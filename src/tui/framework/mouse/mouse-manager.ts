import type { MouseEvent as TuiMouseEvent } from '../../lib/mouse.js'
import type { MouseCursorShape } from '../../lib/mouse-cursor.js'
import { MouseCursor } from '../../lib/mouse-cursor.js'
import type { Tui } from '../../lib/tui.js'
import type { RenderObject } from '../render-object.js'
import { RenderMouseRegion } from '../widgets/mouse-region.js'
import type { HitTestEntry } from './hit-test.js'
import { HitTestManager } from './hit-test.js'
import type {
	MouseDragEvent,
	MouseEnterEvent,
	MouseEventTarget,
	MouseExitEvent,
	MouseHoverEvent,
	MousePosition,
	MouseReleaseEvent,
} from './mouse-events.js'
import {
	createMouseClickEvent,
	createMouseScrollEvent,
	createWidgetMouseEvent,
} from './mouse-events.js'

/**
 * Manages mouse events and dispatches them to the appropriate widgets.
 *
 * This is similar to Flutter's MouseTracker but simplified for terminal UI.
 * It handles hit testing, hover tracking, and event dispatch.
 */
export class MouseManager {
	private static _instance: MouseManager | null = null

	private _rootRenderObject: RenderObject | null = null
	private _hoveredRegions = new Set<RenderMouseRegion>()
	private _vaxis: Tui | null = null
	private _currentCursor: MouseCursorShape = MouseCursor.DEFAULT
	private _lastMousePosition: MousePosition | null = null
	private _dragTargets: Array<{
		target: MouseEventTarget
		localPosition: MousePosition
		globalOffset: MousePosition // Store the target's global position when drag starts
	}> = []
	private _lastDragPosition: MousePosition | null = null
	private _globalReleaseCallbacks = new Set<() => void>()
	private _globalClickCallbacks = new Set<(event: any) => void>()

	// Click tracking for multi-click detection (per button)
	private _lastClickTime = new Map<string, number>()
	private _lastClickPosition = new Map<string, MousePosition>()
	private _currentClickCount = new Map<string, number>()
	private static readonly DOUBLE_CLICK_TIME = 500 // ms
	private static readonly DOUBLE_CLICK_DISTANCE = 2 // pixels/cells
	private static readonly DOUBLE_CLICK_DISTANCE_SQUARED =
		MouseManager.DOUBLE_CLICK_DISTANCE * MouseManager.DOUBLE_CLICK_DISTANCE

	// PERFORMANCE: Reuse scratch objects to reduce allocations during mouse move events
	private _scratchCurrentRegions = new Set<RenderMouseRegion>()
	private _scratchEnteredRegions = new Set<RenderMouseRegion>()
	private _scratchExitedRegions = new Set<RenderMouseRegion>()

	private constructor() {}

	/**
	 * Get the singleton instance of the MouseManager.
	 */
	static get instance(): MouseManager {
		if (!this._instance) {
			this._instance = new MouseManager()
		}
		return this._instance
	}

	/**
	 * Set the root render object for hit testing.
	 */
	setRootRenderObject(root: RenderObject): void {
		this._rootRenderObject = root
	}

	/**
	 * Set the Tui instance for cursor management.
	 */
	setTui(vaxis: Tui): void {
		this._vaxis = vaxis
	}

	/**
	 * Handle a mouse event from Tui and dispatch it to appropriate widgets.
	 */
	handleMouseEvent(vaxisEvent: TuiMouseEvent): void {
		if (!this._rootRenderObject) {
			return // No root to hit test against
		}

		const globalPosition: MousePosition = {
			x: vaxisEvent.x,
			y: vaxisEvent.y,
		}

		// Perform hit testing to find which widgets are under the mouse
		const hitTestResult = HitTestManager.hitTest(this._rootRenderObject, globalPosition)

		// Find render objects that can handle mouse events in the hit test results
		const mouseTargets = this._findMouseTargets(hitTestResult.hits)

		// Handle different types of mouse events
		switch (vaxisEvent.action) {
			case 'press':
				if (
					vaxisEvent.button === 'left' ||
					vaxisEvent.button === 'middle' ||
					vaxisEvent.button === 'right'
				) {
					this._handleClick(vaxisEvent, globalPosition, mouseTargets)
					// Store drag targets for left mouse button to handle future drag events
					if (vaxisEvent.button === 'left') {
						// Store targets with their global offsets for accurate drag calculation
						this._dragTargets = mouseTargets.map(({ target, localPosition }) => {
							// Calculate global offset (globalPos - localPos = global offset of target)
							const globalOffset = {
								x: globalPosition.x - localPosition.x,
								y: globalPosition.y - localPosition.y,
							}
							return { target, localPosition, globalOffset }
						})
					}
				}
				break

			case 'release':
				this._handleRelease(vaxisEvent, globalPosition, mouseTargets)
				// Clear drag targets when mouse is released
				this._dragTargets = []
				this._lastDragPosition = null
				break

			case 'scroll':
				if (vaxisEvent.button === 'wheel_up' || vaxisEvent.button === 'wheel_down') {
					this._handleScroll(vaxisEvent, globalPosition, mouseTargets)
				}
				break

			case 'move':
				this._handleMove(vaxisEvent, globalPosition, mouseTargets)
				// Handle drag if SGR motion flag is set
				if (vaxisEvent.drag) {
					this._handleDrag(vaxisEvent, globalPosition, mouseTargets)
				}
				break
		}

		this._lastMousePosition = globalPosition
	}

	/**
	 * Add a global callback for mouse release events.
	 */
	addGlobalReleaseCallback(callback: () => void): void {
		this._globalReleaseCallbacks.add(callback)
	}

	/**
	 * Remove a global callback for mouse release events.
	 */
	removeGlobalReleaseCallback(callback: () => void): void {
		this._globalReleaseCallbacks.delete(callback)
	}

	/**
	 * Add a global callback for mouse click events.
	 */
	addGlobalClickCallback(callback: (event: any) => void): void {
		this._globalClickCallbacks.add(callback)
	}

	/**
	 * Remove a global callback for mouse click events.
	 */
	removeGlobalClickCallback(callback: (event: any) => void): void {
		this._globalClickCallbacks.delete(callback)
	}

	/**
	 * Request a cursor change. This allows widgets to dynamically change the cursor.
	 * The cursor will remain active until changed again or reset to default.
	 */
	requestCursorChange(cursor: MouseCursorShape): void {
		if (this._vaxis && cursor !== this._currentCursor) {
			this._currentCursor = cursor
			this._vaxis.setMouseCursor(cursor)
		}
	}

	/**
	 * Handle mouse release events.
	 */
	private _handleRelease(
		vaxisEvent: TuiMouseEvent,
		globalPosition: MousePosition,
		mouseTargets: Array<{ target: MouseEventTarget; localPosition: MousePosition }>,
	): void {
		// Call global release callbacks first (for things like selection areas)
		for (const callback of this._globalReleaseCallbacks) {
			callback()
		}

		const button =
			vaxisEvent.button === 'left' ||
			vaxisEvent.button === 'middle' ||
			vaxisEvent.button === 'right'
				? vaxisEvent.button
				: 'left'

		// If we have active drag targets, send release to them first (even if mouse moved away)
		if (this._dragTargets.length > 0) {
			for (const { target, globalOffset } of this._dragTargets) {
				const localPosition = {
					x: globalPosition.x - globalOffset.x,
					y: globalPosition.y - globalOffset.y,
				}
				const releaseEvent: MouseReleaseEvent = {
					type: 'release',
					button,
					...createWidgetMouseEvent(vaxisEvent, globalPosition, localPosition),
				}
				target.handleMouseEvent(releaseEvent)
			}
		} else {
			// Otherwise, send release events to current mouse targets
			for (const { target, localPosition } of mouseTargets) {
				const releaseEvent: MouseReleaseEvent = {
					type: 'release',
					button,
					...createWidgetMouseEvent(vaxisEvent, globalPosition, localPosition),
				}
				target.handleMouseEvent(releaseEvent)

				// For RenderMouseRegion, check if it's opaque to stop propagation
				if (target instanceof RenderMouseRegion && target.opaque) {
					break
				}
			}
		}
	}

	/**
	 * Handle mouse drag events during button-held movement.
	 */
	private _handleDrag(
		vaxisEvent: TuiMouseEvent,
		globalPosition: MousePosition,
		mouseTargets: Array<{ target: MouseEventTarget; localPosition: MousePosition }>,
	): void {
		const button =
			vaxisEvent.button === 'left' ||
			vaxisEvent.button === 'middle' ||
			vaxisEvent.button === 'right'
				? vaxisEvent.button
				: 'left'

		const deltaX = this._lastDragPosition ? globalPosition.x - this._lastDragPosition.x : 0
		const deltaY = this._lastDragPosition ? globalPosition.y - this._lastDragPosition.y : 0

		// Send drag events to the original drag targets
		for (const { target, globalOffset } of this._dragTargets) {
			// Calculate local position using stored global offset
			const localPosition = {
				x: globalPosition.x - globalOffset.x,
				y: globalPosition.y - globalOffset.y,
			}

			const dragEvent: MouseDragEvent = {
				type: 'drag',
				button,
				deltaX,
				deltaY,
				...createWidgetMouseEvent(vaxisEvent, globalPosition, localPosition),
			}

			target.handleMouseEvent(dragEvent)
		}

		this._lastDragPosition = globalPosition
	}

	/**
	 * Handle mouse click events.
	 */
	private _handleClick(
		vaxisEvent: TuiMouseEvent,
		globalPosition: MousePosition,
		mouseTargets: Array<{ target: MouseEventTarget; localPosition: MousePosition }>,
	): void {
		// Calculate click count for multi-click detection
		const clickCount = this._calculateClickCount(globalPosition, vaxisEvent.button)

		// Call global click callbacks first (for things like selection areas)
		for (const callback of this._globalClickCallbacks) {
			callback({ event: vaxisEvent, globalPosition, mouseTargets, clickCount })
		}

		// Dispatch click event to targets that can handle clicks
		for (const { target, localPosition } of mouseTargets) {
			const clickEvent = createMouseClickEvent(
				vaxisEvent,
				globalPosition,
				localPosition,
				clickCount,
			)
			target.handleMouseEvent(clickEvent)

			// For RenderMouseRegion, check if it's opaque to stop propagation
			if (target instanceof RenderMouseRegion && target.opaque) {
				break
			}
		}
	}

	/**
	 * Handle mouse scroll events.
	 */
	private _handleScroll(
		vaxisEvent: TuiMouseEvent,
		globalPosition: MousePosition,
		mouseTargets: Array<{ target: MouseEventTarget; localPosition: MousePosition }>,
	): void {
		// Dispatch scroll event to targets that can handle scrolling
		for (const { target, localPosition } of mouseTargets) {
			const scrollEvent = createMouseScrollEvent(vaxisEvent, globalPosition, localPosition)
			target.handleMouseEvent(scrollEvent)

			// For RenderMouseRegion, check if it's opaque to stop propagation
			if (target instanceof RenderMouseRegion && target.opaque) {
				break
			}
		}
	}

	/**
	 * Handle mouse move events (hover, enter, exit).
	 */
	private _handleMove(
		vaxisEvent: TuiMouseEvent,
		globalPosition: MousePosition,
		mouseTargets: Array<{ target: MouseEventTarget; localPosition: MousePosition }>,
	): void {
		// Filter to only RenderMouseRegion instances for hover/enter/exit events
		const mouseRegions = mouseTargets.filter(
			(mt) => mt.target instanceof RenderMouseRegion,
		) as Array<{ target: RenderMouseRegion; localPosition: MousePosition }>

		// PERFORMANCE: Reuse scratch sets to avoid allocations
		const currentRegions = this._scratchCurrentRegions
		const exitedRegions = this._scratchExitedRegions
		const enteredRegions = this._scratchEnteredRegions

		// Clear and rebuild current regions set
		currentRegions.clear()
		for (const { target } of mouseRegions) {
			currentRegions.add(target)
		}

		// Find regions that were previously hovered but are no longer under the mouse
		exitedRegions.clear()
		for (const region of this._hoveredRegions) {
			if (!currentRegions.has(region)) {
				exitedRegions.add(region)
			}
		}

		// Find regions that are now under the mouse but weren't before
		enteredRegions.clear()
		for (const region of currentRegions) {
			if (!this._hoveredRegions.has(region)) {
				enteredRegions.add(region)
			}
		}

		// Send exit events
		for (const region of exitedRegions) {
			if (region.onExit) {
				const exitEvent: MouseExitEvent = {
					type: 'exit',
					position: globalPosition,
					localPosition: globalPosition, // Exit events use global position
					modifiers: {
						shift: vaxisEvent.modifiers.shift,
						ctrl: vaxisEvent.modifiers.ctrl,
						alt: vaxisEvent.modifiers.alt,
					},
				}
				region.handleMouseEvent(exitEvent)
			}
		}

		// Send enter events
		for (const { target: region, localPosition } of mouseRegions) {
			if (enteredRegions.has(region) && region.onEnter) {
				const enterEvent: MouseEnterEvent = {
					type: 'enter',
					position: globalPosition,
					localPosition,
					modifiers: {
						shift: vaxisEvent.modifiers.shift,
						ctrl: vaxisEvent.modifiers.ctrl,
						alt: vaxisEvent.modifiers.alt,
					},
				}
				region.handleMouseEvent(enterEvent)
			}
		}

		// Send hover events to all currently hovered regions
		for (const { target: region, localPosition } of mouseRegions) {
			if (region.onHover && this._hoveredRegions.has(region)) {
				const hoverEvent: MouseHoverEvent = {
					type: 'hover',
					position: globalPosition,
					localPosition,
					modifiers: {
						shift: vaxisEvent.modifiers.shift,
						ctrl: vaxisEvent.modifiers.ctrl,
						alt: vaxisEvent.modifiers.alt,
					},
				}
				region.handleMouseEvent(hoverEvent)
			}
		}

		// Update the set of currently hovered regions
		// PERFORMANCE: Copy from scratch set to persistent set
		this._hoveredRegions.clear()
		for (const region of currentRegions) {
			this._hoveredRegions.add(region)
		}

		// Update cursor based on topmost region with a cursor
		this._updateCursor(mouseRegions)
	}

	/**
	 * Update the cursor based on the topmost MouseRegion that specifies a cursor.
	 */
	private _updateCursor(
		mouseRegions: Array<{ target: RenderMouseRegion; localPosition: MousePosition }>,
	): void {
		if (!this._vaxis) {
			return
		}

		// Find the last region that explicitly specifies a cursor (prioritize children over parents)
		let newCursor: MouseCursorShape = MouseCursor.DEFAULT
		for (const { target: region } of mouseRegions) {
			if (region.cursor !== null) {
				newCursor = region.cursor
				// Don't break - keep looking for deeper children
			}
		}

		// Only update if cursor changed
		if (newCursor !== this._currentCursor) {
			this._currentCursor = newCursor
			this._vaxis.setMouseCursor(newCursor)
		}
	}

	/**
	 * Find render objects that can handle mouse events in hit test results.
	 * This includes both RenderMouseRegion and any RenderObject that implements MouseEventTarget.
	 */
	private _findMouseTargets(
		hits: readonly HitTestEntry[],
	): Array<{ target: MouseEventTarget; localPosition: MousePosition }> {
		const mouseTargets: Array<{ target: MouseEventTarget; localPosition: MousePosition }> = []

		for (const hit of hits) {
			// Check if the hit target can handle mouse events
			if (this._canHandleMouseEvents(hit.target)) {
				mouseTargets.push({
					target: hit.target as unknown as MouseEventTarget,
					localPosition: hit.localPosition,
				})
			}
		}

		return mouseTargets
	}

	/**
	 * Check if a RenderObject can handle mouse events.
	 */
	private _canHandleMouseEvents(renderObject: RenderObject): boolean {
		// Check if it's a RenderMouseRegion (always handles mouse events)
		if (renderObject instanceof RenderMouseRegion) {
			return true
		}

		// Check if it implements MouseEventTarget interface
		const target = renderObject as any
		return typeof target.handleMouseEvent === 'function'
	}

	/**
	 * Clear all hover state (used when cleaning up).
	 */
	clearHoverState(): void {
		this._hoveredRegions.clear()
		this._dragTargets = []
		// Reset cursor to default
		if (this._vaxis && this._currentCursor !== MouseCursor.DEFAULT) {
			this._currentCursor = MouseCursor.DEFAULT
			this._vaxis.setMouseCursor(MouseCursor.DEFAULT)
		}
		// Don't clear _lastMousePosition here - we might need it to re-establish hover state
	}

	/**
	 * Remove a specific region from hover state (called when region is disposed).
	 */
	removeRegion(region: RenderMouseRegion): void {
		this._hoveredRegions.delete(region)
	}

	/**
	 * Re-establish hover state after widgets are rebuilt (e.g., after resize).
	 * This simulates a mouse move event at the last known position.
	 */
	reestablishHoverState(): void {
		if (!this._lastMousePosition || !this._rootRenderObject) {
			return
		}

		// Create a synthetic mouse move event at the last known position
		const syntheticEvent = {
			type: 'mouse' as const,
			action: 'move' as const,
			x: this._lastMousePosition.x,
			y: this._lastMousePosition.y,
			button: 'unknown' as const,
			drag: false,
			modifiers: {
				shift: false,
				ctrl: false,
				alt: false,
				meta: false,
			},
		}

		// Handle the synthetic move event to re-establish hover state
		this.handleMouseEvent(syntheticEvent)
	}

	/**
	 * Calculate click count for multi-click detection.
	 */
	private _calculateClickCount(globalPosition: MousePosition, button = 'left'): number {
		const currentTime = Date.now()
		const lastTime = this._lastClickTime.get(button) ?? 0
		const timeSinceLastClick = currentTime - lastTime

		let clickCount = 1 // Default to single click

		// Check if this could be a multi-click
		const lastPos = this._lastClickPosition.get(button)
		if (
			lastPos &&
			timeSinceLastClick <= MouseManager.DOUBLE_CLICK_TIME &&
			this._isWithinDoubleClickDistance(globalPosition, lastPos)
		) {
			// This is a continuation of a multi-click sequence
			const currentCount = this._currentClickCount.get(button) ?? 0
			clickCount = currentCount + 1
		} else {
			// This is a new click sequence
			clickCount = 1
		}

		// Update tracking state
		this._lastClickTime.set(button, currentTime)
		this._lastClickPosition.set(button, globalPosition)
		this._currentClickCount.set(button, clickCount)

		return clickCount
	}

	/**
	 * Check if two positions are within double-click distance.
	 * PERFORMANCE: Uses squared distance to avoid expensive sqrt calculation.
	 */
	private _isWithinDoubleClickDistance(pos1: MousePosition, pos2: MousePosition): boolean {
		const dx = pos1.x - pos2.x
		const dy = pos1.y - pos2.y
		const distanceSquared = dx * dx + dy * dy
		return distanceSquared <= MouseManager.DOUBLE_CLICK_DISTANCE_SQUARED
	}

	/**
	 * Dispose of the mouse manager and clean up resources.
	 */
	dispose(): void {
		this.clearHoverState()
		this._lastMousePosition = null
		this._rootRenderObject = null
		this._lastClickTime.clear()
		this._lastClickPosition.clear()
		this._currentClickCount.clear()
		this._globalReleaseCallbacks.clear()
		this._globalClickCallbacks.clear()
		MouseManager._instance = null
	}
}

// @ts-nocheck
import logger from '../../../logger.js'

import { clipboard } from '../../../lib/clipboard.js'
import { MouseCursor, type MouseCursorShape } from '../../../lib/mouse-cursor.js'
import type { KeyboardEvent } from '../../../lib/parser/types.js'
import type { BuildContext } from '../../build-context.js'
import { FocusNode, KeyEventResult } from '../../focus/focus-node.js'
import type { Key } from '../../key.js'
import type { MouseClickEvent, MouseExitEvent, MouseHoverEvent } from '../../mouse/mouse-events.js'
import { MouseManager } from '../../mouse/mouse-manager.js'
import { State } from '../../state.js'
import { StatefulWidget } from '../../stateful-widget.js'
import type { Widget } from '../../widget.js'
import { Focus } from '../focus.js'
import { MouseRegion, RenderMouseRegion } from '../mouse-region.js'
import { InheritedSelectionArea } from './inherited-selection-area.js'
import { SelectionAreaControllerImpl } from './selection-area-controller.js'
import type { DocumentPosition } from './selection-core.js'

/**
 * A widget that enables text selection within its subtree.
 *
 * This refactored version uses a centralized SelectionAreaController
 * to manage selection state across multiple Selectable render objects.
 *
 * Key improvements over the old implementation:
 * - Centralized selection state management
 * - Direct render object updates (no widget rebuilds)
 * - On-demand global mouse event capture
 * - Clean registration via InheritedSelectionArea
 */
export class SelectionArea extends StatefulWidget {
	public readonly child: Widget
	public readonly focusNode?: FocusNode
	public readonly enabled: boolean
	public readonly onCopy?: (text: string) => void

	constructor({
		key,
		child,
		focusNode,
		enabled = true,
		onCopy,
	}: {
		key?: Key
		child: Widget
		focusNode?: FocusNode
		enabled?: boolean
		onCopy?: (text: string) => void
	}) {
		super({ key })
		this.child = child
		this.focusNode = focusNode
		this.enabled = enabled
		this.onCopy = onCopy
	}

	createState(): State<this> {
		return new SelectionAreaState() as unknown as State<this>
	}
}

export class SelectionAreaState extends State<SelectionArea> {
	private _controller!: SelectionAreaControllerImpl
	private _focusNode!: FocusNode
	private _globalReleaseCallback?: () => void
	private _globalMoveCallback?: () => void
	private _globalClickCallback?: (event: any) => void
	private _doubleClickTimer?: NodeJS.Timeout
	private _tripleClickTimer?: NodeJS.Timeout

	// Dynamic cursor optimization
	private _lastHoverCheck = 0
	private _lastHoverPosition = { x: -1, y: -1 }
	private _currentCursor: MouseCursorShape = MouseCursor.DEFAULT

	get controller(): SelectionAreaControllerImpl {
		return this._controller
	}

	get focusNode(): FocusNode {
		return this._focusNode
	}

	initState(): void {
		super.initState()
		this._controller = new SelectionAreaControllerImpl()

		// Set up copy callback
		this._controller.setOnCopyCallback(this.widget.onCopy)

		this._focusNode =
			this.widget.focusNode ??
			new FocusNode({
				debugLabel: 'SelectionArea',
				onKey: this._handleKeyEvent.bind(this),
			})

		// Set up global click callback to clear selection when clicking outside
		this._globalClickCallback = this._handleGlobalClick.bind(this)
		MouseManager.instance.addGlobalClickCallback(this._globalClickCallback)
	}

	build(context: BuildContext): Widget {
		if (!this.widget.enabled) {
			return this.widget.child
		}

		// Wrap child in MouseRegion to capture mouse events
		// Set opaque: false to allow events to propagate to child widgets when not handled
		// Set cursor dynamically based on whether we're over selectable content
		const mouseRegion = new MouseRegion({
			onClick: this._handleMouseClick.bind(this),
			onDrag: this._handleMouseDrag.bind(this),
			onHover: this._handleMouseHover.bind(this), // Re-enabled with efficient implementation
			onExit: this._handleMouseExit.bind(this),
			cursor: this._currentCursor, // Dynamic cursor based on content under mouse
			opaque: false, // Allow event propagation to child widgets
			child: this.widget.child,
		})

		return new Focus({
			focusNode: this._focusNode,
			child: new InheritedSelectionArea({
				controller: this._controller,
				child: mouseRegion,
			}),
		})
	}

	/**
	 * Handle mouse click events to start selection.
	 */
	private _handleMouseClick(event: MouseClickEvent): void {
		if (event.button !== 'left') {
			return
		}

		const globalPoint = { x: event.position.x, y: event.position.y }
		const selectable = this._controller.hitTest(globalPoint)

		if (!selectable) {
			return
		}

		// Convert to local coordinates and get text position
		const localPoint = selectable.globalToLocal(globalPoint)
		const textPos =
			selectable.hitTestSelection(localPoint) ?? selectable.nearestCaretPosition(localPoint)

		// Handle multi-click selection
		if (event.clickCount === 2) {
			// Double-click: select word

			const wordBoundary = selectable.wordBoundary(textPos)
			const anchor: DocumentPosition = {
				selectableId: selectable.selectableId,
				offset: wordBoundary.start,
			}
			const extent: DocumentPosition = {
				selectableId: selectable.selectableId,
				offset: wordBoundary.end,
			}
			this._controller.setSelection({ anchor, extent })

			// Wait 500ms to see if a triple-click follows
			this._doubleClickTimer = setTimeout(() => {
				// Auto-copy the word selection if no triple-click happened
				this._controller.autoCopySelection()
				this._doubleClickTimer = undefined
			}, 500)
			return
		} else if (event.clickCount === 3) {
			// Cancel any pending double-click copy
			if (this._doubleClickTimer) {
				clearTimeout(this._doubleClickTimer)
				this._doubleClickTimer = undefined
			}

			// Triple-click: select paragraph or line based on context
			const context = selectable.getSelectionContext?.() ?? 'line'

			let boundary: { start: number; end: number }
			if (context === 'paragraph' && selectable.paragraphBoundary) {
				boundary = selectable.paragraphBoundary(textPos)
			} else {
				boundary = selectable.lineBoundary(textPos)
			}

			const anchor: DocumentPosition = {
				selectableId: selectable.selectableId,
				offset: boundary.start,
			}
			const extent: DocumentPosition = {
				selectableId: selectable.selectableId,
				offset: boundary.end,
			}
			this._controller.setSelection({ anchor, extent })

			// Wait 200ms before copying triple-click selection
			this._tripleClickTimer = setTimeout(() => {
				// Auto-copy the line/paragraph selection
				this._controller.autoCopySelection()
				this._tripleClickTimer = undefined
			}, 200)
			return
		}

		// Single-click: begin drag selection
		// Clear any pending click timers since we're starting a drag
		if (this._doubleClickTimer) {
			clearTimeout(this._doubleClickTimer)
			this._doubleClickTimer = undefined
		}
		if (this._tripleClickTimer) {
			clearTimeout(this._tripleClickTimer)
			this._tripleClickTimer = undefined
		}

		const anchor: DocumentPosition = {
			selectableId: selectable.selectableId,
			offset: textPos.offset,
		}

		this._controller.beginDrag(anchor)
		this._captureGlobalMouse()
	}

	/**
	 * Handle mouse drag events during selection.
	 */
	private _handleMouseDrag(event: any): void {
		if (!this._controller.isDragging()) return

		const globalPoint = { x: event.position.x, y: event.position.y }
		let selectable = this._controller.hitTest(globalPoint)

		// If no direct hit, find the closest selectable for out-of-bounds drag
		if (!selectable) {
			selectable = this._findClosestSelectable(globalPoint)
		}

		if (!selectable) {
			return
		}

		const localPoint = selectable.globalToLocal(globalPoint)
		let textPos = selectable.nearestCaretPosition(localPoint)

		// Special handling for out-of-bounds coordinates to extend selection properly
		if (!this._controller.hitTest(globalPoint)) {
			textPos = this._getOutOfBoundsPosition(selectable, globalPoint, localPoint)
		}

		const extent: DocumentPosition = {
			selectableId: selectable.selectableId,
			offset: textPos.offset,
		}

		this._controller.updateDrag(extent)
	}

	/**
	 * Handle mouse hover events to update cursor.
	 */
	private _handleMouseHover(event: MouseHoverEvent): void {
		const globalPoint = { x: event.position.x, y: event.position.y }

		// Throttle hover checks to ~60fps max
		const now = Date.now()
		if (now - this._lastHoverCheck < 16) {
			return
		}

		// Skip if mouse hasn't actually moved
		if (
			globalPoint.x === this._lastHoverPosition.x &&
			globalPoint.y === this._lastHoverPosition.y
		) {
			return
		}

		this._lastHoverCheck = now
		this._lastHoverPosition = { x: globalPoint.x, y: globalPoint.y }

		// Keep TEXT cursor during active drag, otherwise check for selectable content
		let newCursor: MouseCursorShape

		if (this._controller.isDragging()) {
			newCursor = MouseCursor.TEXT
		} else {
			const selectable = this._controller.hitTest(globalPoint)
			if (selectable) {
				// Check if there's a clickable span at this position
				const localPoint = selectable.globalToLocal(globalPoint)
				if ('getOnClickAtPosition' in selectable) {
					const onClick = (selectable as any).getOnClickAtPosition(
						localPoint.x,
						localPoint.y,
					)
					newCursor = onClick ? MouseCursor.POINTER : MouseCursor.TEXT
				} else {
					newCursor = MouseCursor.TEXT
				}
			} else {
				newCursor = MouseCursor.DEFAULT
			}
		}

		// Only update cursor if it actually changed and widget is still mounted
		if (newCursor !== this._currentCursor && this.mounted) {
			this._currentCursor = newCursor

			// Update cursor directly on render object instead of rebuilding entire widget tree
			const renderObject = this.context.findRenderObject()
			if (renderObject instanceof RenderMouseRegion) {
				renderObject.cursor = newCursor
			}
		}
	}

	/**
	 * Handle mouse exit events to reset cursor.
	 */
	private _handleMouseExit(event: MouseExitEvent): void {
		// Reset cursor to default when leaving the SelectionArea

		if (this._currentCursor !== MouseCursor.DEFAULT && this.mounted) {
			this._currentCursor = MouseCursor.DEFAULT

			// Update cursor directly on render object instead of rebuilding entire widget tree
			const renderObject = this.context.findRenderObject()
			if (renderObject instanceof RenderMouseRegion) {
				renderObject.cursor = MouseCursor.DEFAULT
			}
		}
	}

	/**
	 * Handle global click events to clear selection when clicking outside selectable content.
	 */
	private _handleGlobalClick = (data: {
		event: any
		globalPosition: { x: number; y: number }
		mouseTargets: any[]
		clickCount: number
	}): void => {
		// Only handle left clicks
		if (data.event.button !== 'left') {
			return
		}

		// If there's no selection, no need to hit test
		if (!this._controller.getSelection()) {
			return
		}

		// Check if the click was on any selectable content
		const selectable = this._controller.hitTest(data.globalPosition)

		// If click was outside selectable content, clear the selection
		if (!selectable) {
			this._controller.clear()
		}
	}

	/**
	 * Find selectables that intersect the current mouse line.
	 */
	private _findClosestSelectable(globalPoint: { x: number; y: number }): any | null {
		const selectables = this._controller.getAllSelectables()
		if (selectables.length === 0) return null

		// Find all selectables that intersect the mouse Y coordinate
		const candidates = selectables.filter((selectable) => {
			const bounds = selectable.globalBounds()
			return globalPoint.y >= bounds.top && globalPoint.y <= bounds.bottom
		})

		if (candidates.length === 0) {
			return null // No selectable on this line - don't jump to random selectable
		}

		// Return the closest horizontally
		return candidates.reduce((best, current) => {
			const currentBounds = current.globalBounds()
			const bestBounds = best.globalBounds()

			const currentDistance = Math.min(
				Math.abs(globalPoint.x - currentBounds.left),
				Math.abs(globalPoint.x - currentBounds.right),
			)
			const bestDistance = Math.min(
				Math.abs(globalPoint.x - bestBounds.left),
				Math.abs(globalPoint.x - bestBounds.right),
			)

			return currentDistance < bestDistance ? current : best
		})
	}

	/**
	 * Get the appropriate text position for out-of-bounds coordinates.
	 */
	private _getOutOfBoundsPosition(
		selectable: any,
		globalPoint: { x: number; y: number },
		localPoint: { x: number; y: number },
	) {
		const bounds = selectable.globalBounds()

		// If above the widget, select from start
		if (globalPoint.y < bounds.top) {
			return { offset: 0 }
		}

		// If below the widget, select to end
		if (globalPoint.y >= bounds.bottom) {
			const textLength = selectable.textLength
				? selectable.textLength()
				: (selectable.plainText?.length ?? 0)
			return { offset: textLength }
		}

		// If to the left or right, use the normal nearest position
		return selectable.nearestCaretPosition(localPoint)
	}

	/**
	 * Handle global mouse move events during drag selection.
	 */
	// private _handleGlobalMouseMove = (): void => {
	// Note: In a real implementation, we'd need the actual mouse position
	// The current mouse system doesn't provide this directly in the callback
	// For now, this is handled by the MouseRegion's onDrag callback
	// }

	/**
	 * Handle global mouse release events to end selection.
	 */
	private _handleGlobalMouseRelease = (): void => {
		if (this._controller.isDragging()) {
			this._controller.endDrag()
			this._releaseGlobalMouse()
		}
	}

	/**
	 * Capture global mouse events for drag selection.
	 */
	private _captureGlobalMouse(): void {
		// Set up global mouse release callback
		this._globalReleaseCallback = this._handleGlobalMouseRelease
		MouseManager.instance.addGlobalReleaseCallback(this._globalReleaseCallback)

		// TODO: Add global mouse move callback when available
		// This would allow selection to continue even when mouse leaves the widget
	}

	/**
	 * Release global mouse event capture.
	 */
	private _releaseGlobalMouse(): void {
		if (this._globalReleaseCallback) {
			MouseManager.instance.removeGlobalReleaseCallback(this._globalReleaseCallback)
			this._globalReleaseCallback = undefined
		}

		if (this._globalMoveCallback) {
			// TODO: Remove global move callback when available
			this._globalMoveCallback = undefined
		}
	}

	/**
	 * Handle keyboard events for selection control.
	 */
	private _handleKeyEvent(event: KeyboardEvent): KeyEventResult {
		// Handle Ctrl+A to select all
		if (event.key === 'a' && event.ctrlKey) {
			this._controller.selectAll()
			return KeyEventResult.handled
		}

		// Handle Ctrl+C to copy selection
		if (event.key === 'c' && event.ctrlKey) {
			const text = this._controller.copySelection()
			if (text) {
				// Copy to clipboard asynchronously
				clipboard
					.writeText(text)
					.then(() => {
						// Manually trigger copy highlight with timer for Ctrl+C
						this._controller.startCopyHighlight()
						setTimeout(() => {
							this._controller.endCopyHighlight()
							// Clear selection after copying (after highlight ends)
							this._controller.clear()
						}, 300)

						// Call the onCopy callback if provided
						this.widget.onCopy?.(text)
					})
					.catch((error) => {
						logger.debug('Failed to write selection to clipboard:', error)
					})
				return KeyEventResult.handled
			}
		}

		// Handle Escape to clear selection
		if (event.key === 'Escape') {
			const text = this._controller.copySelection()
			if (text) {
				this._controller.clear()
				return KeyEventResult.handled
			}
		}

		// TODO: Add Shift + arrow key selection
		// This will require implementing the nextVisualPosition methods
		// in Selectable and adding caret position tracking

		return KeyEventResult.ignored
	}

	dispose(): void {
		// Clear any pending click timers
		if (this._doubleClickTimer) {
			clearTimeout(this._doubleClickTimer)
			this._doubleClickTimer = undefined
		}
		if (this._tripleClickTimer) {
			clearTimeout(this._tripleClickTimer)
			this._tripleClickTimer = undefined
		}

		// Release global mouse capture
		this._releaseGlobalMouse()

		// Remove global click callback
		if (this._globalClickCallback) {
			MouseManager.instance.removeGlobalClickCallback(this._globalClickCallback)
			this._globalClickCallback = undefined
		}

		// Dispose controller
		this._controller.dispose()

		// Don't dispose focusNode if it was provided by the widget
		if (!this.widget.focusNode) {
			this._focusNode.dispose()
		}

		super.dispose()
	}
}

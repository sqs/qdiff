import { assert } from '../../lib/assert.js'
import type { MouseCursorShape } from '../../lib/mouse-cursor.js'
import type { ScreenSurface } from '../../lib/screen-surface.js'
import type { Key } from '../key.js'
import type { HitTestResultInterface } from '../mouse/hit-test.js'
import type {
	AnyMouseEvent,
	MouseClickHandler,
	MouseDragHandler,
	MouseEnterHandler,
	MouseExitHandler,
	MouseHoverHandler,
	MousePosition,
	MouseReleaseHandler,
	MouseScrollHandler,
} from '../mouse/mouse-events.js'
import { MouseManager } from '../mouse/mouse-manager.js'
import { RenderBox as RenderBoxClass } from '../render-object.js'
import {
	SingleChildRenderObjectElement,
	SingleChildRenderObjectWidget,
} from '../render-object-widget.js'
import type { Widget } from '../widget.js'

/**
 * A widget that detects mouse events within its bounds.
 *
 * Based on Flutter's MouseRegion but adapted for terminal UI.
 * This is the foundation widget that other interactive widgets build upon.
 */
export class MouseRegion extends SingleChildRenderObjectWidget {
	readonly child: Widget
	readonly onClick: MouseClickHandler | null
	readonly onEnter: MouseEnterHandler | null
	readonly onExit: MouseExitHandler | null
	readonly onHover: MouseHoverHandler | null
	readonly onScroll: MouseScrollHandler | null
	readonly onRelease: MouseReleaseHandler | null
	readonly onDrag: MouseDragHandler | null
	readonly cursor: MouseCursorShape | null
	readonly opaque: boolean

	constructor({
		key,
		child,
		onClick,
		onEnter,
		onExit,
		onHover,
		onScroll,
		onRelease,
		onDrag,
		cursor,
		opaque = true,
	}: {
		key?: Key
		child: Widget
		onClick?: MouseClickHandler
		onEnter?: MouseEnterHandler
		onExit?: MouseExitHandler
		onHover?: MouseHoverHandler
		onScroll?: MouseScrollHandler
		onRelease?: MouseReleaseHandler
		onDrag?: MouseDragHandler
		cursor?: MouseCursorShape
		opaque?: boolean
	}) {
		super({ key })
		this.child = child
		this.onClick = onClick ?? null
		this.onEnter = onEnter ?? null
		this.onExit = onExit ?? null
		this.onHover = onHover ?? null
		this.onScroll = onScroll ?? null
		this.onRelease = onRelease ?? null
		this.onDrag = onDrag ?? null
		this.cursor = cursor ?? null
		this.opaque = opaque
	}

	createElement(): MouseRegionElement {
		return new MouseRegionElement(this)
	}

	createRenderObject(): RenderMouseRegion {
		return new RenderMouseRegion({
			onClick: this.onClick,
			onEnter: this.onEnter,
			onExit: this.onExit,
			onHover: this.onHover,
			onScroll: this.onScroll,
			onRelease: this.onRelease,
			onDrag: this.onDrag,
			cursor: this.cursor,
			opaque: this.opaque,
		})
	}

	updateRenderObject(renderObject: RenderMouseRegion): void {
		renderObject.onClick = this.onClick
		renderObject.onEnter = this.onEnter
		renderObject.onExit = this.onExit
		renderObject.onHover = this.onHover
		renderObject.onScroll = this.onScroll
		renderObject.onRelease = this.onRelease
		renderObject.onDrag = this.onDrag
		renderObject.cursor = this.cursor
		renderObject.opaque = this.opaque
	}
}

/**
 * Element for MouseRegion widgets.
 */
export class MouseRegionElement extends SingleChildRenderObjectElement {
	get mouseRegionWidget(): MouseRegion {
		return this.widget as MouseRegion
	}

	get renderObject(): RenderMouseRegion {
		return super.renderObject as RenderMouseRegion
	}
}

/**
 * Render object for MouseRegion that handles mouse event detection.
 */
export class RenderMouseRegion extends RenderBoxClass {
	onClick: MouseClickHandler | null
	onEnter: MouseEnterHandler | null
	onExit: MouseExitHandler | null
	onHover: MouseHoverHandler | null
	onScroll: MouseScrollHandler | null
	onRelease: MouseReleaseHandler | null
	onDrag: MouseDragHandler | null
	cursor: MouseCursorShape | null
	opaque: boolean

	private _isHovered = false

	constructor({
		onClick,
		onEnter,
		onExit,
		onHover,
		onScroll,
		onRelease,
		onDrag,
		cursor,
		opaque,
	}: {
		onClick: MouseClickHandler | null
		onEnter: MouseEnterHandler | null
		onExit: MouseExitHandler | null
		onHover: MouseHoverHandler | null
		onScroll: MouseScrollHandler | null
		onRelease: MouseReleaseHandler | null
		onDrag: MouseDragHandler | null
		cursor: MouseCursorShape | null
		opaque: boolean
	}) {
		super()
		this.onClick = onClick
		this.onEnter = onEnter
		this.onExit = onExit
		this.onHover = onHover
		this.onScroll = onScroll
		this.onRelease = onRelease
		this.onDrag = onDrag
		this.cursor = cursor
		this.opaque = opaque
	}

	/**
	 * Whether this MouseRegion is interested in mouse events.
	 */
	get hasMouseListeners(): boolean {
		return !!(
			this.onClick ||
			this.onEnter ||
			this.onExit ||
			this.onHover ||
			this.onScroll ||
			this.onRelease ||
			this.onDrag
		)
	}

	/**
	 * Whether the mouse is currently hovering over this region.
	 */
	get isHovered(): boolean {
		return this._isHovered
	}

	/**
	 * Handle a mouse event that occurred within this region's bounds.
	 */
	handleMouseEvent(event: AnyMouseEvent): void {
		switch (event.type) {
			case 'click':
				this.onClick?.(event)
				break
			case 'enter':
				this._isHovered = true
				this.onEnter?.(event)
				break
			case 'exit':
				this._isHovered = false
				this.onExit?.(event)
				break
			case 'hover':
				this.onHover?.(event)
				break
			case 'scroll':
				this.onScroll?.(event)
				break
			case 'drag':
				this.onDrag?.(event)
				break
			case 'release':
				this.onRelease?.(event)
				break
		}
	}

	/**
	 * Perform layout (pass-through to child).
	 */
	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		if (this.children.length > 0) {
			// Pass constraints through to child
			const child = this.children[0] as RenderBoxClass
			child.layout(constraints)
			const childSize = child.size
			this.setSize(childSize.width, childSize.height)
			child.setOffset(0, 0)
		} else {
			// No child, use minimum size
			this.setSize(0, 0)
		}

		super.performLayout()
	}

	/**
	 * Pass-through intrinsic sizing to child.
	 */
	getMinIntrinsicHeight(width: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBoxClass
			return child.getMinIntrinsicHeight(width)
		}
		return 0
	}

	getMaxIntrinsicHeight(width: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBoxClass
			return child.getMaxIntrinsicHeight(width)
		}
		return 0
	}

	getMinIntrinsicWidth(height: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBoxClass
			return child.getMinIntrinsicWidth(height)
		}
		return 0
	}

	getMaxIntrinsicWidth(height: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBoxClass
			return child.getMaxIntrinsicWidth(height)
		}
		return 0
	}

	/**
	 * Paint this render object (pass-through to child).
	 */
	paint(screen: ScreenSurface, offsetX: number = 0, offsetY: number = 0): void {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBoxClass
			// Add our offset to the child's paint coordinates
			child.paint(screen, offsetX + this.offset.x, offsetY + this.offset.y)
		}
	}

	/**
	 * Hit test override to register for mouse events.
	 */
	hitTest(
		result: HitTestResultInterface,
		position: MousePosition,
		parentAbsX: number = 0,
		parentAbsY: number = 0,
	): boolean {
		// Call parent hit test implementation
		const hit = super.hitTest(result, position, parentAbsX, parentAbsY)

		// If we have mouse listeners and we were hit, register as a mouse target
		if (hit && this.hasMouseListeners) {
			// Register this render object as a mouse event target
			// This will be used by the mouse event dispatcher
			result.addMouseTarget(this, position)
		}

		return hit
	}

	/**
	 * Get debug properties for this render object.
	 */
	getDebugProperties(): Record<string, any> {
		return {
			hasMouseListeners: this.hasMouseListeners,
			isHovered: this.isHovered,
			cursor: this.cursor,
			opaque: this.opaque,
		}
	}

	dispose(): void {
		// Remove from mouse manager to prevent memory leaks
		MouseManager.instance.removeRegion(this)

		// Clear event handlers to prevent memory leaks
		this.onClick = null
		this.onEnter = null
		this.onExit = null
		this.onHover = null
		this.onScroll = null
		this.onRelease = null
		this.onDrag = null
		this.cursor = null

		super.dispose()
	}
}

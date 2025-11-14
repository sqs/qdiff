import { assert } from '../../lib/assert.js'
import { ClippedScreen } from '../../lib/clipped-screen.js'
import type { Screen } from '../../lib/screen.js'
import type { Key } from '../key.js'
import { RenderBox, type RenderObject } from '../render-object.js'
import { SingleChildRenderObjectWidget } from '../render-object-widget.js'
import type { Widget } from '../widget.js'

/**
 * A widget that clips its child to a rectangular region.
 * Prevents child content from rendering outside the specified bounds.
 */
export class ClipRect extends SingleChildRenderObjectWidget {
	/**
	 * Whether to clip the child to the widget's bounds.
	 * If false, the child can overflow freely.
	 */
	readonly clipBehavior: ClipBehavior

	constructor(
		child: Widget,
		{
			key,
			clipBehavior = ClipBehavior.antiAlias,
		}: {
			key?: Key
			clipBehavior?: ClipBehavior
		} = {},
	) {
		super(key ? { child, key } : { child })
		this.clipBehavior = clipBehavior
	}

	createRenderObject(): RenderObject {
		return new ClipRectRenderObject(this.clipBehavior)
	}

	updateRenderObject(renderObject: RenderObject): void {
		const clipRenderObject = renderObject as ClipRectRenderObject
		clipRenderObject.updateClipBehavior(this.clipBehavior)
	}
}

/**
 * Clipping behavior for ClipRect widget.
 */
export enum ClipBehavior {
	/**
	 * No clipping is applied. Child can render outside bounds.
	 */
	none = 'none',

	/**
	 * Content is clipped to the widget's bounds.
	 */
	antiAlias = 'antiAlias',

	/**
	 * Hard clipping - content outside bounds is not rendered.
	 */
	hardEdge = 'hardEdge',
}

/**
 * Render object for ClipRect widget.
 * Clips child rendering to the widget's bounds.
 */
export class ClipRectRenderObject extends RenderBox {
	private _clipBehavior: ClipBehavior

	constructor(clipBehavior: ClipBehavior) {
		super()
		this._clipBehavior = clipBehavior
	}

	updateClipBehavior(clipBehavior: ClipBehavior): void {
		if (this._clipBehavior !== clipBehavior) {
			this._clipBehavior = clipBehavior
			this.markNeedsPaint()
		}
	}

	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		if (this.children.length === 0) {
			this.setSize(constraints.minWidth, constraints.minHeight)
			super.performLayout()
			return
		}

		// Layout child with same constraints
		const child = this.children[0] as RenderBox
		child.layout(constraints)

		// Set our size to match our constraints (not child size)
		this.setSize(constraints.maxWidth, constraints.maxHeight)

		super.performLayout()
	}

	paint(screen: Screen, offsetX: number = 0, offsetY: number = 0): void {
		if (this.children.length === 0 || this._clipBehavior === ClipBehavior.none) {
			// No clipping - paint child normally
			super.paint(screen, offsetX, offsetY)
			return
		}

		const child = this.children[0] as RenderBox

		// Create clipped screen for child painting
		const clipX = offsetX + this.offset.x
		const clipY = offsetY + this.offset.y
		const clipWidth = this.size.width
		const clipHeight = this.size.height

		const clippedScreen = new ClippedScreen(screen, clipX, clipY, clipWidth, clipHeight)

		// Paint child with clipped screen
		child.paint(clippedScreen, offsetX + this.offset.x, offsetY + this.offset.y)
	}
}

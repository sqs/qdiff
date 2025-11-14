import { assert } from '../../lib/assert.js'
import type { Key } from '../key.js'
import { BoxConstraints, RenderBox } from '../render-object.js'
import { SingleChildRenderObjectWidget } from '../render-object-widget.js'
import type { Widget } from '../widget.js'

/**
 * A widget that forces its child to have a specific width and/or height.
 *
 * If width or height is null, this widget will size itself to match
 * the child's intrinsic size in that dimension.
 */
export class SizedBox extends SingleChildRenderObjectWidget {
	public readonly width: number | undefined
	public readonly height: number | undefined

	constructor({
		key,
		width,
		height,
		child,
	}: {
		key?: Key
		width?: number
		height?: number
		child?: Widget
	} = {}) {
		super({ key, child })
		this.width = width
		this.height = height
	}

	createRenderObject(): SizedBoxRenderObject {
		return new SizedBoxRenderObject(this.width, this.height)
	}

	updateRenderObject(renderObject: SizedBoxRenderObject): void {
		renderObject.updateDimensions(this.width, this.height)
	}

	/**
	 * Creates a SizedBox with specific dimensions.
	 */
	static fromSize(width: number, height: number, child?: Widget): SizedBox {
		return child ? new SizedBox({ width, height, child }) : new SizedBox({ width, height })
	}

	/**
	 * Creates a SizedBox that expands to fill available space.
	 */
	static expand(child?: Widget): SizedBox {
		return child
			? new SizedBox({ width: Infinity, height: Infinity, child })
			: new SizedBox({ width: Infinity, height: Infinity })
	}

	/**
	 * Creates a SizedBox that shrinks to minimum size.
	 */
	static shrink(child?: Widget): SizedBox {
		return child
			? new SizedBox({ width: 0, height: 0, child })
			: new SizedBox({ width: 0, height: 0 })
	}

	/**
	 * Creates a SizedBox with only height specified.
	 */
	static height(height: number, child?: Widget): SizedBox {
		return child ? new SizedBox({ height, child }) : new SizedBox({ height })
	}

	/**
	 * Creates a SizedBox with only width specified.
	 */
	static width(width: number, child?: Widget): SizedBox {
		return child ? new SizedBox({ width, child }) : new SizedBox({ width })
	}
}

/**
 * RenderObject for SizedBox.
 */
export class SizedBoxRenderObject extends RenderBox {
	constructor(
		private _width?: number,
		private _height?: number,
	) {
		super()
	}

	updateDimensions(width?: number, height?: number): void {
		const oldWidth = this._width
		const oldHeight = this._height

		this._width = width
		this._height = height

		// Only mark needs layout if dimensions actually changed
		if (oldWidth !== width || oldHeight !== height) {
			this.markNeedsLayout()
		}
	}

	getMinIntrinsicWidth(height: number): number {
		if (this._width !== undefined) {
			return this._width === Infinity ? 0 : this._width
		}
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMinIntrinsicWidth(height)
		}
		return 0
	}

	getMaxIntrinsicWidth(height: number): number {
		if (this._width !== undefined) {
			return this._width === Infinity ? Infinity : this._width
		}
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMaxIntrinsicWidth(height)
		}
		return 0
	}

	getMinIntrinsicHeight(width: number): number {
		if (this._height !== undefined) {
			return this._height === Infinity ? 0 : this._height
		}
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMinIntrinsicHeight(width)
		}
		return 0
	}

	getMaxIntrinsicHeight(width: number): number {
		if (this._height !== undefined) {
			return this._height === Infinity ? Infinity : this._height
		}
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMaxIntrinsicHeight(width)
		}
		return 0
	}

	performLayout(): void {
		super.performLayout()

		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')
		let width: number
		let height: number

		// Determine width
		if (this._width !== undefined) {
			if (this._width === Infinity) {
				width = constraints.maxWidth
			} else {
				width = this._width
			}
		} else if (this.children.length > 0) {
			// Use child's intrinsic width
			const child = this.children[0] as RenderBox
			child.layout(constraints)
			width = child.size.width
		} else {
			// Flutter behavior: null dimension with no child defaults to 0
			width = 0
		}

		// Determine height
		if (this._height !== undefined) {
			if (this._height === Infinity) {
				height = constraints.maxHeight
			} else {
				height = this._height
			}
		} else if (this.children.length > 0) {
			// Use child's intrinsic height - always layout when using intrinsic sizing
			const child = this.children[0] as RenderBox
			child.layout(constraints)
			height = child.size.height
		} else {
			// Flutter behavior: null dimension with no child defaults to 0
			height = 0
		}

		// Clamp the computed size to the constraints (Flutter behavior)
		const constrainedSize = constraints.constrain(width, height)
		this.setSize(constrainedSize.width, constrainedSize.height)

		// Layout child with tight constraints
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const childConstraints = BoxConstraints.tight(
				constrainedSize.width,
				constrainedSize.height,
			)
			child.layout(childConstraints)
			child.setOffset(0, 0)
		}
	}
}

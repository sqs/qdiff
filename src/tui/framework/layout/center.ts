import { assert } from '../../lib/assert.js'
import type { Key } from '../key.js'
import type { RenderObject } from '../render-object.js'
import { RenderBox } from '../render-object.js'
import { SingleChildRenderObjectWidget } from '../render-object-widget.js'
import type { Widget } from '../widget.js'

/**
 * A widget that centers its child within the available space.
 *
 * Center handles unbounded constraints gracefully like Flutter's Center widget -
 * it sizes to its child when unbounded, or expands to fill space when bounded.
 */
export class Center extends SingleChildRenderObjectWidget {
	widthFactor?: number
	heightFactor?: number

	constructor({
		key,
		child,
		widthFactor,
		heightFactor,
	}: {
		key?: Key
		child?: Widget
		widthFactor?: number
		heightFactor?: number
	} = {}) {
		super({ key, child })
		this.widthFactor = widthFactor
		this.heightFactor = heightFactor
	}

	createRenderObject(): CenterRenderObject {
		return new CenterRenderObject(this.widthFactor, this.heightFactor)
	}

	updateRenderObject(renderObject: RenderObject): void {
		if (renderObject instanceof CenterRenderObject) {
			renderObject.widthFactor = this.widthFactor
			renderObject.heightFactor = this.heightFactor
		}
	}

	/**
	 * Creates a Center widget with a child.
	 */
	static child(child: Widget): Center {
		return new Center({ child })
	}
}

/**
 * RenderObject for Center that handles unbounded constraints like Flutter.
 */
export class CenterRenderObject extends RenderBox {
	widthFactor?: number
	heightFactor?: number

	constructor(widthFactor?: number, heightFactor?: number) {
		super()
		this.widthFactor = widthFactor
		this.heightFactor = heightFactor
	}

	getMinIntrinsicWidth(height: number): number {
		const child = this.children[0] as RenderBox | undefined
		const childWidth = child?.getMinIntrinsicWidth(height) ?? 0
		return childWidth * (this.widthFactor ?? 1)
	}

	getMaxIntrinsicWidth(height: number): number {
		const child = this.children[0] as RenderBox | undefined
		const childWidth = child?.getMaxIntrinsicWidth(height) ?? 0
		return childWidth * (this.widthFactor ?? 1)
	}

	getMinIntrinsicHeight(width: number): number {
		const child = this.children[0] as RenderBox | undefined
		const childHeight = child?.getMinIntrinsicHeight(width) ?? 0
		return childHeight * (this.heightFactor ?? 1)
	}

	getMaxIntrinsicHeight(width: number): number {
		const child = this.children[0] as RenderBox | undefined
		const childHeight = child?.getMaxIntrinsicHeight(width) ?? 0
		return childHeight * (this.heightFactor ?? 1)
	}

	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		const shrinkWrapWidth =
			this.widthFactor !== undefined || constraints.maxWidth === Number.POSITIVE_INFINITY
		const shrinkWrapHeight =
			this.heightFactor !== undefined || constraints.maxHeight === Number.POSITIVE_INFINITY

		const child = this.children[0] as RenderBox | undefined
		if (!child) {
			// When no child, size is 0 if shrinkWrap, else infinity -> constrained
			const width = shrinkWrapWidth ? 0 : Number.POSITIVE_INFINITY
			const height = shrinkWrapHeight ? 0 : Number.POSITIVE_INFINITY
			const constrainedWidth = isFinite(width)
				? Math.max(constraints.minWidth, Math.min(constraints.maxWidth, width))
				: constraints.maxWidth
			const constrainedHeight = isFinite(height)
				? Math.max(constraints.minHeight, Math.min(constraints.maxHeight, height))
				: constraints.maxHeight
			this.setSize(constrainedWidth, constrainedHeight)
			super.performLayout()
			return
		}

		// Layout child with loosened constraints
		child.layout(constraints.loosen())

		// Calculate size based on shrinkWrap flags
		const width = shrinkWrapWidth
			? child.size.width * (this.widthFactor ?? 1)
			: Number.POSITIVE_INFINITY
		const height = shrinkWrapHeight
			? child.size.height * (this.heightFactor ?? 1)
			: Number.POSITIVE_INFINITY

		// Constrain to parent constraints
		const constrainedWidth = isFinite(width)
			? Math.max(constraints.minWidth, Math.min(constraints.maxWidth, width))
			: constraints.maxWidth
		const constrainedHeight = isFinite(height)
			? Math.max(constraints.minHeight, Math.min(constraints.maxHeight, height))
			: constraints.maxHeight
		this.setSize(constrainedWidth, constrainedHeight)

		// Center the child within our bounds
		const centerX = (this.size.width - child.size.width) / 2
		const centerY = (this.size.height - child.size.height) / 2
		child.setOffset(centerX, centerY)

		super.performLayout()
	}
}

import { assert } from '../../lib/assert.js'
import type { RenderBox } from '../render-object.js'
import { BoxConstraints } from '../render-object.js'
import { RenderBox as RenderBoxClass } from '../render-object.js'
import { SingleChildRenderObjectWidget } from '../render-object-widget.js'
import type { Widget } from '../widget.js'

/**
 * Properties for IntrinsicHeight widget.
 */
export interface IntrinsicHeightProps {
	/** The child widget */
	child: Widget
}

/**
 * A widget that sizes its child to the child's intrinsic height.
 *
 * This forces the child to determine its preferred height based on its content,
 * similar to Flutter's IntrinsicHeight widget.
 */
export class IntrinsicHeight extends SingleChildRenderObjectWidget {
	constructor(props: IntrinsicHeightProps) {
		super({ child: props.child })
	}

	createRenderObject(): RenderIntrinsicHeight {
		return new RenderIntrinsicHeight()
	}

	updateRenderObject(renderObject: RenderIntrinsicHeight): void {
		// No properties to update
	}
}

/**
 * Render object for IntrinsicHeight that uses child's intrinsic sizing.
 */
export class RenderIntrinsicHeight extends RenderBoxClass {
	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		if (this.children.length === 0) {
			this.setSize(constraints.minWidth, constraints.minHeight)
			super.performLayout()
			return
		}

		const child = this.children[0] as RenderBox

		// Determine child constraints based on whether height is tight
		const hasTightHeight = constraints.minHeight === constraints.maxHeight
		let childConstraints: BoxConstraints
		if (hasTightHeight) {
			childConstraints = constraints
		} else {
			const height = child.getMaxIntrinsicHeight(constraints.maxWidth)
			childConstraints = new BoxConstraints(
				constraints.minWidth,
				constraints.maxWidth,
				height,
				height,
			)
		}

		// Layout child with determined constraints
		child.layout(childConstraints)
		child.setOffset(0, 0)

		// Parent size matches child size
		this.setSize(child.size.width, child.size.height)

		super.performLayout()
	}

	getMinIntrinsicHeight(width: number): number {
		return this.getMaxIntrinsicHeight(width)
	}

	getMaxIntrinsicHeight(width: number): number {
		if (this.children.length === 0) return 0
		const child = this.children[0] as RenderBox
		return child.getMaxIntrinsicHeight(width)
	}

	getMinIntrinsicWidth(height: number): number {
		if (this.children.length === 0) return 0
		const child = this.children[0] as RenderBox
		if (!Number.isFinite(height)) {
			height = child.getMaxIntrinsicHeight(Number.POSITIVE_INFINITY)
		}
		return child.getMinIntrinsicWidth(height)
	}

	getMaxIntrinsicWidth(height: number): number {
		if (this.children.length === 0) return 0
		const child = this.children[0] as RenderBox
		if (!Number.isFinite(height)) {
			height = child.getMaxIntrinsicHeight(Number.POSITIVE_INFINITY)
		}
		return child.getMaxIntrinsicWidth(height)
	}
}

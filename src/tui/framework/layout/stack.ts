import { assert } from '../../lib/assert.js'
import type { Key } from '../key.js'
import { ParentData } from '../parent-data.js'
import { BoxConstraints, RenderBox, type RenderObject } from '../render-object.js'
import { MultiChildRenderObjectWidget } from '../render-object-widget.js'
import type { Widget } from '../widget.js'

/**
 * How to size the non-positioned children of a Stack.
 */
export enum StackFit {
	/** The constraints passed to the stack from its parent are loosened. */
	loose = 'loose',
	/** The constraints passed to the stack from its parent are tightened to the biggest size allowed. */
	expand = 'expand',
	/** The constraints passed to the stack from its parent are passed unmodified to the non-positioned children. */
	passthrough = 'passthrough',
}

/**
 * A widget that positions its children relative to the edges of its box.
 *
 * Similar to Flutter's Stack widget, this allows layering widgets on top of each other
 * with absolute positioning.
 */
export class Stack extends MultiChildRenderObjectWidget {
	readonly fit: StackFit

	constructor({
		key,
		fit = StackFit.loose,
		children = [],
	}: {
		key?: Key
		fit?: StackFit
		children?: Widget[]
	} = {}) {
		super({
			...(key ? { key } : {}),
			children,
		})
		this.fit = fit
	}

	createRenderObject(): StackRenderObject {
		return new StackRenderObject(this.fit)
	}

	updateRenderObject(renderObject: RenderObject): void {
		if (renderObject instanceof StackRenderObject) {
			renderObject.fit = this.fit
		}
	}
}

/**
 * Parent data for Stack children, contains positioning information.
 */
export class StackParentData extends ParentData {
	left?: number
	top?: number
	right?: number
	bottom?: number
	width?: number
	height?: number

	constructor(
		left?: number,
		top?: number,
		right?: number,
		bottom?: number,
		width?: number,
		height?: number,
	) {
		super()
		this.left = left
		this.top = top
		this.right = right
		this.bottom = bottom
		this.width = width
		this.height = height
	}

	/**
	 * Whether this child is considered positioned.
	 *
	 * A child is positioned if any of the top, right, bottom, or left properties
	 * are non-null. Positioned children do not factor into determining the size
	 * of the stack but are instead placed relative to the non-positioned
	 * children in the stack.
	 */
	isPositioned(): boolean {
		return (
			this.top !== undefined ||
			this.right !== undefined ||
			this.bottom !== undefined ||
			this.left !== undefined ||
			this.width !== undefined ||
			this.height !== undefined
		)
	}

	/**
	 * Computes the BoxConstraints the stack layout algorithm would give to
	 * this child, given the Size of the stack.
	 *
	 * This method should only be called when isPositioned is true for the child.
	 */
	positionedChildConstraints(stackSize: { width: number; height: number }): BoxConstraints {
		assert(this.isPositioned(), 'positionedChildConstraints called on non-positioned child')

		// Calculate width
		let width: number | undefined
		if (this.left !== undefined && this.right !== undefined) {
			width = Math.max(0, stackSize.width - this.right - this.left)
		} else if (this.width !== undefined) {
			width = this.width
		}

		// Calculate height
		let height: number | undefined
		if (this.top !== undefined && this.bottom !== undefined) {
			height = Math.max(0, stackSize.height - this.bottom - this.top)
		} else if (this.height !== undefined) {
			height = this.height
		}

		// Return tight constraints for specified dimensions, unconstrained for unspecified
		return new BoxConstraints(
			width ?? 0,
			width ?? Number.POSITIVE_INFINITY,
			height ?? 0,
			height ?? Number.POSITIVE_INFINITY,
		)
	}
}

class StackRenderObject extends RenderBox {
	fit: StackFit

	constructor(fit: StackFit = StackFit.loose) {
		super()
		this.fit = fit
		// PERFORMANCE: Allow children to be hit-tested outside our bounds (needed for positioned children)
		this.allowHitTestOutsideBounds = true
	}

	setupParentData(child: RenderObject): void {
		if (!(child.parentData instanceof StackParentData)) {
			child.parentData = new StackParentData()
		}
	}

	getMinIntrinsicWidth(height: number): number {
		return this.getIntrinsicDimension((child) => child.getMinIntrinsicWidth(height))
	}

	getMaxIntrinsicWidth(height: number): number {
		return this.getIntrinsicDimension((child) => child.getMaxIntrinsicWidth(height))
	}

	getMinIntrinsicHeight(width: number): number {
		return this.getIntrinsicDimension((child) => child.getMinIntrinsicHeight(width))
	}

	getMaxIntrinsicHeight(width: number): number {
		return this.getIntrinsicDimension((child) => child.getMaxIntrinsicHeight(width))
	}

	private getIntrinsicDimension(childSizeGetter: (child: RenderBox) => number): number {
		let extent = 0
		for (const child of this.children as RenderBox[]) {
			const parentData = child.parentData as StackParentData
			if (!parentData.isPositioned()) {
				extent = Math.max(extent, childSizeGetter(child))
			}
		}
		return extent
	}

	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		const children = this.children as RenderBox[]

		// Handle no children case
		if (children.length === 0) {
			const size = constraints.biggest
			if (Number.isFinite(size.width) && Number.isFinite(size.height)) {
				this.setSize(size.width, size.height)
			} else {
				const smallest = constraints.smallest
				this.setSize(smallest.width, smallest.height)
			}
			super.performLayout()
			return
		}

		// Determine constraints for non-positioned children based on fit
		let nonPositionedConstraints: BoxConstraints
		switch (this.fit) {
			case StackFit.loose:
				nonPositionedConstraints = constraints.loosen()
				break
			case StackFit.expand:
				nonPositionedConstraints = BoxConstraints.tight(
					constraints.biggest.width,
					constraints.biggest.height,
				)
				break
			case StackFit.passthrough:
				nonPositionedConstraints = constraints
				break
		}

		// Find the largest non-positioned child to determine our size
		let hasNonPositionedChildren = false
		let width = constraints.minWidth
		let height = constraints.minHeight

		for (const child of children) {
			const parentData = child.parentData as StackParentData

			if (!parentData.isPositioned()) {
				hasNonPositionedChildren = true
				child.layout(nonPositionedConstraints)
				width = Math.max(width, child.size.width)
				height = Math.max(height, child.size.height)
			}
		}

		// Set stack size
		if (hasNonPositionedChildren) {
			this.setSize(width, height)
		} else {
			const size = constraints.biggest
			this.setSize(size.width, size.height)
		}

		// Layout and position all children
		for (const child of children) {
			const parentData = child.parentData as StackParentData

			if (parentData.isPositioned()) {
				// Positioned child
				this.layoutPositionedChild(child, parentData)
			} else {
				// Non-positioned child was already laid out above
				child.setOffset(0, 0)
			}
		}

		super.performLayout()
	}

	private layoutPositionedChild(child: RenderBox, parentData: StackParentData): void {
		const childConstraints = parentData.positionedChildConstraints(this.size)
		child.layout(childConstraints)

		// Calculate position
		let x = 0
		let y = 0

		if (parentData.left !== undefined) {
			x = parentData.left
		} else if (parentData.right !== undefined) {
			x = this.size.width - parentData.right - child.size.width
		}

		if (parentData.top !== undefined) {
			y = parentData.top
		} else if (parentData.bottom !== undefined) {
			y = this.size.height - parentData.bottom - child.size.height
		}

		child.setOffset(x, y)
	}
}

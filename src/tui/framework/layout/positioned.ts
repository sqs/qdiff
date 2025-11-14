import type { Key } from '../key.js'
import { ParentDataWidget } from '../parent-data-widget.js'
import type { RenderObject } from '../render-object.js'
import type { Widget } from '../widget.js'
import { StackParentData } from './stack.js'

/**
 * A widget that controls where a child of a Stack is positioned.
 *
 * A Positioned widget must be a descendant of a Stack, and the path from
 * the Positioned widget to its enclosing Stack must contain only
 * StatelessWidgets or StatefulWidgets (not other kinds of widgets, like RenderObjectWidgets).
 */
export class Positioned extends ParentDataWidget<StackParentData> {
	readonly left?: number
	readonly top?: number
	readonly right?: number
	readonly bottom?: number
	readonly width?: number
	readonly height?: number

	constructor({
		key,
		left,
		top,
		right,
		bottom,
		width,
		height,
		child,
	}: {
		key?: Key
		left?: number
		top?: number
		right?: number
		bottom?: number
		width?: number
		height?: number
		child: Widget
	}) {
		// Validate constraints: only 2 of 3 horizontal values allowed
		if (left !== undefined && right !== undefined && width !== undefined) {
			throw new Error(
				'Positioned: Only two out of the three horizontal values (left, right, width) can be set',
			)
		}

		// Validate constraints: only 2 of 3 vertical values allowed
		if (top !== undefined && bottom !== undefined && height !== undefined) {
			throw new Error(
				'Positioned: Only two out of the three vertical values (top, bottom, height) can be set',
			)
		}

		super(child, key)
		this.left = left
		this.top = top
		this.right = right
		this.bottom = bottom
		this.width = width
		this.height = height
	}

	createParentData(): StackParentData {
		return new StackParentData(
			this.left,
			this.top,
			this.right,
			this.bottom,
			this.width,
			this.height,
		)
	}

	applyParentData(renderObject: RenderObject): void {
		const parentData = renderObject.parentData as StackParentData | undefined
		if (parentData) {
			parentData.left = this.left
			parentData.top = this.top
			parentData.right = this.right
			parentData.bottom = this.bottom
			parentData.width = this.width
			parentData.height = this.height
		}
	}

	debugIsValidRenderObject(_renderObject: RenderObject): boolean {
		// Any render object can have StackParentData
		return true
	}

	updateParentData(renderObject: RenderObject): void {
		const parentData = renderObject.parentData as StackParentData
		let needsLayout = false

		if (parentData.left !== this.left) {
			parentData.left = this.left
			needsLayout = true
		}
		if (parentData.top !== this.top) {
			parentData.top = this.top
			needsLayout = true
		}
		if (parentData.right !== this.right) {
			parentData.right = this.right
			needsLayout = true
		}
		if (parentData.bottom !== this.bottom) {
			parentData.bottom = this.bottom
			needsLayout = true
		}
		if (parentData.width !== this.width) {
			parentData.width = this.width
			needsLayout = true
		}
		if (parentData.height !== this.height) {
			parentData.height = this.height
			needsLayout = true
		}

		if (needsLayout) {
			const parent = renderObject.parent
			if (parent && 'markNeedsLayout' in parent) {
				;(parent as any).markNeedsLayout()
			}
		}
	}
}

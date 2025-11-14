import type { Key } from '../key.js'
import { ParentDataWidget } from '../parent-data-widget.js'
import type { RenderObject } from '../render-object.js'
import type { Widget } from '../widget.js'
import { FlexFit, FlexParentData } from './flex-parent-data.js'

// Re-export FlexFit for convenience
export { FlexFit } from './flex-parent-data.js'

/**
 * A widget that controls how a child of a Row, Column, or Flex flexes.
 *
 * Using a Flexible widget gives a child of a Row, Column, or Flex the flexibility
 * to expand to fill the available space in the main axis (e.g., horizontally for
 * a Row or vertically for a Column), but, unlike Expanded, Flexible does not
 * require the child to fill the available space.
 */
export class Flexible extends ParentDataWidget<FlexParentData> {
	/**
	 * The flex factor to use for this child.
	 *
	 * If this is non-zero, the child is flexible and will be given a share
	 * of the remaining space proportional to this value.
	 */
	readonly flex: number

	/**
	 * How the child should fit within the available space.
	 */
	readonly fit: FlexFit

	constructor({
		child,
		flex = 1,
		fit = FlexFit.loose,
		key,
	}: {
		child: Widget
		flex?: number
		fit?: FlexFit
		key?: Key
	}) {
		super(child, key)
		this.flex = flex
		this.fit = fit
	}

	createParentData(): FlexParentData {
		return new FlexParentData(this.flex, this.fit)
	}

	applyParentData(renderObject: RenderObject): void {
		const parentData = renderObject.parentData as FlexParentData | undefined
		if (parentData) {
			parentData.flex = this.flex
			parentData.fit = this.fit
		}
	}

	debugIsValidRenderObject(_renderObject: RenderObject): boolean {
		// Any render object can have FlexParentData
		return true
	}

	toString(): string {
		return `Flexible(flex: ${this.flex}, fit: ${this.fit}, child: ${this.child})`
	}
}

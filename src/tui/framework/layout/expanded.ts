import type { Key } from '../key.js'
import { ParentDataWidget } from '../parent-data-widget.js'
import type { RenderObject } from '../render-object.js'
import type { Widget } from '../widget.js'
import { FlexFit, FlexParentData } from './flex-parent-data.js'

/**
 * A widget that expands a child of a Row, Column, or Flex so that the child fills the available space.
 *
 * Using an Expanded widget makes a child of a Row, Column, or Flex expand to fill the available space
 * along the main axis (e.g., horizontally for a Row or vertically for a Column). If multiple children
 * are expanded, the available space is divided among them according to the flex factor.
 */
export class Expanded extends ParentDataWidget<FlexParentData> {
	/**
	 * The flex factor to use for this child.
	 *
	 * If this is non-zero, the child is flexible and will be given a share
	 * of the remaining space proportional to this value.
	 */
	readonly flex: number

	constructor({ child, flex = 1, key }: { child: Widget; flex?: number; key?: Key }) {
		super(child, key)
		this.flex = flex
	}

	createParentData(): FlexParentData {
		return new FlexParentData(this.flex, FlexFit.tight)
	}

	applyParentData(renderObject: RenderObject): void {
		const parentData = renderObject.parentData as FlexParentData | undefined
		if (parentData) {
			parentData.flex = this.flex
			parentData.fit = FlexFit.tight
		}
	}

	debugIsValidRenderObject(_renderObject: RenderObject): boolean {
		// Any render object can have FlexParentData
		return true
	}

	toString(): string {
		return `Expanded(flex: ${this.flex}, child: ${this.child})`
	}
}

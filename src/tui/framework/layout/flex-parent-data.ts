import { ParentData } from '../parent-data.js'

/**
 * Defines how a child widget should flex within a Flex widget.
 */
export enum FlexFit {
	/**
	 * The child is forced to fill the available space (default for Expanded).
	 */
	tight = 'tight',

	/**
	 * The child can be smaller than the available space (used by Flexible).
	 */
	loose = 'loose',
}

/**
 * Parent data used by Flex widgets to store flex properties on their children.
 *
 * This replaces the need for wrapper render objects around flexible children.
 */
export class FlexParentData extends ParentData {
	/**
	 * The flex factor for this child.
	 *
	 * If this is non-zero, the child is flexible and will be given a share
	 * of the remaining space proportional to this value.
	 */
	flex: number

	/**
	 * How the child should fit within the available space.
	 *
	 * - tight: The child is forced to fill its allocated space
	 * - loose: The child can be smaller than its allocated space
	 */
	fit: FlexFit

	constructor(flex: number = 0, fit: FlexFit = FlexFit.tight) {
		super()
		this.flex = flex
		this.fit = fit
	}

	toString(): string {
		return `FlexParentData(flex: ${this.flex}, fit: ${this.fit})`
	}
}

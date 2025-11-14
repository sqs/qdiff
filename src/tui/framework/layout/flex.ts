import { assert } from '../../lib/assert.js'
import { clamp } from '../../lib/utils.js'
import type { Key } from '../key.js'
import type { RenderObject } from '../render-object.js'
import { BoxConstraints, finite, RenderBox } from '../render-object.js'
import {
	MultiChildRenderObjectElement,
	MultiChildRenderObjectWidget,
} from '../render-object-widget.js'
import type { Widget } from '../widget.js'
import { FlexFit, FlexParentData } from './flex-parent-data.js'

/**
 * Direction for flex layout.
 */
export enum Axis {
	horizontal = 'horizontal',
	vertical = 'vertical',
}

/**
 * How to align children along the main axis.
 */
export enum MainAxisAlignment {
	start = 'start',
	end = 'end',
	center = 'center',
	spaceBetween = 'spaceBetween',
	spaceAround = 'spaceAround',
	spaceEvenly = 'spaceEvenly',
}

/**
 * How to align children along the cross axis.
 */
export enum CrossAxisAlignment {
	start = 'start',
	end = 'end',
	center = 'center',
	stretch = 'stretch',
	baseline = 'baseline',
}

/**
 * How much space should be occupied along the main axis.
 */
export enum MainAxisSize {
	min = 'min',
	max = 'max',
}

/**
 * A widget that displays its children in a linear array.
 */
export class Flex extends MultiChildRenderObjectWidget {
	public readonly direction: Axis
	public readonly mainAxisAlignment: MainAxisAlignment
	public readonly crossAxisAlignment: CrossAxisAlignment
	public readonly mainAxisSize: MainAxisSize

	constructor({
		key,
		direction,
		children = [],
		mainAxisAlignment = MainAxisAlignment.start,
		crossAxisAlignment = CrossAxisAlignment.center,
		mainAxisSize = MainAxisSize.min,
	}: {
		key?: Key
		direction: Axis
		children?: Widget[]
		mainAxisAlignment?: MainAxisAlignment
		crossAxisAlignment?: CrossAxisAlignment
		mainAxisSize?: MainAxisSize
	}) {
		super({
			...(key ? { key } : {}),
			children,
		})
		this.direction = direction
		this.mainAxisAlignment = mainAxisAlignment
		this.crossAxisAlignment = crossAxisAlignment
		this.mainAxisSize = mainAxisSize
	}

	createRenderObject(): FlexRenderObject {
		return new FlexRenderObject(
			this.direction,
			this.mainAxisAlignment,
			this.crossAxisAlignment,
			this.mainAxisSize,
		)
	}

	updateRenderObject(renderObject: RenderObject): void {
		const flexRenderObject = renderObject as FlexRenderObject
		flexRenderObject.updateProperties(
			this.direction,
			this.mainAxisAlignment,
			this.crossAxisAlignment,
			this.mainAxisSize,
		)
	}

	createElement(): FlexElement {
		return new FlexElement(this)
	}
}

/**
 * Element for Flex widget that sets up FlexParentData on children.
 */
export class FlexElement extends MultiChildRenderObjectElement {
	constructor(widget: Flex) {
		super(widget)
	}

	get flexWidget(): Flex {
		return this.widget as Flex
	}

	mount(): void {
		super.mount()
		this._setupChildParentData()
	}

	update(newWidget: Widget): void {
		super.update(newWidget)
		this._setupChildParentData()
	}

	performRebuild(): void {
		super.performRebuild()
		this._setupChildParentData()
	}

	private _setupChildParentData(): void {
		// Ensure all children have FlexParentData
		for (const childElement of this.children) {
			const renderObject = childElement.renderObject
			if (renderObject && !renderObject.parentData) {
				renderObject.parentData = new FlexParentData(0, FlexFit.tight)
			}
		}
	}
}

/**
 * RenderObject for Flex layouts.
 */
export class FlexRenderObject extends RenderBox {
	constructor(
		private _direction: Axis,
		private _mainAxisAlignment: MainAxisAlignment,
		private _crossAxisAlignment: CrossAxisAlignment,
		private _mainAxisSize: MainAxisSize,
	) {
		super()
	}

	updateProperties(
		direction: Axis,
		mainAxisAlignment: MainAxisAlignment,
		crossAxisAlignment: CrossAxisAlignment,
		mainAxisSize: MainAxisSize,
	): void {
		this._direction = direction
		this._mainAxisAlignment = mainAxisAlignment
		this._crossAxisAlignment = crossAxisAlignment
		this._mainAxisSize = mainAxisSize
		this.markNeedsLayout()
	}

	performLayout(): void {
		super.performLayout()

		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')
		const isHorizontal = this._direction === Axis.horizontal

		// Separate flexible and non-flexible children
		const flexibleChildren: { child: RenderBox; flex: number; fit: FlexFit }[] = []
		const nonFlexibleChildren: RenderBox[] = []

		for (const child of this.children as RenderBox[]) {
			const parentData = child.parentData as FlexParentData | undefined

			if (parentData && parentData.flex > 0) {
				flexibleChildren.push({
					child,
					flex: parentData.flex,
					fit: parentData.fit,
				})
			} else {
				nonFlexibleChildren.push(child)
			}
		}

		// Layout non-flexible children with intrinsic sizing (Flutter algorithm)
		let totalNonFlexibleMainSize = 0
		let maxCrossSize = 0

		// Calculate finite cross-axis constraint when incoming constraint is infinite
		let finiteCrossAxisConstraint: number
		const incomingCrossAxis = isHorizontal ? constraints.maxHeight : constraints.maxWidth

		if (isFinite(incomingCrossAxis)) {
			// Use the finite constraint as-is
			finiteCrossAxisConstraint = incomingCrossAxis
		} else {
			// Calculate intrinsic cross-axis size when constraint is infinite
			let maxIntrinsicCrossAxis = 0

			for (const child of nonFlexibleChildren) {
				const intrinsicSize = isHorizontal
					? child.getMaxIntrinsicHeight(Infinity) // Row: get child's preferred height
					: child.getMaxIntrinsicWidth(Infinity) // Column: get child's preferred width
				maxIntrinsicCrossAxis = Math.max(maxIntrinsicCrossAxis, intrinsicSize)
			}

			// Use the calculated intrinsic size as the finite constraint
			finiteCrossAxisConstraint = maxIntrinsicCrossAxis
		}

		for (const child of nonFlexibleChildren) {
			// Give child constraints: unbounded main axis, finite cross axis
			// Cross axis is tight if CrossAxisAlignment.stretch
			const crossAxisMin =
				this._crossAxisAlignment === CrossAxisAlignment.stretch
					? finiteCrossAxisConstraint
					: 0

			const childConstraints = isHorizontal
				? new BoxConstraints(
						0,
						Infinity, // main axis unbounded
						crossAxisMin, // tight if stretch, loose otherwise
						finiteCrossAxisConstraint, // cross axis always finite
					)
				: new BoxConstraints(
						crossAxisMin, // tight if stretch, loose otherwise
						finiteCrossAxisConstraint, // cross axis always finite
						0,
						Infinity, // main axis unbounded
					)

			child.layout(childConstraints)

			// Check for infinite size after layout and add to totals
			if (isHorizontal) {
				totalNonFlexibleMainSize += child.size.width
				maxCrossSize = Math.max(maxCrossSize, child.size.height)
			} else {
				totalNonFlexibleMainSize += child.size.height
				maxCrossSize = Math.max(maxCrossSize, child.size.width)
			}
		}

		// Calculate available space for flexible children - zero when unbounded like Flutter
		const maxMainSize = isHorizontal ? constraints.maxWidth : constraints.maxHeight
		const availableMainSize = Number.isFinite(maxMainSize)
			? Math.max(0, maxMainSize - totalNonFlexibleMainSize)
			: 0 // Flutter behavior: no flex space when unbounded

		// Calculate total flex
		const totalFlex = flexibleChildren.reduce((sum, item) => sum + item.flex, 0)

		// Check for invalid flex children with unbounded constraints (matches Flutter's behavior)
		// Error conditions from spec:
		// 1. Unbounded main axis constraints (!canFlex)
		// 2. Child has flex > 0
		// 3. Either mainAxisSize == max OR child fit == tight
		const canFlex = maxMainSize < Infinity
		if (!canFlex && totalFlex > 0) {
			for (const { flex, fit } of flexibleChildren) {
				if (
					flex > 0 &&
					(this._mainAxisSize === MainAxisSize.max || fit === FlexFit.tight)
				) {
					const identity = isHorizontal ? 'row' : 'column'
					const axis = isHorizontal ? 'horizontal' : 'vertical'
					const dimension = isHorizontal ? 'width' : 'height'

					assert(
						false,
						`RenderFlex children have non-zero flex but incoming ${dimension} constraints are unbounded.\n\n` +
							`When a ${identity} is in a parent that does not provide a finite ${dimension} constraint, for example if it is in a ${axis} scrollable, it will try to shrink-wrap its children along the ${axis} axis. Setting a flex on a child (e.g. using Expanded) indicates that the child is to expand to fill the remaining space in the ${axis} direction.\n\n` +
							`These two directives are mutually exclusive. If a parent is to shrink-wrap its child, the child cannot simultaneously expand to fit its parent.\n\n` +
							`Consider setting mainAxisSize to MainAxisSize.min and using FlexFit.loose fits for the flexible children (using Flexible rather than Expanded). This will allow the flexible children to size themselves to less than the infinite remaining space they would otherwise be forced to take, and then will cause the RenderFlex to shrink-wrap the children rather than expanding to fit the maximum constraints provided by the parent.`,
					)
				}
			}
		}

		// Layout flexible children
		if (totalFlex > 0) {
			const mainSizePerFlex = availableMainSize / totalFlex
			let distributedSpace = 0

			for (let i = 0; i < flexibleChildren.length; i++) {
				const { child, flex, fit } = flexibleChildren[i]!

				// Calculate size with proper rounding to avoid fractional issues
				let childMainSize: number
				if (i === flexibleChildren.length - 1) {
					// Last child gets all remaining space to ensure total equals availableMainSize
					childMainSize = availableMainSize - distributedSpace
				} else {
					childMainSize = Math.floor(mainSizePerFlex * flex)
					distributedSpace += childMainSize
				}

				// Use tight constraints for FlexFit.tight, loose for FlexFit.loose
				// Cross axis always finite
				const maxCrossAxis = isHorizontal ? constraints.maxHeight : constraints.maxWidth

				const childConstraints = isHorizontal
					? fit === FlexFit.tight
						? new BoxConstraints(childMainSize, childMainSize, 0, maxCrossAxis)
						: BoxConstraints.loose(childMainSize, maxCrossAxis)
					: fit === FlexFit.tight
						? new BoxConstraints(0, maxCrossAxis, childMainSize, childMainSize)
						: BoxConstraints.loose(maxCrossAxis, childMainSize)

				child.layout(childConstraints)

				if (isHorizontal) {
					maxCrossSize = Math.max(maxCrossSize, child.size.height)
				} else {
					maxCrossSize = Math.max(maxCrossSize, child.size.width)
				}
			}
		}

		// Set our size first
		const totalMainSize = totalNonFlexibleMainSize + (totalFlex > 0 ? availableMainSize : 0)

		if (isHorizontal) {
			const finalWidth =
				this._mainAxisSize === MainAxisSize.min || constraints.maxWidth === Infinity
					? clamp(totalMainSize, constraints.minWidth, constraints.maxWidth)
					: Math.max(constraints.minWidth, constraints.maxWidth)

			const finalHeight = clamp(maxCrossSize, constraints.minHeight, constraints.maxHeight)

			this.setSize(
				finite(finalWidth, constraints.minWidth),
				finite(finalHeight, constraints.minHeight),
			)
		} else {
			const finalHeight =
				this._mainAxisSize === MainAxisSize.min || constraints.maxHeight === Infinity
					? clamp(totalMainSize, constraints.minHeight, constraints.maxHeight)
					: Math.max(constraints.minHeight, constraints.maxHeight)

			const finalWidth = clamp(maxCrossSize, constraints.minWidth, constraints.maxWidth)

			this.setSize(
				finite(finalWidth, constraints.minWidth),
				finite(finalHeight, constraints.minHeight),
			)
		}

		// Position all children using the updated size
		const actualCrossSize = isHorizontal ? this.size.height : this.size.width
		this.positionChildren(isHorizontal, actualCrossSize, constraints)
	}

	private positionChildren(
		isHorizontal: boolean,
		maxCrossSize: number,
		_constraints: BoxConstraints,
	): void {
		const children = this.children as RenderBox[]
		if (children.length === 0) return

		// Calculate total main size of all children
		let totalMainSize = 0
		for (const child of children) {
			totalMainSize += isHorizontal ? child.size.width : child.size.height
		}

		// Calculate available space and spacing
		const containerMainSize = isHorizontal ? this.size.width : this.size.height
		const freeSpace = Math.max(0, containerMainSize - totalMainSize)

		let leadingSpace = 0
		let betweenSpace = 0

		switch (this._mainAxisAlignment) {
			case MainAxisAlignment.start:
				leadingSpace = 0
				break
			case MainAxisAlignment.end:
				leadingSpace = freeSpace
				break
			case MainAxisAlignment.center:
				leadingSpace = freeSpace / 2
				break
			case MainAxisAlignment.spaceBetween:
				betweenSpace =
					children.length > 1 ? Math.floor(freeSpace / (children.length - 1)) : 0
				break
			case MainAxisAlignment.spaceAround:
				betweenSpace = children.length > 0 ? freeSpace / children.length : 0
				leadingSpace = betweenSpace / 2
				break
			case MainAxisAlignment.spaceEvenly:
				betweenSpace =
					children.length > 0 ? Math.floor(freeSpace / (children.length + 1)) : 0
				leadingSpace = betweenSpace
				break
		}

		// Position each child
		let currentMainPosition = leadingSpace

		for (let i = 0; i < children.length; i++) {
			const child = children[i]!
			const childMainSize = isHorizontal ? child.size.width : child.size.height
			const childCrossSize = isHorizontal ? child.size.height : child.size.width

			// Calculate cross axis position
			let crossPosition = 0
			switch (this._crossAxisAlignment) {
				case CrossAxisAlignment.start:
					crossPosition = 0
					break
				case CrossAxisAlignment.end:
					crossPosition = maxCrossSize - childCrossSize
					break
				case CrossAxisAlignment.center:
					crossPosition = (maxCrossSize - childCrossSize) / 2
					break
				case CrossAxisAlignment.stretch:
					crossPosition = 0
					break
				case CrossAxisAlignment.baseline:
					if (!isHorizontal) {
						throw new Error(
							'CrossAxisAlignment.baseline is only supported for horizontal flex (Row)',
						)
					}
					// For baseline alignment, position child so its baseline aligns with the container baseline
					// TODO: Implement baseline calculation when baseline metrics are available
					crossPosition = 0
					break
			}

			if (isHorizontal) {
				child.setOffset(currentMainPosition, crossPosition)
			} else {
				child.setOffset(crossPosition, currentMainPosition)
			}

			// Move to next position - don't add betweenSpace after the last child
			currentMainPosition += childMainSize
			if (i < children.length - 1) {
				currentMainPosition += betweenSpace
			}
		}
	}

	getMinIntrinsicWidth(height: number): number {
		const isHorizontal = this._direction === Axis.horizontal
		const children = this.children as RenderBox[]

		if (isHorizontal) {
			// For horizontal flex (Row), use Flutter's formula:
			// sum(non-flex) + max(flexFraction) * totalFlex
			let inflexibleWidth = 0
			let totalFlex = 0
			let maxFlexFraction = 0

			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				const flex = parentData?.flex ?? 0

				if (flex > 0) {
					totalFlex += flex
					const flexFraction = child.getMinIntrinsicWidth(height) / flex
					maxFlexFraction = Math.max(maxFlexFraction, flexFraction)
				} else {
					inflexibleWidth += child.getMinIntrinsicWidth(height)
				}
			}

			return inflexibleWidth + maxFlexFraction * totalFlex
		} else {
			// For vertical flex (Column), return max child width
			let maxWidth = 0
			for (const child of children) {
				maxWidth = Math.max(maxWidth, child.getMinIntrinsicWidth(height))
			}
			return maxWidth
		}
	}

	getMaxIntrinsicWidth(height: number): number {
		const isHorizontal = this._direction === Axis.horizontal
		const children = this.children as RenderBox[]

		if (isHorizontal) {
			// For horizontal flex (Row), use Flutter's formula:
			// sum(non-flex) + max(flexFraction) * totalFlex
			let inflexibleWidth = 0
			let totalFlex = 0
			let maxFlexFraction = 0

			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				const flex = parentData?.flex ?? 0

				if (flex > 0) {
					totalFlex += flex
					const flexFraction = child.getMaxIntrinsicWidth(height) / flex
					maxFlexFraction = Math.max(maxFlexFraction, flexFraction)
				} else {
					inflexibleWidth += child.getMaxIntrinsicWidth(height)
				}
			}

			return inflexibleWidth + maxFlexFraction * totalFlex
		} else {
			// For vertical flex (Column), return max child width
			let maxWidth = 0
			for (const child of children) {
				maxWidth = Math.max(maxWidth, child.getMaxIntrinsicWidth(height))
			}
			return maxWidth
		}
	}

	getMaxIntrinsicHeight(width: number): number {
		const isHorizontal = this._direction === Axis.horizontal
		const children = this.children as RenderBox[]

		if (isHorizontal) {
			// For horizontal flex (Row), return max child height accounting for flex allocation
			let maxHeight = 0
			let totalFlex = 0
			const nonFlexChildren: RenderBox[] = []
			const flexChildren: { child: RenderBox; flex: number }[] = []

			// Separate flex vs non-flex children
			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				if (parentData && parentData.flex > 0) {
					totalFlex += parentData.flex
					flexChildren.push({ child, flex: parentData.flex })
				} else {
					nonFlexChildren.push(child)
				}
			}

			// Calculate space for non-flexible children
			let nonFlexibleWidth = 0
			for (const child of nonFlexChildren) {
				nonFlexibleWidth += child.getMaxIntrinsicWidth(0)
			}

			const availableWidth = Math.max(0, width - nonFlexibleWidth)

			// Calculate heights for all children
			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				let childWidth = width
				if (parentData && parentData.flex > 0 && totalFlex > 0) {
					childWidth = (availableWidth / totalFlex) * parentData.flex
				}
				maxHeight = Math.max(maxHeight, child.getMaxIntrinsicHeight(childWidth))
			}

			return maxHeight
		} else {
			// For vertical flex (Column), use Flutter's formula:
			// sum(non-flex) + max(flexFraction) * totalFlex
			let inflexibleHeight = 0
			let totalFlex = 0
			let maxFlexFraction = 0

			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				const flex = parentData?.flex ?? 0

				if (flex > 0) {
					totalFlex += flex
					const flexFraction = child.getMaxIntrinsicHeight(width) / flex
					maxFlexFraction = Math.max(maxFlexFraction, flexFraction)
				} else {
					inflexibleHeight += child.getMaxIntrinsicHeight(width)
				}
			}

			return inflexibleHeight + maxFlexFraction * totalFlex
		}
	}

	getMinIntrinsicHeight(width: number): number {
		const isHorizontal = this._direction === Axis.horizontal
		const children = this.children as RenderBox[]

		if (isHorizontal) {
			// For horizontal flex (Row), return max child height
			// Need to account for flex children getting proportional width
			let maxHeight = 0
			let totalFlex = 0
			const nonFlexChildren: RenderBox[] = []
			const flexChildren: RenderBox[] = []

			// First pass: separate flex vs non-flex children and calculate total flex
			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				if (parentData && parentData.flex > 0) {
					totalFlex += parentData.flex
					flexChildren.push(child)
				} else {
					nonFlexChildren.push(child)
				}
			}

			// Calculate space needed by non-flexible children
			let nonFlexibleWidth = 0
			for (const child of nonFlexChildren) {
				nonFlexibleWidth += child.getMinIntrinsicWidth(0) // Height doesn't matter for width calc
			}

			// Calculate available space for flexible children
			const availableWidth = Math.max(0, width - nonFlexibleWidth)

			// Calculate heights for ALL children (including flexible ones)
			// This matches Flutter's behavior where Expanded children contribute to intrinsic sizing
			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				let childWidth = width
				if (parentData && parentData.flex > 0 && totalFlex > 0) {
					// Give proportional width to flexible child based on its flex value
					childWidth = (availableWidth / totalFlex) * parentData.flex
				}
				maxHeight = Math.max(maxHeight, child.getMinIntrinsicHeight(childWidth))
			}

			return maxHeight
		} else {
			// For vertical flex (Column), use Flutter's formula:
			// sum(non-flex) + max(flexFraction) * totalFlex
			let inflexibleHeight = 0
			let totalFlex = 0
			let maxFlexFraction = 0

			for (const child of children) {
				const parentData = child.parentData as FlexParentData | undefined
				const flex = parentData?.flex ?? 0

				if (flex > 0) {
					totalFlex += flex
					const flexFraction = child.getMinIntrinsicHeight(width) / flex
					maxFlexFraction = Math.max(maxFlexFraction, flexFraction)
				} else {
					inflexibleHeight += child.getMinIntrinsicHeight(width)
				}
			}

			return inflexibleHeight + maxFlexFraction * totalFlex
		}
	}

	dispose(): void {
		// Clear layout properties to help GC
		this._direction = Axis.vertical
		this._mainAxisAlignment = MainAxisAlignment.start
		this._crossAxisAlignment = CrossAxisAlignment.start
		this._mainAxisSize = MainAxisSize.min

		super.dispose()
	}
}

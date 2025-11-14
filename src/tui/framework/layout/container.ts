import { assert } from '../../lib/assert.js'
import type { Color, Screen } from '../../lib/screen.js'
import { Colors } from '../../lib/screen.js'
import { BuildContextImpl } from '../build-context.js'
import type { Key } from '../key.js'
import type { HitTestResultInterface } from '../mouse/hit-test.js'
import type { MousePosition } from '../mouse/mouse-events.js'
import type { RenderObject } from '../render-object.js'
import { BoxConstraints, RenderBox } from '../render-object.js'
import {
	SingleChildRenderObjectElement,
	SingleChildRenderObjectWidget,
} from '../render-object-widget.js'
import type { Widget } from '../widget.js'
import { DimContext } from '../widgets/dim-context.js'
import type { EdgeInsets } from './padding.js'

/**
 * Box decoration for containers.
 */
export class BoxDecoration {
	constructor(
		public readonly color?: Color,
		public readonly border?: Border,
	) {}
}

/**
 * Border definition for boxes.
 */
export class Border {
	constructor(
		public readonly top?: BorderSide,
		public readonly right?: BorderSide,
		public readonly bottom?: BorderSide,
		public readonly left?: BorderSide,
	) {}

	/**
	 * Creates a border with the same style on all sides.
	 */
	static all(side: BorderSide): Border {
		return new Border(side, side, side, side)
	}

	/**
	 * Creates a border with symmetric horizontal and vertical sides.
	 */
	static symmetric(horizontal?: BorderSide, vertical?: BorderSide): Border {
		return new Border(vertical, horizontal, vertical, horizontal)
	}
}

/**
 * Single border side definition.
 */
export class BorderSide {
	constructor(
		public readonly color: Color = Colors.black,
		public readonly width: number = 1,
		public readonly style: BorderStyle = BorderStyle.rounded,
	) {}
}

/**
 * Border style enumeration.
 */
export enum BorderStyle {
	solid = 'solid',
	dashed = 'dashed',
	dotted = 'dotted',
	rounded = 'rounded',
}

/**
 * A widget that combines common painting, positioning, and sizing widgets.
 *
 * Container provides a convenient way to create a widget with padding,
 * margin, decoration, and size constraints.
 */
export class Container extends SingleChildRenderObjectWidget {
	public readonly width: number | undefined
	public readonly height: number | undefined
	public readonly padding: EdgeInsets | undefined
	public readonly margin: EdgeInsets | undefined
	public readonly decoration: BoxDecoration | undefined
	public readonly constraints: BoxConstraints | undefined

	constructor({
		key,
		child,
		width,
		height,
		padding,
		margin,
		decoration,
		constraints,
	}: {
		key?: Key
		child?: Widget
		width?: number
		height?: number
		padding?: EdgeInsets
		margin?: EdgeInsets
		decoration?: BoxDecoration
		constraints?: BoxConstraints
	} = {}) {
		super({
			...(key ? { key } : {}),
			...(child ? { child } : {}),
		})
		this.width = width
		this.height = height
		this.padding = padding
		this.margin = margin
		this.decoration = decoration
		this.constraints = constraints
	}

	createElement(): ContainerElement {
		return new ContainerElement(this)
	}

	createRenderObject(): ContainerRenderObject {
		return new ContainerRenderObject(
			this.width,
			this.height,
			this.padding,
			this.margin,
			this.decoration,
			this.constraints,
		)
	}

	updateRenderObject(renderObject: RenderObject): void {
		if (!(renderObject instanceof ContainerRenderObject)) {
			throw new Error('renderObject must be an instance of ContainerRenderObject')
		}
		renderObject.updateProperties(
			this.width,
			this.height,
			this.padding,
			this.margin,
			this.decoration,
			this.constraints,
		)
	}
}

/**
 * Element for Container that handles DimContext.
 */
export class ContainerElement extends SingleChildRenderObjectElement {
	constructor(widget: Container) {
		super(widget)
	}

	mount(): void {
		super.mount()
		this._updateForceDim()
	}

	performRebuild(): void {
		super.performRebuild()
		this._updateForceDim()
	}

	private _updateForceDim(): void {
		if (!this.renderObject) return

		const context = new BuildContextImpl(this, this.widget)
		const forceDim = DimContext.shouldForceDim(context)

		if (this.renderObject instanceof ContainerRenderObject) {
			this.renderObject.setForceDim(forceDim)
		}
	}
}

/**
 * RenderObject for Container.
 */
export class ContainerRenderObject extends RenderBox {
	private _forceDim: boolean = false

	constructor(
		private _width?: number,
		private _height?: number,
		private _padding?: EdgeInsets,
		private _margin?: EdgeInsets,
		private _decoration?: BoxDecoration,
		private _constraints?: BoxConstraints,
	) {
		super()
	}

	setForceDim(value: boolean): void {
		if (this._forceDim !== value) {
			this._forceDim = value
			this.markNeedsPaint()
		}
	}

	updateProperties(
		width?: number,
		height?: number,
		padding?: EdgeInsets,
		margin?: EdgeInsets,
		decoration?: BoxDecoration,
		constraints?: BoxConstraints,
	): void {
		this._width = width
		this._height = height
		this._padding = padding
		this._margin = margin
		this._decoration = decoration
		this._constraints = constraints
		this.markNeedsLayout()
		this.markNeedsPaint()
	}

	performLayout(): void {
		super.performLayout()

		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		// Calculate total margin and padding
		const marginHorizontal = this._margin?.horizontal ?? 0
		const marginVertical = this._margin?.vertical ?? 0
		const paddingHorizontal = this._padding?.horizontal ?? 0
		const paddingVertical = this._padding?.vertical ?? 0

		// Calculate border space (only for borders that actually exist)
		const border = this._decoration?.border
		const borderHorizontal = (border?.left ? 1 : 0) + (border?.right ? 1 : 0)
		const borderVertical = (border?.top ? 1 : 0) + (border?.bottom ? 1 : 0)

		this.sendDebugData({
			margin: this._margin,
			padding: this._padding,
			decoration: this._decoration,
			width: this._width,
			height: this._height,
			constraints: this._constraints,
		})

		// Convert width/height to tight constraints and combine with this._constraints
		// From Flutter: constraints = (width != null || height != null)
		//     ? constraints?.tighten(width: width, height: height) ??
		//           BoxConstraints.tightFor(width: width, height: height)
		//     : constraints;
		const widthHeightConstraints =
			this._width !== undefined || this._height !== undefined
				? (this._constraints?.tighten({ width: this._width, height: this._height }) ??
					BoxConstraints.tightFor({ width: this._width, height: this._height }))
				: this._constraints

		// Enforce width/height constraints on incoming constraints (clamps to respect parent)
		const effectiveConstraints = widthHeightConstraints
			? constraints.enforce(widthHeightConstraints)
			: constraints

		// Calculate available space for content from effective constraints
		const maxContentWidth =
			effectiveConstraints.maxWidth - marginHorizontal - paddingHorizontal - borderHorizontal

		const maxContentHeight =
			effectiveConstraints.maxHeight - marginVertical - paddingVertical - borderVertical

		const contentConstraints = new BoxConstraints(
			Math.max(
				0,
				effectiveConstraints.minWidth -
					marginHorizontal -
					paddingHorizontal -
					borderHorizontal,
			),
			Math.max(0, maxContentWidth),
			Math.max(
				0,
				effectiveConstraints.minHeight - marginVertical - paddingVertical - borderVertical,
			),
			Math.max(0, maxContentHeight),
		)

		let contentWidth: number
		let contentHeight: number

		if (this.children.length > 0) {
			// Layout child
			const child = this.children[0]
			if (!(child instanceof RenderBox)) {
				throw new Error('Child must be a RenderBox')
			}
			child.layout(contentConstraints)
			contentWidth = child.size.width
			contentHeight = child.size.height

			// Position child with margin, border, and padding offset
			const borderLeft = border?.left ? 1 : 0
			const borderTop = border?.top ? 1 : 0
			const offsetX = (this._margin?.left ?? 0) + borderLeft + (this._padding?.left ?? 0)
			const offsetY = (this._margin?.top ?? 0) + borderTop + (this._padding?.top ?? 0)
			child.setOffset(offsetX, offsetY)
		} else {
			// No child - expand to fill bounded constraints or shrink to zero for unbounded
			// This matches Flutter's Container behavior with LimitedBox(0,0) + ConstrainedBox.expand
			if (
				contentConstraints.maxWidth !== Infinity &&
				contentConstraints.maxHeight !== Infinity
			) {
				// Bounded constraints - expand to fill
				contentWidth = contentConstraints.maxWidth
				contentHeight = contentConstraints.maxHeight
			} else {
				// Unbounded constraints - shrink to minimum
				contentWidth = contentConstraints.minWidth
				contentHeight = contentConstraints.minHeight
			}
		}

		// Calculate final container size
		let finalWidth: number
		let finalHeight: number

		// If we have explicit width/height (which are now in effectiveConstraints as tight constraints)
		// and they're tight, use them directly
		if (
			effectiveConstraints.minWidth === effectiveConstraints.maxWidth &&
			isFinite(effectiveConstraints.maxWidth)
		) {
			finalWidth = effectiveConstraints.maxWidth
		} else {
			// Calculate total width from content size + decorations
			finalWidth = contentWidth + paddingHorizontal + borderHorizontal + marginHorizontal
		}

		if (
			effectiveConstraints.minHeight === effectiveConstraints.maxHeight &&
			isFinite(effectiveConstraints.maxHeight)
		) {
			finalHeight = effectiveConstraints.maxHeight
		} else {
			// Calculate total height from content size + decorations
			finalHeight = contentHeight + paddingVertical + borderVertical + marginVertical
		}

		this.setSize(
			effectiveConstraints.constrain(finalWidth, finalHeight).width,
			effectiveConstraints.constrain(finalWidth, finalHeight).height,
		)
	}

	getMinIntrinsicWidth(height: number): number {
		// If we have an explicit width, use it
		if (this._width !== undefined) {
			return this._width
		}

		// If we have a width constraint, respect it
		if (this._constraints && this._constraints.minWidth !== 0) {
			return this._constraints.minWidth
		}

		const marginHorizontal = this._margin?.horizontal ?? 0
		const paddingHorizontal = this._padding?.horizontal ?? 0
		const border = this._decoration?.border
		const borderHorizontal = (border?.left ? 1 : 0) + (border?.right ? 1 : 0)

		let childWidth = 0
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableHeight = Math.max(
				0,
				height -
					(this._margin?.vertical ?? 0) -
					(this._padding?.vertical ?? 0) -
					((border?.top ? 1 : 0) + (border?.bottom ? 1 : 0)),
			)
			childWidth = child.getMinIntrinsicWidth(availableHeight)
		}

		return childWidth + marginHorizontal + paddingHorizontal + borderHorizontal
	}

	getMaxIntrinsicWidth(height: number): number {
		// If we have an explicit width, use it
		if (this._width !== undefined) {
			return this._width
		}

		// If we have a width constraint, respect it
		if (this._constraints && this._constraints.maxWidth !== Infinity) {
			return this._constraints.maxWidth
		}

		const marginHorizontal = this._margin?.horizontal ?? 0
		const paddingHorizontal = this._padding?.horizontal ?? 0
		const border = this._decoration?.border
		const borderHorizontal = (border?.left ? 1 : 0) + (border?.right ? 1 : 0)

		let childWidth = 0 // Empty container has 0 intrinsic width
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableHeight = Math.max(
				0,
				height -
					(this._margin?.vertical ?? 0) -
					(this._padding?.vertical ?? 0) -
					((border?.top ? 1 : 0) + (border?.bottom ? 1 : 0)),
			)
			childWidth = child.getMaxIntrinsicWidth(availableHeight)
		}

		if (childWidth === Infinity) {
			return Infinity
		}

		return childWidth + marginHorizontal + paddingHorizontal + borderHorizontal
	}

	getMinIntrinsicHeight(width: number): number {
		// If we have an explicit height, use it
		if (this._height !== undefined) {
			return this._height
		}

		// If we have a height constraint, respect it
		if (this._constraints && this._constraints.minHeight !== 0) {
			return this._constraints.minHeight
		}

		const marginVertical = this._margin?.vertical ?? 0
		const paddingVertical = this._padding?.vertical ?? 0
		const border = this._decoration?.border
		const borderVertical = (border?.top ? 1 : 0) + (border?.bottom ? 1 : 0)

		let childHeight = 0
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableWidth = Math.max(
				0,
				width -
					(this._margin?.horizontal ?? 0) -
					(this._padding?.horizontal ?? 0) -
					((border?.left ? 1 : 0) + (border?.right ? 1 : 0)),
			)
			childHeight = child.getMinIntrinsicHeight(availableWidth)
		}

		const totalHeight = childHeight + marginVertical + paddingVertical + borderVertical

		// Clamp to maxHeight constraint if present
		if (this._constraints && this._constraints.maxHeight !== Infinity) {
			return Math.min(totalHeight, this._constraints.maxHeight)
		}

		return totalHeight
	}

	getMaxIntrinsicHeight(width: number): number {
		// If we have an explicit height, use it
		if (this._height !== undefined) {
			return this._height
		}

		// If we have a height constraint, respect it
		if (this._constraints && this._constraints.maxHeight !== Infinity) {
			return this._constraints.maxHeight
		}

		const marginVertical = this._margin?.vertical ?? 0
		const paddingVertical = this._padding?.vertical ?? 0
		const border = this._decoration?.border
		const borderVertical = (border?.top ? 1 : 0) + (border?.bottom ? 1 : 0)

		let childHeight = 0 // Empty container has 0 height, not infinite
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableWidth = Math.max(
				0,
				width -
					(this._margin?.horizontal ?? 0) -
					(this._padding?.horizontal ?? 0) -
					((border?.left ? 1 : 0) + (border?.right ? 1 : 0)),
			)
			childHeight = child.getMaxIntrinsicHeight(availableWidth)
		}

		if (childHeight === Infinity) {
			return Infinity
		}

		return childHeight + marginVertical + paddingVertical + borderVertical
	}

	paint(screen: Screen, offsetX: number = 0, offsetY: number = 0): void {
		// Use integer coordinates for screen painting
		const absoluteX = Math.floor(offsetX + this.offset.x)
		const absoluteY = Math.floor(offsetY + this.offset.y)

		// Paint background color if specified
		if (this._decoration?.color) {
			const backgroundStyle = {
				bg: this._decoration.color,
			}
			screen.fill(
				absoluteX,
				absoluteY,
				this.size.width,
				this.size.height,
				' ', // Fill with spaces
				backgroundStyle,
			)
		}

		// Paint border using box drawing characters
		if (this._decoration?.border) {
			this._paintBorder(screen, absoluteX, absoluteY)
		}

		// Call parent implementation to paint children
		super.paint(screen, offsetX, offsetY)
	}

	/**
	 * Paint the border using box drawing characters.
	 */
	private _paintBorder(screen: Screen, x: number, y: number): void {
		const border = this._decoration!.border!
		const width = this.size.width
		const height = this.size.height

		const getStyle = (color: Color) => {
			const style: any = { fg: color }
			if (this._forceDim) {
				style.dim = true
			}
			return style
		}

		// Get border characters based on width
		const getHorizontalChar = (borderWidth: number): string => {
			switch (borderWidth) {
				case 1:
					return '─'
				case 2:
					return '━'
				case 3:
					return '━' // Use heavy for 3+ as well
				default:
					return '━'
			}
		}

		const getVerticalChar = (borderWidth: number): string => {
			switch (borderWidth) {
				case 1:
					return '│'
				case 2:
					return '┃'
				case 3:
					return '┃' // Use heavy for 3+ as well
				default:
					return '┃'
			}
		}

		const getCornerChars = (borderWidth: number, isRounded: boolean) => {
			if (borderWidth === 1) {
				return isRounded
					? { tl: '╭', tr: '╮', bl: '╰', br: '╯' }
					: { tl: '┌', tr: '┐', bl: '└', br: '┘' }
			} else {
				// Use heavy corners for width 2+
				return isRounded
					? { tl: '╭', tr: '╮', bl: '╰', br: '╯' } // No heavy rounded, use regular
					: { tl: '┏', tr: '┓', bl: '┗', br: '┛' }
			}
		}

		// Top border
		if (border.top) {
			const style = getStyle(border.top.color)
			const char = getHorizontalChar(border.top.width)
			for (let i = 0; i < width; i++) {
				screen.setChar(x + i, y, char, style, 1)
			}
		}

		// Bottom border
		if (border.bottom) {
			const style = getStyle(border.bottom.color)
			const char = getHorizontalChar(border.bottom.width)
			for (let i = 0; i < width; i++) {
				screen.setChar(x + i, y + height - 1, char, style, 1)
			}
		}

		// Left border
		if (border.left) {
			const style = getStyle(border.left.color)
			const char = getVerticalChar(border.left.width)
			for (let i = 0; i < height; i++) {
				screen.setChar(x, y + i, char, style, 1)
			}
		}

		// Right border
		if (border.right) {
			const style = getStyle(border.right.color)
			const char = getVerticalChar(border.right.width)
			for (let i = 0; i < height; i++) {
				screen.setChar(x + width - 1, y + i, char, style, 1)
			}
		}

		// Corners - use rounded or square based on border style and width
		const isRounded = border.top?.style === BorderStyle.rounded
		const cornerWidth = Math.max(
			border.top?.width ?? 1,
			border.right?.width ?? 1,
			border.bottom?.width ?? 1,
			border.left?.width ?? 1,
		)
		const corners = getCornerChars(cornerWidth, isRounded)

		if (border.top && border.left) {
			const style = getStyle(border.top.color)
			screen.setChar(x, y, corners.tl, style, 1)
		}
		if (border.top && border.right) {
			const style = getStyle(border.top.color)
			screen.setChar(x + width - 1, y, corners.tr, style, 1)
		}
		if (border.bottom && border.left) {
			const style = getStyle(border.bottom.color)
			screen.setChar(x, y + height - 1, corners.bl, style, 1)
		}
		if (border.bottom && border.right) {
			const style = getStyle(border.bottom.color)
			screen.setChar(x + width - 1, y + height - 1, corners.br, style, 1)
		}
	}

	hitTest(
		result: HitTestResultInterface,
		position: MousePosition,
		parentAbsX: number = 0,
		parentAbsY: number = 0,
	): boolean {
		// Delegate to the updated RenderBox implementation
		return super.hitTest(result, position, parentAbsX, parentAbsY)
	}

	dispose(): void {
		// Clear decoration references to help GC
		this._decoration = undefined
		this._constraints = undefined
		this._padding = undefined
		this._margin = undefined

		super.dispose()
	}
}

import { assert } from '../../lib/assert.js'
import type { Key } from '../key.js'
import type { HitTestResultInterface } from '../mouse/hit-test.js'
import type { MousePosition } from '../mouse/mouse-events.js'
import { BoxConstraints, RenderBox } from '../render-object.js'
import { Element, Widget } from '../widget.js'

/**
 * Represents padding values for all four sides.
 */
export class EdgeInsets {
	constructor(
		public readonly left: number,
		public readonly top: number,
		public readonly right: number,
		public readonly bottom: number,
	) {}

	/**
	 * Creates padding with the same value on all sides.
	 */
	static all(value: number): EdgeInsets {
		return new EdgeInsets(value, value, value, value)
	}

	/**
	 * Creates padding with symmetric horizontal and vertical values.
	 */
	static symmetric(horizontal: number = 0, vertical: number = 0): EdgeInsets {
		return new EdgeInsets(horizontal, vertical, horizontal, vertical)
	}

	/**
	 * Creates padding with only horizontal values.
	 */
	static horizontal(value: number): EdgeInsets {
		return new EdgeInsets(value, 0, value, 0)
	}

	/**
	 * Creates padding with only vertical values.
	 */
	static vertical(value: number): EdgeInsets {
		return new EdgeInsets(0, value, 0, value)
	}

	/**
	 * Creates padding with only left value.
	 */
	static only(options: {
		left?: number
		top?: number
		right?: number
		bottom?: number
	}): EdgeInsets {
		return new EdgeInsets(
			options.left ?? 0,
			options.top ?? 0,
			options.right ?? 0,
			options.bottom ?? 0,
		)
	}

	/**
	 * Total horizontal padding (left + right).
	 */
	get horizontal(): number {
		return this.left + this.right
	}

	/**
	 * Total vertical padding (top + bottom).
	 */
	get vertical(): number {
		return this.top + this.bottom
	}
}

/**
 * A widget that applies padding around its child.
 */
export class Padding extends Widget {
	public readonly padding: EdgeInsets
	public readonly child: Widget | undefined

	constructor({ key, padding, child }: { key?: Key; padding: EdgeInsets; child?: Widget }) {
		super(key ? { key } : {})
		this.padding = padding
		this.child = child
	}

	createElement(): PaddingElement {
		return new PaddingElement(this)
	}
}

/**
 * Element for Padding widget.
 */
export class PaddingElement extends Element {
	private _child?: Element
	private _renderObject?: PaddingRenderObject

	constructor(widget: Padding) {
		super(widget)
	}

	get paddingWidget(): Padding {
		return this.widget as Padding
	}

	get child(): Element | undefined {
		return this._child
	}

	get renderObject(): PaddingRenderObject | undefined {
		return this._renderObject
	}

	mount(): void {
		this._renderObject = new PaddingRenderObject(this.paddingWidget.padding)
		this._renderObject.attach()

		if (this.paddingWidget.child) {
			this._child = this.paddingWidget.child.createElement()
			this.addChild(this._child)
			this._child.mount()

			// Connect render objects
			if (this._child.renderObject) {
				this._renderObject.adoptChild(this._child.renderObject)
			}
		}
	}

	unmount(): void {
		if (this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			this._child = undefined
		}

		if (this._renderObject) {
			this._renderObject.detach()
			this._renderObject = undefined
		}

		super.unmount()
	}

	update(newWidget: Widget): void {
		super.update(newWidget)
		const widget = this.paddingWidget

		// Update render object padding
		if (this._renderObject) {
			this._renderObject.updatePadding(widget.padding)
		}

		// Update child
		if (widget.child && this._child) {
			if (this._child.widget.canUpdate(widget.child)) {
				this._child.update(widget.child)
			} else {
				this._child.unmount()
				this.removeChild(this._child)
				this._child = widget.child.createElement()
				this.addChild(this._child)
				this._child.mount()

				// Reconnect render objects
				if (this._renderObject && this._child.renderObject) {
					this._renderObject.removeAllChildren()
					this._renderObject.adoptChild(this._child.renderObject)
				}
			}
		} else if (widget.child && !this._child) {
			this._child = widget.child.createElement()
			this.addChild(this._child)
			this._child.mount()

			if (this._renderObject && this._child.renderObject) {
				this._renderObject.adoptChild(this._child.renderObject)
			}
		} else if (!widget.child && this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			this._child = undefined

			if (this._renderObject) {
				this._renderObject.removeAllChildren()
			}
		}
	}

	performRebuild(): void {
		// Padding elements don't typically rebuild themselves
		// Updates happen through parent widget changes
	}
}

/**
 * RenderObject for Padding.
 */
export class PaddingRenderObject extends RenderBox {
	constructor(private _padding: EdgeInsets) {
		super()
	}

	updatePadding(padding: EdgeInsets): void {
		this._padding = padding
		this.markNeedsLayout()
	}

	get padding(): EdgeInsets {
		return this._padding
	}

	performLayout(): void {
		super.performLayout()

		this.sendDebugData({ padding: this.padding })

		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')
		const horizontalPadding = this._padding.horizontal
		const verticalPadding = this._padding.vertical

		if (this.children.length > 0) {
			// Calculate available space for child after padding
			const childConstraints = new BoxConstraints(
				Math.max(0, constraints.minWidth - horizontalPadding),
				Math.max(0, constraints.maxWidth - horizontalPadding),
				Math.max(0, constraints.minHeight - verticalPadding),
				Math.max(0, constraints.maxHeight - verticalPadding),
			)

			const child = this.children[0] as RenderBox
			child.layout(childConstraints)

			// Position child with padding offset
			child.setOffset(this._padding.left, this._padding.top)

			// Set our size to child size plus padding, constrained by parent
			const desiredSize = constraints.constrain(
				child.size.width + horizontalPadding,
				child.size.height + verticalPadding,
			)
			this.setSize(desiredSize.width, desiredSize.height)
		} else {
			// No child, constrain padding size by parent constraints
			const desiredSize = constraints.constrain(horizontalPadding, verticalPadding)
			this.setSize(desiredSize.width, desiredSize.height)
		}
	}

	getMinIntrinsicWidth(height: number): number {
		const horizontalPadding = this._padding.horizontal
		const verticalPadding = this._padding.vertical

		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableHeight = Math.max(0, height - verticalPadding)
			return child.getMinIntrinsicWidth(availableHeight) + horizontalPadding
		}
		return horizontalPadding
	}

	getMinIntrinsicHeight(width: number): number {
		const horizontalPadding = this._padding.horizontal
		const verticalPadding = this._padding.vertical

		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableWidth = Math.max(0, width - horizontalPadding)
			return child.getMinIntrinsicHeight(availableWidth) + verticalPadding
		}
		return verticalPadding
	}

	getMaxIntrinsicWidth(height: number): number {
		const horizontalPadding = this._padding.horizontal
		const verticalPadding = this._padding.vertical

		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableHeight = Math.max(0, height - verticalPadding)
			return child.getMaxIntrinsicWidth(availableHeight) + horizontalPadding
		}
		return horizontalPadding
	}

	getMaxIntrinsicHeight(width: number): number {
		const horizontalPadding = this._padding.horizontal
		const verticalPadding = this._padding.vertical

		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			const availableWidth = Math.max(0, width - horizontalPadding)
			return child.getMaxIntrinsicHeight(availableWidth) + verticalPadding
		}
		return verticalPadding
	}

	hitTest(
		result: HitTestResultInterface,
		position: MousePosition,
		parentAbsX: number = 0,
		parentAbsY: number = 0,
	): boolean {
		// Calculate absolute position of this render object
		const absX = parentAbsX + this.offset.x
		const absY = parentAbsY + this.offset.y

		const withinX = position.x >= absX && position.x < absX + this.size.width
		const withinY = position.y >= absY && position.y < absY + this.size.height

		if (withinX && withinY) {
			// Hit! Add to result with local position
			const localPosition = {
				x: position.x - absX,
				y: position.y - absY,
			}
			result.add({ target: this, localPosition })

			// Test children with absolute coordinates
			for (let i = this.children.length - 1; i >= 0; i--) {
				const child = this.children[i]
				if (child && 'hitTest' in child && typeof child.hitTest === 'function') {
					child.hitTest(result, position, absX, absY)
				}
			}

			return true
		}

		// Still forward to children even if we weren't hit, but with our absolute position
		const fallbackAbsX = parentAbsX + this.offset.x
		const fallbackAbsY = parentAbsY + this.offset.y
		for (const child of this.children) {
			if ('hitTest' in child && typeof child.hitTest === 'function') {
				child.hitTest(result, position, fallbackAbsX, fallbackAbsY)
			}
		}

		return false
	}
}

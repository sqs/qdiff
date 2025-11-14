import type { ParentData } from './parent-data.js'
import type { RenderObject } from './render-object.js'
import { Element, Widget } from './widget.js'

/**
 * Base class for widgets that provide data to be stored on child render objects.
 *
 * ParentDataWidgets don't create render objects themselves; instead they modify
 * the parent data of their child's render object. This allows efficient
 * parent-child communication without creating wrapper render objects.
 */
export abstract class ParentDataWidget<T extends ParentData> extends Widget {
	readonly child: Widget

	constructor(child: Widget, key?: any) {
		super(key)
		this.child = child
	}

	/**
	 * Creates the parent data object that will be stored on the child.
	 */
	abstract createParentData(): T

	/**
	 * Applies the parent data to the child's render object.
	 * Called when the widget is first mounted and when it's updated.
	 */
	abstract applyParentData(renderObject: RenderObject): void

	/**
	 * Checks if the parent data is valid for the given render object.
	 * Should return true if the render object can accept this type of parent data.
	 */
	abstract debugIsValidRenderObject(renderObject: RenderObject): boolean

	createElement(): Element {
		return new ParentDataElement(this)
	}
}

/**
 * Element for ParentDataWidget.
 * Manages the lifecycle of parent data application.
 */
export class ParentDataElement extends Element {
	private _child?: Element

	constructor(widget: ParentDataWidget<any>) {
		super(widget)
	}

	get parentDataWidget(): ParentDataWidget<any> {
		return this.widget as ParentDataWidget<any>
	}

	get child(): Element | undefined {
		return this._child
	}

	get renderObject(): RenderObject | undefined {
		return this._child?.renderObject
	}

	mount(): void {
		this._child = this.parentDataWidget.child.createElement()
		this.addChild(this._child)
		this._child.mount()
		this._applyParentData()
	}

	unmount(): void {
		if (this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			;(this as any)._child = undefined
		}
		super.unmount()
	}

	update(newWidget: Widget): void {
		super.update(newWidget)
		const newParentDataWidget = newWidget as ParentDataWidget<any>

		if (this._child) {
			if (this._child.widget.canUpdate(newParentDataWidget.child)) {
				this._child.update(newParentDataWidget.child)
			} else {
				this._child.unmount()
				this.removeChild(this._child)
				this._child = newParentDataWidget.child.createElement()
				this.addChild(this._child)
				this._child.mount()
			}
		} else {
			this._child = newParentDataWidget.child.createElement()
			this.addChild(this._child)
			this._child.mount()
		}

		this._applyParentData()
	}

	performRebuild(): void {
		// ParentDataWidget doesn't rebuild - it just applies parent data
		this._applyParentData()
	}

	private _applyParentData(): void {
		const child = this._child
		if (!child) return

		const renderObject = child.renderObject
		if (!renderObject) return

		if (!this.parentDataWidget.debugIsValidRenderObject(renderObject)) {
			throw new Error(
				`ParentDataWidget ${this.parentDataWidget.constructor.name} provided parent data to ` +
					`${renderObject.constructor.name}, but ${renderObject.constructor.name} ` +
					`doesn't support this type of parent data.`,
			)
		}

		// Create parent data if it doesn't exist or is wrong type
		if (
			!renderObject.parentData ||
			renderObject.parentData.constructor !==
				this.parentDataWidget.createParentData().constructor
		) {
			renderObject.parentData = this.parentDataWidget.createParentData()
		}

		this.parentDataWidget.applyParentData(renderObject)
	}
}

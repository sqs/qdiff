import type { Key } from './key.js'
import { Element, Widget } from './widget.js'

/**
 * Base class for widgets that efficiently propagate information down the tree.
 *
 * InheritedWidgets, when referenced by descendant widgets, will cause the
 * dependent widgets to rebuild when the inherited widget changes.
 */
export abstract class InheritedWidget extends Widget {
	public readonly child: Widget

	constructor({ key, child }: { key?: Key; child: Widget }) {
		super(key !== undefined ? { key } : {})
		this.child = child
	}

	createElement(): InheritedElement {
		return new InheritedElement(this)
	}

	/**
	 * Whether this widget should notify dependent widgets when it changes.
	 * This is called when the widget is updated.
	 */
	abstract updateShouldNotify(oldWidget: this): boolean
}

/**
 * Element for InheritedWidget that manages dependencies.
 */
export class InheritedElement extends Element {
	private _child?: Element
	private _dependents = new Set<Element>()

	constructor(widget: InheritedWidget) {
		super(widget)
	}

	get inheritedWidget(): InheritedWidget {
		return this.widget as InheritedWidget
	}

	get child(): Element | undefined {
		return this._child
	}

	/**
	 * InheritedWidget elements delegate their render object to their child
	 */
	get renderObject() {
		return this._child?.renderObject
	}

	mount(): void {
		this._child = this.inheritedWidget.child.createElement()
		this.addChild(this._child)
		this._child.mount()
		this.markMounted()
	}

	unmount(): void {
		if (this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			;(this as any)._child = undefined
		}
		this._dependents.clear()
		super.unmount()
	}

	update(newWidget: Widget): void {
		const oldWidget = this.inheritedWidget
		super.update(newWidget)
		const widget = this.inheritedWidget

		// Check if we should notify dependents
		if (widget.updateShouldNotify(oldWidget)) {
			this.notifyDependents()
		}

		// Update child
		if (this._child && this._child.widget.canUpdate(widget.child)) {
			this._child.update(widget.child)
		} else {
			if (this._child) {
				this._child.unmount()
				this.removeChild(this._child)
			}

			this._child = widget.child.createElement()
			this.addChild(this._child)
			this._child.mount()
		}
	}

	/**
	 * Add a dependent element that should be notified when this widget changes.
	 */
	addDependent(dependent: Element): void {
		this._dependents.add(dependent)
	}

	/**
	 * Remove a dependent element.
	 */
	removeDependent(dependent: Element): void {
		this._dependents.delete(dependent)
	}

	/**
	 * Notify all dependent elements that they need to rebuild.
	 */
	private notifyDependents(): void {
		for (const dependent of this._dependents) {
			dependent.markNeedsRebuild()
		}
	}

	performRebuild(): void {
		// InheritedElements don't typically rebuild themselves directly
		// Updates happen through the update() method when widget properties change
		// Dependencies are managed through dependency notifications
	}
}

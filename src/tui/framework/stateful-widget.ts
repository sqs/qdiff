import type { BuildContext } from './build-context.js'
import { BuildContextImpl } from './build-context.js'
import type { RenderObject } from './render-object.js'
import type { State } from './state.js'
import { Element, Widget } from './widget.js'

/**
 * A widget that has mutable state.
 *
 * StatefulWidget is useful when the part of the user interface you are
 * describing can change dynamically. The state is held in a State object
 * that is created by the createState method.
 */
export abstract class StatefulWidget extends Widget {
	/**
	 * Creates the mutable state for this widget at a given location in the tree.
	 *
	 * Subclasses should override this method to return a newly created
	 * instance of their associated State subclass.
	 */
	abstract createState(): State<this>

	/**
	 * Creates the element for this widget.
	 *
	 * @returns A new StatefulElement that manages this widget's state
	 */
	createElement(): StatefulElement {
		return new StatefulElement(this)
	}
}

/**
 * An Element that manages a StatefulWidget and its associated State.
 */
export class StatefulElement extends Element {
	private _state?: State<StatefulWidget>
	private _child?: Element
	private _context?: BuildContext

	/**
	 * Creates a new StatefulElement for the given StatefulWidget.
	 *
	 * @param widget The StatefulWidget this element will manage
	 */
	constructor(widget: StatefulWidget) {
		super(widget)
	}

	/**
	 * Returns the widget cast as a StatefulWidget.
	 *
	 * @returns The StatefulWidget this element manages
	 */
	get statefulWidget(): StatefulWidget {
		return this.widget as StatefulWidget
	}

	/**
	 * Returns the current state instance associated with this element.
	 *
	 * @returns The State object, or undefined if not yet mounted
	 */
	get state(): State<StatefulWidget> | undefined {
		return this._state
	}

	/**
	 * Returns the child element built by the state's build method.
	 *
	 * @returns The child Element, or undefined if not yet built
	 */
	get child(): Element | undefined {
		return this._child
	}

	/**
	 * Mounts this element to the widget tree.
	 * Creates the build context, state instance, and performs initial build.
	 */
	mount(): void {
		this._context = new BuildContextImpl(this, this.widget)
		this._state = this.statefulWidget.createState()
		this._state._mount(this.statefulWidget, this._context)
		this.rebuild()
		this.markMounted()
	}

	/**
	 * Unmounts this element from the widget tree.
	 * Cleans up the child element, state, and context.
	 */
	unmount(): void {
		if (this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			;(this as any)._child = undefined
		}

		if (this._state) {
			this._state._unmount()
			;(this as any)._state = undefined
		}

		;(this as any)._context = undefined
		super.unmount()
	}

	/**
	 * Updates this element with a new widget configuration.
	 * Notifies the state of the update and triggers a rebuild.
	 *
	 * @param newWidget The new widget configuration to update to
	 */
	update(newWidget: Widget): void {
		// Skip update if the exact same widget instance is provided (e.g., from cache)
		if (this.widget === newWidget) {
			return
		}

		super.update(newWidget)

		if (this._state) {
			this._state._update(this.statefulWidget)
		}

		// Update context widget reference AFTER state update to prevent stale widget access
		// This ensures didUpdateWidget gets correct old/new comparison, but build() gets fresh widget
		if (this._context) {
			this._context.widget = newWidget
		}

		this.rebuild()
	}

	/**
	 * Perform the rebuild as required by the Element base class.
	 */
	performRebuild(): void {
		this.rebuild()
	}

	/**
	 * Rebuilds the widget by calling the state's build method and updating the child.
	 */
	rebuild(): void {
		if (!this._context || !this._state) {
			throw new Error('Cannot rebuild unmounted element')
		}

		const newWidget = this._state.build(this._context)

		if (this._child) {
			if (this._child.widget.canUpdate(newWidget)) {
				this._child.update(newWidget)
			} else {
				const oldChild = this._child
				const parentRO = this.findNearestRenderObjectAncestor()

				// Drop old render object from parent
				if (parentRO && oldChild.renderObject) {
					parentRO.dropChild(oldChild.renderObject)
				} else if (!parentRO && oldChild.renderObject) {
					// When there's no parent RO, ensure old render object is detached
					oldChild.renderObject.detach()
				}

				// Unmount and remove old child
				this._child.unmount()
				this.removeChild(this._child)

				// Create and mount new child
				this._child = newWidget.createElement()
				this.addChild(this._child)
				this._child.mount()

				// Adopt new render object to parent
				if (parentRO && this._child.renderObject) {
					parentRO.adoptChild(this._child.renderObject)
					this._child.renderObject.markNeedsLayout()
				} else if (!parentRO && this._child.renderObject) {
					// When there's no parent RO, ensure the new render object gets attached
					// The normal layout pipeline will handle positioning via InheritedElement delegation
					this._child.renderObject.attach()
					this._child.renderObject.markNeedsLayout()
				}

				// Mark the new child for layout since it's a completely new render object
				if (this._child.renderObject) {
					this._child.renderObject.markNeedsLayout()
				}
			}
		} else {
			this._child = newWidget.createElement()
			this.addChild(this._child)
			this._child.mount()
		}
	}

	/**
	 * Marks this element as needing to be rebuilt.
	 * This is called by State.setState().
	 */
	markNeedsBuild(): void {
		this.markNeedsRebuild()
	}

	/**
	 * Find the nearest ancestor element that has a render object.
	 */
	private findNearestRenderObjectAncestor(): RenderObject | undefined {
		let current = this.parent
		while (current) {
			if (current.renderObject) {
				// Avoid circular references - don't return our own child's render object
				if (
					this._child?.renderObject &&
					current.renderObject === this._child.renderObject
				) {
					current = current.parent
					continue
				}
				return current.renderObject
			}
			current = current.parent
		}
		return undefined
	}

	/**
	 * Returns the render object from the child element (same as StatelessElement).
	 */
	get renderObject(): RenderObject | undefined {
		return this._child?.renderObject
	}
}

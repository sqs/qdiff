import type { BuildContext } from './build-context.js'
import { BuildContextImpl } from './build-context.js'
import type { RenderObject } from './render-object.js'
import { Element, Widget } from './widget.js'

/**
 * A widget that does not require mutable state.
 *
 * StatelessWidget is useful when the part of the user interface you are
 * describing does not depend on anything other than the configuration
 * information passed in the constructor.
 */
export abstract class StatelessWidget extends Widget {
	/**
	 * Describes the part of the user interface represented by this widget.
	 *
	 * The build method is called whenever the widget needs to be rendered.
	 * It should return a widget that describes the current configuration.
	 * @param context The build context containing information about the widget tree
	 * @returns A widget that describes the current configuration
	 */
	abstract build(context: BuildContext): Widget

	/**
	 * Creates the element for this widget.
	 * @returns A new StatelessElement that manages this widget
	 */
	createElement(): StatelessElement {
		return new StatelessElement(this)
	}
}

/**
 * An Element that manages a StatelessWidget.
 */
export class StatelessElement extends Element {
	private _child?: Element
	private _context?: BuildContext

	/**
	 * Creates a new StatelessElement for the given widget.
	 * @param widget The StatelessWidget this element will manage
	 */
	constructor(widget: StatelessWidget) {
		super(widget)
	}

	/**
	 * Gets the StatelessWidget managed by this element.
	 * @returns The StatelessWidget this element manages
	 */
	get statelessWidget(): StatelessWidget {
		return this.widget as StatelessWidget
	}

	/**
	 * Gets the child element created by building this widget.
	 * @returns The child element, or undefined if not yet built
	 */
	get child(): Element | undefined {
		return this._child
	}

	/**
	 * Gets the render object from the child element.
	 * @returns The render object from the child element, or undefined if no child exists
	 */
	get renderObject(): RenderObject | undefined {
		return this._child?.renderObject
	}

	/**
	 * Mounts this element by creating a build context and performing the initial build.
	 */
	mount(): void {
		this._context = new BuildContextImpl(this, this.widget)
		this.rebuild()
		this.markMounted()
	}

	/**
	 * Unmounts this element by cleaning up the child element and build context.
	 */
	unmount(): void {
		if (this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			;(this as any)._child = undefined
		}
		;(this as any)._context = undefined
		super.unmount()
	}

	/**
	 * Updates this element with a new widget and triggers a rebuild.
	 * @param newWidget The new widget to use for this element
	 */
	update(newWidget: Widget): void {
		// Skip update if the exact same widget instance is provided (e.g., from cache)
		if (this.widget === newWidget) {
			return
		}

		super.update(newWidget)

		// Update context widget reference to prevent stale widget access
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
	 * Rebuilds the widget by calling its build method and updating the child.
	 */
	private rebuild(): void {
		if (!this._context) {
			throw new Error('Cannot rebuild unmounted element')
		}

		const newWidget = this.statelessWidget.build(this._context)

		if (this._child) {
			// Skip update if the exact same widget instance is returned (e.g., from cache)
			if (this._child.widget === newWidget) {
				return
			}

			if (this._child.widget.canUpdate(newWidget)) {
				this._child.update(newWidget)
			} else {
				this._child.unmount()
				this.removeChild(this._child)
				this._child = newWidget.createElement()
				this.addChild(this._child)
				this._child.mount()
			}
		} else {
			this._child = newWidget.createElement()
			this.addChild(this._child)
			this._child.mount()
		}
	}
}

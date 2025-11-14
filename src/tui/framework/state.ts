import type { BuildContext } from './build-context.js'
import type { Widget } from './widget.js'

/**
 * The logic and internal state for a StatefulWidget.
 *
 * State objects are created by StatefulWidget.createState() and are
 * associated with a StatefulWidget for the lifetime of that widget.
 *
 * @template T - The type of StatefulWidget this State is associated with
 */
export abstract class State<T extends StatefulWidget> {
	/**
	 * The StatefulWidget that this State is associated with.
	 */
	widget!: T

	/**
	 * The BuildContext for this State.
	 */
	context!: BuildContext

	/**
	 * Whether this State is currently mounted.
	 */
	private _mounted = false

	/**
	 * Whether this State object is currently in the tree.
	 *
	 * @returns True if the state is currently mounted in the widget tree
	 */
	get mounted(): boolean {
		return this._mounted
	}

	/**
	 * Describes the part of the user interface represented by this widget.
	 *
	 * The build method is called whenever the widget needs to be rendered.
	 * It should return a widget that describes the current configuration and state.
	 *
	 * @param context - The BuildContext containing information about the location
	 *                  in the widget tree where this widget is being built
	 * @returns A Widget that describes the current configuration and state
	 */
	abstract build(context: BuildContext): Widget

	/**
	 * Called when this object is inserted into the tree.
	 *
	 * Override this method to perform initialization that depends on the
	 * location at which this object was inserted into the tree.
	 */
	initState(): void {
		// Override in subclasses
	}

	/**
	 * Called whenever the widget configuration changes.
	 *
	 * Override this method to respond when the widget changes.
	 * The old widget is available as oldWidget.
	 *
	 * @param _oldWidget - The previous widget instance before the update
	 */
	didUpdateWidget(_oldWidget: T): void {
		// Override in subclasses
	}

	/**
	 * Called when this object is removed from the tree permanently.
	 *
	 * Override this method to release any resources retained by this object.
	 */
	dispose(): void {
		// Override in subclasses
	}

	/**
	 * Notify the framework that the internal state of this object has changed.
	 *
	 * Calling setState notifies the framework that the internal state of this
	 * object has changed in a way that might impact the user interface in this
	 * subtree, which causes the framework to schedule a build for this State object.
	 *
	 * @param fn - Optional function to execute before marking for rebuild.
	 *             This function should contain state mutations.
	 */
	setState(fn?: () => void): void {
		if (!this._mounted) {
			throw new Error('setState() called after dispose()')
		}

		if (fn) {
			fn()
		}

		// Mark for rebuild - this would trigger the framework to call build() again
		this._markNeedsBuild()
	}

	/**
	 * Internal method to mark this state as mounted.
	 *
	 * @param widget - The StatefulWidget instance to associate with this state
	 * @param context - The BuildContext for this state's location in the tree
	 */
	_mount(widget: T, context: BuildContext): void {
		this.widget = widget
		this.context = context
		this._mounted = true
		this.initState()
	}

	/**
	 * Internal method to update the widget reference.
	 *
	 * @param newWidget - The new StatefulWidget instance to associate with this state
	 */
	_update(newWidget: T): void {
		const oldWidget = this.widget
		this.widget = newWidget
		this.didUpdateWidget(oldWidget)
	}

	/**
	 * Internal method to unmount this state.
	 */
	_unmount(): void {
		this._mounted = false
		this.dispose()
	}

	/**
	 * Internal method to mark that this state needs to be rebuilt.
	 * This would be implemented by the framework to schedule a rebuild.
	 */
	private _markNeedsBuild(): void {
		// Get the StatefulElement from the context and trigger rebuild
		const element = this.context.element
		if ('markNeedsBuild' in element && typeof element.markNeedsBuild === 'function') {
			;(element as any).markNeedsBuild()
		}
	}
}

/**
 * Import this interface to use with StatefulWidget.
 * This is a forward declaration to avoid circular dependencies.
 */
export interface StatefulWidget extends Widget {
	/**
	 * Creates the State instance for this StatefulWidget.
	 *
	 * @returns A new State instance that will manage this widget's state
	 */
	createState(): State<any>
}

import type { BuildContext } from '../../build-context.js'
import { InheritedWidget } from '../../inherited-widget.js'
import type { Key } from '../../key.js'
import type { Widget } from '../../widget.js'
import type { SelectionAreaController } from './selection-core.js'

/**
 * An InheritedWidget that provides access to a SelectionAreaController for its descendants.
 *
 * This widget enables child render objects to register themselves as Selectable
 * with the nearest SelectionArea without requiring direct widget references.
 *
 * Similar to Flutter's SelectionContainer, this provides the selection context
 * that child selectables can look up during their attach/detach lifecycle.
 */
export class InheritedSelectionArea extends InheritedWidget {
	public readonly controller: SelectionAreaController

	constructor({
		key,
		controller,
		child,
	}: {
		key?: Key
		controller: SelectionAreaController
		child: Widget
	}) {
		super({ key, child })
		this.controller = controller
	}

	/**
	 * Get the SelectionAreaController from the nearest InheritedSelectionArea ancestor.
	 *
	 * This method establishes a dependency relationship, so the calling widget
	 * will rebuild if the SelectionAreaController changes (though this is rare).
	 *
	 * @param context BuildContext to search from
	 * @returns SelectionAreaController from nearest ancestor, or null if none found
	 */
	static of(context: BuildContext): SelectionAreaController | null {
		const element = context.dependOnInheritedWidgetOfExactType(InheritedSelectionArea)
		if (element) {
			return (element.widget as InheritedSelectionArea).controller
		}
		return null
	}

	/**
	 * Get the SelectionAreaController from the nearest InheritedSelectionArea ancestor.
	 *
	 * Similar to `of`, but throws an error if no SelectionArea is found.
	 * Use this when selection capability is required.
	 *
	 * @param context BuildContext to search from
	 * @returns SelectionAreaController from nearest ancestor
	 * @throws Error if no InheritedSelectionArea is found
	 */
	static require(context: BuildContext): SelectionAreaController {
		const controller = InheritedSelectionArea.of(context)
		if (!controller) {
			throw new Error(
				'InheritedSelectionArea.require() called with a context that does not contain an InheritedSelectionArea.\n' +
					'No InheritedSelectionArea ancestor could be found starting from the given context. ' +
					'This can happen if the context comes from a widget above the SelectionArea.\n' +
					'The context used was: ' +
					context.widget.constructor.name,
			)
		}
		return controller
	}

	/**
	 * Whether this widget should notify dependents when it changes.
	 *
	 * Dependents should rebuild if the controller instance changes.
	 * This is rare - typically only happens when SelectionArea is rebuilt
	 * with a completely new controller.
	 */
	updateShouldNotify(oldWidget: InheritedSelectionArea): boolean {
		return this.controller !== oldWidget.controller
	}
}

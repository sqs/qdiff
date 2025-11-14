import type { BuildContext } from '../build-context.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'
import type { Action, ActionInfo } from './action.js'
import type { Intent } from './intent.js'

/**
 * Dispatches actions for intents.
 *
 * The ActionDispatcher is responsible for finding and invoking actions
 * that are bound to specific intent types.
 */
export class ActionDispatcher {
	/**
	 * Invokes the action associated with the given intent.
	 *
	 * @param intent The intent to invoke an action for
	 * @param context The build context to search for actions in
	 * @returns The result of the action, or null if no action was found
	 */
	invokeAction<T extends Intent>(intent: T, context: BuildContext): any {
		const actionInfo = this.findAction(intent, context)
		if (actionInfo && actionInfo.enabled) {
			return actionInfo.action.invoke(intent)
		}
		return null
	}

	/**
	 * Finds the action associated with the given intent.
	 *
	 * @param intent The intent to find an action for
	 * @param context The build context to search in
	 * @returns Information about the action, or null if not found
	 */
	findAction<T extends Intent>(intent: T, context: BuildContext): ActionInfo | null {
		// Walk up the widget tree looking for Actions widgets
		let currentContext: BuildContext | null = context

		while (currentContext) {
			const actionsState = currentContext.findAncestorStateOfType(ActionsState)
			if (actionsState) {
				const action = actionsState.getActionForIntent(intent)
				if (action) {
					return {
						action,
						enabled: action.isEnabled(intent),
					}
				}
			}
			// Move to parent context
			currentContext = currentContext.parent
		}

		return null
	}
}

/**
 * Properties for the Actions widget.
 */
export interface ActionsProps {
	/**
	 * A map of Intent types to Action objects that defines which actions
	 * this widget knows about.
	 */
	actions: Map<new () => Intent, Action>

	/**
	 * The child widget for this Actions widget.
	 */
	child: Widget

	/**
	 * An optional ActionDispatcher to use for invoking actions.
	 *
	 * If not provided, a default dispatcher will be used.
	 */
	dispatcher?: ActionDispatcher
}

/**
 * A widget that maps Intents to Actions to be used by its descendants.
 *
 * Actions are typically invoked using Shortcuts. They can also be invoked
 * using Actions.invoke() on a context containing an ambient Actions widget.
 *
 * This widget establishes an action registry that can be used by descendant
 * widgets to find and invoke actions for specific intents.
 */
export class Actions extends StatefulWidget {
	public readonly actions: Map<new () => Intent, Action>
	public readonly child: Widget
	public readonly dispatcher?: ActionDispatcher

	constructor({ actions, child, dispatcher, key }: ActionsProps & { key?: any }) {
		super({ key })
		this.actions = actions
		this.child = child
		this.dispatcher = dispatcher
	}

	createState(): State<this> {
		return new ActionsState() as unknown as State<this>
	}

	/**
	 * Invokes the action associated with the given Intent using the Actions widget
	 * that most tightly encloses the given BuildContext.
	 *
	 * @param context The build context to search for actions in
	 * @param intent The intent to invoke an action for
	 * @returns The result of the action, or null if no action was found or enabled
	 */
	static invoke<T extends Intent>(context: BuildContext, intent: T): any {
		const dispatcher = Actions.of(context)
		return dispatcher.invokeAction(intent, context)
	}

	/**
	 * Similar to invoke, but returns null instead of throwing if no Actions widget is found.
	 */
	static maybeInvoke<T extends Intent>(context: BuildContext, intent: T): any {
		try {
			return Actions.invoke(context, intent)
		} catch {
			return null
		}
	}

	/**
	 * Finds the Action bound to the given intent type in the given context.
	 *
	 * @param context The build context to search in
	 * @param intent Optional intent instance to use for type inference
	 * @returns The action bound to the intent type
	 * @throws Error if no action is found
	 */
	static find<T extends Intent>(context: BuildContext, intent?: T): Action<T> {
		const result = Actions.maybeFind(context, intent)
		if (!result) {
			const intentType = intent?.constructor.name || 'unknown'
			throw new Error(`No action found for intent type: ${intentType}`)
		}
		return result
	}

	/**
	 * Similar to find, but returns null instead of throwing if no action is found.
	 */
	static maybeFind<T extends Intent>(context: BuildContext, intent?: T): Action<T> | null {
		let currentContext: BuildContext | null = context

		while (currentContext) {
			const actionsState = currentContext.findAncestorStateOfType(ActionsState)
			if (actionsState && intent) {
				const action = actionsState.getActionForIntent(intent)
				if (action) {
					return action as Action<T>
				}
			}
			currentContext = currentContext.parent
		}

		return null
	}

	/**
	 * Returns the ActionDispatcher associated with the Actions widget that
	 * most tightly encloses the given BuildContext.
	 *
	 * @param context The build context to search in
	 * @returns The action dispatcher
	 * @throws Error if no Actions widget is found
	 */
	static of(context: BuildContext): ActionDispatcher {
		const actionsState = context.findAncestorStateOfType(ActionsState)
		if (!actionsState) {
			throw new Error('No Actions widget found in context')
		}
		return actionsState.dispatcher
	}

	/**
	 * Returns a callback that invokes the bound action for the given intent
	 * if the action is enabled, and returns null if the action is not enabled
	 * or no matching action is found.
	 */
	static handler<T extends Intent>(context: BuildContext, intent: T): (() => void) | null {
		const actionInfo = Actions.of(context).findAction(intent, context)
		if (actionInfo && actionInfo.enabled) {
			return () => actionInfo.action.invoke(intent)
		}
		return null
	}
}

/**
 * State for the Actions widget.
 */
export class ActionsState extends State<Actions> {
	public readonly dispatcher: ActionDispatcher = new ActionDispatcher()

	/**
	 * Gets the action for a given intent, if one exists.
	 */
	getActionForIntent<T extends Intent>(intent: T): Action<T> | null {
		const IntentConstructor = intent.constructor as new () => Intent
		return this.widget.actions.get(IntentConstructor) as Action<T> | null
	}

	build(context: BuildContext): Widget {
		// The Actions widget is invisible and just provides the action registry
		// to its descendants through the build context
		return this.widget.child
	}
}

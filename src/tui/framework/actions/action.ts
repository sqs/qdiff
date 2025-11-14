import type { Intent } from './intent.js'

/**
 * Base class for all actions.
 *
 * An Action defines how to execute a specific Intent. Actions contain
 * the business logic for handling user actions, while Intents describe
 * what the user wants to do.
 */
export abstract class Action<T extends Intent = Intent> {
	/**
	 * Creates an Action.
	 */
	constructor() {}

	/**
	 * Called when the action is invoked with an intent.
	 *
	 * @param intent The intent that triggered this action
	 * @returns The result of the action, or null if no result
	 */
	abstract invoke(intent: T): any

	/**
	 * Whether this action is enabled for the given intent.
	 *
	 * If this returns false, the action will not be invoked and
	 * keyboard shortcuts will be ignored.
	 *
	 * @param intent The intent to check
	 * @returns True if the action can be invoked
	 */
	isEnabled(intent: T): boolean {
		return true
	}

	/**
	 * Whether this action should consume the key event that triggered it.
	 *
	 * If this returns false, the key event will continue to bubble up
	 * the widget tree after this action is invoked.
	 *
	 * @param intent The intent that was invoked
	 * @returns True if the key event should be consumed
	 */
	consumesKey(intent: T): boolean {
		return true
	}

	/**
	 * Returns a string representation of this action for debugging.
	 */
	toString(): string {
		return `${this.constructor.name}()`
	}
}

/**
 * An action that invokes a callback when called.
 *
 * This is a convenience class for creating simple actions without
 * needing to create a custom Action subclass.
 */
export class CallbackAction<T extends Intent = Intent> extends Action<T> {
	/**
	 * Creates a CallbackAction.
	 *
	 * @param onInvoke The callback to invoke when this action is triggered
	 */
	constructor(private readonly onInvoke: (intent: T) => any) {
		super()
	}

	invoke(intent: T): any {
		return this.onInvoke(intent)
	}
}

/**
 * An action that does nothing.
 *
 * This can be used to disable a shortcut by mapping an intent to DoNothingAction.
 */
export class DoNothingAction extends Action {
	invoke(intent: Intent): null {
		return null
	}

	consumesKey(intent: Intent): boolean {
		return true
	}
}

/**
 * Information about an action that can be performed.
 */
export interface ActionInfo {
	/**
	 * The action that can be invoked.
	 */
	action: Action

	/**
	 * Whether the action is currently enabled.
	 */
	enabled: boolean
}

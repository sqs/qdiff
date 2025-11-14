import type { KeyboardEvent } from '../../lib/parser/types.js'
import type { BuildContext } from '../build-context.js'
import { type FocusNode, KeyEventResult } from '../focus/focus-node.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'
import { Focus } from '../widgets/focus.js'
import { ActionsState } from './actions-widget.js'
import type { Intent } from './intent.js'

/**
 * Options for creating a ShortcutActivator
 */
export interface ShortcutActivatorOptions {
	shift?: boolean
	ctrl?: boolean
	alt?: boolean
	meta?: boolean
}

/**
 * Represents a key combination that can trigger a shortcut.
 *
 * This class defines the key, modifiers, and conditions that must
 * be met for a shortcut to be activated.
 */
export class ShortcutActivator {
	public readonly shift: boolean
	public readonly ctrl: boolean
	public readonly alt: boolean
	public readonly meta: boolean

	constructor(
		public readonly key: string,
		options: ShortcutActivatorOptions = {},
	) {
		this.shift = options.shift ?? false
		this.ctrl = options.ctrl ?? false
		this.alt = options.alt ?? false
		this.meta = options.meta ?? false
	}

	/**
	 * Checks if this activator matches the given keyboard event.
	 */
	accepts(event: KeyboardEvent): boolean {
		return (
			event.key === this.key &&
			event.shiftKey === this.shift &&
			event.ctrlKey === this.ctrl &&
			event.altKey === this.alt &&
			event.metaKey === this.meta
		)
	}

	/**
	 * Creates a ShortcutActivator for a simple key press.
	 */
	static key(key: string): ShortcutActivator {
		return new ShortcutActivator(key)
	}

	/**
	 * Creates a ShortcutActivator for a Ctrl+key combination.
	 */
	static ctrl(key: string): ShortcutActivator {
		return new ShortcutActivator(key, { ctrl: true })
	}

	/**
	 * Creates a ShortcutActivator for a Shift+key combination.
	 */
	static shift(key: string): ShortcutActivator {
		return new ShortcutActivator(key, { shift: true })
	}

	/**
	 * Creates a ShortcutActivator for an Alt+key combination.
	 */
	static alt(key: string): ShortcutActivator {
		return new ShortcutActivator(key, { alt: true })
	}

	/**
	 * Creates a ShortcutActivator for a Meta+key combination.
	 */
	static meta(key: string): ShortcutActivator {
		return new ShortcutActivator(key, { meta: true })
	}

	toString(): string {
		const modifiers = []
		if (this.meta) modifiers.push('Meta')
		if (this.ctrl) modifiers.push('Ctrl')
		if (this.alt) modifiers.push('Alt')
		if (this.shift) modifiers.push('Shift')

		return modifiers.length > 0 ? `${modifiers.join('+')}+${this.key}` : this.key
	}
}

/**
 * Manages a set of keyboard shortcuts and their associated intents.
 */
export class ShortcutManager {
	private readonly shortcuts = new Map<ShortcutActivator, Intent>()

	constructor(shortcuts: Map<ShortcutActivator, Intent> = new Map()) {
		this.shortcuts = new Map(shortcuts)
	}

	/**
	 * Handles a keyboard event and returns the associated intent if found.
	 *
	 * @param event The keyboard event to handle
	 * @returns The intent associated with the key combination, or null if none found
	 */
	handleKeyEvent(event: KeyboardEvent): Intent | null {
		for (const [activator, intent] of this.shortcuts) {
			if (activator.accepts(event)) {
				return intent
			}
		}
		return null
	}

	/**
	 * Adds a shortcut to this manager.
	 */
	addShortcut(activator: ShortcutActivator, intent: Intent): void {
		this.shortcuts.set(activator, intent)
	}

	/**
	 * Removes a shortcut from this manager.
	 */
	removeShortcut(activator: ShortcutActivator): boolean {
		return this.shortcuts.delete(activator)
	}

	/**
	 * Gets all shortcuts in this manager.
	 */
	getAllShortcuts(): Map<ShortcutActivator, Intent> {
		return new Map(this.shortcuts)
	}

	/**
	 * Creates a new ShortcutManager that inherits from this one.
	 */
	copyWith(additional: Map<ShortcutActivator, Intent>): ShortcutManager {
		const combined = new Map([...this.shortcuts, ...additional])
		return new ShortcutManager(combined)
	}
}

/**
 * Properties for the Shortcuts widget.
 */
export interface ShortcutsProps {
	/**
	 * The map of shortcuts that describes the mapping between a key sequence
	 * and the Intent that will be emitted when that key sequence is pressed.
	 */
	shortcuts: Map<ShortcutActivator, Intent>

	/**
	 * The child widget for this Shortcuts widget.
	 */
	child: Widget

	/**
	 * An optional ShortcutManager to use instead of creating a new one.
	 *
	 * If provided, this manager will be used directly. If not provided,
	 * a new manager will be created from the shortcuts map.
	 */
	manager?: ShortcutManager

	/**
	 * A debug label for this shortcuts widget.
	 */
	debugLabel?: string

	/**
	 * An optional focus node to share with other widgets.
	 * When provided, this widget will not create its own Focus widget.
	 */
	focusNode?: FocusNode
}

/**
 * A widget that creates key bindings to specific actions for its descendants.
 *
 * This widget establishes a ShortcutManager to be used by its descendants
 * when invoking an Action via a keyboard key combination that maps to an Intent.
 *
 * The Shortcuts widget separates key bindings and their implementations,
 * allowing shortcuts to have key bindings that adapt to the focused context.
 */
export class Shortcuts extends StatefulWidget {
	public readonly shortcuts: Map<ShortcutActivator, Intent>
	public readonly child: Widget
	public readonly manager?: ShortcutManager
	public readonly debugLabel?: string
	public readonly focusNode?: FocusNode

	constructor({
		shortcuts,
		child,
		manager,
		debugLabel,
		focusNode,
		key,
	}: ShortcutsProps & { key?: any }) {
		super({ key })
		this.shortcuts = shortcuts
		this.child = child
		this.manager = manager
		this.debugLabel = debugLabel
		this.focusNode = focusNode
	}

	createState(): State<this> {
		return new ShortcutsState() as unknown as State<this>
	}
}

/**
 * State for the Shortcuts widget.
 */
export class ShortcutsState extends State<Shortcuts> {
	private manager: ShortcutManager | null = null

	initState(): void {
		super.initState()
		this.createManager()

		// Register our key handler with the provided focus node
		if (this.widget.focusNode) {
			this.widget.focusNode.addKeyHandler(this.handleKeyEvent)
		}
	}

	didUpdateWidget(oldWidget: Shortcuts): void {
		super.didUpdateWidget(oldWidget)

		// Recreate manager if shortcuts changed
		if (
			oldWidget.shortcuts !== this.widget.shortcuts ||
			oldWidget.manager !== this.widget.manager
		) {
			this.createManager()
		}
	}

	/**
	 * Creates or updates the shortcut manager.
	 */
	private createManager(): void {
		if (this.widget.manager) {
			this.manager = this.widget.manager
		} else {
			this.manager = new ShortcutManager(this.widget.shortcuts)
		}
	}

	dispose(): void {
		// Remove our key handler from the focus node
		if (this.widget.focusNode) {
			this.widget.focusNode.removeKeyHandler(this.handleKeyEvent)
		}
		super.dispose()
	}

	/**
	 * Handles keyboard events by checking for matching shortcuts.
	 */
	handleKeyEvent = (event: KeyboardEvent): KeyEventResult => {
		if (!this.manager) {
			return KeyEventResult.ignored
		}

		const intent = this.manager.handleKeyEvent(event)
		if (intent) {
			// Try to invoke the action for this intent
			const result = this.invokeIntent(intent)
			if (result === KeyEventResult.handled) {
				return KeyEventResult.handled
			}
		}

		return KeyEventResult.ignored
	}

	/**
	 * Attempts to invoke an action for the given intent.
	 */
	private invokeIntent(intent: Intent): any {
		// Find the nearest ActionsState using the proper BuildContext method
		const actionsState = this.context.findAncestorStateOfType(ActionsState)

		if (actionsState) {
			const action = actionsState.getActionForIntent(intent)
			if (action && action.isEnabled(intent)) {
				return action.invoke(intent)
			}
		}

		return null
	}

	build(context: BuildContext): Widget {
		if (this.widget.focusNode) {
			// Flutter pattern: When focusNode is provided, don't create Focus widget
			// We've registered our handler with the shared focus node in initState
			return this.widget.child
		} else {
			// Create our own Focus widget for key handling
			return new Focus({
				onKey: this.handleKeyEvent,
				autofocus: false,
				canRequestFocus: true,
				skipTraversal: false,
				debugLabel: this.widget.debugLabel,
				child: this.widget.child,
			})
		}
	}
}

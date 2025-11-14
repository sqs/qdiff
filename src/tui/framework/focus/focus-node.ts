import type { KeyboardEvent, PasteEvent } from '../../lib/parser/types.js'
import { FocusManager } from './focus-manager.js'

export enum KeyEventResult {
	/** The key event has been handled. Do not propagate it to other handlers. */
	handled = 'handled',
	/** The key event has not been handled. Allow other handlers to receive it. */
	ignored = 'ignored',
}

export type KeyboardEventHandler = (event: KeyboardEvent) => KeyEventResult
export type PasteEventHandler = (event: PasteEvent) => KeyEventResult
export type FocusListener = (node: FocusNode) => void

/**
 * A node in the focus tree that can receive keyboard events.
 *
 * Based on Flutter's FocusNode but simplified for terminal UI.
 * Each FocusNode represents a single focusable element in the widget tree.
 */
export class FocusNode {
	private static _nextDebugId = 0
	private _debugId: string
	private _parent: FocusNode | null = null
	private _children: Set<FocusNode> = new Set()
	private _hasPrimaryFocus = false
	private _canRequestFocus = true
	private _skipTraversal = false
	private _keyHandlers: KeyboardEventHandler[] = []
	private _onPasteCallback: PasteEventHandler | null = null
	private _listeners: Set<FocusListener> = new Set()
	private _debugLabel: string | null = null
	private static _requestFocusCallback: ((node: FocusNode | null) => boolean) | null = null

	/**
	 * Creates a new FocusNode with the specified options.
	 * @param options Configuration options for the focus node
	 * @param options.debugLabel Optional debug label for identification
	 * @param options.canRequestFocus Whether this node can receive focus (default: true)
	 * @param options.skipTraversal Whether to skip this node during focus traversal (default: false)
	 * @param options.onKey Key event handler for this node
	 * @param options.onPaste Paste event handler for this node
	 */
	constructor(
		options: {
			debugLabel?: string
			canRequestFocus?: boolean
			skipTraversal?: boolean
			onKey?: KeyboardEventHandler
			onPaste?: PasteEventHandler
		} = {},
	) {
		this._debugId = `focus-${FocusNode._nextDebugId++}`
		this._debugLabel = options.debugLabel ?? null
		this._canRequestFocus = options.canRequestFocus ?? true
		this._skipTraversal = options.skipTraversal ?? false
		if (options.onKey) {
			this._keyHandlers.push(options.onKey)
		}
		this._onPasteCallback = options.onPaste ?? null
	}

	/**
	 * Stable debug ID assigned at construction time.
	 */
	get debugId(): string {
		return this._debugId
	}

	/**
	 * Whether this node currently has primary focus.
	 */
	get hasPrimaryFocus(): boolean {
		return this._hasPrimaryFocus
	}

	/**
	 * Whether this node currently has focus. This means that it is on the path
	 * from the root to the primary focus node (i.e., the primary focus is this
	 * node or a descendant of this node).
	 */
	get hasFocus(): boolean {
		const primaryNode = FocusManager.instance.primaryFocus
		return this._hasPrimaryFocus || (primaryNode?._isDecendantOf(this) ?? false)
	}

	/**
	 * Whether this node can request focus.
	 */
	get canRequestFocus(): boolean {
		return this._canRequestFocus
	}

	set canRequestFocus(value: boolean) {
		if (this._canRequestFocus !== value) {
			this._canRequestFocus = value
			if (!value && this._hasPrimaryFocus) {
				this.unfocus()
			}
		}
	}

	/**
	 * Whether this node should be skipped during focus traversal.
	 */
	get skipTraversal(): boolean {
		return this._skipTraversal
	}

	set skipTraversal(value: boolean) {
		this._skipTraversal = value
	}

	/**
	 * The parent of this node in the focus tree.
	 */
	get parent(): FocusNode | null {
		return this._parent
	}

	/**
	 * The children of this node in the focus tree.
	 */
	get children(): ReadonlySet<FocusNode> {
		return this._children
	}

	/**
	 * Debug label for this node.
	 */
	get debugLabel(): string | null {
		return this._debugLabel
	}

	/**
	 * Paste event handler for this node.
	 */
	get onPaste(): PasteEventHandler | null {
		return this._onPasteCallback
	}

	set onPaste(handler: PasteEventHandler | null) {
		this._onPasteCallback = handler
	}

	/**
	 * Set the callback for requesting focus (used by FocusManager to avoid circular dependency).
	 * @param callback Function to call when focus is requested
	 */
	static setRequestFocusCallback(callback: (node: FocusNode | null) => boolean): void {
		FocusNode._requestFocusCallback = callback
	}

	/**
	 * Request focus for this node.
	 * @returns True if focus was successfully requested, false if the node cannot receive focus
	 */
	requestFocus(): boolean {
		if (!this._canRequestFocus) {
			return false
		}

		if (FocusNode._requestFocusCallback) {
			return FocusNode._requestFocusCallback(this)
		}
		return false
	}

	/**
	 * Remove focus from this node if it currently has focus.
	 */
	unfocus(): void {
		if (this._hasPrimaryFocus) {
			if (FocusNode._requestFocusCallback) {
				FocusNode._requestFocusCallback(null)
			}
		}
	}

	_isDecendantOf(node: FocusNode | null): boolean {
		if (node === null) {
			return false
		}
		if (this._parent === node) {
			return true
		}
		return this._parent?._isDecendantOf(node) ?? false
	}

	_isAncestorTo(node: FocusNode | null): boolean {
		return node?._isDecendantOf(this) ?? false
	}

	/**
	 * Attach this node as a child of the given parent.
	 * Called by FocusManager when building the focus tree.
	 * @param parent The parent node to attach to, or null to detach from current parent
	 */
	_attach(parent: FocusNode | null): void {
		if (this._parent === parent) {
			return
		}

		// Detach from old parent
		if (this._parent) {
			this._parent._children.delete(this)
		}

		// Attach to new parent
		this._parent = parent
		if (parent) {
			parent._children.add(this)
		}

		// Invalidate focusable nodes cache when tree structure changes
		if (FocusNode._requestFocusCallback) {
			const focusManager = (FocusNode._requestFocusCallback as any).__focusManager
			if (focusManager && focusManager._invalidateFocusableNodesCache) {
				focusManager._invalidateFocusableNodesCache()
			}
		}
	}

	/**
	 * Detach this node from its parent.
	 * Called by FocusManager when removing from focus tree.
	 */
	_detach(): void {
		if (this._parent) {
			this._parent._children.delete(this)
			this._parent = null
		}

		// Invalidate focusable nodes cache when tree structure changes
		if (FocusNode._requestFocusCallback) {
			const focusManager = (FocusNode._requestFocusCallback as any).__focusManager
			if (focusManager && focusManager._invalidateFocusableNodesCache) {
				focusManager._invalidateFocusableNodesCache()
			}
		}

		// If this node has focus, unfocus it
		if (this._hasPrimaryFocus) {
			this.unfocus()
		}
	}

	/**
	 * Set the focus state of this node.
	 * Called by FocusManager - should not be called directly.
	 * @param focused Whether this node should be focused
	 */
	_setFocus(focused: boolean): void {
		if (this._hasPrimaryFocus === focused) {
			return
		}

		const oldHasFocus = this.hasFocus
		this._hasPrimaryFocus = focused
		const newHasFocus = this.hasFocus

		// Notify this node's listeners
		this._notifyListeners()

		// Notify ancestor listeners if hasFocus changed
		if (oldHasFocus !== newHasFocus) {
			this._notifyAncestorListeners()
		}
	}

	/**
	 * Add a listener that is called when focus state changes.
	 * The listener receives the FocusNode instance and can query hasFocus, hasPrimaryFocus, etc.
	 * Similar to Flutter's FocusNode.addListener().
	 * @param listener The callback to invoke when focus state changes
	 */
	addListener(listener: FocusListener): void {
		this._listeners.add(listener)
	}

	/**
	 * Remove a focus listener.
	 * @param listener The callback to remove from focus notifications
	 */
	removeListener(listener: FocusListener): void {
		this._listeners.delete(listener)
	}

	/**
	 * Notify listeners that this node's focus state has changed.
	 */
	private _notifyListeners(): void {
		for (const listener of this._listeners) {
			listener(this)
		}
	}

	/**
	 * Notify ancestor listeners that hasFocus state has changed.
	 * Called when a descendant gains/loses primary focus.
	 */
	private _notifyAncestorListeners(): void {
		let parent = this._parent
		while (parent) {
			parent._notifyListeners()
			parent = parent._parent
		}
	}

	/**
	 * Handle a key event at this node.
	 * @param event The key event to handle
	 * @returns KeyEventResult.handled if the event was consumed, KeyEventResult.ignored otherwise
	 */
	_handleKeyEvent(event: KeyboardEvent): KeyEventResult {
		return this.handleKeyEvent(event)
	}

	/**
	 * Internal method to handle paste events on this node.
	 * @param event The paste event to handle
	 * @returns KeyEventResult.handled if the event was consumed, KeyEventResult.ignored otherwise
	 * @internal
	 */
	_handlePasteEvent(event: PasteEvent): KeyEventResult {
		if (this._onPasteCallback) {
			return this._onPasteCallback(event)
		}
		return KeyEventResult.ignored
	}

	/**
	 * Get a debug description of this node.
	 * @returns A short string description of this focus node
	 */
	toStringShort(): string {
		const label = this._debugLabel ? `"${this._debugLabel}"` : ''
		const focus = this._hasPrimaryFocus ? ' FOCUSED' : ''
		const canFocus = this._canRequestFocus ? '' : " (can't focus)"
		return `FocusNode${label}${focus}${canFocus}`
	}

	/**
	 * Get a detailed debug description including the focus tree.
	 * @param prefix String prefix for indentation (default: '')
	 * @param includeChildren Whether to include child nodes in the output (default: true)
	 * @returns A detailed string representation of this node and its children
	 */
	toStringDeep(prefix = '', includeChildren = true): string {
		let result = prefix + this.toStringShort()

		if (includeChildren && this._children.size > 0) {
			const childPrefix = prefix + '  '
			for (const child of this._children) {
				result += '\n' + child.toStringDeep(childPrefix, true)
			}
		}

		return result
	}

	/**
	 * Dispose of this focus node and clean up resources.
	 */
	/**
	 * Add a key event handler to this focus node.
	 * Multiple handlers can be registered and they will be called in order
	 * until one handles the event (like Flutter).
	 */
	addKeyHandler(handler: KeyboardEventHandler): void {
		this._keyHandlers.push(handler)
	}

	/**
	 * Remove a key event handler from this focus node.
	 */
	removeKeyHandler(handler: KeyboardEventHandler): void {
		const index = this._keyHandlers.indexOf(handler)
		if (index !== -1) {
			this._keyHandlers.splice(index, 1)
		}
	}

	/**
	 * Handle a key event by calling all registered handlers in order.
	 * Returns handled if any handler handles the event, ignored otherwise.
	 * This matches Flutter's key event handling behavior.
	 */
	handleKeyEvent(event: KeyboardEvent): KeyEventResult {
		// Call all handlers in registration order until one handles the event
		for (const handler of this._keyHandlers) {
			const result = handler(event)
			if (result === KeyEventResult.handled) {
				return KeyEventResult.handled
			}
		}
		return KeyEventResult.ignored
	}

	dispose(): void {
		this._detach()
		this._children.clear()
		this._keyHandlers = []
	}
}

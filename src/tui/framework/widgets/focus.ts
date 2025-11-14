import type { BuildContext } from '../build-context.js'
import { FocusManager } from '../focus/focus-manager.js'
import type { FocusNode, KeyboardEventHandler, PasteEventHandler } from '../focus/focus-node.js'
import { FocusNode as FocusNodeClass } from '../focus/focus-node.js'
import type { Key } from '../key.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'

export type FocusChangeCallback = (focused: boolean) => void

/**
 * A widget that inserts a FocusNode into the focus tree.
 *
 * Based on Flutter's Focus widget but simplified for terminal UI.
 * This widget creates and manages a FocusNode that can receive keyboard events.
 */
export class Focus extends StatefulWidget {
	readonly focusNode: FocusNode | undefined
	readonly child: Widget
	readonly autofocus: boolean
	readonly canRequestFocus: boolean
	readonly skipTraversal: boolean
	readonly onKey: KeyboardEventHandler | null
	readonly onPaste: PasteEventHandler | null
	readonly onFocusChange: FocusChangeCallback | null
	readonly debugLabel: string | null

	constructor({
		key,
		focusNode,
		child,
		autofocus = false,
		canRequestFocus = true,
		skipTraversal = false,
		onKey,
		onPaste,
		onFocusChange,
		debugLabel,
	}: {
		key?: Key
		focusNode?: FocusNode
		child: Widget
		autofocus?: boolean
		canRequestFocus?: boolean
		skipTraversal?: boolean
		onKey?: KeyboardEventHandler
		onPaste?: PasteEventHandler
		onFocusChange?: FocusChangeCallback
		debugLabel?: string
	}) {
		super({ key })

		this.focusNode = focusNode
		this.child = child
		this.autofocus = autofocus
		this.canRequestFocus = canRequestFocus
		this.skipTraversal = skipTraversal
		this.onKey = onKey || null
		this.onPaste = onPaste || null
		this.onFocusChange = onFocusChange || null
		this.debugLabel = debugLabel || null
	}

	createState(): State<this> {
		return new FocusState() as unknown as State<this>
	}
}

/**
 * State for Focus widget that manages FocusNode lifecycle
 */
export class FocusState extends State<Focus> {
	private _internalFocusNode: FocusNode | null = null
	private _isDisposed = false
	private _focusChangeHandler: ((node: FocusNode) => void) | null = null

	get effectiveFocusNode(): FocusNode {
		return this.widget.focusNode ?? this._internalFocusNode!
	}

	initState(): void {
		super.initState()

		// Create internal focus node if none provided
		if (!this.widget.focusNode) {
			const nodeOptions: any = {
				canRequestFocus: this.widget.canRequestFocus,
				skipTraversal: this.widget.skipTraversal,
			}

			if (this.widget.onKey) {
				nodeOptions.onKey = this.widget.onKey
			}

			if (this.widget.onPaste) {
				nodeOptions.onPaste = this.widget.onPaste
			}

			if (this.widget.debugLabel) {
				nodeOptions.debugLabel = this.widget.debugLabel
			}

			this._internalFocusNode = new FocusNodeClass(nodeOptions)
		}

		// Set up handlers on the effective focus node (but only if we didn't already set it via nodeOptions)
		// This ensures handlers work whether focus node was provided or auto-created
		if (this.widget.onKey && this.widget.focusNode) {
			this.effectiveFocusNode.addKeyHandler(this.widget.onKey)
		}

		if (this.widget.onPaste) {
			this.effectiveFocusNode.onPaste = this.widget.onPaste
		}

		// Set up focus change listener if callback provided
		if (this.widget.onFocusChange) {
			this._focusChangeHandler = (node: FocusNode) => {
				if (!this._isDisposed && this.widget.onFocusChange) {
					this.widget.onFocusChange(node.hasFocus)
				}
			}
			this.effectiveFocusNode.addListener(this._focusChangeHandler)
		}

		// Find parent focus node from widget tree context
		const parentFocusState = this.context.findAncestorStateOfType(FocusState)
		const parentFocusNode = parentFocusState?.effectiveFocusNode || null

		// Register with focus manager using proper parent
		FocusManager.instance.registerNode(this.effectiveFocusNode, parentFocusNode)

		// Handle autofocus
		if (this.widget.autofocus) {
			// Use setTimeout to ensure the widget tree is fully mounted
			setTimeout(() => {
				if (!this._isDisposed) {
					this.effectiveFocusNode.requestFocus()
				}
			}, 0)
		}
	}

	dispose(): void {
		// Remove our key handler if we added one
		if (this.widget.onKey) {
			this.effectiveFocusNode.removeKeyHandler(this.widget.onKey)
		}

		// Unregister from focus manager (this may trigger focus change notifications)
		FocusManager.instance.unregisterNode(this.effectiveFocusNode)

		// Mark as disposed AFTER unregistering (so onFocusChange can still be called)
		this._isDisposed = true

		// Remove focus change listener AFTER unregistering (so it can be notified of unfocus)
		if (this._focusChangeHandler) {
			this.effectiveFocusNode.removeListener(this._focusChangeHandler)
			this._focusChangeHandler = null
		}

		// Dispose internal focus node if we created one
		if (this._internalFocusNode) {
			this._internalFocusNode.dispose()
			this._internalFocusNode = null
		}

		super.dispose()
	}

	build(_context: BuildContext): Widget {
		return this.widget.child
	}
}

/**
 * Convenience widget for creating focusable components.
 * Similar to Focus but with sensible defaults for interactive widgets.
 */
export class Focusable extends Focus {
	constructor({
		key,
		focusNode,
		child,
		autofocus = false,
		onKey,
		onFocusChange,
		debugLabel,
	}: {
		key?: any
		focusNode?: FocusNode
		child: Widget
		autofocus?: boolean
		onKey?: KeyboardEventHandler
		onFocusChange?: FocusChangeCallback
		debugLabel?: string
	}) {
		super({
			key,
			...(focusNode && { focusNode }),
			child,
			autofocus,
			canRequestFocus: true,
			skipTraversal: false,
			...(onKey && { onKey }),
			...(onFocusChange && { onFocusChange }),
			...(debugLabel && { debugLabel }),
		})
	}
}

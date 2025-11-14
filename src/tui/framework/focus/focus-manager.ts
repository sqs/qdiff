import { assert } from '../../lib/assert.js'
import type { KeyboardEvent, PasteEvent } from '../../lib/parser/types.js'
import { FocusNode, KeyEventResult } from './focus-node.js'

export interface FocusNodeDebugInfo {
	id: string
	debugLabel: string | null
	hasPrimaryFocus: boolean
	hasFocus: boolean
	canRequestFocus: boolean
	skipTraversal: boolean
	isPrimaryFocus: boolean
	children: FocusNodeDebugInfo[]
}

export interface FocusTreeSnapshot {
	timestamp: number
	rootScope: FocusNodeDebugInfo | null
	primaryFocusId: string | null
	focusStack: Array<{ id: string; debugLabel: string | null }>
}

/**
 * Manages the focus tree and dispatches keyboard events to focused nodes.
 *
 * Based on Flutter's FocusManager but simplified for terminal UI.
 * This is a singleton that coordinates focus across the entire application.
 */
export class FocusManager {
	private static _instance: FocusManager | null = null

	private _rootScope: FocusNode
	private _primaryFocus: FocusNode | null = null
	// private _markedForFocus: FocusNode | null = null; // Reserved for future use
	private _cachedFocusableNodes: FocusNode[] | null = null

	/**
	 * Stack of primary focus nodes for focus history.
	 * When a node is unfocused, the next node on the stack receives focus.
	 * This is normally handled by a FocusScope in Flutter, but we're avoiding that for now.
	 */
	private _primaryFocusStack: FocusNode[] = []

	/**
	 * Creates a new FocusManager instance.
	 * Private constructor - use FocusManager.instance to get the singleton.
	 */
	private constructor() {
		// Create the root focus scope
		this._rootScope = new FocusNode({
			debugLabel: 'Root Focus Scope',
			canRequestFocus: false, // Root scope doesn't take focus itself
		})

		// Set up the callback to avoid circular dependency
		const requestFocusCallback = (node: FocusNode | null) => this.requestFocus(node)
		;(requestFocusCallback as any).__focusManager = this
		FocusNode.setRequestFocusCallback(requestFocusCallback)
	}

	/**
	 * Get the singleton instance of the FocusManager.
	 * @returns The global FocusManager instance
	 */
	static get instance(): FocusManager {
		if (!this._instance) {
			this._instance = new FocusManager()
		}
		return this._instance
	}

	/**
	 * The node that currently has primary focus, if any.
	 */
	get primaryFocus(): FocusNode | null {
		return this._primaryFocus
	}

	/**
	 * The root focus scope node.
	 */
	get rootScope(): FocusNode {
		return this._rootScope
	}

	/**
	 * Request focus for the given node.
	 * Pass null to unfocus all nodes.
	 * @param node The node to focus, or null to unfocus all nodes
	 * @returns True if the focus change was successful
	 */
	requestFocus(node: FocusNode | null): boolean {
		// If requesting focus for the same node, do nothing
		if (this._primaryFocus === node) {
			return true
		}

		// Validate that the node can receive focus
		if (node && !node.canRequestFocus) {
			return false
		}

		// Validate that the node is attached to the tree
		if (node && !node.parent) {
			return false
		}

		// Mark the old focused node as unfocused
		if (this._primaryFocus) {
			this._primaryFocus._setFocus(false)
		}

		// If node is null (unfocus current), restore focus to the previous node from the stack
		if (node === null) {
			const oldNode = this._primaryFocus

			// Remove the current node from the stack
			if (oldNode) {
				this._popFromFocusStack(oldNode)
			}

			// Find the next valid node in the stack
			const previousNode = this._findPreviousFocusableNode()
			this._primaryFocus = previousNode

			if (previousNode) {
				previousNode._setFocus(true)
			}

			return true
		}

		// Set the new primary focus
		this._primaryFocus = node

		// Mark the new focused node as focused and add to stack with deduplication
		node._setFocus(true)
		this._pushToFocusStack(node)

		return true
	}

	/**
	 * Handle a keyboard event by dispatching it to the appropriate focus nodes.
	 * @param event The keyboard event to handle
	 * @returns True if the event was handled by a focus node
	 */
	handleKeyEvent(event: KeyboardEvent): boolean {
		// If no node has focus, the event is not handled
		if (!this._primaryFocus) {
			return false
		}

		// Track the focus path for debugging (only in dev mode)
		const focusPath:
			| Array<{ id: string; debugLabel: string | null; handled: boolean }>
			| undefined = process.env.NODE_ENV !== 'production' ? [] : undefined

		// Simple bottom-up key event bubbling

		// Simple bottom-up bubbling like the original system
		let currentNode: FocusNode | null = this._primaryFocus

		while (currentNode) {
			const result = currentNode._handleKeyEvent(event)
			const wasHandled = result === KeyEventResult.handled

			// Record this node in the focus path
			if (focusPath) {
				focusPath.push({
					id: currentNode.debugId,
					debugLabel: currentNode.debugLabel,
					handled: wasHandled,
				})
			}

			if (wasHandled) {
				// Record the keystroke with focus path
				// if (focusPath) {
				// 	WidgetTreeDebugger.recordKeystroke(this.formatKeyEvent(event), focusPath, true)
				// }
				return true
			}
			// Bubble up to parent node
			currentNode = currentNode.parent
		}

		// Record the keystroke as unhandled
		// if (focusPath) {
		// 	WidgetTreeDebugger.recordKeystroke(this.formatKeyEvent(event), focusPath, false)
		// }

		return false
	}

	/**
	 * Format a keyboard event for display in debug info
	 */
	private formatKeyEvent(event: KeyboardEvent): string {
		const parts: string[] = []
		if (event.ctrlKey) parts.push('Ctrl')
		if (event.altKey) parts.push('Alt')
		if (event.shiftKey) parts.push('Shift')
		if (event.metaKey) parts.push('Meta')

		if (event.key) {
			parts.push(event.key)
		}

		return parts.join('+')
	}

	/**
	 * Handle paste events by dispatching them to the focused node.
	 * Similar to handleKeyEvent but for paste events.
	 * @param event The paste event to handle
	 * @returns True if the event was handled by a focus node
	 */
	handlePasteEvent(event: PasteEvent): boolean {
		// If no node has focus, the event is not handled
		if (!this._primaryFocus) {
			return false
		}

		// Try to handle the event at the focused node first
		let currentNode: FocusNode | null = this._primaryFocus

		while (currentNode) {
			const result = currentNode._handlePasteEvent(event)

			if (result === KeyEventResult.handled) {
				return true
			}

			// Bubble up to parent node
			currentNode = currentNode.parent
		}

		// Event was not handled by any focus node
		return false
	}

	/**
	 * Register a focus node in the focus tree.
	 * This is called when a Focus widget is mounted.
	 * @param node The focus node to register
	 * @param parent The parent node to attach to (defaults to root scope)
	 */
	registerNode(node: FocusNode, parent: FocusNode | null = null): void {
		assert(node !== parent, 'Focus node cannot be its own parent')
		this._invalidateFocusableNodesCache()
		const parentNode = parent ?? this._rootScope
		node._attach(parentNode)
	}

	/**
	 * Unregister a focus node from the focus tree.
	 * This is called when a Focus widget is unmounted.
	 * @param node The focus node to unregister
	 */
	unregisterNode(node: FocusNode): void {
		this._invalidateFocusableNodesCache()

		// Remove from focus stack (always, not just when it's primary)
		this._popFromFocusStack(node)

		// If this was the primary focus, unfocus it
		if (this._primaryFocus === node) {
			this.requestFocus(null)
		}

		node._detach()
	}

	/**
	 * Find the nearest focusable ancestor of the given node.
	 * @param node The node to search from
	 * @returns The nearest focusable ancestor, or null if none found
	 */
	findNearestFocusableAncestor(node: FocusNode): FocusNode | null {
		let current = node.parent

		while (current) {
			if (current.canRequestFocus && !current.skipTraversal) {
				return current
			}
			current = current.parent
		}

		return null
	}

	/**
	 * Find all focusable nodes in the focus tree.
	 * Useful for focus traversal and debugging.
	 * @returns Array of all focusable nodes in the tree
	 */
	findAllFocusableNodes(): FocusNode[] {
		if (this._cachedFocusableNodes !== null) {
			return this._cachedFocusableNodes
		}

		const focusableNodes: FocusNode[] = []

		const collectFocusableNodes = (node: FocusNode) => {
			if (node.canRequestFocus && !node.skipTraversal) {
				focusableNodes.push(node)
			}

			for (const child of node.children) {
				collectFocusableNodes(child)
			}
		}

		collectFocusableNodes(this._rootScope)
		this._cachedFocusableNodes = focusableNodes
		return focusableNodes
	}

	/**
	 * Invalidate the cached focusable nodes list.
	 * Call this when the focus tree structure changes.
	 * @private
	 */
	private _invalidateFocusableNodesCache(): void {
		this._cachedFocusableNodes = null
	}

	/**
	 * Push a node to the focus stack with deduplication.
	 * If the node already exists in the stack, it's moved to the top.
	 * @private
	 */
	private _pushToFocusStack(node: FocusNode): void {
		// Remove node from stack if it already exists (deduplication)
		const existingIndex = this._primaryFocusStack.indexOf(node)
		if (existingIndex !== -1) {
			this._primaryFocusStack.splice(existingIndex, 1)
		}

		// Push to stack
		this._primaryFocusStack.push(node)
	}

	/**
	 * Pop a specific node from the focus stack.
	 * Removes all instances of the node from the stack.
	 * @private
	 */
	private _popFromFocusStack(node: FocusNode): void {
		let stackIndex = this._primaryFocusStack.indexOf(node)
		while (stackIndex !== -1) {
			this._primaryFocusStack.splice(stackIndex, 1)
			stackIndex = this._primaryFocusStack.indexOf(node)
		}
	}

	/**
	 * Find the previous focusable node in the focus stack.
	 * Skips invalid or detached nodes.
	 * @private
	 */
	private _findPreviousFocusableNode(): FocusNode | null {
		while (this._primaryFocusStack.length > 0) {
			const candidate = this._primaryFocusStack[this._primaryFocusStack.length - 1]!

			// Validate candidate
			if (candidate.parent && candidate.canRequestFocus && !candidate.skipTraversal) {
				return candidate
			} else {
				this._primaryFocusStack.pop()
			}
		}

		return null
	}

	/**
	 * Move focus to the next focusable node in traversal order.
	 * This is a simple implementation - a more complete version would
	 * support different traversal policies.
	 * @returns True if focus was successfully moved to the next node
	 */
	focusNext(): boolean {
		const focusableNodes = this.findAllFocusableNodes()

		if (focusableNodes.length === 0) {
			return false
		}

		if (!this._primaryFocus) {
			// No current focus, focus the first node
			return this.requestFocus(focusableNodes[0] ?? null)
		}

		// Find current focus in the list
		const currentIndex = focusableNodes.indexOf(this._primaryFocus)

		if (currentIndex === -1) {
			// Current focus not in focusable list, focus the first node
			return this.requestFocus(focusableNodes[0] ?? null)
		}

		// Move to next node, wrapping around
		const nextIndex = (currentIndex + 1) % focusableNodes.length
		return this.requestFocus(focusableNodes[nextIndex] ?? null)
	}

	/**
	 * Move focus to the previous focusable node in traversal order.
	 * @returns True if focus was successfully moved to the previous node
	 */
	focusPrevious(): boolean {
		const focusableNodes = this.findAllFocusableNodes()

		if (focusableNodes.length === 0) {
			return false
		}

		if (!this._primaryFocus) {
			// No current focus, focus the last node
			return this.requestFocus(focusableNodes[focusableNodes.length - 1] ?? null)
		}

		// Find current focus in the list
		const currentIndex = focusableNodes.indexOf(this._primaryFocus)

		if (currentIndex === -1) {
			// Current focus not in focusable list, focus the last node
			return this.requestFocus(focusableNodes[focusableNodes.length - 1] ?? null)
		}

		// Move to previous node, wrapping around
		const previousIndex = currentIndex === 0 ? focusableNodes.length - 1 : currentIndex - 1
		return this.requestFocus(focusableNodes[previousIndex] ?? null)
	}

	/**
	 * Convert a FocusNode to debug info recursively
	 * @private
	 */
	private _focusNodeToDebugInfo(node: FocusNode): FocusNodeDebugInfo {
		return {
			id: node.debugId,
			debugLabel: node.debugLabel,
			hasPrimaryFocus: node.hasPrimaryFocus,
			hasFocus: node.hasFocus,
			canRequestFocus: node.canRequestFocus,
			skipTraversal: node.skipTraversal,
			isPrimaryFocus: this._primaryFocus === node,
			children: Array.from(node.children).map((child) => this._focusNodeToDebugInfo(child)),
		}
	}

	/**
	 * Dump the focus tree for debugging purposes.
	 * This is a no-op in production builds.
	 * @returns A snapshot of the focus tree, or null if not in dev mode
	 */
	debugDumpFocusTree(): FocusTreeSnapshot | null {
		// Only enabled in development builds
		if (process.env.NODE_ENV === 'production') {
			return null
		}

		const primaryFocusId = this._primaryFocus ? this._primaryFocus.debugId : null

		return {
			timestamp: Date.now(),
			rootScope: this._focusNodeToDebugInfo(this._rootScope),
			primaryFocusId,
			focusStack: this._primaryFocusStack.map((node) => ({
				id: node.debugId,
				debugLabel: node.debugLabel,
			})),
		}
	}

	/**
	 * Dispose of the focus manager and clean up resources.
	 * This should only be called when shutting down the application.
	 */
	dispose(): void {
		this._primaryFocus = null
		this._cachedFocusableNodes = null
		this._primaryFocusStack = []
		// this._markedForFocus = null;
		this._rootScope.dispose()
		FocusManager._instance = null
	}
}

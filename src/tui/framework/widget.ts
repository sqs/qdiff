import { getBuildScheduler } from './build-scheduler.js'
import { GlobalKey, type Key } from './key.js'
import type { RenderObject } from './render-object.js'
import type { Constructor } from './types.js'

/**
 * Base class for all UI components in the Flutter-inspired framework.
 *
 * Widgets are immutable descriptions of part of a user interface.
 * They describe what the view should look like given their current
 * configuration and state.
 */
export abstract class Widget {
	public readonly key: Key | undefined
	private _debugData: Record<string, any> = {}

	/**
	 * Creates a new Widget instance.
	 * @param options - Configuration options for the widget
	 * @param options.key - Optional key to identify this widget instance
	 */
	constructor({ key }: { key?: Key } = {}) {
		if (this.constructor === Widget) {
			throw new Error('Widget is abstract and cannot be instantiated directly')
		}
		this.key = key
	}

	/**
	 * Send arbitrary debug data for this widget instance.
	 * This data will be visible in the widget tree debugger.
	 */
	sendDebugData(data: Record<string, any>): void {
		this._debugData = { ...this._debugData, ...data }
	}

	/**
	 * Get the debug data for this widget (internal use by debugger).
	 */
	get debugData(): Record<string, any> {
		return this._debugData
	}
	/**
	 * Creates an Element to manage this widget in the element tree.
	 * Each widget type must implement this method to return the appropriate element.
	 * @returns The element that will manage this widget in the element tree
	 */
	abstract createElement(): Element

	/**
	 * Whether the widget can be updated by another widget of the same type.
	 *
	 * Two widgets can update each other if:
	 * 1. They have the same runtime type
	 * 2. They have compatible keys (both null, or equal keys)
	 * @param other - The widget to check compatibility with
	 * @returns True if this widget can be updated by the other widget
	 */
	canUpdate(other: Widget): boolean {
		// Must be same type
		if (this.constructor !== other.constructor) {
			return false
		}

		// Key compatibility check
		if (this.key === undefined && other.key === undefined) {
			return true // Both have no keys
		}

		if (this.key === undefined || other.key === undefined) {
			return false // One has key, other doesn't
		}

		return this.key.equals(other.key) // Both have keys - check equality
	}
}

/**
 * Base class for all elements in the element tree.
 * Elements are the bridge between widgets and the render objects.
 */
export abstract class Element {
	widget: Widget
	parent?: Element
	private _children: Element[] = []
	private _inheritedDependencies = new Set<any>() // Using any to avoid circular imports
	private _dirty = false
	private _cachedDepth?: number
	private _mounted = false

	/**
	 * Creates a new Element instance.
	 * @param widget - The widget this element manages
	 */
	constructor(widget: Widget) {
		this.widget = widget
	}

	/**
	 * Gets the read-only array of child elements.
	 * @returns The array of child elements
	 */
	get children(): readonly Element[] {
		return this._children
	}

	/**
	 * Get the depth of this element in the tree (for rebuild ordering).
	 * @returns The depth level, with root elements at depth 0
	 */
	get depth(): number {
		if (this._cachedDepth !== undefined) {
			return this._cachedDepth
		}

		let depth = 0
		let current = this.parent
		while (current) {
			depth++
			current = current.parent
		}

		this._cachedDepth = depth
		return depth
	}

	/**
	 * Invalidate the cached depth - called when parent changes.
	 * @private
	 */
	private _invalidateDepth(): void {
		this._cachedDepth = undefined
		// Recursively invalidate all children's cached depths
		for (const child of this._children) {
			child._invalidateDepth()
		}
	}

	/**
	 * Whether this element is marked as dirty and needs rebuilding.
	 * @returns True if the element needs rebuilding, false otherwise
	 */
	get dirty(): boolean {
		return this._dirty
	}

	/**
	 * Whether this element is currently mounted in the widget tree.
	 * @returns True if the element is mounted, false otherwise
	 */
	get mounted(): boolean {
		return this._mounted
	}

	/**
	 * Get the render object associated with this element, if any.
	 * @returns The render object, or undefined if this element has no render object
	 */
	get renderObject(): RenderObject | undefined {
		return undefined // Override in subclasses that have render objects
	}

	/**
	 * Updates this element with a new widget.
	 * @param newWidget - The new widget to replace the current widget
	 */
	update(newWidget: Widget): void {
		this.widget = newWidget
	}

	/**
	 * Adds a child element.
	 * @param child - The element to add as a child
	 */
	protected addChild(child: Element): void {
		child.parent = this
		child._invalidateDepth()
		this._children.push(child)
	}

	/**
	 * Removes a child element.
	 * @param child - The element to remove from children
	 */
	protected removeChild(child: Element): void {
		const index = this._children.indexOf(child)
		if (index !== -1) {
			this._children.splice(index, 1)
			;(child as any).parent = undefined
			child._invalidateDepth()
		}
	}

	/**
	 * Removes all child elements.
	 */
	protected removeAllChildren(): void {
		for (const child of this._children) {
			;(child as any).parent = undefined
			child._invalidateDepth()
		}
		this._children.length = 0
	}

	/**
	 * Called when the element is first created.
	 */
	abstract mount(): void

	/**
	 * Mark this element as mounted. Should be called by subclasses at the end of their mount() implementation.
	 * @protected
	 */
	protected markMounted(): void {
		this._mounted = true

		// Register GlobalKey if present
		if (this.widget.key instanceof GlobalKey) {
			this.widget.key._setElement(this)
		}
	}

	/**
	 * Called when the element is removed from the tree.
	 */
	unmount(): void {
		// Unregister GlobalKey if present
		if (this.widget.key instanceof GlobalKey) {
			this.widget.key._clearElement()
		}

		// Mark as unmounted first
		this._mounted = false

		// Clear dirty flag
		this._dirty = false

		// Clear cached values to prevent memory leaks
		this._cachedDepth = undefined

		// Remove this element from all inherited dependencies
		for (const inherited of this._inheritedDependencies) {
			if ('removeDependent' in inherited) {
				inherited.removeDependent(this)
			}
		}
		this._inheritedDependencies.clear()
	}

	/**
	 * Mark this element as needing to rebuild.
	 * This is called when an InheritedWidget dependency changes or setState() is called.
	 */
	markNeedsRebuild(): void {
		// Don't schedule rebuilds for unmounted elements
		if (!this._mounted) return

		this._dirty = true
		// Use build scheduler to avoid circular dependency
		getBuildScheduler().scheduleBuildFor(this)
	}

	/**
	 * Perform the actual rebuild of this element.
	 * Called by the BuildOwner during the build phase.
	 */
	abstract performRebuild(): void

	/**
	 * Find the nearest ancestor InheritedWidget of the given type and register as dependent.
	 * @param type - The constructor type of the InheritedWidget to find
	 * @returns The element containing the InheritedWidget, or null if not found
	 */
	dependOnInheritedWidgetOfExactType<T>(type: Constructor<T>): Element | null {
		let current = this.parent
		while (current) {
			if (current.widget.constructor === type) {
				// Register this element as dependent on the inherited widget
				if ('addDependent' in current) {
					;(current as any).addDependent(this)
					// Track this dependency for cleanup
					this._inheritedDependencies.add(current)
				}
				return current
			}
			current = current.parent
		}
		return null
	}

	/**
	 * Find the nearest ancestor element of the specified type.
	 * @param type - The constructor type of the element to find
	 * @returns The ancestor element of the specified type, or null if not found
	 */
	findAncestorElementOfType<T extends Element>(type: Constructor<T>): T | null {
		let current = this.parent
		while (current) {
			if (current instanceof type) {
				return current
			}
			current = current.parent
		}
		return null
	}

	/**
	 * Find the nearest ancestor widget of the specified type.
	 * @param type - The constructor type of the widget to find
	 * @returns The ancestor widget of the specified type, or null if not found
	 */
	findAncestorWidgetOfType<T>(type: Constructor<T>): T | null {
		let current = this.parent
		while (current) {
			if (current.widget instanceof type) {
				return current.widget
			}
			current = current.parent
		}
		return null
	}
}

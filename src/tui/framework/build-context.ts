import type { MediaQueryData } from './media-query.js'
import { RenderObject } from './render-object.js'
import type { Constructor } from './types.js'
import type { Element, Widget } from './widget.js'

/**
 * Context passed to widget build methods.
 * Provides access to the element tree and framework services.
 */
export interface BuildContext {
	/**
	 * The element associated with this build context.
	 */
	readonly element: Element

	/**
	 * The widget associated with this build context.
	 */
	widget: Widget

	/**
	 * Media query data for terminal capabilities and size.
	 * Optional - may be undefined if no MediaQuery ancestor exists.
	 */
	readonly mediaQuery: MediaQueryData | undefined

	/**
	 * Finds the nearest ancestor element of the specified type.
	 * @template T - The element type to search for, must extend Element
	 * @param type - Constructor function for the element type to find
	 * @returns The nearest ancestor element of the specified type, or null if not found
	 */
	findAncestorElementOfType<T extends Element>(type: Constructor<T>): T | null

	/**
	 * Finds the nearest ancestor widget of the specified type.
	 * @template T - The widget type to search for
	 * @param type - Constructor function for the widget type to find
	 * @returns The nearest ancestor widget of the specified type, or null if not found
	 */
	findAncestorWidgetOfType<T>(type: Constructor<T>): T | null

	/**
	 * Register a dependency on the nearest InheritedWidget of the given type.
	 * This will cause this widget to rebuild when the InheritedWidget changes.
	 * @template T - The InheritedWidget type to depend on
	 * @param type - Constructor function for the InheritedWidget type
	 * @returns The element containing the InheritedWidget, or null if not found
	 */
	dependOnInheritedWidgetOfExactType<T>(type: Constructor<T>): Element | null

	/**
	 * Finds the nearest ancestor state of the specified type.
	 * @template T - The state type to search for
	 * @param type - Constructor function for the state type to find
	 * @returns The nearest ancestor state of the specified type, or null if not found
	 */
	findAncestorStateOfType<T>(type: Constructor<T>): T | null

	/**
	 * The parent build context, if any.
	 */
	readonly parent: BuildContext | null

	/**
	 * Returns the RenderObject for this context.
	 * Only available for RenderObjectElements.
	 * @returns The RenderObject associated with this context, or undefined if not available
	 */
	findRenderObject(): RenderObject | undefined
}

/**
 * Implementation of BuildContext.
 * Provides concrete implementations for all BuildContext methods.
 */
export class BuildContextImpl implements BuildContext {
	/**
	 * Creates a new BuildContext implementation.
	 * @param element - The element associated with this build context
	 * @param widget - The widget associated with this build context
	 * @param mediaQuery - Optional media query data for terminal capabilities and size
	 */
	constructor(
		public readonly element: Element,
		public widget: Widget,
		public readonly mediaQuery: MediaQueryData | undefined = undefined,
		public readonly parent: BuildContext | null = null,
	) {}

	/**
	 * Finds the nearest ancestor element of the specified type by traversing up the element tree.
	 * @template T - The element type to search for, must extend Element
	 * @param type - Constructor function for the element type to find
	 * @returns The nearest ancestor element of the specified type, or null if not found
	 */
	findAncestorElementOfType<T extends Element>(type: Constructor<T>): T | null {
		let current = this.element.parent
		while (current) {
			if (current instanceof type) {
				return current
			}
			current = current.parent
		}
		return null
	}

	/**
	 * Finds the nearest ancestor widget of the specified type by delegating to the element.
	 * @template T - The widget type to search for
	 * @param type - Constructor function for the widget type to find
	 * @returns The nearest ancestor widget of the specified type, or null if not found
	 */
	findAncestorWidgetOfType<T>(type: Constructor<T>): T | null {
		return this.element.findAncestorWidgetOfType(type)
	}

	/**
	 * Register a dependency on the nearest InheritedWidget of the given type.
	 * This will cause this widget to rebuild when the InheritedWidget changes.
	 * @template T - The InheritedWidget type to depend on
	 * @param type - Constructor function for the InheritedWidget type
	 * @returns The element containing the InheritedWidget, or null if not found
	 */
	dependOnInheritedWidgetOfExactType<T>(type: Constructor<T>): Element | null {
		return this.element.dependOnInheritedWidgetOfExactType(type)
	}

	/**
	 * Finds the nearest ancestor state of the specified type.
	 * @template T - The state type to search for
	 * @param type - Constructor function for the state type to find
	 * @returns The nearest ancestor state of the specified type, or null if not found
	 */
	findAncestorStateOfType<T>(type: Constructor<T>): T | null {
		let current = this.element.parent
		while (current) {
			// Check if this is a StatefulElement with a state of the right type
			if ('state' in current && current.state instanceof type) {
				return current.state as T
			}
			current = current.parent
		}
		return null
	}

	/**
	 * Returns the RenderObject for this context by checking if the element has one.
	 * Only available for RenderObjectElements.
	 * @returns The RenderObject associated with this context, or undefined if not available
	 */
	findRenderObject(): RenderObject | undefined {
		// Check if this element has a render object
		if ('renderObject' in this.element) {
			const renderObject = (this.element as any).renderObject
			return renderObject instanceof RenderObject ? renderObject : undefined
		}
		return undefined
	}
}

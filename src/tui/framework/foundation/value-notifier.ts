/**
 * Flutter-style ValueNotifier and ChangeNotifier implementation
 * for reactive state management in TUI framework
 */

export type VoidCallback = () => void

/**
 * Base class for objects that provide change notifications
 */
export abstract class ChangeNotifier {
	private _listeners: Set<VoidCallback> = new Set()
	private _disposed = false

	/**
	 * Adds a listener to be called when the object changes
	 */
	addListener(listener: VoidCallback): void {
		if (this._disposed) {
			throw new Error('Cannot add listener to disposed ChangeNotifier')
		}
		this._listeners.add(listener)
	}

	/**
	 * Removes a previously added listener
	 */
	removeListener(listener: VoidCallback): void {
		this._listeners.delete(listener)
	}

	/**
	 * Calls all registered listeners
	 */
	protected notifyListeners(): void {
		if (this._disposed) return

		// Create copy to avoid issues if listeners are modified during iteration
		const listeners = Array.from(this._listeners)
		for (const listener of listeners) {
			try {
				listener()
			} catch (error) {
				// Error in ChangeNotifier listener - silently ignore to prevent cascading failures
			}
		}
	}

	/**
	 * Discards resources and stops notifying listeners
	 */
	dispose(): void {
		this._disposed = true
		this._listeners.clear()
	}

	/**
	 * Whether this object has been disposed
	 */
	get disposed(): boolean {
		return this._disposed
	}

	/**
	 * Whether this object has any listeners
	 */
	get hasListeners(): boolean {
		return this._listeners.size > 0
	}
}

/**
 * A ValueNotifier holds a single value and notifies listeners when it changes
 */
export class ValueNotifier<T> extends ChangeNotifier {
	private _value: T

	constructor(value: T) {
		super()
		this._value = value
	}

	/**
	 * The current value
	 */
	get value(): T {
		return this._value
	}

	/**
	 * Sets the value and notifies listeners if it changed
	 */
	set value(newValue: T) {
		// For object types, always notify (since we create new objects each time)
		// For primitives, check equality
		const shouldNotify = typeof newValue === 'object' || this._value !== newValue
		this._value = newValue
		if (shouldNotify) {
			this.notifyListeners()
		}
	}
}

/**
 * A widget that listens to a ValueNotifier and rebuilds when it changes
 */
export interface ValueListenableBuilder<T> {
	/**
	 * Called to build the widget tree when the value changes
	 */
	builder: (value: T) => any // Widget in actual use
}

/**
 * Helper to create a listener that rebuilds a widget when a ValueNotifier changes
 */
export function createValueListener<T>(
	notifier: ValueNotifier<T>,
	builder: () => void, // Changed to just trigger rebuild, not pass value
): { dispose: () => void } {
	const listener = () => {
		// Trigger the rebuild callback
		builder()
	}

	notifier.addListener(listener)

	return {
		dispose: () => notifier.removeListener(listener),
	}
}

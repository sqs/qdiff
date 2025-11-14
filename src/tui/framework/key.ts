/**
 * A Key is an identifier for Widgets and Elements.
 *
 * Keys are used to preserve state when widgets of the same type are
 * rearranged in the widget tree. They help the framework determine
 * which widgets can be updated vs which need to be replaced.
 */
export abstract class Key {
	constructor() {}

	/**
	 * Whether two keys are equal for the purposes of widget reconciliation.
	 *
	 * @param other - The key to compare with this key
	 * @returns True if the keys are equal, false otherwise
	 */
	abstract equals(other: Key): boolean

	/**
	 * Returns a hash code for this key.
	 *
	 * @returns A numeric hash code for this key
	 */
	abstract get hashCode(): number

	/**
	 * Returns a string representation of this key.
	 *
	 * @returns A string representation of this key
	 */
	abstract toString(): string
}

/**
 * A key that uses a value of a particular type to identify itself.
 *
 * ValueKeys are useful when you have a collection of widgets and need
 * to identify them by some data value (like an ID or name).
 */
export class ValueKey<T> extends Key {
	/**
	 * Creates a new ValueKey with the given value.
	 *
	 * @param value - The value to use as the key identifier
	 */
	constructor(public readonly value: T) {
		super()
	}

	/**
	 * Compares this ValueKey with another key for equality.
	 *
	 * @param other - The key to compare with this key
	 * @returns True if both keys are ValueKeys with equal values, false otherwise
	 */
	equals(other: Key): boolean {
		if (!(other instanceof ValueKey)) {
			return false
		}
		return this.value === other.value
	}

	/**
	 * Returns a hash code based on the value.
	 *
	 * @returns A numeric hash code derived from the value
	 */
	get hashCode(): number {
		if (this.value === null || this.value === undefined) {
			return 0
		}

		if (typeof this.value === 'string') {
			return this.stringHash(this.value)
		}

		if (typeof this.value === 'number') {
			return this.value
		}

		if (typeof this.value === 'boolean') {
			return this.value ? 1 : 0
		}

		// For objects, use string representation
		return this.stringHash(String(this.value))
	}

	/**
	 * Computes a hash code for a string value.
	 *
	 * @param str - The string to hash
	 * @returns A numeric hash code for the string
	 */
	private stringHash(str: string): number {
		let hash = 0
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash // Convert to 32bit integer
		}
		return hash
	}

	/**
	 * Returns a string representation of this ValueKey.
	 *
	 * @returns A string in the format "ValueKey(value)"
	 */
	toString(): string {
		return `ValueKey(${this.value})`
	}
}

/**
 * A key that uses the identity of an object to identify itself.
 *
 * ObjectKeys are useful when you need to preserve the identity of
 * widgets based on object references rather than values.
 */
export class ObjectKey extends Key {
	/**
	 * Creates a new ObjectKey with the given object reference.
	 *
	 * @param value - The object to use as the key identifier
	 */
	constructor(public readonly value: object) {
		super()
	}

	/**
	 * Compares this ObjectKey with another key for equality using reference comparison.
	 *
	 * @param other - The key to compare with this key
	 * @returns True if both keys are ObjectKeys with the same object reference, false otherwise
	 */
	equals(other: Key): boolean {
		if (!(other instanceof ObjectKey)) {
			return false
		}
		return this.value === other.value // Reference equality
	}

	/**
	 * Returns a hash code based on the object's string representation.
	 *
	 * @returns A numeric hash code derived from the object
	 */
	get hashCode(): number {
		// Use a simple hash based on the object's memory address approximation
		// In practice, this could be more sophisticated
		return this.stringHash(String(this.value))
	}

	/**
	 * Computes a hash code for a string value.
	 *
	 * @param str - The string to hash
	 * @returns A numeric hash code for the string
	 */
	private stringHash(str: string): number {
		let hash = 0
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}
		return hash
	}

	/**
	 * Returns a string representation of this ObjectKey.
	 *
	 * @returns A string in the format "ObjectKey(object)"
	 */
	toString(): string {
		return `ObjectKey(${this.value})`
	}
}

/**
 * A key that is unique across the entire app.
 *
 * UniqueKeys are useful when you need to force the framework to
 * treat a widget as completely new, even if it's the same type.
 */
export class UniqueKey extends Key {
	private static _counter = 0
	private readonly _id: number

	/**
	 * Creates a new UniqueKey with a globally unique identifier.
	 */
	constructor() {
		super()
		this._id = UniqueKey._counter++
	}

	/**
	 * Compares this UniqueKey with another key for equality.
	 *
	 * @param other - The key to compare with this key
	 * @returns True if both keys are UniqueKeys with the same ID, false otherwise
	 */
	equals(other: Key): boolean {
		if (!(other instanceof UniqueKey)) {
			return false
		}
		return this._id === other._id
	}

	/**
	 * Returns the unique ID as the hash code.
	 *
	 * @returns The unique numeric identifier for this key
	 */
	get hashCode(): number {
		return this._id
	}

	/**
	 * Returns a string representation of this UniqueKey.
	 *
	 * @returns A string in the format "UniqueKey(id)"
	 */
	toString(): string {
		return `UniqueKey(${this._id})`
	}
}

/**
 * A key that is globally unique across the entire widget tree.
 *
 * GlobalKeys can be used to access their associated widget or element
 * from anywhere in the widget tree. They're more powerful but should
 * be used sparingly.
 */
import { assert } from '../lib/assert.js'
import type { Element } from './widget.js'

export class GlobalKey<T = unknown> extends Key {
	private static _registry = new Map<string, GlobalKey>()
	private static _counter = 0
	private readonly _id: string
	private _currentElement?: Element // Will be typed as Element when we have the type

	/**
	 * Creates a new GlobalKey with an optional debug label.
	 *
	 * @param debugLabel - Optional human-readable label for debugging purposes
	 */
	constructor(debugLabel?: string) {
		super()

		if (debugLabel) {
			// For debug labels, check if this exact label already exists
			this._id = `${debugLabel}_${GlobalKey._counter++}`
		} else {
			this._id = `GlobalKey_${GlobalKey._counter++}`
		}

		GlobalKey._registry.set(this._id, this)
	}

	/**
	 * Compares this GlobalKey with another key for equality.
	 *
	 * @param other - The key to compare with this key
	 * @returns True if both keys are GlobalKeys with the same ID, false otherwise
	 */
	equals(other: Key): boolean {
		if (!(other instanceof GlobalKey)) {
			return false
		}
		return this._id === other._id
	}

	/**
	 * Returns a hash code based on the global key ID.
	 *
	 * @returns A numeric hash code derived from the key ID
	 */
	get hashCode(): number {
		return this.stringHash(this._id)
	}

	/**
	 * Computes a hash code for a string value.
	 *
	 * @param str - The string to hash
	 * @returns A numeric hash code for the string
	 */
	private stringHash(str: string): number {
		let hash = 0
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}
		return hash
	}

	/**
	 * The element associated with this key.
	 *
	 * @returns The current element associated with this key, or undefined if none
	 */
	get currentElement(): Element | undefined {
		// Will be typed as Element<T> when available
		return this._currentElement
	}

	/**
	 * The widget associated with this key.
	 *
	 * @returns The current widget of type T associated with this key, or undefined if none
	 */
	get currentWidget(): T | undefined {
		return this._currentElement?.widget as unknown as T | undefined
	}

	/**
	 * Internal method to associate an element with this key.
	 *
	 * @param element - The element to associate with this key
	 */
	_setElement(element: Element): void {
		assert(
			this._currentElement === undefined,
			`GlobalKey ${this._id} is already associated with an element. Each GlobalKey can only be used once in the widget tree.`,
		)
		this._currentElement = element
	}

	/**
	 * Internal method to clear the element association.
	 * Also removes the key from the registry (matching Flutter's behavior).
	 */
	_clearElement(): void {
		this._currentElement = undefined
		GlobalKey._registry.delete(this._id)
	}

	/**
	 * Returns a string representation of this GlobalKey.
	 *
	 * @returns A string in the format "GlobalKey(id)"
	 */
	toString(): string {
		return `GlobalKey(${this._id})`
	}

	/**
	 * Clean up the global key registry (useful for testing).
	 * Clears all registered GlobalKeys and resets the counter.
	 */
	static _clearRegistry(): void {
		GlobalKey._registry.clear()
		GlobalKey._counter = 0
	}
}

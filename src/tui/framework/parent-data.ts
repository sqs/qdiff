/**
 * Base class for data that a parent widget stores on its children.
 *
 * Similar to Flutter's ParentData, this allows parent widgets to store
 * layout information on child render objects without creating wrapper objects.
 */
export abstract class ParentData {
	/**
	 * Called when a child is removed from its parent.
	 * Subclasses can override this to perform cleanup.
	 */
	detach(): void {
		// Default implementation does nothing
	}

	/**
	 * Returns a string representation of this parent data.
	 * Used for debugging and error messages.
	 */
	toString(): string {
		return `${this.constructor.name}#${this.hashCode()}`
	}

	private hashCode(): string {
		return Math.random().toString(36).substr(2, 9)
	}
}

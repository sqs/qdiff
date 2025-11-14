/**
 * Determines the physics of scrollable widgets.
 *
 * Similar to Flutter's ScrollPhysics, this defines how the scroll position
 * responds to user input and what happens when scrolling beyond bounds.
 */
export abstract class ScrollPhysics {
	/**
	 * Adjusts a scroll offset to be within valid bounds.
	 */
	abstract applyBoundaryConditions(
		offset: number,
		minScrollExtent: number,
		maxScrollExtent: number,
	): number

	/**
	 * Determines whether the scroll view should accept user input.
	 */
	shouldAcceptUserOffset(): boolean {
		return true
	}

	/**
	 * Returns a copy of this physics with the given parent.
	 * For now, we'll keep this simple without parent chaining.
	 */
	applyTo(_ancestor?: ScrollPhysics): ScrollPhysics {
		return this
	}
}

/**
 * Scroll physics that prevent the scroll offset from going beyond bounds.
 * This is like Flutter's ClampingScrollPhysics.
 */
export class ClampingScrollPhysics extends ScrollPhysics {
	applyBoundaryConditions(
		offset: number,
		minScrollExtent: number,
		maxScrollExtent: number,
	): number {
		// Clamp the offset to valid bounds
		return Math.max(minScrollExtent, Math.min(maxScrollExtent, offset))
	}
}

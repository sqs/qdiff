/**
 * Highlight mode for selection rendering.
 */
export enum HighlightMode {
	SELECTION = 'selection',
	COPY = 'copy',
	DRAG = 'drag',
}

/**
 * Interface for widgets that can participate in text selection.
 */
export interface Selectable {
	/**
	 * Get the plain text content of this selectable widget.
	 */
	get plainText(): string

	/**
	 * Get the total character length of the selectable text.
	 */
	get textLength(): number

	/**
	 * Get the bounding rectangle for a character at the given index.
	 * @param index - The character index (0-based)
	 * @returns Rectangle with x, y, width, height relative to this widget's origin
	 */
	getCharacterRect(index: number): { x: number; y: number; width: number; height: number } | null

	/**
	 * Set the selection highlight range for this widget.
	 * @param range - The range to highlight, or null to clear selection
	 * @param mode - The highlight mode to use (selection or copy)
	 */
	setHighlight(range: { start: number; end: number } | null, mode?: HighlightMode): void

	/**
	 * Clean up any resources associated with selection registration.
	 */
	disposeRegistration(): void
}

/**
 * Selection range with base and extent positions.
 * Similar to Flutter's TextSelection.
 */
export interface SelectionRange {
	/** The starting position of the selection */
	base: number
	/** The ending position of the selection */
	extent: number
	/** Whether the selection is collapsed (base === extent) */
	isCollapsed: boolean
}

/**
 * Create a selection range.
 */
export function createSelectionRange(base: number, extent: number): SelectionRange {
	return {
		base,
		extent,
		isCollapsed: base === extent,
	}
}

/**
 * Get the normalized start and end of a selection range.
 */
export function getSelectionBounds(range: SelectionRange): { start: number; end: number } {
	return {
		start: Math.min(range.base, range.extent),
		end: Math.max(range.base, range.extent),
	}
}

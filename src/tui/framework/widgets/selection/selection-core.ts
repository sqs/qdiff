/**
 * Core types and interfaces for the TUI selection system.
 *
 * This module defines the fundamental contracts and data structures used
 * throughout the selection system, following Flutter's selection patterns
 * adapted for terminal interfaces.
 */

import type { Offset } from '../../types.js'
import type { HighlightMode } from './interfaces.js'

// Re-export Offset for convenience
export type { Offset }

/**
 * A rectangular region defined by left, top, right, and bottom coordinates.
 */
export interface Rect {
	readonly left: number
	readonly top: number
	readonly right: number
	readonly bottom: number
}

/**
 * A mathematically empty rectangle that cannot contain any points.
 * Used to represent invalid or non-visible bounds.
 */
export const EMPTY_RECT: Rect = {
	left: 1,
	top: 1,
	right: 0,
	bottom: 0,
} as const

/**
 * A position within selectable text content.
 *
 * Uses grapheme cluster offsets for proper Unicode support including
 * emoji, combining characters, and complex scripts.
 */
export interface SelectableTextPosition {
	/**
	 * Logical text offset in grapheme clusters.
	 * This ensures proper handling of multi-byte characters, emoji, and combining characters.
	 */
	readonly offset: number
}

/**
 * A range of text within a selectable, from start (inclusive) to end (exclusive).
 */
export interface SelectableTextRange {
	/** Start offset (inclusive) */
	readonly start: number
	/** End offset (exclusive) */
	readonly end: number
}

/**
 * A position within the document, identifying both the selectable and the offset within it.
 */
export interface DocumentPosition {
	/** Unique ID of the selectable containing this position */
	readonly selectableId: number
	/** Offset within that selectable's content */
	readonly offset: number
}

/**
 * A text selection spanning potentially multiple selectables.
 *
 * Similar to Flutter's TextSelection but works across widget boundaries.
 * The anchor is where the selection started, extent is the current end.
 */
export interface Selection {
	/** Where the selection started (may be after extent in backward selections) */
	readonly anchor: DocumentPosition
	/** Current end of the selection */
	readonly extent: DocumentPosition
}

/**
 * Selection granularity for different interaction modes.
 */
export interface SelectionGranularity {
	readonly type: 'character' | 'word' | 'line' | 'paragraph'
}

/**
 * A rectangular region used for selection highlighting.
 */
export interface SelectionBox {
	/** The rectangle to highlight in local coordinates */
	readonly rect: Rect
	/** Optional baseline for text alignment (for future text decoration support) */
	readonly baseline?: number
}

/**
 * Interface for render objects that support text selection.
 *
 * Similar to Flutter's Selectable mixin, this interface defines the contract
 * for objects that can participate in cross-widget text selection.
 *
 * Implementers should be render objects (not widgets) to enable direct
 * state updates without widget rebuilds.
 */
export interface Selectable {
	/**
	 * Unique stable ID within a SelectionArea.
	 * Assigned by the SelectionAreaController during registration.
	 */
	selectableId: number

	// === Registration Lifecycle ===

	/**
	 * Called when this selectable is attached to a SelectionArea.
	 * Use this to set up any area-specific state.
	 */
	onAttachToSelectionArea(area: SelectionAreaController): void

	/**
	 * Called when this selectable is detached from a SelectionArea.
	 * Use this to clean up any area-specific state.
	 */
	onDetachFromSelectionArea(area: SelectionAreaController): void

	// === Geometry and Coordinate Conversion ===

	/**
	 * Returns the global bounds of this selectable for hit testing and ordering.
	 * Used by SelectionArea to determine reading order and pointer targeting.
	 */
	globalBounds(): Rect

	/**
	 * Converts a global coordinate to local coordinates within this selectable.
	 */
	globalToLocal(point: Offset): Offset

	// === Hit Testing and Caret Positioning ===

	/**
	 * Hit test for selection within this selectable.
	 *
	 * @param localPoint Point in local coordinates
	 * @returns Position if the point is within selectable text, null if outside
	 */
	hitTestSelection(localPoint: Offset): SelectableTextPosition | null

	/**
	 * Find the nearest valid caret position to the given point.
	 * Unlike hitTestSelection, this always returns a position (clamped to content bounds).
	 *
	 * @param localPoint Point in local coordinates
	 * @returns Nearest caret position, clamped to valid range
	 */
	nearestCaretPosition(localPoint: Offset): SelectableTextPosition

	// === Text Boundaries (for multi-click selection) ===

	/**
	 * Get the word boundary containing the given position.
	 * Used for double-click word selection.
	 */
	wordBoundary(pos: SelectableTextPosition): SelectableTextRange

	/**
	 * Get the line boundary containing the given position.
	 * Used for triple-click line selection.
	 */
	lineBoundary(pos: SelectableTextPosition): SelectableTextRange

	/**
	 * Get the paragraph boundary containing the given position.
	 * Used for triple-click paragraph selection in text blocks.
	 * Should select text between hard line breaks (\n).
	 */
	paragraphBoundary?(pos: SelectableTextPosition): SelectableTextRange

	/**
	 * Determine the selection context for triple-click behavior.
	 * @returns 'paragraph' for text blocks, 'line' for list items or single lines
	 */
	getSelectionContext?(): 'paragraph' | 'line'

	// === Content Access ===

	/**
	 * Returns the total length of selectable text content in grapheme clusters.
	 */
	textLength(): number

	/**
	 * Extract text content from this selectable.
	 *
	 * @param range Optional range to extract. If omitted, returns all text.
	 * @returns Plain text content for the specified range
	 */
	getText(range?: SelectableTextRange): string

	// === Selection Rendering ===

	/**
	 * Update the selection ranges that this selectable should highlight.
	 *
	 * This is the primary way SelectionArea communicates selection state
	 * to individual selectables. Implementations should:
	 * 1. Store the ranges
	 * 2. Invalidate painting if ranges changed
	 * 3. Render highlights during next paint
	 *
	 * @param ranges Array of ranges to highlight (may be empty to clear selection)
	 */
	setSelectedRanges(ranges: SelectableTextRange[]): void

	/**
	 * Set the highlight mode for selection rendering.
	 * Optional method for selectables that support different highlight styles.
	 */
	setHighlightMode?(mode: HighlightMode): void

	// === Optional: Advanced Navigation ===
	// These methods support keyboard navigation across selectables.
	// They can be implemented later when adding Shift+Arrow support.

	/**
	 * Get the next visual position in the specified direction.
	 * Used for keyboard navigation across line and widget boundaries.
	 *
	 * @param pos Current position
	 * @param direction Movement direction
	 * @returns Next position, or null if at boundary
	 */
	nextVisualPosition?(
		pos: SelectableTextPosition,
		direction: 'left' | 'right' | 'up' | 'down',
	): SelectableTextPosition | null
}

/**
 * Interface for the selection area controller that manages selection state
 * and coordinates between multiple Selectable render objects.
 */
export interface SelectionAreaController {
	register(selectable: Selectable): number
	unregister(selectable: Selectable): void
	hitTest(globalPoint: Offset): Selectable | null
	setSelection(selection: Selection | null): void
	getSelection(): Selection | null
	clear(): void
	selectAll(): void
	copySelection(): string
	startCopyHighlight(): void
	endCopyHighlight(): void
	beginDrag(anchor: DocumentPosition): void
	updateDrag(extent: DocumentPosition): void
	endDrag(): void
	isDragging(): boolean
	addListener(listener: () => void): () => void
	dispose(): void
}

/**
 * Create an empty text range.
 */
export function createEmptyRange(offset: number): SelectableTextRange {
	return { start: offset, end: offset }
}

/**
 * Check if a text range is empty (collapsed).
 */
export function isRangeEmpty(range: SelectableTextRange): boolean {
	return range.start === range.end
}

/**
 * Normalize a text range so start <= end.
 */
export function normalizeRange(range: SelectableTextRange): SelectableTextRange {
	if (range.start <= range.end) return range
	return { start: range.end, end: range.start }
}

/**
 * Check if two text ranges are equal.
 */
export function rangesEqual(a: SelectableTextRange, b: SelectableTextRange): boolean {
	return a.start === b.start && a.end === b.end
}

/**
 * Check if a selection is collapsed (anchor equals extent).
 */
export function isSelectionCollapsed(selection: Selection): boolean {
	return (
		selection.anchor.selectableId === selection.extent.selectableId &&
		selection.anchor.offset === selection.extent.offset
	)
}

/**
 * Compare two document positions for ordering.
 *
 * @param a First position
 * @param b Second position
 * @param selectableOrder Function that returns the relative order of two selectables
 * @returns Negative if a < b, positive if a > b, zero if equal
 */
export function compareDocumentPositions(
	a: DocumentPosition,
	b: DocumentPosition,
	selectableOrder: (idA: number, idB: number) => number,
): number {
	if (a.selectableId === b.selectableId) {
		return a.offset - b.offset
	}
	return selectableOrder(a.selectableId, b.selectableId)
}

/**
 * Create a selection from two document positions, automatically determining anchor/extent.
 */
export function createSelection(start: DocumentPosition, end: DocumentPosition): Selection {
	return { anchor: start, extent: end }
}

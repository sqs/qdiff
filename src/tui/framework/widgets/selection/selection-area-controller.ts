import logger from '../../../logger.js'

import { clipboard } from '../../../lib/clipboard.js'
import { HighlightMode } from './interfaces.js'
import type {
	DocumentPosition,
	Offset,
	Rect,
	Selectable,
	SelectableTextRange,
	Selection,
	SelectionAreaController,
} from './selection-core.js'
import { compareDocumentPositions } from './selection-core.js'

/**
 * Manages selection state and coordinates between multiple Selectable render objects.
 *
 * This controller implements the centralized selection model where:
 * - All selection state lives here (no state in individual selectables)
 * - Selection spans are computed and pushed to affected selectables
 * - Mouse and keyboard interactions are coordinated across selectables
 * - Reading order is maintained for proper text extraction
 *
 * The controller follows a reactive pattern: when selection changes,
 * it immediately propagates the changes to all affected selectables.
 */
export class SelectionAreaControllerImpl implements SelectionAreaController {
	// === Registry Management ===
	private readonly _selectables: Selectable[] = []
	private readonly _idToSelectable = new Map<number, Selectable>()
	private _nextId = 1

	// === Selection State ===
	private _selection: Selection | null = null
	private _isDragging = false
	private _dragAnchor: DocumentPosition | null = null

	// === Performance Cache ===
	private _orderedCache: Array<{ selectable: Selectable }> = []
	private _orderDirty = true

	// === Event Listeners ===
	private _listeners = new Set<() => void>()

	// === Copy Highlighting Timer ===
	private _copyHighlightTimer?: NodeJS.Timeout
	private _clearSelectionTimer?: NodeJS.Timeout

	// === Copy Callback ===
	private _onCopyCallback?: (text: string) => void

	// === Public API ===

	/**
	 * Register a selectable with this controller.
	 *
	 * @param selectable The selectable to register
	 * @returns Unique ID assigned to the selectable
	 */
	register(selectable: Selectable): number {
		const id = this._nextId++
		selectable.selectableId = id

		this._selectables.push(selectable)
		this._idToSelectable.set(id, selectable)
		this._orderDirty = true

		// Notify the selectable of attachment
		selectable.onAttachToSelectionArea(this)

		return id
	}

	/**
	 * Unregister a selectable from this controller.
	 *
	 * If the selectable is part of the current selection, the selection is cleared.
	 *
	 * @param selectable The selectable to unregister
	 */
	unregister(selectable: Selectable): void {
		const index = this._selectables.indexOf(selectable)
		if (index === -1) {
			return
		}

		// Remove from registry
		this._selectables.splice(index, 1)
		this._idToSelectable.delete(selectable.selectableId)
		this._orderDirty = true

		// Clear selection if it involves this selectable
		if (this._selection && this._involvesSelectable(this._selection, selectable.selectableId)) {
			this.clear()
		}

		// Clear any highlights on this selectable
		selectable.setSelectedRanges([])

		// Notify the selectable of detachment
		selectable.onDetachFromSelectionArea(this)
	}

	/**
	 * Get all registered selectables.
	 *
	 * @returns Array of all registered selectables
	 */
	getAllSelectables(): Selectable[] {
		return [...this._selectables]
	}

	/**
	 * Find which selectable contains the given global point.
	 *
	 * @param globalPoint Point in global coordinates
	 * @returns The selectable under the point, or null if none
	 */
	hitTest(globalPoint: Offset): Selectable | null {
		this._ensureOrder()

		// Test selectables in reverse paint order (front to back)
		for (let i = this._orderedCache.length - 1; i >= 0; i--) {
			const item = this._orderedCache[i]
			if (item) {
				const bounds = item.selectable.globalBounds()
				if (this._pointInRect(globalPoint, bounds)) {
					return item.selectable
				}
			}
		}

		return null
	}

	/**
	 * Set the current selection.
	 *
	 * @param selection New selection, or null to clear
	 */
	setSelection(selection: Selection | null): void {
		if (this._selectionsEqual(this._selection, selection)) {
			return
		}

		this._selection = selection
		this._propagateSelection()
		this._notifyListeners()
	}

	/**
	 * Get the current selection.
	 */
	getSelection(): Selection | null {
		return this._selection
	}

	/**
	 * Clear the current selection.
	 */
	clear(): void {
		this.setSelection(null)
		this._isDragging = false
		this._dragAnchor = null
	}

	/**
	 * Select all text in all registered selectables.
	 */
	selectAll(): void {
		if (this._selectables.length === 0) {
			this.clear()
			return
		}

		this._ensureOrder()

		const firstItem = this._orderedCache[0]
		const lastItem = this._orderedCache[this._orderedCache.length - 1]

		if (!firstItem || !lastItem) {
			this.clear()
			return
		}

		this.setSelection({
			anchor: { selectableId: firstItem.selectable.selectableId, offset: 0 },
			extent: {
				selectableId: lastItem.selectable.selectableId,
				offset: lastItem.selectable.textLength(),
			},
		})
	}

	/**
	 * Copy the current selection to a string and start copy highlighting.
	 *
	 * @returns Selected text, or empty string if no selection
	 */
	copySelection(): string {
		if (!this._selection) {
			return ''
		}

		const rangesById = this._splitSelectionBySelectable(this._selection)
		const parts: string[] = []

		this._ensureOrder()

		for (const { selectable } of this._orderedCache) {
			const ranges = rangesById.get(selectable.selectableId)
			if (!ranges || ranges.length === 0) {
				continue
			}

			// Collect all text from this widget first
			const widgetTexts: string[] = []
			for (const range of ranges) {
				const text = selectable.getText(range)
				if (text) {
					widgetTexts.push(text)
				}
			}

			// Add newline between widgets if we have text from this widget and previous text
			if (widgetTexts.length > 0) {
				if (parts.length > 0 && !parts[parts.length - 1]?.endsWith('\n')) {
					parts.push('\n')
				}
				parts.push(...widgetTexts)
			}
		}

		// Note: Copy highlighting is now managed separately in endDrag() and manual copy operations
		return parts.join('')
	}

	/**
	 * Start copy highlighting on the current selection.
	 * Changes highlight mode to COPY for visual feedback.
	 */
	startCopyHighlight(): void {
		if (!this._selection) {
			return
		}

		this._applyHighlightMode(HighlightMode.COPY)
	}

	/**
	 * End copy highlighting and return to normal selection highlighting.
	 */
	endCopyHighlight(): void {
		if (!this._selection) {
			return
		}

		this._applyHighlightMode(HighlightMode.SELECTION)
	}

	/**
	 * Start copy highlighting with automatic timer to end after 300ms.
	 */
	private _startCopyHighlightWithTimer(): void {
		// Clear any existing timers
		if (this._copyHighlightTimer) {
			clearTimeout(this._copyHighlightTimer)
			this._copyHighlightTimer = undefined
		}
		if (this._clearSelectionTimer) {
			clearTimeout(this._clearSelectionTimer)
			this._clearSelectionTimer = undefined
		}

		// Start copy highlighting
		this.startCopyHighlight()

		// Set timer to automatically end copy highlighting after 300ms
		this._copyHighlightTimer = setTimeout(() => {
			this.endCopyHighlight()
			this._copyHighlightTimer = undefined
		}, 300)
	}

	/**
	 * Begin a drag selection operation.
	 *
	 * @param anchor Starting position for the selection
	 */
	beginDrag(anchor: DocumentPosition): void {
		this._isDragging = true
		this._dragAnchor = anchor

		// Start with collapsed selection at anchor
		this.setSelection({
			anchor,
			extent: anchor,
		})
	}

	/**
	 * Update the extent of an ongoing drag selection.
	 *
	 * @param extent New extent position
	 */
	updateDrag(extent: DocumentPosition): void {
		if (!this._isDragging || !this._dragAnchor) {
			return
		}

		this.setSelection({
			anchor: this._dragAnchor,
			extent,
		})
	}

	/**
	 * End the current drag selection operation.
	 * Automatically copies selection to clipboard with 300ms highlight.
	 */
	async endDrag(): Promise<void> {
		this._isDragging = false
		// Note: we don't clear _dragAnchor here as it might be useful for debugging

		// Auto-copy the selection if there is one
		await this._autoCopySelection()
	}

	/**
	 * Auto-copy the current selection with highlighting and clearing.
	 * Used for both drag selections and multi-click selections.
	 */
	async autoCopySelection(): Promise<void> {
		await this._autoCopySelection()
	}

	/**
	 * Internal method to handle auto-copy behavior.
	 */
	private async _autoCopySelection(): Promise<void> {
		if (this._selection) {
			const text = this.copySelection()
			if (text) {
				// Copy to clipboard
				try {
					await clipboard.writeText(text)
				} catch (error) {
					logger.debug('Failed to write selection to clipboard:', error)
				}

				// Start copy highlight and auto-clear after 300ms
				this._startCopyHighlightWithTimer()

				// Clear selection after copying (after highlight ends)
				this._clearSelectionTimer = setTimeout(() => {
					this.clear()
					this._clearSelectionTimer = undefined
				}, 300)

				// Call the onCopy callback if provided
				this._onCopyCallback?.(text)
			}
		}
	}

	/**
	 * Check if a drag operation is currently active.
	 */
	isDragging(): boolean {
		return this._isDragging
	}

	/**
	 * Add a listener that will be called when the selection changes.
	 *
	 * @param listener Callback to invoke on selection changes
	 * @returns Function to remove the listener
	 */
	addListener(listener: () => void): () => void {
		this._listeners.add(listener)
		return () => this._listeners.delete(listener)
	}

	/**
	 * Set the callback to be called when text is copied.
	 *
	 * @param callback Function to call with the copied text
	 */
	setOnCopyCallback(callback?: (text: string) => void): void {
		this._onCopyCallback = callback
	}

	/**
	 * Remove all listeners and clear selection state.
	 * Call this when disposing of the controller.
	 */
	dispose(): void {
		// Clear selection from all selectables
		for (const selectable of this._selectables) {
			selectable.setSelectedRanges([])
			selectable.onDetachFromSelectionArea(this)
		}

		// Clear internal state
		this._selectables.length = 0
		this._idToSelectable.clear()
		this._orderedCache.length = 0
		this._selection = null
		this._isDragging = false
		this._dragAnchor = null
		this._listeners.clear()

		// Clear any pending timers
		if (this._copyHighlightTimer) {
			clearTimeout(this._copyHighlightTimer)
			this._copyHighlightTimer = undefined
		}
		if (this._clearSelectionTimer) {
			clearTimeout(this._clearSelectionTimer)
			this._clearSelectionTimer = undefined
		}
	}

	// === Private Implementation ===

	/**
	 * Ensure the ordered cache is up to date.
	 */
	private _ensureOrder(): void {
		if (!this._orderDirty) {
			return
		}

		this._orderedCache = this._selectables
			.map((selectable) => ({ selectable }))
			.sort((a, b) => {
				// Reading order: top-to-bottom, then left-to-right
				const aBounds = a.selectable.globalBounds()
				const bBounds = b.selectable.globalBounds()
				const topDiff = aBounds.top - bBounds.top
				if (topDiff !== 0) {
					return topDiff
				}
				return aBounds.left - bBounds.left
			})

		this._orderDirty = false
	}

	/**
	 * Propagate current selection to all affected selectables.
	 */
	private _propagateSelection(): void {
		if (!this._selection) {
			// Clear selection from all selectables
			for (const selectable of this._selectables) {
				selectable.setSelectedRanges([])
			}
			return
		}

		const rangesById = this._splitSelectionBySelectable(this._selection)

		for (const selectable of this._selectables) {
			const ranges = rangesById.get(selectable.selectableId) ?? []
			selectable.setSelectedRanges(ranges)
		}
	}

	/**
	 * Apply a highlight mode to all selectables with current selection.
	 */
	private _applyHighlightMode(mode: HighlightMode): void {
		if (!this._selection) {
			return
		}

		for (const selectable of this._selectables) {
			selectable.setHighlightMode?.(mode)
		}
	}

	/**
	 * Split a selection into per-selectable ranges.
	 */
	private _splitSelectionBySelectable(selection: Selection): Map<number, SelectableTextRange[]> {
		// Normalize selection order (start <= end in reading order)
		const [start, end] =
			this._compareDocumentPositions(selection.anchor, selection.extent) <= 0
				? [selection.anchor, selection.extent]
				: [selection.extent, selection.anchor]

		const rangesById = new Map<number, SelectableTextRange[]>()

		// If selection is within a single selectable, handle it directly
		if (start.selectableId === end.selectableId) {
			rangesById.set(start.selectableId, [{ start: start.offset, end: end.offset }])
			return rangesById
		}

		// Multi-selectable selection: walk through ordered selectables
		this._ensureOrder()

		let inRange = false
		for (const { selectable } of this._orderedCache) {
			const id = selectable.selectableId

			if (!inRange) {
				// Check if this is the start selectable
				if (id === start.selectableId) {
					inRange = true
					rangesById.set(id, [{ start: start.offset, end: selectable.textLength() }])
				}
			} else {
				// We're in the middle of a multi-selectable selection
				if (id === end.selectableId) {
					// This is the end selectable
					rangesById.set(id, [{ start: 0, end: end.offset }])
					break
				} else {
					// This is a middle selectable - select all of it
					rangesById.set(id, [{ start: 0, end: selectable.textLength() }])
				}
			}
		}

		return rangesById
	}

	/**
	 * Compare two document positions for reading order.
	 */
	private _compareDocumentPositions(a: DocumentPosition, b: DocumentPosition): number {
		return compareDocumentPositions(a, b, (idA, idB) => {
			this._ensureOrder()

			const indexA = this._orderedCache.findIndex(
				(item) => item.selectable.selectableId === idA,
			)
			const indexB = this._orderedCache.findIndex(
				(item) => item.selectable.selectableId === idB,
			)

			if (indexA === -1 || indexB === -1) {
				// Fallback to ID comparison if not found (shouldn't happen)
				return idA - idB
			}

			return indexA - indexB
		})
	}

	/**
	 * Check if a selection involves a specific selectable.
	 */
	private _involvesSelectable(selection: Selection, selectableId: number): boolean {
		return (
			selection.anchor.selectableId === selectableId ||
			selection.extent.selectableId === selectableId
		)
	}

	/**
	 * Check if a point is within a rectangle.
	 */
	private _pointInRect(point: Offset, rect: Rect): boolean {
		return (
			point.x >= rect.left &&
			point.x <= rect.right &&
			point.y >= rect.top &&
			point.y <= rect.bottom
		)
	}

	/**
	 * Check if two selections are equal.
	 */
	private _selectionsEqual(a: Selection | null, b: Selection | null): boolean {
		if (a === null && b === null) return true
		if (a === null || b === null) return false

		return (
			a.anchor.selectableId === b.anchor.selectableId &&
			a.anchor.offset === b.anchor.offset &&
			a.extent.selectableId === b.extent.selectableId &&
			a.extent.offset === b.extent.offset
		)
	}

	/**
	 * Notify all listeners of selection changes.
	 */
	private _notifyListeners(): void {
		for (const listener of this._listeners) {
			try {
				listener()
			} catch (error) {
				// Silently ignore listener errors to prevent cascading failures
				// In a production system, this would use a proper logging mechanism
			}
		}
	}

	// === Debug Helpers ===

	/**
	 * Get debug information about the current state.
	 * Useful for testing and debugging.
	 */
	getDebugInfo(): {
		selectableCount: number
		hasSelection: boolean
		isDragging: boolean
		selection: Selection | null
	} {
		return {
			selectableCount: this._selectables.length,
			hasSelection: this._selection !== null,
			isDragging: this._isDragging,
			selection: this._selection,
		}
	}
}

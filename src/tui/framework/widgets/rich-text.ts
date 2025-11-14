import { assert } from '../../lib/assert.js'
import { MouseCursor } from '../../lib/mouse-cursor.js'
import type { Cell, Color, Hyperlink, Screen, Style } from '../../lib/screen.js'
import { Colors, createCell } from '../../lib/screen.js'
import {
	getCharWidth,
	getStringWidth,
	splitIntoGraphemes,
	truncateText,
} from '../../lib/text-utils.js'
import type { BuildContext } from '../build-context.js'
import { BuildContextImpl } from '../build-context.js'
import type { Key } from '../key.js'
import { MediaQuery } from '../media-query.js'
import type { AnyMouseEvent, MouseEventTarget } from '../mouse/mouse-events.js'
import { MouseManager } from '../mouse/mouse-manager.js'
import type { RenderObject } from '../render-object.js'
import { RenderBox } from '../render-object.js'
import { LeafRenderObjectElement, LeafRenderObjectWidget } from '../render-object-widget.js'
import { DimContext } from './dim-context.js'
import { InheritedSelectionArea } from './selection/inherited-selection-area.js'
import { HighlightMode } from './selection/interfaces.js'
import type {
	Offset,
	Rect,
	Selectable,
	SelectableTextPosition,
	SelectableTextRange,
	SelectionAreaController,
} from './selection/selection-core.js'
import { EMPTY_RECT } from './selection/selection-core.js'
import { Theme } from './theme.js'

type CharacterPosition = {
	x: number
	y: number
	width: number
}

/**
 * Text styling options.
 */
export class TextStyle {
	public readonly color?: Color
	public readonly backgroundColor?: Color
	public readonly bold?: boolean
	public readonly italic?: boolean
	public readonly underline?: boolean
	public readonly strikethrough?: boolean
	public readonly dim?: boolean

	constructor({
		color,
		backgroundColor,
		bold,
		italic,
		underline,
		strikethrough,
		dim,
	}: {
		color?: Color
		backgroundColor?: Color
		bold?: boolean
		italic?: boolean
		underline?: boolean
		strikethrough?: boolean
		dim?: boolean
	} = {}) {
		if (color !== undefined) this.color = color
		if (backgroundColor !== undefined) this.backgroundColor = backgroundColor
		if (bold !== undefined) this.bold = bold
		if (italic !== undefined) this.italic = italic
		if (underline !== undefined) this.underline = underline
		if (strikethrough !== undefined) this.strikethrough = strikethrough
		if (dim !== undefined) this.dim = dim
	}

	/**
	 * Creates a copy of this TextStyle with the given overrides.
	 */
	copyWith({
		color,
		backgroundColor,
		bold,
		italic,
		underline,
		strikethrough,
		dim,
	}: {
		color?: Color
		backgroundColor?: Color
		bold?: boolean
		italic?: boolean
		underline?: boolean
		strikethrough?: boolean
		dim?: boolean
	}): TextStyle {
		const result: any = {}
		if (color !== undefined || this.color !== undefined) result.color = color ?? this.color
		if (backgroundColor !== undefined || this.backgroundColor !== undefined)
			result.backgroundColor = backgroundColor ?? this.backgroundColor
		if (bold !== undefined || this.bold !== undefined) result.bold = bold ?? this.bold
		if (italic !== undefined || this.italic !== undefined) result.italic = italic ?? this.italic
		if (underline !== undefined || this.underline !== undefined)
			result.underline = underline ?? this.underline
		if (strikethrough !== undefined || this.strikethrough !== undefined)
			result.strikethrough = strikethrough ?? this.strikethrough
		if (dim !== undefined || this.dim !== undefined) result.dim = dim ?? this.dim
		return new TextStyle(result)
	}

	/**
	 * Merges this style with another, with the other taking precedence.
	 */
	merge(other?: TextStyle): TextStyle {
		if (!other) return this

		const result: any = {}
		if (other.color !== undefined || this.color !== undefined)
			result.color = other.color ?? this.color
		if (other.backgroundColor !== undefined || this.backgroundColor !== undefined)
			result.backgroundColor = other.backgroundColor ?? this.backgroundColor
		if (other.bold !== undefined || this.bold !== undefined)
			result.bold = other.bold ?? this.bold
		if (other.italic !== undefined || this.italic !== undefined)
			result.italic = other.italic ?? this.italic
		if (other.underline !== undefined || this.underline !== undefined)
			result.underline = other.underline ?? this.underline
		if (other.strikethrough !== undefined || this.strikethrough !== undefined)
			result.strikethrough = other.strikethrough ?? this.strikethrough
		if (other.dim !== undefined || this.dim !== undefined) result.dim = other.dim ?? this.dim
		return new TextStyle(result)
	}

	/**
	 * Factory methods for common text styles
	 */
	static normal(color?: Color): TextStyle {
		return color ? new TextStyle({ color }) : new TextStyle()
	}

	static bold(color?: Color): TextStyle {
		return color ? new TextStyle({ color, bold: true }) : new TextStyle({ bold: true })
	}

	static italic(color?: Color): TextStyle {
		return color ? new TextStyle({ color, italic: true }) : new TextStyle({ italic: true })
	}

	static underline(color?: Color): TextStyle {
		return color
			? new TextStyle({ color, underline: true })
			: new TextStyle({ underline: true })
	}

	static colored(color: Color): TextStyle {
		return new TextStyle({ color })
	}

	static background(backgroundColor: Color): TextStyle {
		return new TextStyle({ backgroundColor })
	}
}

/**
 * An immutable span of text with an associated style.
 */
export class TextSpan {
	constructor(
		public readonly text?: string,
		public readonly style?: TextStyle,
		public readonly children?: TextSpan[],
		public readonly hyperlink?: Hyperlink,
		public readonly onClick?: () => void,
	) {}

	/**
	 * Gets the plain text content of this span and all its children.
	 */
	toPlainText(): string {
		let result = this.text ?? ''

		if (this.children) {
			for (const child of this.children) {
				result += child.toPlainText()
			}
		}

		// Ensure we always return a string
		return String(result)
	}

	/**
	 * Compares this TextSpan with another for content and style equality.
	 */
	equals(other: TextSpan | null | undefined): boolean {
		if (!other) return false

		// Compare text content
		if (this.text !== other.text) return false

		// Compare hyperlinks
		if (this.hyperlink?.uri !== other.hyperlink?.uri) return false

		// Compare styles (shallow comparison of style properties)
		if (this.style !== other.style) {
			if (!this.style || !other.style) return false
			if (this.style.color !== other.style.color) return false
			if (this.style.backgroundColor !== other.style.backgroundColor) return false
			if (this.style.bold !== other.style.bold) return false
			if (this.style.italic !== other.style.italic) return false
			if (this.style.underline !== other.style.underline) return false
		}

		// Compare children
		if (this.children?.length !== other.children?.length) return false
		if (this.children && other.children) {
			for (let i = 0; i < this.children.length; i++) {
				const thisChild = this.children[i]
				const otherChild = other.children[i]
				if (!thisChild || !otherChild || !thisChild.equals(otherChild)) return false
			}
		}

		return true
	}

	/**
	 * Visits this span and all descendant spans.
	 */
	visitTextSpan(visitor: (span: TextSpan) => boolean): void {
		if (!visitor(this)) return

		if (this.children) {
			for (const child of this.children) {
				child.visitTextSpan(visitor)
			}
		}
	}
}

/**
 * How text should be aligned within its container.
 */
export enum TextAlign {
	left = 'left',
	right = 'right',
	center = 'center',
	justify = 'justify',
}

/**
 * Recursively strips \r characters from a TextSpan and its children.
 */
function stripCarriageReturns(span: TextSpan): TextSpan {
	const cleanedText = span.text?.replace(/\r/g, '')
	const cleanedChildren = span.children?.map((child) => stripCarriageReturns(child))

	return new TextSpan(cleanedText, span.style, cleanedChildren, span.hyperlink, span.onClick)
}

/**
 * A widget that displays rich text with optional styling.
 *
 * RichText is the fundamental text widget in the UI framework.
 * It can display text spans with different styles and handle taps on individual spans.
 */
export class RichText extends LeafRenderObjectWidget {
	public readonly text: TextSpan
	public readonly textAlign: TextAlign
	public readonly maxLines: number | undefined
	public readonly overflow: TextOverflow
	public readonly selectable: boolean

	constructor({
		key,
		text,
		textAlign = TextAlign.left,
		maxLines,
		overflow = TextOverflow.clip,
		selectable = false,
	}: {
		key?: Key
		text: TextSpan
		textAlign?: TextAlign
		maxLines?: number
		overflow?: TextOverflow
		selectable?: boolean
	}) {
		super(key ? { key } : {})
		this.text = stripCarriageReturns(text)
		this.textAlign = textAlign
		this.maxLines = maxLines
		this.overflow = overflow
		this.selectable = selectable
		this.sendDebugData({ text })
	}

	createElement(): RichTextElement {
		return new RichTextElement(this)
	}

	createRenderObject(): RichTextRenderObject {
		return new RichTextRenderObject(
			this.text,
			this.textAlign,
			this.maxLines,
			this.overflow,
			false, // Will be updated by element with proper MediaQuery
			Colors.index(8), // Will be updated by element with proper Theme
			Colors.yellow, // Will be updated by element with proper Theme
			this.selectable,
		)
	}

	/**
	 * IMPORTANT: This is intentionally a no-op.
	 *
	 * RichText needs MediaQuery (for emojiWidthSupported) and Theme (for selection colors)
	 * from BuildContext, but widgets don't have context access - only elements do.
	 *
	 * Standard framework flow:
	 *   Element.update() → Widget.updateRenderObject() → RenderObject.updateText()
	 *
	 * Problem: Widget can't access MediaQuery/Theme, so it would pass wrong values.
	 *
	 * Solution: RichTextElement overrides update() to call _updateRenderObjectWithMediaQuery()
	 * which properly accesses MediaQuery/Theme and updates the render object.
	 *
	 * If we implemented this method, we'd call updateText() twice on every update:
	 *   1. Once here with wrong values (emojiWidthSupported=false)
	 *   2. Once in _updateRenderObjectWithMediaQuery() with correct values
	 *
	 * Each updateText() call clears caches and regenerates styled cells, so the double
	 * update was expensive. Making this a no-op eliminates the redundant work.
	 */
	updateRenderObject(renderObject: RenderObject): void {
		// Intentionally empty - see comment above
	}
}

/**
 * Custom element for RichText that provides MediaQuery access.
 */
export class RichTextElement extends LeafRenderObjectElement {
	constructor(widget: RichText) {
		super(widget)
	}

	get richTextWidget(): RichText {
		return this.widget as RichText
	}

	mount(): void {
		super.mount()
		this._updateRenderObjectWithMediaQuery()
	}

	performRebuild(): void {
		super.performRebuild()
		// Defer context setting to next frame to ensure widget tree is fully built
		setTimeout(() => this._ensureRenderObjectContext(), 0)
	}

	private _ensureRenderObjectContext(): void {
		if (!this.renderObject) return

		const richTextRenderObject = this.renderObject as RichTextRenderObject
		const context = new BuildContextImpl(this, this.widget)

		richTextRenderObject.setContext(context)
	}

	update(newWidget: RichText): void {
		super.update(newWidget)

		// Always update render object with context to ensure SelectionArea registration
		this._updateRenderObjectWithMediaQuery()
	}

	private _updateRenderObjectWithMediaQuery(): void {
		if (!this.renderObject) {
			return
		}

		try {
			// Create a BuildContext from this element to access widget tree
			const context = new BuildContextImpl(this, this.widget)

			const mediaQuery = MediaQuery.of(context)
			const theme = Theme.maybeOf(context)
			const selectionColor = theme?.colorScheme.selection ?? Colors.index(8)
			const copyHighlightColor = theme?.colorScheme.copyHighlight ?? Colors.yellow

			const richTextRenderObject = this.renderObject as RichTextRenderObject

			// Set context for SelectionArea registration
			richTextRenderObject.setContext(context)

			richTextRenderObject.updateText(
				this.richTextWidget.text,
				this.richTextWidget.textAlign,
				this.richTextWidget.maxLines,
				this.richTextWidget.overflow,
				mediaQuery.supportsEmojiWidth,
				selectionColor,
				copyHighlightColor,
				this.richTextWidget.selectable,
			)
		} catch (error) {
			// MediaQuery not available, fall back to defaults
			const context = new BuildContextImpl(this, this.widget)
			const richTextRenderObject = this.renderObject as RichTextRenderObject

			// Set context for SelectionArea registration even in fallback case
			richTextRenderObject.setContext(context)

			richTextRenderObject.updateText(
				this.richTextWidget.text,
				this.richTextWidget.textAlign,
				this.richTextWidget.maxLines,
				this.richTextWidget.overflow,
				false,
				Colors.index(8), // Default selection color
				Colors.yellow, // Default copy highlight color
				this.richTextWidget.selectable,
			)
		}
	}
}

/**
 * How text overflow should be handled.
 */
export enum TextOverflow {
	clip = 'clip',
	ellipsis = 'ellipsis',
	fade = 'fade',
	visible = 'visible',
}

/**
 * RenderObject for RichText that implements the Selectable and MouseEventTarget interfaces.
 *
 * This render object can participate in cross-widget text selection by
 * registering with the nearest SelectionArea and implementing selection primitives.
 * It also handles mouse events for tappable TextSpans.
 */
export class RichTextRenderObject extends RenderBox implements Selectable, MouseEventTarget {
	// Selectable interface properties
	public selectableId: number = 0
	private _selectionArea?: SelectionAreaController
	private _selectedRanges: SelectableTextRange[] = []

	// Setter to track when _selectionArea gets modified
	set selectionArea(value: SelectionAreaController | undefined) {
		this._selectionArea = value
	}

	get selectionArea(): SelectionAreaController | undefined {
		return this._selectionArea
	}

	// Existing RichText properties
	private _cachedStyledCells: Cell[] | undefined // Cache styled cells from layout
	private _selectionStart: number | null = null
	private _selectionEnd: number | null = null
	private _characterPositions: Array<CharacterPosition> = []
	private _visualLines: Array<{ y: number; start: number; end: number }> = []
	private _selectionColor: Color = Colors.index(8) // Default selection color
	private _copyHighlightColor: Color = Colors.yellow // Default copy highlight color
	private _highlightMode: HighlightMode = HighlightMode.SELECTION

	// Mouse handling for tappable spans
	private _hasTappableSpans: boolean = false

	// BuildContext for accessing inherited widgets like DimContext
	private _context?: BuildContext

	constructor(
		private _text: TextSpan,
		private _textAlign: TextAlign,
		private _maxLines?: number,
		private _overflow: TextOverflow = TextOverflow.clip,
		private _emojiWidthSupported: boolean = false,
		selectionColor: Color = Colors.index(8),
		copyHighlightColor: Color = Colors.yellow,
		private _selectable: boolean = false,
	) {
		super()
		this._selectionColor = selectionColor
		this._copyHighlightColor = copyHighlightColor
		this._hasTappableSpans = this.hasAnyTappableSpans()
	}

	get text(): TextSpan {
		return this._text
	}

	get textAlign(): TextAlign {
		return this._textAlign
	}

	get maxLines(): number | undefined {
		return this._maxLines
	}

	get overflow(): TextOverflow {
		return this._overflow
	}

	/**
	 * MouseEventTarget interface: Whether this render object is interested in mouse events.
	 */
	get hasMouseListeners(): boolean {
		return this._hasTappableSpans
	}

	/**
	 * MouseEventTarget interface: Handle mouse events for tappable spans.
	 */
	handleMouseEvent(event: AnyMouseEvent): void {
		if (!this._hasTappableSpans) {
			return
		}

		switch (event.type) {
			case 'hover': {
				const onClickHover = this.getOnClickAtPosition(
					event.localPosition.x,
					event.localPosition.y,
				)
				if (onClickHover) {
					MouseManager.instance.requestCursorChange(MouseCursor.POINTER)
				} else {
					MouseManager.instance.requestCursorChange(MouseCursor.DEFAULT)
				}
				break
			}

			case 'exit':
				MouseManager.instance.requestCursorChange(MouseCursor.DEFAULT)
				break

			case 'click': {
				const onClickClick = this.getOnClickAtPosition(
					event.localPosition.x,
					event.localPosition.y,
				)
				if (onClickClick) {
					onClickClick()
				}
				break
			}
		}
	}

	/**
	 * Update selection range for this RichText.
	 */
	updateSelection(
		start: number | null,
		end: number | null,
		mode: HighlightMode = HighlightMode.SELECTION,
	): void {
		if (
			this._selectionStart !== start ||
			this._selectionEnd !== end ||
			this._highlightMode !== mode
		) {
			this._selectionStart = start
			this._selectionEnd = end
			this._highlightMode = mode
			this.markNeedsPaint()
		}
	}

	/**
	 * Set the highlight mode for the current selection.
	 */
	setHighlightMode(mode: HighlightMode): void {
		if (this._highlightMode !== mode) {
			this._highlightMode = mode
			this.markNeedsPaint()
		}
	}

	/**
	 * Get the plain text content of this RichText.
	 */
	get plainText(): string {
		return this._text.toPlainText()
	}

	/**
	 * Get the character rectangle for a given character index.
	 */
	getCharacterRect(
		index: number,
	): { x: number; y: number; width: number; height: number } | null {
		if (index < 0 || index >= this._characterPositions.length) {
			return null
		}

		const pos = this._characterPositions[index]
		if (!pos) return null

		return {
			x: pos.x,
			y: pos.y,
			width: pos.width,
			height: 1,
		}
	}

	/**
	 * Get the character offset at a given position within this widget.
	 * This is the reverse of getCharacterRect.
	 */
	getOffsetForPosition(x: number, y: number): number | null {
		if (this._characterPositions.length === 0) {
			return null
		}

		// Round fractional coordinates to nearest character cell
		const roundedX = Math.round(x)
		const roundedY = Math.floor(y) // Use floor for Y to stay on current line

		// Calculate the widget's bounding box
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity
		for (const pos of this._characterPositions) {
			minX = Math.min(minX, pos.x)
			minY = Math.min(minY, pos.y)
			maxX = Math.max(maxX, pos.x + pos.width)
			maxY = Math.max(maxY, pos.y + 1)
		}

		// If coordinate is outside widget bounds, return null
		if (roundedX < minX || roundedX >= maxX || roundedY < minY || roundedY >= maxY) {
			return null
		}

		// First, check for exact character matches
		for (let i = 0; i < this._characterPositions.length; i++) {
			const pos = this._characterPositions[i]
			if (!pos) continue

			if (
				roundedX >= pos.x &&
				roundedX < pos.x + pos.width &&
				roundedY >= pos.y &&
				roundedY < pos.y + 1
			) {
				return i
			}
		}

		// If no exact match, find the closest position on the same line
		for (let i = 0; i < this._characterPositions.length; i++) {
			const pos = this._characterPositions[i]
			if (!pos) continue

			// Check if we're on the same line
			if (roundedY >= pos.y && roundedY < pos.y + 1) {
				// If click is to the left of this character, return this position
				if (roundedX < pos.x) {
					return i
				}
				// If this is the last character on the line and click is to the right
				if (
					i === this._characterPositions.length - 1 ||
					(this._characterPositions[i + 1] && this._characterPositions[i + 1]!.y > pos.y)
				) {
					if (roundedX >= pos.x + pos.width) {
						return i + 1 // Position after this character
					}
				}
			}
		}

		// If within bounds but no exact match, return the closest position
		let closestIndex = 0
		let minDistance = Infinity

		for (let i = 0; i < this._characterPositions.length; i++) {
			const pos = this._characterPositions[i]
			if (!pos) continue

			const distance = Math.abs(roundedY - pos.y) + Math.abs(roundedX - pos.x)
			if (distance < minDistance) {
				minDistance = distance
				closestIndex = i
			}
		}

		return closestIndex
	}

	/**
	 * Get visual line information for text selection.
	 */
	getVisualLines(): Array<{ y: number; start: number; end: number }> {
		return this._visualLines
	}

	/**
	 * Get the number of renderable characters (excluding newlines).
	 */
	getRenderableCharacterCount(): number {
		return this._characterPositions.length
	}

	/**
	 * Get the hyperlink URI at a given screen position relative to this render object.
	 */
	getHyperlinkAtPosition(x: number, y: number): string | null {
		const charIndex = this.getOffsetForPosition(x, y)
		if (charIndex === null) {
			return null
		}

		const styledCells = this.getCachedStyledCells()
		const cell = styledCells[charIndex]
		return cell?.hyperlink?.uri ?? null
	}

	/**
	 * Get the onClick callback for the TextSpan at a given screen position.
	 */
	getOnClickAtPosition(x: number, y: number): (() => void) | null {
		const charIndex = this.getOffsetForPosition(x, y)
		if (charIndex === null) {
			return null
		}

		// Find which span owns this character
		let currentIndex = 0
		const findSpan = (span: TextSpan): (() => void) | null => {
			if (span.text) {
				const spanLength = splitIntoGraphemes(span.text).length
				if (charIndex >= currentIndex && charIndex < currentIndex + spanLength) {
					return span.onClick ?? null
				}
				currentIndex += spanLength
			}

			if (span.children) {
				for (const child of span.children) {
					const result = findSpan(child)
					if (result) return result
				}
			}

			return null
		}

		return findSpan(this._text)
	}

	/**
	 * Check if any TextSpan in the tree has an onClick callback.
	 */
	hasAnyTappableSpans(): boolean {
		const checkSpan = (span: TextSpan): boolean => {
			if (span.onClick) return true
			if (span.children) {
				for (const child of span.children) {
					if (checkSpan(child)) return true
				}
			}
			return false
		}

		return checkSpan(this._text)
	}

	updateText(
		text: TextSpan,
		textAlign: TextAlign,
		maxLines?: number,
		overflow: TextOverflow = TextOverflow.clip,
		emojiWidthSupported: boolean = false,
		selectionColor: Color = Colors.index(8),
		copyHighlightColor: Color = Colors.yellow,
		selectable: boolean = false,
	): void {
		this._text = text
		this._textAlign = textAlign
		this._maxLines = maxLines
		this._overflow = overflow
		this._emojiWidthSupported = emojiWidthSupported
		this._selectionColor = selectionColor
		this._copyHighlightColor = copyHighlightColor
		this._selectable = selectable

		// Update tappable spans flag
		this._hasTappableSpans = this.hasAnyTappableSpans()

		// Clear old cached data to prevent memory leaks
		this._cachedStyledCells = undefined
		this._characterPositions = []
		this._visualLines = []

		// Always recompute styled cells (no change detection - keeps code simple)
		this._cachedStyledCells = this.getStyledCells()

		this.markNeedsLayout()
		this.markNeedsPaint()
	}

	/**
	 * Convert TextSpan tree to pre-computed styled cells.
	 * This is the expensive operation we do once and reuse.
	 */
	private getStyledCells(): Cell[] {
		const cells: Cell[] = []
		const segments = this.getStyledSegments(
			this._text,
			new TextStyle({ color: Colors.default() }),
		)

		// Check if DimContext is forcing dim rendering
		const forceDim = this._context ? DimContext.shouldForceDim(this._context) : false

		for (const segment of segments) {
			const graphemes = splitIntoGraphemes(segment.text)
			for (const grapheme of graphemes) {
				const width = getCharWidth(grapheme, this._emojiWidthSupported)
				const style: Style = {}

				if (segment.style.color) style.fg = segment.style.color
				if (segment.style.backgroundColor) style.bg = segment.style.backgroundColor
				if (segment.style.bold) style.bold = segment.style.bold
				if (segment.style.italic) style.italic = segment.style.italic
				if (segment.style.underline) style.underline = segment.style.underline
				if (segment.style.strikethrough) style.strikethrough = segment.style.strikethrough
				if (segment.style.dim || forceDim) style.dim = true

				cells.push(createCell(grapheme, style, width, segment.hyperlink))
			}
		}

		return cells
	}

	/**
	 * Get styled cells - use cached version from layout if available
	 */
	private getCachedStyledCells(): Cell[] {
		return this._cachedStyledCells ?? this.getStyledCells()
	}

	/**
	 * Get total width of all cells
	 */
	private getTotalCellsWidth(cells: Cell[]): number {
		let totalWidth = 0
		for (const cell of cells) {
			totalWidth += cell.width
		}
		return totalWidth
	}

	/**
	 * Wrap cells into lines based on width constraints
	 */
	private wrapCells(cells: Cell[], maxWidth: number): Cell[][] {
		if (maxWidth === Infinity) {
			// No wrapping needed, just handle explicit line breaks
			return this.handleExplicitLineBreaksInCells(cells)
		}

		const lines: Cell[][] = []
		let currentLine: Cell[] = []
		let currentLineWidth = 0
		let i = 0

		while (i < cells.length) {
			const cell = cells[i]
			if (!cell) {
				i++
				continue
			}

			// Handle explicit newlines
			if (cell.char === '\n') {
				currentLine.push(cell)
				lines.push(currentLine)
				currentLine = []
				currentLineWidth = 0
				i++
				continue
			}

			// If adding this cell would exceed maxWidth, try to break at word boundary
			if (currentLineWidth + cell.width > maxWidth && currentLine.length > 0) {
				// Look for a good break point (whitespace) in current line
				let breakPoint = currentLine.length - 1
				while (breakPoint >= 0 && !/\s/.test(currentLine[breakPoint]!.char)) {
					breakPoint--
				}

				if (breakPoint >= 0) {
					// Found whitespace, break there
					const remainingCells = currentLine.slice(breakPoint + 1)
					currentLine = currentLine.slice(0, breakPoint + 1)
					lines.push(currentLine)

					// Start new line with remaining cells
					currentLine = remainingCells
					currentLineWidth = 0
					for (const c of remainingCells) {
						currentLineWidth += c.width
					}
				} else {
					// No whitespace found, hard break
					lines.push(currentLine)
					currentLine = []
					currentLineWidth = 0
				}
			}

			currentLine.push(cell)
			currentLineWidth += cell.width
			i++
		}

		if (currentLine.length > 0) {
			lines.push(currentLine)
		}

		return lines.length > 0 ? lines : [[]]
	}

	/**
	 * Handle explicit line breaks in cells without width wrapping
	 */
	private handleExplicitLineBreaksInCells(cells: Cell[]): Cell[][] {
		const lines: Cell[][] = []
		let currentLine: Cell[] = []

		for (const cell of cells) {
			if (cell.char === '\n') {
				currentLine.push(cell)
				lines.push(currentLine)
				currentLine = []
			} else {
				currentLine.push(cell)
			}
		}

		if (currentLine.length > 0) {
			lines.push(currentLine)
		}

		return lines.length > 0 ? lines : [[]]
	}

	performLayout(): void {
		// Get constraints from base class (which handles _lastConstraints)
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		// Use cached styled cells (computed in updateText)
		const styledCells = this.getCachedStyledCells()

		// When maxWidth is infinite, use intrinsic width for wrapping instead of infinity
		const wrapWidth = isFinite(constraints.maxWidth)
			? constraints.maxWidth
			: this.getTotalCellsWidth(styledCells)

		const wrappedLines = this.wrapCells(styledCells, wrapWidth)

		// Apply maxLines constraint
		const effectiveLines = this._maxLines ? wrappedLines.slice(0, this._maxLines) : wrappedLines

		// Calculate content width efficiently from cells
		let contentWidth = 0
		for (const line of effectiveLines) {
			let lineWidth = 0
			for (const cell of line) {
				lineWidth += cell.width
			}
			contentWidth = Math.max(contentWidth, lineWidth)
		}

		const height = effectiveLines.length
		const textWasWrapped = effectiveLines.length > 1

		// Calculate final dimensions following Flutter's constraint handling
		let finalWidth: number
		let finalHeight: number

		// Handle width constraints
		if (!isFinite(constraints.maxWidth)) {
			// Infinite width constraints - use intrinsic width
			finalWidth = contentWidth
		} else {
			// Finite width constraints - determine width based on alignment
			let desiredWidth: number
			if (this._textAlign === TextAlign.center || this._textAlign === TextAlign.right) {
				desiredWidth = constraints.maxWidth
			} else {
				// For left alignment: if text was wrapped, use constraint width, otherwise use content width
				desiredWidth = textWasWrapped ? constraints.maxWidth : contentWidth
			}
			finalWidth = Math.max(
				constraints.minWidth,
				Math.min(constraints.maxWidth, desiredWidth),
			)
		}

		// Handle height constraints
		if (!isFinite(constraints.maxHeight)) {
			// Infinite height constraints - use intrinsic height
			finalHeight = height
		} else {
			// Finite height constraints - don't limit height for wrapped text to ensure proper layout reporting
			const desiredHeight = textWasWrapped ? height : Math.min(height, constraints.maxHeight)
			finalHeight = Math.max(constraints.minHeight, desiredHeight)
		}

		// Ensure dimensions are valid (should always be finite at this point)
		finalWidth = Math.max(0, finalWidth)
		finalHeight = Math.max(0, finalHeight)

		this.setSize(finalWidth, finalHeight)

		// Clear the needsLayout flag after layout is complete
		super.performLayout()
	}

	getMinIntrinsicWidth(height: number): number {
		const styledCells = this.getCachedStyledCells()

		// If maxLines is 1, text can't wrap, so min width = full width
		if (this._maxLines === 1) {
			return Math.max(this.getTotalCellsWidth(styledCells), 1)
		}

		// For wrappable text, return width of the widest unbreakable word
		let maxWordWidth = 0
		let currentWordWidth = 0
		let inWord = false

		for (const cell of styledCells) {
			// Handle explicit newlines
			if (cell.char === '\n') {
				if (inWord) {
					maxWordWidth = Math.max(maxWordWidth, currentWordWidth)
					currentWordWidth = 0
					inWord = false
				}
				continue
			}

			const isWhitespace = /\s/.test(cell.char)

			if (isWhitespace) {
				if (inWord) {
					maxWordWidth = Math.max(maxWordWidth, currentWordWidth)
					currentWordWidth = 0
					inWord = false
				}
			} else {
				if (!inWord) {
					currentWordWidth = 0
					inWord = true
				}
				currentWordWidth += cell.width
			}
		}

		// Handle final word
		if (inWord) {
			maxWordWidth = Math.max(maxWordWidth, currentWordWidth)
		}

		return Math.max(maxWordWidth, 1) // At least 1 character wide
	}

	getMaxIntrinsicWidth(height: number): number {
		// Return the natural width if text were laid out on a single line
		const styledCells = this.getCachedStyledCells()
		return Math.max(this.getTotalCellsWidth(styledCells), 1)
	}

	getMinIntrinsicHeight(width: number): number {
		// Calculate how many lines we need with the given width using cached cells
		const styledCells = this.getCachedStyledCells()
		const wrappedLines = this.wrapCells(styledCells, width)
		const effectiveLines = this._maxLines ? wrappedLines.slice(0, this._maxLines) : wrappedLines
		return Math.max(effectiveLines.length, 1) // At least 1 line high
	}

	getMaxIntrinsicHeight(width: number): number {
		// For text, max height equals min height (text doesn't expand beyond content)
		return this.getMinIntrinsicHeight(width)
	}

	paint(screen: Screen, offsetX: number = 0, offsetY: number = 0): void {
		const absoluteX = offsetX + this.offset.x
		const absoluteY = offsetY + this.offset.y

		// Use cached styled cells from layout
		const styledCells = this.getCachedStyledCells()
		const wrappedLines = this.wrapCells(styledCells, this.size.width)

		// Apply maxLines constraint and overflow handling
		let effectiveLines = this._maxLines ? wrappedLines.slice(0, this._maxLines) : wrappedLines

		// Apply text overflow handling if we have maxLines and content would overflow
		if (this._maxLines && wrappedLines.length > this._maxLines) {
			effectiveLines = this.applyCellOverflow(effectiveLines, this.size.width)
		}

		// Respect the layout height constraint - only render lines that fit
		if (effectiveLines.length > this.size.height) {
			effectiveLines = effectiveLines.slice(0, this.size.height)
		}

		// Build character positions for selection support
		this._characterPositions = []
		this._visualLines = []

		let globalCharIndex = 0
		for (let lineIndex = 0; lineIndex < effectiveLines.length; lineIndex++) {
			const line = effectiveLines[lineIndex]
			if (!line) continue
			const y = absoluteY + lineIndex

			if (y >= 0 && y < screen.getSize().height) {
				// Calculate starting x position based on alignment
				let x = absoluteX
				if (this._textAlign === 'center' || this._textAlign === 'right') {
					// Calculate line width excluding trailing whitespace for alignment
					let totalLineWidth = 0
					let endIndex = line.length - 1

					// Find last non-whitespace character by going backwards
					while (
						endIndex >= 0 &&
						line[endIndex] &&
						/\s/.test(line[endIndex]?.char || '')
					) {
						endIndex--
					}

					// Calculate width up to and including the last non-whitespace character
					for (let i = 0; i <= endIndex; i++) {
						const cell = line[i]
						if (cell) {
							totalLineWidth += cell.width
						}
					}

					if (this._textAlign === 'center') {
						x = Math.max(
							absoluteX,
							absoluteX + Math.floor((this.size.width - totalLineWidth) / 2),
						)
					} else {
						// right alignment
						x = Math.max(absoluteX, absoluteX + this.size.width - totalLineWidth)
					}
				}

				// Paint cells directly
				let currentX = Math.floor(x)
				const maxX = absoluteX + this.size.width
				for (const cell of line) {
					// Skip newline characters - they don't render but are counted for selection
					if (cell.char === '\n') {
						this._characterPositions.push({
							x: currentX - absoluteX,
							y: lineIndex,
							width: 0,
						})
						globalCharIndex++
						continue
					}

					if (currentX >= maxX) break
					if (currentX >= absoluteX) {
						// Check if this character is selected
						const isSelected = this._isCharacterSelected(globalCharIndex)

						// Preserve the old background color logic
						let cellToRender = { ...cell }

						// Preserve existing background color if text doesn't specify one
						if (!cell.style.bg && !isSelected) {
							const existingCell = screen.getCell(currentX, y)
							if (existingCell?.style.bg) {
								cellToRender = {
									...cellToRender,
									style: { ...cellToRender.style, bg: existingCell.style.bg },
								}
							}
						}

						// Apply selection highlighting
						if (isSelected) {
							if (this._highlightMode === HighlightMode.COPY) {
								// Copy highlight: use yellow as foreground with reverse
								cellToRender = {
									...cellToRender,
									style: {
										...cellToRender.style,
										fg: this._copyHighlightColor,
										reverse: true,
									},
								}
							} else {
								// Selection (both normal and drag): use selection color as background
								cellToRender = {
									...cellToRender,
									style: { ...cellToRender.style, bg: this._selectionColor },
								}
							}
						}

						screen.setCell(currentX, y, cellToRender)
					}

					this._characterPositions.push({
						x: currentX - absoluteX,
						y: lineIndex,
						width: cell.width,
					})
					currentX += cell.width
					globalCharIndex++
				}
			} else {
				// Count characters even when not painting to maintain index
				for (const cell of line) {
					this._characterPositions.push({ x: 0, y: lineIndex, width: cell.width })
					globalCharIndex++
				}
			}

			// Record visual line information
			if (line.length > 0) {
				const lineStartIndex = this._characterPositions.length - line.length
				const lineEndIndex = this._characterPositions.length - 1
				this._visualLines.push({
					y: lineIndex,
					start: lineStartIndex,
					end: lineEndIndex,
				})
			}
		}
	}

	/**
	 * Get the rendered text lines with their styles for terminal rendering.
	 */
	getStyledLines(): StyledLine[] {
		// Generate lines fresh each time based on current size constraints
		const segments = this.getStyledSegments(
			this._text,
			new TextStyle({ color: Colors.default() }),
		)
		const wrappedLines = this.wrapStyledSegments(segments, this.size.width)

		// Apply maxLines constraint and overflow handling
		let effectiveLines = this._maxLines ? wrappedLines.slice(0, this._maxLines) : wrappedLines

		// Apply text overflow handling if we have maxLines and content would overflow
		if (this._maxLines && wrappedLines.length > this._maxLines) {
			effectiveLines = this.applyTextOverflow(effectiveLines, this.size.width)
		}

		// Respect the layout height constraint - only render lines that fit
		if (effectiveLines.length > this.size.height) {
			effectiveLines = effectiveLines.slice(0, this.size.height)
		}

		// Build character positions based on the final effective lines
		this._characterPositions = []
		this._visualLines = []
		for (let lineIndex = 0; lineIndex < effectiveLines.length; lineIndex++) {
			const line = effectiveLines[lineIndex]
			if (line) {
				this._addLineCharacterPositions(line, lineIndex)
			}
		}

		return effectiveLines
	}

	/**
	 * Wrap styled segments to fit within maxWidth, preserving styles.
	 */
	private wrapStyledSegments(segments: StyledSegment[], maxWidth: number): StyledLine[] {
		if (maxWidth === Infinity) {
			// No wrapping needed, just handle explicit line breaks
			return this.handleExplicitLineBreaks(segments)
		}

		const lines: StyledLine[] = []
		let currentLine: StyledSegment[] = []
		let currentLineWidth = 0
		let lastSegmentEndedWithNewline = false // Track if previous segment ended with \n

		for (const segment of segments) {
			// First handle explicit line breaks
			if (!segment.text || typeof segment.text !== 'string') {
				// Invalid segment, skip it
				continue
			}
			const textParts = segment.text.split('\n')

			// Update flag for next segment
			const segmentEndsWithNewline = segment.text.endsWith('\n')

			for (let partIndex = 0; partIndex < textParts.length; partIndex++) {
				const part = textParts[partIndex]
				if (part === undefined) continue

				// If this isn't the first part, we hit a \n, so finish current line
				if (partIndex > 0) {
					// Add the newline character to the previous line
					if (currentLine.length > 0) {
						const lastSegment = currentLine[currentLine.length - 1]
						if (lastSegment) {
							lastSegment.text += '\n'
						}
					} else {
						// If current line is empty, add newline as its own segment
						currentLine.push({
							text: '\n',
							style: segment.style,
							hyperlink: segment.hyperlink,
						})
					}

					lines.push({
						segments: currentLine,
						alignment: this._textAlign,
					})
					currentLine = []
					currentLineWidth = 0
				}

				if (part.length === 0) continue // Skip empty parts

				// Now wrap this part by words
				const words = this.splitIntoWords(part)

				for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
					const word = words[wordIndex]
					if (word === undefined) continue
					const wordWidth = getStringWidth(word, this._emojiWidthSupported)
					const isWhitespace = /^\s+$/.test(word)

					// If adding this word would exceed maxWidth, start new line
					if (currentLineWidth + wordWidth > maxWidth && currentLine.length > 0) {
						lines.push({
							segments: currentLine,
							alignment: this._textAlign,
						})
						currentLine = []
						currentLineWidth = 0
					}

					// Skip leading whitespace on wrapped lines unless it's after explicit line break
					const isAfterExplicitBreak =
						(partIndex > 0 && wordIndex === 0) ||
						(partIndex === 0 && wordIndex === 0 && lastSegmentEndedWithNewline)
					if (isWhitespace && currentLine.length === 0 && !isAfterExplicitBreak) {
						continue // Skip leading whitespace on automatic wrap
					}

					// Reset flag after processing first word of segment
					if (partIndex === 0 && wordIndex === 0) {
						lastSegmentEndedWithNewline = false
					}

					// Add word to current line
					const lastSegment = currentLine[currentLine.length - 1]
					if (
						currentLine.length > 0 &&
						lastSegment &&
						this.segmentsEqual(lastSegment, segment)
					) {
						lastSegment.text += word
					} else {
						currentLine.push({
							text: word,
							style: segment.style,
							hyperlink: segment.hyperlink,
						})
					}
					currentLineWidth += wordWidth
				}
			}

			// Update flag for next segment
			lastSegmentEndedWithNewline = segmentEndsWithNewline
		}

		// Add final line if it has content
		if (currentLine.length > 0) {
			lines.push({
				segments: currentLine,
				alignment: this._textAlign,
			})
		}

		// Handle empty case
		if (lines.length === 0) {
			lines.push({
				segments: [{ text: '', style: new TextStyle({ color: Colors.default() }) }],
				alignment: this._textAlign,
			})
		}

		return lines
	}

	/**
	 * Handle explicit line breaks without width constraints.
	 */
	private handleExplicitLineBreaks(segments: StyledSegment[]): StyledLine[] {
		const lines: StyledLine[] = []
		let currentLine: StyledSegment[] = []

		for (const segment of segments) {
			if (!segment.text || typeof segment.text !== 'string') {
				// Invalid segment, skip it
				continue
			}
			const textParts = segment.text.split('\n')

			for (let i = 0; i < textParts.length; i++) {
				if (i > 0) {
					// Add the newline character to the previous line
					if (currentLine.length > 0) {
						const lastSegment = currentLine[currentLine.length - 1]
						if (lastSegment) {
							lastSegment.text += '\n'
						}
					} else {
						// If current line is empty, add newline as its own segment
						currentLine.push({
							text: '\n',
							style: segment.style,
							hyperlink: segment.hyperlink,
						})
					}

					// Finish current line
					lines.push({
						segments: currentLine,
						alignment: this._textAlign,
					})
					currentLine = []
				}

				const textPart = textParts[i]
				if (textPart !== undefined && textPart.length > 0) {
					currentLine.push({
						text: textPart,
						style: segment.style,
						hyperlink: segment.hyperlink,
					})
				}
			}
		}

		// Add final line
		if (currentLine.length > 0) {
			lines.push({
				segments: currentLine,
				alignment: this._textAlign,
			})
		}

		// Handle empty case
		if (lines.length === 0) {
			lines.push({
				segments: [{ text: '', style: new TextStyle({ color: Colors.default() }) }],
				alignment: this._textAlign,
			})
		}

		return lines
	}

	/**
	 * Check if two text styles are equal.
	 */
	private stylesEqual(style1: TextStyle, style2: TextStyle): boolean {
		return (
			style1.color === style2.color &&
			style1.backgroundColor === style2.backgroundColor &&
			style1.bold === style2.bold &&
			style1.italic === style2.italic &&
			style1.underline === style2.underline &&
			style1.strikethrough === style2.strikethrough &&
			style1.dim === style2.dim
		)
	}

	private segmentsEqual(seg1: StyledSegment, seg2: StyledSegment): boolean {
		return (
			this.stylesEqual(seg1.style, seg2.style) &&
			((seg1.hyperlink?.uri === seg2.hyperlink?.uri &&
				seg1.hyperlink?.id === seg2.hyperlink?.id) ||
				(seg1.hyperlink === undefined && seg2.hyperlink === undefined))
		)
	}

	/**
	 * Split text into words while preserving whitespace.
	 */
	private splitIntoWords(text: string): string[] {
		const words: string[] = []
		let currentWord = ''
		let inWhitespace = false

		const graphemes = splitIntoGraphemes(text)
		for (const grapheme of graphemes) {
			const isWhitespace = /\s/.test(grapheme)

			if (isWhitespace !== inWhitespace) {
				if (currentWord.length > 0) {
					words.push(currentWord)
					currentWord = ''
				}
				inWhitespace = isWhitespace
			}

			currentWord += grapheme
		}

		if (currentWord.length > 0) {
			words.push(currentWord)
		}

		return words
	}

	/**
	 * Apply text overflow strategies to the last line when maxLines is exceeded.
	 */
	private applyTextOverflow(lines: StyledLine[], maxWidth: number): StyledLine[] {
		if (lines.length === 0) return lines

		const lastLine = lines[lines.length - 1]
		if (!lastLine) return lines
		const modifiedLines = [...lines]

		// Calculate ellipsis width
		const ellipsisWidth = getStringWidth('…', this._emojiWidthSupported)
		const availableWidth = maxWidth - ellipsisWidth

		// Truncate segments to fit within available width, then add ellipsis
		const truncatedSegments: StyledSegment[] = []
		let usedWidth = 0

		// Clip last line to maxWidth
		const clippedSegments: StyledSegment[] = []
		let remainingWidth = maxWidth

		switch (this._overflow) {
			case TextOverflow.ellipsis: {
				for (const segment of lastLine.segments) {
					const segmentWidth = getStringWidth(segment.text, this._emojiWidthSupported)

					if (usedWidth + segmentWidth <= availableWidth) {
						// Segment fits completely
						truncatedSegments.push(segment)
						usedWidth += segmentWidth
					} else if (usedWidth < availableWidth) {
						// Partial segment fits
						const remainingWidthForSegment = availableWidth - usedWidth
						const truncatedText = truncateText(
							segment.text,
							remainingWidthForSegment,
							this._emojiWidthSupported,
							'',
						)
						if (truncatedText.length > 0) {
							truncatedSegments.push({
								text: truncatedText,
								style: segment.style,
								hyperlink: segment.hyperlink,
							})
						}
						break
					} else {
						// No more space
						break
					}
				}

				// Add ellipsis as the last segment (use style from last segment or default)
				const lastSegment = lastLine.segments[lastLine.segments.length - 1]
				const ellipsisStyle =
					lastLine.segments.length > 0 && lastSegment
						? lastSegment.style
						: new TextStyle({ color: Colors.default() })
				truncatedSegments.push({ text: '…', style: ellipsisStyle })

				modifiedLines[modifiedLines.length - 1] = {
					segments: truncatedSegments,
					alignment: lastLine.alignment,
				}
				break
			}

			case TextOverflow.fade:
			// TODO: Implement fade effect (requires terminal capabilities)
			// For now, fall through to clip
			case TextOverflow.clip: {
				for (const segment of lastLine.segments) {
					if (remainingWidth <= 0) break

					const segmentWidth = getStringWidth(segment.text, this._emojiWidthSupported)
					if (segmentWidth <= remainingWidth) {
						clippedSegments.push(segment)
						remainingWidth -= segmentWidth
					} else {
						// Truncate this segment
						const clippedText = truncateText(
							segment.text,
							remainingWidth,
							this._emojiWidthSupported,
							'',
						)
						if (clippedText.length > 0) {
							clippedSegments.push({
								text: clippedText,
								style: segment.style,
								hyperlink: segment.hyperlink,
							})
						}
						break
					}
				}

				modifiedLines[modifiedLines.length - 1] = {
					segments: clippedSegments,
					alignment: lastLine.alignment,
				}
				break
			}

			case TextOverflow.visible:
			default:
				// No modification needed
				break
		}

		return modifiedLines
	}

	/**
	 * Extract styled segments from a TextSpan tree.
	 */
	private getStyledSegments(
		span: TextSpan,
		parentStyle: TextStyle,
		parentHyperlink?: Hyperlink,
	): StyledSegment[] {
		const segments: StyledSegment[] = []

		// Merge parent style with this span's style
		const effectiveStyle = parentStyle.merge(span.style)

		// Use this span's hyperlink, or inherit from parent
		const effectiveHyperlink = span.hyperlink ?? parentHyperlink

		// Add this span's text if it has any
		if (span.text) {
			segments.push({
				text: span.text,
				style: effectiveStyle,
				hyperlink: effectiveHyperlink,
			})
		}

		// Process children recursively
		if (span.children) {
			for (const child of span.children) {
				segments.push(...this.getStyledSegments(child, effectiveStyle, effectiveHyperlink))
			}
		}

		return segments
	}

	/**
	 * Build character positions for a single line and add to the global arrays.
	 */
	private _addLineCharacterPositions(line: StyledLine, lineIndex: number): void {
		// Calculate starting x position based on alignment
		let lineStartX = 0
		if (line.alignment === 'center' || line.alignment === 'right') {
			let totalLineWidth = 0
			for (const segment of line.segments) {
				totalLineWidth += getStringWidth(segment.text, this._emojiWidthSupported)
			}

			if (line.alignment === 'center') {
				lineStartX = Math.max(0, Math.floor((this.size.width - totalLineWidth) / 2))
			} else {
				lineStartX = Math.max(0, this.size.width - totalLineWidth)
			}
		}

		const lineStartIndex = this._characterPositions.length
		let currentX = lineStartX
		for (const segment of line.segments) {
			const graphemes = splitIntoGraphemes(segment.text)
			for (const grapheme of graphemes) {
				const charWidth = getCharWidth(grapheme, this._emojiWidthSupported)

				// Add position for all characters, including newlines
				this._characterPositions.push({
					x: currentX, // Newlines use same x position as they would have
					y: lineIndex,
					width: grapheme === '\n' ? 0 : charWidth, // Newlines have 0 width
				})

				// Only advance x position for non-newline characters
				if (grapheme !== '\n') {
					currentX += charWidth
				}
			}
		}
		const lineEndIndex = this._characterPositions.length - 1

		// Record visual line information
		if (lineEndIndex >= lineStartIndex) {
			this._visualLines.push({
				y: lineIndex,
				start: lineStartIndex,
				end: lineEndIndex,
			})
		}
	}

	/**
	 * Apply text overflow to cell lines when maxLines is exceeded
	 */
	private applyCellOverflow(lines: Cell[][], maxWidth: number): Cell[][] {
		if (lines.length === 0) return lines
		if (this._overflow === TextOverflow.visible) return lines

		const result = [...lines]
		const lastLine = result[result.length - 1]
		if (!lastLine) return result

		switch (this._overflow) {
			case TextOverflow.ellipsis: {
				// Calculate how much space we need for ellipsis
				const ellipsisWidth = getStringWidth('…', this._emojiWidthSupported)
				const availableWidth = maxWidth - ellipsisWidth

				// Truncate last line to fit ellipsis
				const truncatedCells: Cell[] = []
				let usedWidth = 0

				for (const cell of lastLine) {
					if (usedWidth + cell.width <= availableWidth) {
						truncatedCells.push(cell)
						usedWidth += cell.width
					} else {
						break
					}
				}

				// Add ellipsis cell (use style from last cell or default)
				const lastCell = lastLine[lastLine.length - 1]
				const ellipsisStyle = lastCell ? lastCell.style : {}
				truncatedCells.push(createCell('…', ellipsisStyle, ellipsisWidth))

				result[result.length - 1] = truncatedCells
				break
			}

			case TextOverflow.clip: {
				// Clip last line to maxWidth
				const clippedCells: Cell[] = []
				let usedWidth = 0

				for (const cell of lastLine) {
					if (usedWidth + cell.width <= maxWidth) {
						clippedCells.push(cell)
						usedWidth += cell.width
					} else {
						break
					}
				}

				result[result.length - 1] = clippedCells
				break
			}

			default:
				// No overflow handling needed
				break
		}

		return result
	}

	/**
	 * Check if a character at the given index is selected.
	 */
	private _isCharacterSelected(charIndex: number): boolean {
		if (this._selectionStart === null || this._selectionEnd === null) {
			return false
		}

		const start = Math.min(this._selectionStart, this._selectionEnd)
		const end = Math.max(this._selectionStart, this._selectionEnd)

		return charIndex >= start && charIndex < end
	}

	// === Selectable Interface Implementation ===

	/**
	 * Override attach to register with SelectionArea.
	 * Note: We'll register with SelectionArea when we have access to BuildContext
	 * through the element system.
	 */
	attach(): void {
		super.attach()
		// Registration with SelectionArea will happen when context is set
	}

	/**
	 * Set the BuildContext for this render object and register with SelectionArea.
	 * This should be called by the widget/element after creation.
	 */
	setContext(context: BuildContext): void {
		// Store context for accessing DimContext later
		this._context = context

		// Only register with SelectionArea if this RichText is selectable
		if (!this._selectable) {
			return
		}

		// Find and register with nearest SelectionArea
		const selectionArea = InheritedSelectionArea.of(context)

		if (selectionArea && !this.selectionArea) {
			this.selectionArea = selectionArea
			selectionArea.register(this)

			// Generate a unique ID if not already set
			if (this.selectableId <= 0) {
				this.selectableId = Math.floor(Math.random() * 1000000) + 1
			}
		}
	}

	/**
	 * Override detach to unregister from SelectionArea.
	 */
	detach(): void {
		if (this.selectionArea) {
			this.selectionArea.unregister(this)
			this.selectionArea = undefined
		}
		super.detach()
	}

	onAttachToSelectionArea(area: SelectionAreaController): void {
		// Called by SelectionAreaController after registration
		// Currently no additional setup needed
	}

	onDetachFromSelectionArea(area: SelectionAreaController): void {
		// Called by SelectionAreaController before unregistration
		// Currently no additional cleanup needed
	}

	globalBounds(): Rect {
		// Skip items that haven't been properly laid out (zero size indicates not visible/laid out)
		if (this.size.width <= 0 || this.size.height <= 0) {
			return EMPTY_RECT
		}

		// Get global position by walking up the parent chain
		let globalX = this.offset.x
		let globalY = this.offset.y

		// Walk up the render object parent chain to accumulate transforms
		let parent = this.parent
		while (parent) {
			if (parent instanceof RenderBox) {
				globalX += parent.offset.x
				globalY += parent.offset.y
			}
			parent = parent.parent
		}

		const bounds = {
			left: globalX,
			top: globalY,
			right: globalX + this.size.width,
			bottom: globalY + this.size.height,
		}

		return bounds
	}

	globalToLocal(point: Offset): Offset {
		// Convert global coordinates to local coordinates by subtracting global position
		let globalX = this.offset.x
		let globalY = this.offset.y

		// Walk up the parent chain to get true global position
		let parent = this.parent
		while (parent) {
			if (parent instanceof RenderBox) {
				globalX += parent.offset.x
				globalY += parent.offset.y
			}
			parent = parent.parent
		}

		return {
			x: point.x - globalX,
			y: point.y - globalY,
		}
	}

	hitTestSelection(localPoint: Offset): SelectableTextPosition | null {
		// Check if point is within this render object's bounds
		if (
			localPoint.x < 0 ||
			localPoint.y < 0 ||
			localPoint.x >= this.size.width ||
			localPoint.y >= this.size.height
		) {
			return null
		}

		// Use existing getOffsetForPosition method
		const offset = this.getOffsetForPosition(localPoint.x, localPoint.y)
		return offset !== null ? { offset } : null
	}

	nearestCaretPosition(localPoint: Offset): SelectableTextPosition {
		// Clamp coordinates to widget bounds
		const clampedX = Math.max(0, Math.min(localPoint.x, this.size.width))
		const clampedY = Math.max(0, Math.min(localPoint.y, this.size.height - 1))

		// Use existing getOffsetForPosition method with clamped coordinates
		let offset = this.getOffsetForPosition(clampedX, clampedY)

		// fallback: find the line and return end of that line
		if (offset === null) {
			// Find which visual line this Y position corresponds to
			const lineIndex = Math.floor(clampedY)
			const visualLine = this._visualLines.find((line) => line.y === lineIndex)

			if (visualLine) {
				// Return end of the clicked line
				offset = visualLine.end + 1
			} else {
				// Ultimate fallback to start of text
				offset = 0
			}
		}

		return { offset }
	}

	wordBoundary(pos: SelectableTextPosition): SelectableTextRange {
		const text = this.plainText
		const offset = Math.max(0, Math.min(pos.offset, text.length))

		// Find word boundaries using simple whitespace/punctuation rules
		let start = offset
		let end = offset

		// Move start backward to beginning of word
		while (start > 0) {
			const char = text[start - 1]
			if (!char || !/\w/.test(char)) break
			start--
		}

		// Move end forward to end of word
		while (end < text.length) {
			const char = text[end]
			if (!char || !/\w/.test(char)) break
			end++
		}

		// If we're not in a word, select the character at the offset
		if (start === end) {
			end = Math.min(offset + 1, text.length)
		}

		return { start, end }
	}

	lineBoundary(pos: SelectableTextPosition): SelectableTextRange {
		const text = this.plainText
		const offset = Math.max(0, Math.min(pos.offset, text.length))

		// Find logical line boundaries (text between \n characters)
		let start = 0
		let end = text.length

		// Find start of logical line (look backward for \n)
		for (let i = offset - 1; i >= 0; i--) {
			if (text[i] === '\n') {
				start = i + 1
				break
			}
		}

		// Find end of logical line (look forward for \n)
		for (let i = offset; i < text.length; i++) {
			if (text[i] === '\n') {
				end = i
				break
			}
		}

		return { start, end }
	}

	paragraphBoundary(pos: SelectableTextPosition): SelectableTextRange {
		const text = this.plainText
		const offset = Math.max(0, Math.min(pos.offset, text.length))

		// Find paragraph boundaries defined by double line breaks (\n\n) or start/end of text
		let start = 0
		let end = text.length

		// Find start of paragraph (look backward for \n\n)
		for (let i = offset - 1; i > 0; i--) {
			if (text[i] === '\n' && text[i - 1] === '\n') {
				start = i + 1
				break
			}
		}

		// Find end of paragraph (look forward for \n\n)
		for (let i = offset; i < text.length - 1; i++) {
			if (text[i] === '\n' && text[i + 1] === '\n') {
				end = i
				break
			}
		}

		return { start, end }
	}

	getSelectionContext(): 'paragraph' | 'line' {
		// If the text contains newlines, it's likely a text block where paragraph selection makes sense
		// Otherwise, it's probably a single line or list item where line selection is more appropriate
		return this.plainText.includes('\n') ? 'paragraph' : 'line'
	}

	textLength(): number {
		return this.plainText.length
	}

	getText(range?: SelectableTextRange): string {
		const text = this.plainText
		if (!range) {
			return text
		}

		const start = Math.max(0, Math.min(range.start, text.length))
		const end = Math.max(start, Math.min(range.end, text.length))

		return text.slice(start, end)
	}

	setSelectedRanges(ranges: SelectableTextRange[]): void {
		// Update selection ranges if they changed
		if (!this._rangesEqual(this._selectedRanges, ranges)) {
			this._selectedRanges = ranges

			// Convert to legacy selection format for compatibility with existing paint code
			if (ranges.length > 0) {
				// For simplicity, use the first range
				// TODO: Support multiple ranges in the paint system
				const range = ranges[0]
				if (range) {
					this.updateSelection(range.start, range.end, HighlightMode.SELECTION)
				} else {
					this.updateSelection(null, null, HighlightMode.SELECTION)
				}
			} else {
				this.updateSelection(null, null, HighlightMode.SELECTION)
			}
		}
	}

	/**
	 * Helper method to compare range arrays for equality.
	 */
	private _rangesEqual(a: SelectableTextRange[], b: SelectableTextRange[]): boolean {
		if (a.length !== b.length) return false

		for (let i = 0; i < a.length; i++) {
			const rangeA = a[i]
			const rangeB = b[i]
			if (!rangeA || !rangeB || rangeA.start !== rangeB.start || rangeA.end !== rangeB.end) {
				return false
			}
		}

		return true
	}

	dispose(): void {
		// Clear text references to help GC
		this._text = new TextSpan('')
		this._cachedStyledCells = undefined
		this._characterPositions = []
		this._visualLines = []
		this._selectionStart = null
		this._selectionEnd = null

		super.dispose()
	}
}

/**
 * A segment of text with a specific style.
 */
export interface StyledSegment {
	text: string
	style: TextStyle
	hyperlink?: Hyperlink
}

/**
 * A line of text with styling information for rendering.
 */
export interface StyledLine {
	segments: StyledSegment[]
	alignment: TextAlign
}

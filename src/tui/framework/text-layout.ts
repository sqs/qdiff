import { getCharWidth, splitIntoGraphemes } from '../lib/text-utils.js'

/**
 * Represents a single line of text with layout information.
 */
export interface TextLine {
	/** Start offset in the source text (in graphemes) */
	startOffset: number
	/** End offset in the source text (in graphemes) */
	endOffset: number
	/** Visual width of the line in terminal cells */
	width: number
	/** Whether this line ends with a hard break (newline) */
	isHardBreak: boolean
}

/**
 * Layout mode for text wrapping.
 */
export enum TextWrapMode {
	/** No wrapping, only respect hard line breaks (\n) */
	NONE = 'none',
	/** Wrap at word boundaries when possible */
	WORD = 'word',
	/** Wrap at any character when needed */
	CHARACTER = 'character',
}

/**
 * Configuration for text layout.
 */
export interface TextLayoutConfig {
	/** Maximum width in terminal cells */
	maxWidth: number
	/** Text wrapping mode */
	wrapMode: TextWrapMode
	/** Whether emoji width calculation is supported */
	emojiSupported?: boolean
}

/**
 * Shared text layout engine for TextField and RichText widgets.
 * Computes line breaks, wrapping, and layout information.
 */
export class TextLayoutEngine {
	private _text: string = ''
	private _config: TextLayoutConfig
	private _lines: TextLine[] | null = null
	private _graphemes: string[] | null = null

	constructor(text: string, config: TextLayoutConfig) {
		this._text = text
		this._config = config
	}

	/** Update text and invalidate cache */
	updateText(text: string): void {
		if (this._text !== text) {
			this._text = text
			this._invalidateCache()
		}
	}

	/** Update configuration and invalidate cache */
	updateConfig(config: TextLayoutConfig): void {
		if (JSON.stringify(this._config) !== JSON.stringify(config)) {
			this._config = config
			this._invalidateCache()
		}
	}

	/** Get computed lines with layout information */
	get lines(): TextLine[] {
		if (this._lines === null) {
			this._computeLines()
		}
		return this._lines!
	}

	/** Get graphemes array (cached) */
	get graphemes(): string[] {
		if (this._graphemes === null) {
			this._graphemes = splitIntoGraphemes(this._text)
		}
		return this._graphemes
	}

	/** Get line count */
	getLineCount(): number {
		return this._text.split('\n').length
	}

	/** Get specific line information */
	getLine(index: number): TextLine | null {
		const lines = this.lines
		return index >= 0 && index < lines.length ? (lines[index] ?? null) : null
	}

	/** Convert offset to line index */
	offsetToLineIndex(offset: number): number {
		const lines = this.lines
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (line && offset >= line.startOffset && offset <= line.endOffset) {
				return i
			}
		}
		return Math.max(0, lines.length - 1)
	}

	/** Convert offset to line/column position */
	offsetToPosition(offset: number): { line: number; column: number } {
		const graphemes = this.graphemes
		let lineIndex = 0
		let columnIndex = 0

		for (let i = 0; i < offset && i < graphemes.length; i++) {
			if (graphemes[i] === '\n') {
				lineIndex++
				columnIndex = 0
			} else {
				columnIndex++
			}
		}

		return {
			line: lineIndex,
			column: columnIndex,
		}
	}

	/** Convert line/column position to offset */
	positionToOffset(line: number, column: number): number {
		const graphemes = this.graphemes
		let currentLine = 0
		let currentColumn = 0

		// Walk through graphemes to find the target position
		for (let i = 0; i <= graphemes.length; i++) {
			// Check if we've reached the target position
			if (currentLine === line && currentColumn === column) {
				return i
			}

			// If we're past the target line, clamp to end of target line
			if (currentLine > line) {
				return i
			}

			// If we're at the end, return current position
			if (i >= graphemes.length) {
				return i
			}

			// Process current character and update position for NEXT iteration
			if (graphemes[i] === '\n') {
				currentLine++
				currentColumn = 0
			} else {
				currentColumn++
			}
		}

		return graphemes.length
	}

	/** Get text content for a specific line */
	getLineText(lineIndex: number): string {
		const lines = this._text.split('\n')
		return lineIndex >= 0 && lineIndex < lines.length ? (lines[lineIndex] ?? '') : ''
	}

	/** Invalidate internal caches */
	private _invalidateCache(): void {
		this._lines = null
		this._graphemes = null
	}

	/** Compute line layout information */
	private _computeLines(): void {
		const graphemes = this.graphemes
		const { maxWidth, wrapMode, emojiSupported = false } = this._config

		this._lines = []

		if (graphemes.length === 0) {
			// Empty text has one empty line
			this._lines.push({
				startOffset: 0,
				endOffset: 0,
				width: 0,
				isHardBreak: false,
			})
			return
		}

		let currentLineStart = 0
		let currentLineWidth = 0
		let i = 0

		while (i < graphemes.length) {
			const grapheme = graphemes[i]
			if (!grapheme) {
				i++
				continue
			}

			// Handle hard line breaks (newlines)
			if (grapheme === '\n') {
				this._lines.push({
					startOffset: currentLineStart,
					endOffset: i,
					width: currentLineWidth,
					isHardBreak: true,
				})
				currentLineStart = i + 1
				currentLineWidth = 0
				i++
				continue
			}

			const charWidth = getCharWidth(grapheme, emojiSupported)

			// Check if adding this character would exceed maxWidth
			if (
				wrapMode !== TextWrapMode.NONE &&
				currentLineWidth + charWidth > maxWidth &&
				currentLineWidth > 0
			) {
				let wrapPoint = i

				// For word wrapping, try to find a better break point
				if (wrapMode === TextWrapMode.WORD) {
					const wordWrapPoint = this._findWordWrapPoint(graphemes, currentLineStart, i)

					if (wordWrapPoint < i) {
						// Found a word boundary - check if the next word is longer than maxWidth
						const nextWordLength = this._getNextWordLength(
							graphemes,
							wordWrapPoint,
							emojiSupported,
						)

						if (nextWordLength > maxWidth) {
							// Next word is too long to fit on any line - fill current line and break mid-word
							wrapPoint = this._fillToCapacity(
								graphemes,
								currentLineStart,
								maxWidth,
								emojiSupported,
							)
						} else {
							// Next word can fit on a line - use word boundary
							wrapPoint = wordWrapPoint
						}
					} else {
						// No word boundary found - fill the line to capacity
						wrapPoint = this._fillToCapacity(
							graphemes,
							currentLineStart,
							maxWidth,
							emojiSupported,
						)
					}
				}

				// Create line up to wrap point
				const lineWidth = this._calculateLineWidth(
					graphemes,
					currentLineStart,
					wrapPoint,
					emojiSupported,
				)
				this._lines.push({
					startOffset: currentLineStart,
					endOffset: wrapPoint,
					width: lineWidth,
					isHardBreak: false,
				})

				// Start new line at wrap point
				currentLineStart = wrapPoint

				// Skip whitespace only if we wrapped at a word boundary (not mid-word)
				if (wrapMode === TextWrapMode.WORD) {
					// Check if we have a space at the wrap point - indicates word boundary wrap
					if (
						currentLineStart < graphemes.length &&
						graphemes[currentLineStart] &&
						/\s/.test(graphemes[currentLineStart]!)
					) {
						// Skip whitespace at the beginning of wrapped lines
						while (
							currentLineStart < graphemes.length &&
							graphemes[currentLineStart] &&
							/\s/.test(graphemes[currentLineStart]!)
						) {
							currentLineStart++
						}
					}
				}

				currentLineWidth = 0
				i = currentLineStart
				continue
			}

			currentLineWidth += charWidth
			i++
		}

		// Add final line if there's remaining content or if text ends with newline
		// When text ends with a newline, we need an empty line for the cursor to sit on
		const endsWithNewline = graphemes.length > 0 && graphemes[graphemes.length - 1] === '\n'

		if (currentLineStart < graphemes.length || this._lines.length === 0 || endsWithNewline) {
			this._lines.push({
				startOffset: currentLineStart,
				endOffset: graphemes.length,
				width: currentLineWidth,
				isHardBreak: false,
			})
		}
	}

	/** Find optimal word wrap point working backwards from current position */
	private _findWordWrapPoint(graphemes: string[], lineStart: number, currentPos: number): number {
		// Look backwards for whitespace to break at
		for (let i = currentPos - 1; i > lineStart; i--) {
			if (graphemes[i] && /\s/.test(graphemes[i]!)) {
				// Skip consecutive whitespace
				while (i > lineStart && graphemes[i] && /\s/.test(graphemes[i]!)) {
					i--
				}
				return i + 1
			}
		}

		// No good word boundary found, break at current position
		return currentPos
	}

	/** Get the length of the next word starting at the given position */
	private _getNextWordLength(
		graphemes: string[],
		startPos: number,
		emojiSupported: boolean,
	): number {
		let length = 0
		let i = startPos

		// Skip leading whitespace to find start of next word
		while (i < graphemes.length && graphemes[i] && /\s/.test(graphemes[i]!)) {
			i++
		}

		// Measure the word until we hit whitespace or end
		while (i < graphemes.length && graphemes[i] && !/\s/.test(graphemes[i]!)) {
			const grapheme = graphemes[i]
			if (!grapheme || grapheme === '\n') break
			length += getCharWidth(grapheme, emojiSupported)
			i++
		}

		return length
	}

	/** Fill the current line to capacity and return the wrap point */
	private _fillToCapacity(
		graphemes: string[],
		lineStart: number,
		maxWidth: number,
		emojiSupported: boolean,
	): number {
		let currentWidth = 0
		let lastFitIndex = lineStart

		for (let i = lineStart; i < graphemes.length; i++) {
			const grapheme = graphemes[i]
			if (!grapheme) continue

			// Don't cross hard line breaks
			if (grapheme === '\n') {
				break
			}

			const charWidth = getCharWidth(grapheme, emojiSupported)

			// Check if adding this character would exceed maxWidth
			if (currentWidth + charWidth > maxWidth) {
				break
			}

			currentWidth += charWidth
			lastFitIndex = i + 1 // Position after this character
		}

		return lastFitIndex
	}

	/** Calculate visual width of a line segment */
	private _calculateLineWidth(
		graphemes: string[],
		start: number,
		end: number,
		emojiSupported: boolean,
	): number {
		let width = 0
		for (let i = start; i < end; i++) {
			const grapheme = graphemes[i]
			if (grapheme && grapheme !== '\n') {
				// Don't count newlines
				width += getCharWidth(grapheme, emojiSupported)
			}
		}
		return width
	}
}

/**
 * Text Width Calculation Utilities
 * Handles proper width calculation for emoji and Unicode characters using:
 *
 * - Unicode Property Escapes for accurate character classification
 * - Comprehensive East Asian Width ranges for CJK characters
 * - Per-character caching for performance
 * - Proper grapheme cluster and variation selector handling
 */

import { isJetBrainsTerminal } from '../ide-environment.js'
import { TAB_WIDTH } from './screen.js'

// Character width cache - maps grapheme string to display width
const charWidthCache = new Map<string, number>()

/** Check if a character is an emoji using Unicode properties */
export function isEmoji(char: string): boolean {
	// Use Unicode property escapes - supported in Node.js 10+ (we require 18+)
	// \p{Extended_Pictographic} covers the broadest range of emoji characters
	return /\p{Extended_Pictographic}/u.test(char)
}

/** Check if a code point has default text presentation (width 1) */
function hasDefaultTextPresentation(codePoint: number): boolean {
	// Characters that are in Extended_Pictographic but have default text presentation
	// Based on Unicode emoji data - these render as text by default
	return (
		// Geometric shapes (triangles, etc.) - typically text presentation
		(codePoint >= 0x25a0 && codePoint <= 0x25ff) ||
		// Miscellaneous symbols that are traditionally text
		(codePoint >= 0x2600 &&
			codePoint <= 0x26ff &&
			// Exclude weather symbols which are typically emoji
			!(
				codePoint >= 0x2600 &&
				codePoint <= 0x26ff &&
				(codePoint === 0x2600 ||
					codePoint === 0x2601 ||
					codePoint === 0x26a1 ||
					codePoint === 0x2744 ||
					codePoint === 0x26c4 ||
					codePoint === 0x26c5)
			)) ||
		// Arrows and mathematical symbols
		(codePoint >= 0x2190 && codePoint <= 0x21ff) ||
		// Heavy multiplication X - displays as text width in most terminals
		codePoint === 0x2716
	)
}

/** Check if a character is a combining mark using Unicode properties */
export function isCombining(char: string): boolean {
	// \p{M} matches all combining marks (Mark category)
	return /\p{M}/u.test(char)
}

/**
 * Calculate display width of a grapheme cluster (no caching - used internally)
 * Properly handles variation selectors, grapheme clusters, and emoji sequences
 *
 * Based on modern Unicode width calculation:
 * 1. If emojiWidthSupported=true: treat as grapheme, return width of first non-zero codepoint
 * 2. If emojiWidthSupported=false: sum all individual codepoint widths
 * 3. Handle emoji text/presentation variation selectors
 * 4. Apply East Asian Width rules for CJK characters
 */
function getCharWidthSlow(grapheme: string, emojiWidthSupported: boolean = true): number {
	if (!grapheme) return 0

	const codePoints = Array.from(grapheme)

	if (emojiWidthSupported) {
		// Terminal supports grapheme segmentation - return width of grapheme cluster
		let graphemeWidth = 0

		for (let i = 0; i < codePoints.length; i++) {
			const char = codePoints[i]
			if (!char) continue

			const codePoint = char.codePointAt(0)
			if (!codePoint) continue

			let width = getCodePointWidth(codePoint)

			if (width !== 0) {
				// Handle emoji text/presentation variation selectors
				if (i + 1 < codePoints.length) {
					const nextChar = codePoints[i + 1]
					const nextCodePoint = nextChar?.codePointAt(0)
					if (nextCodePoint === 0xfe0e) {
						// Text presentation selector - force narrow width
						width = 1
					} else if (nextCodePoint === 0xfe0f) {
						// Emoji presentation selector - force emoji width
						width = 2
					}
				}

				// Only use width of first non-zero-width code point in grapheme cluster
				if (graphemeWidth === 0) {
					graphemeWidth = width
					break
				}
			}
		}

		return graphemeWidth
	} else {
		// Terminal doesn't support grapheme segmentation - sum individual codepoint widths
		let totalWidth = 0

		for (const char of codePoints) {
			if (!char) continue

			const codePoint = char.codePointAt(0)
			if (!codePoint) continue

			totalWidth += getCodePointWidth(codePoint)
		}

		return totalWidth
	}
}

/** Get the display width of a single Unicode code point */
function getCodePointWidth(codePoint: number): number {
	// Tab character - use global tab width
	if (codePoint === 0x09) {
		return TAB_WIDTH
	}

	// Zero-width characters
	if (
		// Combining marks - use Unicode property for accuracy
		isCombining(String.fromCodePoint(codePoint)) ||
		// Zero-width joiner
		codePoint === 0x200d ||
		// Variation selectors (always 0 width by themselves)
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		(codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
		// Skin tone modifiers (Fitzpatrick scale)
		(codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
	) {
		return 0
	}

	// Emoji and pictographic characters
	if (isEmojiCodePoint(codePoint)) {
		// JetBrains terminal treats older Unicode emoji (Miscellaneous Symbols/Dingbats)
		// as narrow even if they have default emoji presentation
		if (isJetBrainsTerminal() && codePoint >= 0x2600 && codePoint <= 0x27bf) {
			return 1
		}

		// Check if this character has default text presentation
		if (hasDefaultTextPresentation(codePoint)) {
			return 1
		}
		return 2
	}

	// East Asian Wide characters (based on UAX #11)
	if (isWideCharacter(codePoint)) {
		return 2
	}

	// Default to narrow width
	return 1
}

/** Check if a code point is an emoji using Unicode properties */
function isEmojiCodePoint(codePoint: number): boolean {
	const char = String.fromCodePoint(codePoint)
	return isEmoji(char)
}

/**
 * Check if a code point represents a wide character (East Asian Width)
 * Note: East_Asian_Width Unicode properties are not supported in JavaScript regex,
 * so we use manual ranges based on UAX #11
 */
function isWideCharacter(codePoint: number): boolean {
	return (
		// CJK Unified Ideographs
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
		// CJK Extension A
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
		// CJK Extension B
		(codePoint >= 0x20000 && codePoint <= 0x2a6df) ||
		// CJK Extension C
		(codePoint >= 0x2a700 && codePoint <= 0x2b73f) ||
		// CJK Extension D
		(codePoint >= 0x2b740 && codePoint <= 0x2b81f) ||
		// CJK Extension E
		(codePoint >= 0x2b820 && codePoint <= 0x2ceaf) ||
		// CJK Extension F
		(codePoint >= 0x2ceb0 && codePoint <= 0x2ebef) ||
		// Hangul Syllables
		(codePoint >= 0xac00 && codePoint <= 0xd7af) ||
		// Hiragana
		(codePoint >= 0x3040 && codePoint <= 0x309f) ||
		// Katakana
		(codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
		// Katakana Phonetic Extensions
		(codePoint >= 0x31f0 && codePoint <= 0x31ff) ||
		// Fullwidth Forms
		(codePoint >= 0xff00 && codePoint <= 0xffef) ||
		// CJK Symbols and Punctuation (wide characters)
		(codePoint >= 0x3000 && codePoint <= 0x303f) ||
		// Halfwidth and Fullwidth Forms (fullwidth portion)
		(codePoint >= 0xff01 && codePoint <= 0xff60) ||
		// Additional wide punctuation and symbols
		codePoint === 0x2329 || // Left-pointing angle bracket
		codePoint === 0x232a || // Right-pointing angle bracket
		// Regional indicator symbols (flag emoji components)
		(codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff)
	)
}

/** Calculate display width of a character (cached for performance) */
export function getCharWidth(char: string, emojiWidthSupported: boolean = true): number {
	// Check cache first
	const cached = charWidthCache.get(char)
	if (cached !== undefined) {
		return cached
	}

	// Calculate width using Unicode properties or manual ranges
	const width = getCharWidthSlow(char, emojiWidthSupported)

	// Cache the result
	charWidthCache.set(char, width)
	return width
}

// Global singleton segmenter. Reuse this instance to prevent loading unicode
// database frequently
let cachedSegmenter: any | null = null

/** Split text into graphemes using Intl.Segmenter if available */
export function splitIntoGraphemes(text: string): string[] {
	try {
		if (!cachedSegmenter) {
			const IntlAny: any = Intl
			cachedSegmenter = new IntlAny.Segmenter('en', { granularity: 'grapheme' })
		}
		return Array.from(cachedSegmenter.segment(text), (s: any) => s.segment)
	} catch (e) {
		// Fallback: split into codepoints
		return Array.from(text)
	}
}

/** Calculate display width of a string using Unicode-aware character width calculation */
export function getStringWidth(text: string, emojiWidthSupported: boolean = true): number {
	let width = 0

	// Split text into graphemes and calculate width of each
	const graphemes = splitIntoGraphemes(text)
	for (const grapheme of graphemes) {
		width += getCharWidth(grapheme, emojiWidthSupported)
	}

	return width
}

/** Truncate text to fit within a specified width */
export function truncateText(
	text: string,
	maxWidth: number,
	emojiWidthSupported: boolean = true,
	ellipsis: string = '…',
): string {
	if (maxWidth <= 0) return ''

	let currentWidth = 0
	let result = ''

	// Use proper grapheme segmentation instead of codepoint iteration
	const graphemes = splitIntoGraphemes(text)

	for (const grapheme of graphemes) {
		const graphemeWidth = getCharWidth(grapheme, emojiWidthSupported)

		// Check if adding this grapheme would exceed the limit
		if (currentWidth + graphemeWidth > maxWidth) {
			// If we have space for ellipsis, add it
			const ellipsisWidth = getStringWidth(ellipsis, emojiWidthSupported)
			if (currentWidth + ellipsisWidth <= maxWidth) {
				result += ellipsis
			}
			break
		}

		result += grapheme
		currentWidth += graphemeWidth
	}

	return result
}

/** Pad text to a specific width */
export function padText(
	text: string,
	width: number,
	emojiWidthSupported: boolean = true,
	align: 'left' | 'center' | 'right' = 'left',
	fillChar: string = ' ',
): string {
	const textWidth = getStringWidth(text, emojiWidthSupported)

	if (textWidth >= width) {
		return text
	}

	const padding = width - textWidth
	const fillCharWidth = getCharWidth(fillChar, emojiWidthSupported)
	const fillCount = Math.floor(padding / fillCharWidth)

	switch (align) {
		case 'center': {
			const leftPad = Math.floor(fillCount / 2)
			const rightPad = fillCount - leftPad
			return fillChar.repeat(leftPad) + text + fillChar.repeat(rightPad)
		}
		case 'right': {
			return fillChar.repeat(fillCount) + text
		}
		default: // 'left'
			return text + fillChar.repeat(fillCount)
	}
}

import { VTLexer } from '../../lib/parser/lexer.js'
import type { CsiEvent, CsiParam, ParserEvent } from '../../lib/parser/types.js'
import type { Color, Hyperlink } from '../../lib/screen.js'
import { Colors } from '../../lib/screen.js'
import type { Key } from '../key.js'
import { RichText, TextSpan, TextStyle } from './rich-text.js'

/**
 * Creates a RichText widget that parses ANSI escape sequences and renders styled text.
 *
 * Supports:
 * - SGR (Select Graphic Rendition) sequences for text styling
 * - OSC 8 sequences for hyperlinks
 * - Strips all other escape sequences
 */
export function AnsiText({
	key,
	text,
	textAlign,
	maxLines,
	overflow,
}: {
	key?: Key
	text: string
	textAlign?: import('./rich-text.js').TextAlign
	maxLines?: number
	overflow?: import('./rich-text.js').TextOverflow
}): RichText {
	const parsedSpan = parseAnsiString(text)
	return new RichText({
		key,
		text: parsedSpan,
		textAlign,
		maxLines,
		overflow,
	})
}

/**
 * Parse an ANSI string into a styled TextSpan tree.
 */
export function parseAnsiString(ansiString: string): TextSpan {
	const lexer = new VTLexer()
	const segments: AnsiSegment[] = []

	// Current style state
	let currentStyle = new TextStyle()
	let currentHyperlink: Hyperlink | undefined
	let currentText = ''

	// Add a segment when we encounter style changes or the end
	const addSegment = () => {
		if (currentText.length > 0) {
			segments.push({
				text: currentText,
				style: currentStyle,
				hyperlink: currentHyperlink,
			})
			currentText = ''
		}
	}

	lexer.onEvent((event: ParserEvent) => {
		switch (event.type) {
			case 'print':
				// Accumulate printable text
				currentText += event.grapheme
				break

			case 'execute':
				// Handle certain control characters as printable text
				if (event.code === 0x0a) {
					// Line Feed (LF) - treat as newline in text
					currentText += '\n'
				} else if (event.code === 0x09) {
					// Tab (HT) - treat as tab in text
					currentText += '\t'
				}
				// Ignore carriage returns (0x0d) and all other execute events
				break

			case 'csi':
				// Handle SGR sequences
				if (event.final === 'm') {
					addSegment()
					currentStyle = applySgrSequence(currentStyle, event)
				}
				// Ignore all other CSI sequences
				break

			case 'osc': {
				// Handle OSC 8 hyperlinks
				const hyperlinkResult = parseOsc8Sequence(event.data)
				if (hyperlinkResult !== null) {
					addSegment()
					currentHyperlink = hyperlinkResult // Can be undefined to clear hyperlink
				}
				break
			}

			// Ignore all other escape sequences
			case 'escape':
			case 'dcs':
				break
		}
	})

	// Parse the input
	lexer.parse(ansiString)
	lexer.flush()

	// Add final segment
	addSegment()

	// Convert segments to TextSpan tree
	if (segments.length === 0) {
		return new TextSpan('')
	}

	if (segments.length === 1) {
		const segment = segments[0]!
		return new TextSpan(segment.text, segment.style, undefined, segment.hyperlink)
	}

	// Multiple segments - create a root span with children
	const children = segments.map(
		(segment) => new TextSpan(segment.text, segment.style, undefined, segment.hyperlink),
	)
	return new TextSpan(undefined, undefined, children)
}

/**
 * Apply SGR (Select Graphic Rendition) sequence to current style.
 */
function applySgrSequence(currentStyle: TextStyle, event: CsiEvent): TextStyle {
	// Flatten parameters and subparameters into a single array
	const params = flattenCsiParams(event.params)

	// If no parameters, default to reset (SGR 0)
	if (params.length === 0) {
		params.push(0)
	}

	let newStyle = currentStyle

	for (let i = 0; i < params.length; i++) {
		const param = params[i]!

		switch (param) {
			case 0: // Reset all
				newStyle = new TextStyle()
				break
			case 1: // Bold
				newStyle = newStyle.copyWith({ bold: true })
				break
			case 2: // Dim
				newStyle = newStyle.copyWith({ dim: true })
				break
			case 3: // Italic
				newStyle = newStyle.copyWith({ italic: true })
				break
			case 4: // Underline
				newStyle = newStyle.copyWith({ underline: true })
				break
			case 9: // Strikethrough
				newStyle = newStyle.copyWith({ strikethrough: true })
				break
			case 22: // Normal intensity (reset bold/dim)
				newStyle = newStyle.copyWith({ bold: false, dim: false })
				break
			case 23: // Not italic
				newStyle = newStyle.copyWith({ italic: false })
				break
			case 24: // Not underlined
				newStyle = newStyle.copyWith({ underline: false })
				break
			case 29: // Not strikethrough
				newStyle = newStyle.copyWith({ strikethrough: false })
				break
			case 30:
			case 31:
			case 32:
			case 33:
			case 34:
			case 35:
			case 36:
			case 37:
				// Standard foreground colors (30-37)
				newStyle = newStyle.copyWith({ color: Colors.index(param - 30) })
				break
			case 38: {
				// Extended foreground color
				const fgColor = parseExtendedColor(params, i)
				if (fgColor.color) {
					newStyle = newStyle.copyWith({ color: fgColor.color })
				}
				i = fgColor.nextIndex
				break
			}
			case 39: // Default foreground
				newStyle = newStyle.copyWith({ color: Colors.default() })
				break
			case 40:
			case 41:
			case 42:
			case 43:
			case 44:
			case 45:
			case 46:
			case 47:
				// Standard background colors (40-47)
				newStyle = newStyle.copyWith({ backgroundColor: Colors.index(param - 40) })
				break
			case 48: {
				// Extended background color
				const bgColor = parseExtendedColor(params, i)
				if (bgColor.color) {
					newStyle = newStyle.copyWith({ backgroundColor: bgColor.color })
				}
				i = bgColor.nextIndex
				break
			}
			case 49: // Default background
				newStyle = newStyle.copyWith({ backgroundColor: Colors.default() })
				break
			case 90:
			case 91:
			case 92:
			case 93:
			case 94:
			case 95:
			case 96:
			case 97:
				// Bright foreground colors (90-97)
				newStyle = newStyle.copyWith({ color: Colors.index(param - 90 + 8) })
				break
			case 100:
			case 101:
			case 102:
			case 103:
			case 104:
			case 105:
			case 106:
			case 107:
				// Bright background colors (100-107)
				newStyle = newStyle.copyWith({ backgroundColor: Colors.index(param - 100 + 8) })
				break
			// Ignore unknown parameters
		}
	}

	return newStyle
}

/**
 * Flatten CSI parameters and subparameters into a single array.
 * This handles both semicolon (38;2;255;128;0) and colon (38:2:255:128:0) delimited sequences.
 */
function flattenCsiParams(params: CsiParam[]): number[] {
	const result: number[] = []

	for (const param of params) {
		result.push(param.value)
		if (param.subparams) {
			result.push(...param.subparams)
		}
	}

	return result
}

/**
 * Parse extended color sequences (38;2;r;g;b or 38;5;index).
 * Also handles colon-delimited sequences with optional empty parameters like 38:2::r:g:b
 */
function parseExtendedColor(
	params: number[],
	startIndex: number,
): { color: Color | null; nextIndex: number } {
	if (startIndex + 1 >= params.length) {
		return { color: null, nextIndex: startIndex }
	}

	const colorType = params[startIndex + 1]!

	if (colorType === 2) {
		// RGB color: 38;2;r;g;b or 38:2:r:g:b or 38:2::r:g:b (with optional transparency param)
		// Look for the RGB values, skipping any intermediate parameters
		const rgbStartIndex = startIndex + 2
		const availableParams = params.length - rgbStartIndex

		// Handle case where there might be an extra transparency/reserved parameter
		// Common patterns: 38;2;r;g;b or 38:2::r:g:b
		if (availableParams >= 4) {
			// Check if we have 4 parameters (transparency + RGB) vs 3 (just RGB)
			// Try the 4-parameter version first (38:2::r:g:b)
			const r = params[rgbStartIndex + 1] ?? 0
			const g = params[rgbStartIndex + 2] ?? 0
			const b = params[rgbStartIndex + 3] ?? 0
			return { color: Colors.rgb(r, g, b), nextIndex: startIndex + 5 }
		} else if (availableParams >= 3) {
			// Standard 3-parameter RGB (38;2;r;g;b)
			const r = params[rgbStartIndex] ?? 0
			const g = params[rgbStartIndex + 1] ?? 0
			const b = params[rgbStartIndex + 2] ?? 0
			return { color: Colors.rgb(r, g, b), nextIndex: startIndex + 4 }
		}

		return { color: null, nextIndex: startIndex + 1 }
	} else if (colorType === 5) {
		// Indexed color: 38;5;index or 38:5:index or 38:5::index
		const indexStartPos = startIndex + 2
		const availableParams = params.length - indexStartPos

		if (availableParams >= 2) {
			// Handle case with empty parameter: 38:5::index
			const index = params[indexStartPos + 1] ?? 0
			return { color: Colors.index(index), nextIndex: startIndex + 4 }
		} else if (availableParams >= 1) {
			// Standard case: 38;5;index
			const index = params[indexStartPos] ?? 0
			return { color: Colors.index(index), nextIndex: startIndex + 2 }
		}

		return { color: null, nextIndex: startIndex + 1 }
	}

	return { color: null, nextIndex: startIndex + 1 }
}

/**
 * Parse OSC 8 hyperlink sequence.
 * Format: OSC 8 ; params ; URI ST
 * Where params can include id=value
 */
function parseOsc8Sequence(data: string): Hyperlink | null | undefined {
	const parts = data.split(';')

	if (parts.length < 2 || parts[0] !== '8') {
		return null
	}

	const params = parts[1] ?? ''
	const uri = parts.slice(2).join(';')

	// If URI is empty, this ends a hyperlink
	if (!uri) {
		return undefined // Explicitly return undefined to clear hyperlink
	}

	// Parse id parameter if present
	let id = ''
	if (params) {
		const idMatch = params.match(/id=([^:;]+)/)
		if (idMatch) {
			id = idMatch[1] ?? ''
		}
	}

	return { uri, id }
}

/**
 * Internal segment representation during parsing.
 */
interface AnsiSegment {
	text: string
	style: TextStyle
	hyperlink?: Hyperlink
}

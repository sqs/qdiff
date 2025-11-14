/**
 * Terminal renderer - converts screen diffs to ANSI escape sequences
 */

import { assert } from './assert.js'
import type { CellDiff, Color, Hyperlink, Style } from './screen.js'
import { hyperlinkEndSequence, hyperlinksEqual, hyperlinkStartSequence, TAB_WIDTH } from './screen.js'
import { StringBuilder } from './string-builder.js'
import type { TerminalCapabilities } from './terminal-queries.js'

/** ANSI escape sequence constants */
const ESC = '\x1b'
const CSI = '\x1b['

/** Reset all styles */
const RESET = CSI + '0m'
const RESET_SIMPLE = CSI + 'm'

/** Cursor movement */
const CURSOR_TO = (row: number, col: number) => CSI + `${row + 1};${col + 1}H`
const CURSOR_HOME = CSI + 'H'
const HIDE_CURSOR = CSI + '?25l'
const SHOW_CURSOR = CSI + '?25h'

/** Screen operations */
const CLEAR_SCREEN = CSI + '2J'

/** Synchronized output control */
const SYNC_START = CSI + '?2026h'
const SYNC_END = CSI + '?2026l'

/** Bracketed paste control */
const BRACKETED_PASTE_ENABLE = CSI + '?2004h'
const BRACKETED_PASTE_DISABLE = CSI + '?2004l'

/** 256-color palette RGB values (colors 16-255) */
const COLOR_PALETTE_256: Array<[number, number, number]> = [
	// Colors 16-231: 6x6x6 color cube
	...Array.from({ length: 216 }, (_, i) => {
		const r = Math.floor(i / 36)
		const g = Math.floor((i % 36) / 6)
		const b = i % 6
		const toRgb = (val: number) => (val === 0 ? 0 : 55 + val * 40)
		return [toRgb(r), toRgb(g), toRgb(b)] as [number, number, number]
	}),
	// Colors 232-255: grayscale ramp
	...Array.from({ length: 24 }, (_, i) => {
		const gray = 8 + i * 10
		return [gray, gray, gray] as [number, number, number]
	}),
]

/** Cache for RGB to 256-color conversions */
const rgbToIndexCache = new Map<string, number>()

/** Convert RGB color to closest 256-color index */
function rgbToClosestIndex(r: number, g: number, b: number): number {
	const key = `${r},${g},${b}`
	const cached = rgbToIndexCache.get(key)
	if (cached !== undefined) {
		return cached
	}

	let closestIndex = 16 // Start from color 16
	let closestDistanceSquared = Infinity

	for (let i = 0; i < COLOR_PALETTE_256.length; i++) {
		const [pr, pg, pb] = COLOR_PALETTE_256[i]!
		const distanceSquared = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2

		if (distanceSquared < closestDistanceSquared) {
			closestDistanceSquared = distanceSquared
			closestIndex = i + 16 // Offset by 16 since palette starts at index 16
		}
	}

	rgbToIndexCache.set(key, closestIndex)
	return closestIndex
}

/** Alt screen control */
const ALT_SCREEN_ENTER = CSI + '?1049h'
const ALT_SCREEN_EXIT = CSI + '?1049l'

/** Mouse reporting control */
const MOUSE_ENABLE_BASE = CSI + '?1002h' + CSI + '?1003h' + CSI + '?1004h' + CSI + '?1006h' // Enable button-event tracking + any-event tracking + focus tracking + SGR mode
const MOUSE_DISABLE_BASE = CSI + '?1002l' + CSI + '?1003l' + CSI + '?1004l' + CSI + '?1006l' // Disable button-event tracking + any-event tracking + focus tracking + SGR mode
const MOUSE_PIXEL_ENABLE = CSI + '?1016h' // Enable pixel mouse mode
const MOUSE_PIXEL_DISABLE = CSI + '?1016l' // Disable pixel mouse mode

/** Emoji width control */
const EMOJI_WIDTH_ENABLE = CSI + '?2027h' // Enable proper emoji width reporting
const EMOJI_WIDTH_DISABLE = CSI + '?2027l' // Disable proper emoji width reporting

/** In-band resize control */
const INBAND_RESIZE_ENABLE = CSI + '?2048h' // Enable in-band resize notifications
const INBAND_RESIZE_DISABLE = CSI + '?2048l' // Disable in-band resize notifications

/** Kitty keyboard protocol control */
const KITTY_KEYBOARD_PUSH = CSI + '>1u' // Push disambiguation level 1 onto stack
const KITTY_KEYBOARD_POP = CSI + '<u' // Pop from kitty keyboard protocol stack

/** Mouse shape control */
const MOUSE_SHAPE = (shape: string) => ESC + `]22;${shape}` + ESC + '\\'

/** Terminal title control */
const TERMINAL_TITLE = (title: string) => ESC + `]0;${title}` + '\x07'

/** Check if character contains disallowed control characters (tab is allowed) */
function hasDisallowedCellChar(char: string): boolean {
	// Allow tab explicitly
	if (char === '\t') {
		return false
	}

	const cp = char.codePointAt(0)
	if (cp === undefined) {
		return false
	}

	// C0 controls (except TAB), DEL
	if ((cp >= 0x00 && cp <= 0x08) || (cp >= 0x0a && cp <= 0x1f) || cp === 0x7f) {
		return true
	}
	// C1 controls
	if (cp >= 0x80 && cp <= 0x9f) {
		return true
	}
	// Unicode line/paragraph separators
	if (cp === 0x2028 || cp === 0x2029) {
		return true
	}
	// BOM
	if (cp === 0xfeff) {
		return true
	}

	return false
}

/** Get visual symbol for control character, or replacement character if none exists */
function getControlCharSymbol(char: string): string {
	const cp = char.codePointAt(0)
	if (cp === undefined) {
		return '\uFFFD'
	}

	// C0 controls (0x00-0x1F) map to Unicode Control Pictures (U+2400-U+241F)
	if (cp >= 0x00 && cp <= 0x1f) {
		return String.fromCodePoint(0x2400 + cp)
	}

	// DEL (0x7F) maps to U+2421 (␡)
	if (cp === 0x7f) {
		return '\u2421'
	}

	// For everything else (C1, line separators, BOM), use replacement character
	return '\uFFFD'
}

/** Progress bar control */
const PROGRESS_BAR_INDETERMINATE = ESC + ']9;4;3' + ESC + '\\'
const PROGRESS_BAR_OFF = ESC + ']9;4;0' + ESC + '\\'
const PROGRESS_BAR_PAUSED = ESC + ']9;4;4' + ESC + '\\'

/** Hardware cursor shape control */
const CURSOR_SHAPE = (shape: number) => CSI + `${shape} q`

/** Hardware cursor shapes */
export const CursorShape = {
	/** Default terminal cursor (usually blinking block) */
	DEFAULT: 0,
	/** Blinking block cursor */
	BLINKING_BLOCK: 1,
	/** Steady block cursor */
	STEADY_BLOCK: 2,
	/** Blinking underline cursor */
	BLINKING_UNDERLINE: 3,
	/** Steady underline cursor */
	STEADY_UNDERLINE: 4,
	/** Blinking bar/I-beam cursor (good for text input) */
	BLINKING_BAR: 5,
	/** Steady bar/I-beam cursor (good for text input) */
	STEADY_BAR: 6,
} as const

export type CursorShapeType = (typeof CursorShape)[keyof typeof CursorShape]

/** Generate mouse enable sequence based on pixel mouse capability */
export function getMouseEnableSequence(usePixelMouse: boolean): string {
	return MOUSE_ENABLE_BASE + (usePixelMouse ? MOUSE_PIXEL_ENABLE : '')
}

/** Generate mouse disable sequence - disables all mouse modes */
export function getMouseDisableSequence(): string {
	return MOUSE_DISABLE_BASE + MOUSE_PIXEL_DISABLE
}

/** Set terminal title */
export function setTerminalTitle(title: string): string {
	return TERMINAL_TITLE(title)
}

/** Set progress bar to indeterminate state */
export function setProgressBarIndeterminate(): string {
	return PROGRESS_BAR_INDETERMINATE
}

/** Turn off progress bar */
export function setProgressBarOff(): string {
	return PROGRESS_BAR_OFF
}

/** Set progress bar to paused state */
export function setProgressBarPaused(): string {
	return PROGRESS_BAR_PAUSED
}

/** Current style state for optimization */
interface StyleState {
	fg?: Color | undefined
	bg?: Color | undefined
	bold?: boolean | undefined
	italic?: boolean | undefined
	underline?: boolean | undefined
	strikethrough?: boolean | undefined
	reverse?: boolean | undefined
	dim?: boolean | undefined
	hyperlink?: Hyperlink | undefined
}

/** Convert a color to ANSI escape sequence */
function colorToAnsi(
	color: Color | undefined,
	foreground: boolean,
	capabilities?: TerminalCapabilities,
): string {
	if (!color) {
		return ''
	}

	switch (color.type) {
		case 'default':
			// Use default color codes: 39 (fg) or 49 (bg)
			return CSI + (foreground ? '39' : '49') + 'm'

		case 'index': {
			// 256-color palette: 38;5;n (fg) or 48;5;n (bg)
			const prefix = foreground ? '38' : '48'
			return CSI + `${prefix};5;${color.value}m`
		}

		case 'rgb': {
			// Check if RGB is supported, fallback to 256-color if not
			if (capabilities && !capabilities.canRgb) {
				const { r, g, b } = color.value
				const fallbackIndex = rgbToClosestIndex(r, g, b)
				const prefix = foreground ? '38' : '48'
				return CSI + `${prefix};5;${fallbackIndex}m`
			}

			// RGB color: 38;2;r;g;b (fg) or 48;2;r;g;b (bg)
			const rgbPrefix = foreground ? '38' : '48'
			const { r, g, b } = color.value
			return CSI + `${rgbPrefix};2;${r};${g};${b}m`
		}

		default:
			return ''
	}
}

/** Convert a style to ANSI escape sequences */
function styleToAnsi(
	style: Style,
	currentState: StyleState,
	capabilities?: TerminalCapabilities,
): string {
	let ansi = ''

	// Handle foreground color
	if (style.fg !== currentState.fg) {
		if (style.fg === undefined && currentState.fg !== undefined) {
			// Reset to default foreground when going from colored to undefined
			ansi += CSI + '39m'
		} else {
			ansi += colorToAnsi(style.fg, true, capabilities)
		}
		currentState.fg = style.fg
	}

	// Handle background color
	if (style.bg !== currentState.bg) {
		if (style.bg === undefined && currentState.bg !== undefined) {
			// Reset to default background when going from colored to undefined
			ansi += CSI + '49m'
		} else {
			ansi += colorToAnsi(style.bg, false, capabilities)
		}
		currentState.bg = style.bg
	}

	// Handle text attributes
	if (style.bold !== currentState.bold) {
		ansi += style.bold ? CSI + '1m' : CSI + '22m'
		currentState.bold = style.bold
		// CSI 22m turns off both bold and dim, so re-enable dim if needed
		if (!style.bold && style.dim) {
			ansi += CSI + '2m'
		}
	}

	if (style.italic !== currentState.italic) {
		ansi += style.italic ? CSI + '3m' : CSI + '23m'
		currentState.italic = style.italic
	}

	if (style.underline !== currentState.underline) {
		// Skip underline if terminal doesn't support it
		if (capabilities?.underlineSupport !== 'none') {
			ansi += style.underline ? CSI + '4m' : CSI + '24m'
		}
		currentState.underline = style.underline
	}

	if (style.strikethrough !== currentState.strikethrough) {
		ansi += style.strikethrough ? CSI + '9m' : CSI + '29m'
		currentState.strikethrough = style.strikethrough
	}

	if (style.reverse !== currentState.reverse) {
		ansi += style.reverse ? CSI + '7m' : CSI + '27m'
		currentState.reverse = style.reverse
	}

	if (style.dim !== currentState.dim) {
		ansi += style.dim ? CSI + '2m' : CSI + '22m'
		currentState.dim = style.dim
		// CSI 22m turns off both bold and dim, so re-enable bold if needed
		if (!style.dim && style.bold) {
			ansi += CSI + '1m'
		}
	}

	return ansi
}

/** Handle hyperlink changes and return ANSI sequences */
function hyperlinkToAnsi(hyperlink: Hyperlink | undefined, currentState: StyleState): string {
	let ansi = ''

	// Check if hyperlink changed
	if (!hyperlinksEqual(hyperlink, currentState.hyperlink)) {
		// Close current hyperlink if one is active
		if (currentState.hyperlink) {
			ansi += hyperlinkEndSequence()
		}

		// Start new hyperlink if provided
		if (hyperlink) {
			ansi += hyperlinkStartSequence(hyperlink)
		}

		// Update current state
		currentState.hyperlink = hyperlink
	}

	return ansi
}

/** Compare two colors for equality */
function colorsEqual(a: Color | undefined, b: Color | undefined): boolean {
	if (a === b) return true
	if (a === undefined || b === undefined) return false

	if (a.type !== b.type) return false

	switch (a.type) {
		case 'default':
			return true // Both are default

		case 'index': {
			return (b as Extract<Color, { type: 'index' }>).value === a.value
		}

		case 'rgb': {
			const bRgb = (b as Extract<Color, { type: 'rgb' }>).value
			return bRgb.r === a.value.r && bRgb.g === a.value.g && bRgb.b === a.value.b
		}

		default:
			return false
	}
}

/** Compare two styles for equality */
function stylesEqual(a: Style, b: Style): boolean {
	return (
		colorsEqual(a.fg, b.fg) &&
		colorsEqual(a.bg, b.bg) &&
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strikethrough === b.strikethrough &&
		a.reverse === b.reverse &&
		a.dim === b.dim
	)
}

/** A batch of cells with the same style at consecutive positions */
interface RenderBatch {
	x: number
	y: number
	chars: string[]
	style: Style
	hyperlink?: Hyperlink // OSC 8 hyperlink information
	totalWidth: number // Total visual width of all characters
}

/** Terminal renderer */
export class Renderer {
	private currentStyle: StyleState = {}
	private currentX: number = 0
	private currentY: number = 0

	constructor(private capabilities?: TerminalCapabilities) {}

	/** Update terminal capabilities for RGB fallback */
	updateCapabilities(capabilities: TerminalCapabilities): void {
		this.capabilities = capabilities
	}

	/** Render diffs to ANSI escape sequences */
	render(diffs: CellDiff[]): string {
		if (diffs.length === 0) {
			return ''
		}

		// Group diffs into batches for efficiency
		const batches = this.batchDiffs(diffs)

		const output = new StringBuilder()

		for (const batch of batches) {
			// Move cursor if needed
			if (this.currentX !== batch.x || this.currentY !== batch.y) {
				output.append(CURSOR_TO(batch.y, batch.x))
				this.currentX = batch.x
				this.currentY = batch.y
			}

			// Apply style changes
			output.append(styleToAnsi(batch.style, this.currentStyle, this.capabilities))

			// Apply hyperlink changes
			output.append(hyperlinkToAnsi(batch.hyperlink, this.currentStyle))

			// Output characters
			output.append(batch.chars.join(''))

			// Update cursor position by visual width, not character count
			this.currentX += batch.totalWidth
		}

		return output.toString()
	}

	/** Clear the entire screen */
	clearScreen(): string {
		this.currentX = 0
		this.currentY = 0
		this.currentStyle = {}
		return RESET + hyperlinkEndSequence() + CLEAR_SCREEN + CURSOR_HOME
	}

	/** Hide the cursor */
	hideCursor(): string {
		return HIDE_CURSOR
	}

	/** Show the cursor */
	showCursor(): string {
		return SHOW_CURSOR
	}

	/** Set cursor shape */
	setCursorShape(shape: CursorShapeType): string {
		if (this.capabilities?.supportsCursorShape === false) {
			return ''
		}
		return CURSOR_SHAPE(shape)
	}

	/** Reset all styles */
	reset(): string {
		this.currentStyle = {}
		return RESET + hyperlinkEndSequence()
	}

	/** Move cursor to specific position */
	moveTo(x: number, y: number): string {
		this.currentX = x
		this.currentY = y
		return CURSOR_TO(y, x)
	}

	/** Group adjacent cells with same style into batches */
	private batchDiffs(diffs: CellDiff[]): RenderBatch[] {
		if (diffs.length === 0) {
			return []
		}

		const batches: RenderBatch[] = []
		let currentBatch: RenderBatch | null = null
		let lastY = -1
		let skipUntilX = -1 // Track where to resume after skipping wide char continuations

		for (const diff of diffs) {
			// Check for disallowed control characters in cell content (except tab)
			const hasDisallowed = hasDisallowedCellChar(diff.cell.char)
			const originalChar = diff.cell.char

			// Replace disallowed characters with control symbol or replacement character
			if (hasDisallowed) {
				diff.cell.char = getControlCharSymbol(diff.cell.char)
			}

			// Assert about the original character (crashes in dev, logs in prod)
			assert(
				!hasDisallowed,
				`Cell contains disallowed control at (${diff.x}, ${diff.y}):`,
				`U+${originalChar.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`,
			)

			// Track line changes
			if (diff.y !== lastY) {
				lastY = diff.y
				skipUntilX = -1
			}

			// Skip continuation cells from previous wide character on same line
			if (skipUntilX !== -1 && diff.x < skipUntilX) {
				continue
			}
			skipUntilX = -1

			const canExtendBatch =
				currentBatch &&
				currentBatch.y === diff.y &&
				currentBatch.x + currentBatch.totalWidth === diff.x &&
				stylesEqual(currentBatch.style, diff.cell.style) &&
				hyperlinksEqual(currentBatch.hyperlink, diff.cell.hyperlink)

			if (canExtendBatch) {
				// Extend current batch
				let displayChar = diff.cell.char === '\t' ? ' '.repeat(TAB_WIDTH) : diff.cell.char

				// Wrap wide characters with kitty explicit width escape if supported
				if (
					this.capabilities?.kittyExplicitWidth &&
					diff.cell.width > 1 &&
					diff.cell.char !== '\t'
				) {
					displayChar = `\x1b]66;w=${diff.cell.width};${displayChar}\x1b\\`
				}

				currentBatch!.chars.push(displayChar)
				currentBatch!.totalWidth += diff.cell.width

				// If this is a wide character, skip its continuation positions
				if (diff.cell.width > 1) {
					skipUntilX = diff.x + diff.cell.width
				}
			} else {
				// Start new batch
				let displayChar = diff.cell.char === '\t' ? ' '.repeat(TAB_WIDTH) : diff.cell.char

				// Wrap wide characters with kitty explicit width escape if supported
				if (
					this.capabilities?.kittyExplicitWidth &&
					diff.cell.width > 1 &&
					diff.cell.char !== '\t'
				) {
					displayChar = `\x1b]66;w=${diff.cell.width};${displayChar}\x1b\\`
				}

				currentBatch = {
					x: diff.x,
					y: diff.y,
					chars: [displayChar],
					style: diff.cell.style,
					hyperlink: diff.cell.hyperlink,
					totalWidth: diff.cell.width,
				}
				batches.push(currentBatch)

				// If this is a wide character, skip its continuation positions
				if (diff.cell.width > 1) {
					skipUntilX = diff.x + diff.cell.width
				}
			}
		}

		return batches
	}

	/** Get current cursor position */
	getCursorPosition(): { x: number; y: number } {
		return { x: this.currentX, y: this.currentY }
	}

	/** Reset internal state */
	resetState(): void {
		this.currentStyle = {}
		this.currentX = 0
		this.currentY = 0
	}

	/** Start synchronized output mode */
	startSync(): string {
		return SYNC_START
	}

	/** End synchronized output mode */
	endSync(): string {
		return SYNC_END
	}

	/** Enter alternate screen buffer */
	enterAltScreen(): string {
		return ALT_SCREEN_ENTER + this.clearScreen()
	}

	/** Exit alternate screen buffer */
	exitAltScreen(): string {
		return ALT_SCREEN_EXIT
	}

	/** Reset cursor style (simple reset) */
	resetCursor(): string {
		return RESET_SIMPLE
	}

	/** Enable mouse reporting */
	enableMouse(usePixelMouse: boolean = false): string {
		return getMouseEnableSequence(usePixelMouse)
	}

	/** Disable mouse reporting */
	disableMouse(): string {
		return getMouseDisableSequence()
	}

	/** Enable emoji width mode */
	enableEmojiWidth(): string {
		return EMOJI_WIDTH_ENABLE
	}

	/** Disable emoji width mode */
	disableEmojiWidth(): string {
		return EMOJI_WIDTH_DISABLE
	}

	/** Enable in-band resize mode */
	enableInBandResize(): string {
		return INBAND_RESIZE_ENABLE
	}

	/** Disable in-band resize mode */
	disableInBandResize(): string {
		return INBAND_RESIZE_DISABLE
	}

	/** Enable bracketed paste mode */
	enableBracketedPaste(): string {
		return BRACKETED_PASTE_ENABLE
	}

	/** Disable bracketed paste mode */
	disableBracketedPaste(): string {
		return BRACKETED_PASTE_DISABLE
	}

	/** Enable kitty keyboard protocol (push disambiguation level 1) */
	enableKittyKeyboard(): string {
		return KITTY_KEYBOARD_PUSH
	}

	/** Disable kitty keyboard protocol (pop from stack) */
	disableKittyKeyboard(): string {
		return KITTY_KEYBOARD_POP
	}

	/** Set mouse cursor shape */
	setMouseShape(shape: string): string {
		return MOUSE_SHAPE(shape)
	}

	/** Set progress bar to indeterminate state */
	setProgressBarIndeterminate(): string {
		return PROGRESS_BAR_INDETERMINATE
	}

	/** Turn off progress bar */
	setProgressBarOff(): string {
		return PROGRESS_BAR_OFF
	}

	/** Set progress bar to paused state */
	setProgressBarPaused(): string {
		return PROGRESS_BAR_PAUSED
	}
}

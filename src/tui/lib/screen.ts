/**
 * Screen buffer management with double-buffering for efficient terminal updates
 */

export interface RgbColor {
    r: number
    g: number
    b: number
}

import type { ScreenSurface } from './screen-surface.js'

/** Global tab width in spaces */
export const TAB_WIDTH = 4

/** Color types */
export type Color =
	| { type: 'default'; alpha?: number } // Terminal default color
	| { type: 'index'; value: number; alpha?: number } // 256-color palette (0-255)
	| { type: 'rgb'; value: RgbColor; alpha?: number } // True color RGB

/** Text style attributes */
export interface Style {
	fg?: Color // Foreground color
	bg?: Color // Background color
	bold?: boolean
	italic?: boolean
	underline?: boolean
	strikethrough?: boolean
	reverse?: boolean
	dim?: boolean
}

/** OSC 8 hyperlink information */
export interface Hyperlink {
	uri: string
	id: string
}

/** A single terminal cell */
export interface Cell {
	char: string
	style: Style
	width: number // Visual width of this character
	hyperlink?: Hyperlink // OSC 8 hyperlink information
}

/** Color creation helpers */
export const Colors = {
	/** Default terminal color */
	default(alpha?: number): Color {
		return alpha !== undefined ? { type: 'default', alpha } : { type: 'default' }
	},

	/** Indexed color (0-255) */
	index(value: number, alpha?: number): Color {
		return alpha !== undefined ? { type: 'index', value, alpha } : { type: 'index', value }
	},

	/** RGB color */
	rgb(r: number, g: number, b: number, alpha?: number): Color {
		return alpha !== undefined
			? { type: 'rgb', value: { r, g, b }, alpha }
			: { type: 'rgb', value: { r, g, b } }
	},

	/** Transparent color (fully transparent default) */
	transparent(): Color {
		return { type: 'default', alpha: 0.0 }
	},

	// Common colors for convenience
	black: { type: 'index', value: 0 } as Color,
	red: { type: 'index', value: 1 } as Color,
	green: { type: 'index', value: 2 } as Color,
	yellow: { type: 'index', value: 3 } as Color,
	blue: { type: 'index', value: 4 } as Color,
	magenta: { type: 'index', value: 5 } as Color,
	cyan: { type: 'index', value: 6 } as Color,
	white: { type: 'index', value: 7 } as Color, // Dim white/light gray
	brightWhite: { type: 'index', value: 15 } as Color, // Bright white
}

/** Create an empty cell with default style */
export function createCell(
	char: string = ' ',
	style: Style = {},
	width: number = 1,
	hyperlink?: Hyperlink,
): Cell {
	return {
		char,
		style: { ...style },
		width,
		hyperlink,
	}
}

/** Shared empty cell singleton to reduce allocations */
export const EMPTY_CELL: Cell = createCell(' ', {})

/** Compare two cells for equality */
export function cellsEqual(a: Cell, b: Cell): boolean {
	return (
		a.char === b.char &&
		a.width === b.width &&
		stylesEqual(a.style, b.style) &&
		hyperlinksEqual(a.hyperlink, b.hyperlink)
	)
}

/** Compare two styles for equality */
export function stylesEqual(a: Style, b: Style): boolean {
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

/** Compare two hyperlinks for equality */
export function hyperlinksEqual(a: Hyperlink | undefined, b: Hyperlink | undefined): boolean {
	if (a === b) return true
	if (a === undefined || b === undefined) return false
	return a.uri === b.uri && a.id === b.id
}

/** Compare two colors for equality */
function colorsEqual(a: Color | undefined, b: Color | undefined): boolean {
	if (a === b) return true
	if (a === undefined || b === undefined) return false

	if (a.type !== b.type) return false
	if (a.alpha !== b.alpha) return false

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

/** Convert color to RGB for blending calculations */
function colorToRgb(color: Color, indexRgbArray?: RgbColor[]): RgbColor | null {
	switch (color.type) {
		case 'rgb':
			return color.value

		case 'index': {
			// Only use queried RGB values - never approximate
			return indexRgbArray?.[color.value] ?? null
		}

		case 'default':
			// Return null for default colors - they can't be blended
			return null

		default:
			return null
	}
}

/** Blend two colors using alpha compositing */
function blendColors(source: Color, destination: Color, indexRgbArray?: RgbColor[]): Color {
	const sourceAlpha = source.alpha ?? 1.0

	// If source is fully opaque, return source
	if (sourceAlpha >= 1.0) {
		return source
	}

	// If source is fully transparent, return destination
	if (sourceAlpha <= 0.0) {
		return destination
	}

	// Convert both colors to RGB for blending
	const sourceRgb = colorToRgb(source, indexRgbArray)
	const destRgb = colorToRgb(destination, indexRgbArray)

	// If we can't convert to RGB, fall back to source or destination
	if (!sourceRgb || !destRgb) {
		return sourceAlpha > 0.5 ? source : destination
	}

	// Alpha blending: result = source * alpha + dest * (1 - alpha)
	const blendedR = Math.round(sourceRgb.r * sourceAlpha + destRgb.r * (1 - sourceAlpha))
	const blendedG = Math.round(sourceRgb.g * sourceAlpha + destRgb.g * (1 - sourceAlpha))
	const blendedB = Math.round(sourceRgb.b * sourceAlpha + destRgb.b * (1 - sourceAlpha))

	return {
		type: 'rgb',
		value: {
			r: Math.max(0, Math.min(255, blendedR)),
			g: Math.max(0, Math.min(255, blendedG)),
			b: Math.max(0, Math.min(255, blendedB)),
		},
	}
}

/** Blend a style with existing cell style */
function blendStyles(
	newStyle: Style,
	existingStyle: Style,
	defaultBg: Color,
	defaultFg: Color,
	indexRgbArray?: RgbColor[],
): Style {
	const result: Style = { ...existingStyle }

	// Blend foreground color if present
	if (newStyle.fg) {
		if (existingStyle.fg) {
			result.fg = blendColors(newStyle.fg, existingStyle.fg, indexRgbArray)
		} else {
			result.fg = blendColors(newStyle.fg, defaultFg, indexRgbArray)
		}
	}

	// Blend background color if present
	if (newStyle.bg) {
		// If new background is fully transparent, keep existing background
		if (newStyle.bg.alpha === 0.0) {
			if (existingStyle.bg) {
				result.bg = existingStyle.bg
			}
			// If no existing background, don't set a background (leave undefined)
		} else if (existingStyle.bg) {
			result.bg = blendColors(newStyle.bg, existingStyle.bg, indexRgbArray)
		} else {
			result.bg = blendColors(newStyle.bg, defaultBg, indexRgbArray)
		}
	}

	// Copy other style attributes (these don't blend)
	if (newStyle.bold !== undefined) result.bold = newStyle.bold
	if (newStyle.italic !== undefined) result.italic = newStyle.italic
	if (newStyle.underline !== undefined) result.underline = newStyle.underline
	if (newStyle.strikethrough !== undefined) result.strikethrough = newStyle.strikethrough
	if (newStyle.reverse !== undefined) result.reverse = newStyle.reverse
	if (newStyle.dim !== undefined) result.dim = newStyle.dim

	return result
}

/** A 2D screen buffer */
export class ScreenBuffer implements ScreenSurface {
	private cells: Cell[][]
	private width: number
	private height: number
	private indexToRgb: RgbColor[] = []
	private defaultBg: Color = Colors.default()
	private defaultFg: Color = Colors.default()

	constructor(width: number, height: number) {
		this.width = width
		this.height = height
		this.cells = []
		this.resize(width, height)
	}

	/** Set default colors for blending operations */
	setDefaultColors(bg: Color, fg: Color): void {
		this.defaultBg = bg
		this.defaultFg = fg
	}

	/** Set RGB mapping for indexed colors (indices 0-7) */
	setIndexRgbMapping(colors: RgbColor[]): void {
		this.indexToRgb = colors
	}

	/** Get buffer dimensions */
	getSize(): { width: number; height: number } {
		return { width: this.width, height: this.height }
	}

	/** Resize the buffer */
	resize(width: number, height: number): void {
		this.width = width
		this.height = height

		// Create new cells array
		this.cells = Array(height)
			.fill(null)
			.map(() =>
				Array(width)
					.fill(null)
					.map(() => EMPTY_CELL),
			)
	}

	/** Get a cell at the specified position */
	getCell(x: number, y: number): Cell | null {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
			return null
		}
		return this.cells[y]?.[x] || null
	}

	/** Set a cell at the specified position */
	setCell(x: number, y: number, cell: Cell): void {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
			return
		}

		// Check if we need to blend colors
		const hasAlpha =
			(cell.style.fg && cell.style.fg.alpha !== undefined && cell.style.fg.alpha < 1.0) ||
			(cell.style.bg && cell.style.bg.alpha !== undefined && cell.style.bg.alpha < 1.0)

		if (hasAlpha) {
			// Blend with existing cell
			const existingCell = this.cells[y]?.[x] || EMPTY_CELL
			const blendedStyle = blendStyles(
				cell.style,
				existingCell.style,
				this.defaultBg,
				this.defaultFg,
				this.indexToRgb,
			)
			if (this.cells[y]) {
				this.cells[y][x] = {
					char: cell.char,
					style: blendedStyle,
					width: cell.width,
				}
			}
		} else {
			// No alpha blending needed, replace directly
			if (this.cells[y]) {
				this.cells[y][x] = { ...cell, style: { ...cell.style } }
			}
		}

		// For wide characters (width > 1), set continuation cells
		// Continuation cells inherit the full style so diffs can detect when they change
		if (cell.width > 1) {
			for (let i = 1; i < cell.width; i++) {
				if (x + i < this.width && this.cells[y]) {
					// Create continuation cell with same style as the wide character
					// This ensures proper diffing when the wide character is replaced/cleared
					this.cells[y][x + i] = createCell(' ', cell.style, 1)
				}
			}
		}
	}

	/** Set a character at the specified position with style and width */
	setChar(x: number, y: number, char: string, style: Style, width: number): void {
		this.setCell(x, y, createCell(char, style, width))
	}

	/** Clear the entire buffer */
	clear(): void {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				const row = this.cells[y]
				if (row) {
					row[x] = EMPTY_CELL
				}
			}
		}
	}

	/** Fill a region with a character and style */
	fill(
		x: number,
		y: number,
		width: number,
		height: number,
		char: string = ' ',
		style: Style = {},
	): void {
		const cell = createCell(char, style)
		for (let dy = 0; dy < height; dy++) {
			for (let dx = 0; dx < width; dx++) {
				this.setCell(x + dx, y + dy, cell)
			}
		}
	}

	/** Copy this buffer's contents to another buffer */
	copyTo(other: ScreenBuffer): void {
		const { width, height } = other.getSize()
		for (let y = 0; y < Math.min(this.height, height); y++) {
			for (let x = 0; x < Math.min(this.width, width); x++) {
				const cell = this.getCell(x, y)
				if (cell) {
					other.setCell(x, y, cell)
				}
			}
		}
	}

	/** Get all cells as a 2D array (for debugging) */
	getCells(): Cell[][] {
		return this.cells.map((row) => row.map((cell) => ({ ...cell, style: { ...cell.style } })))
	}

	// Cursor methods to satisfy TextField expectations (no-op for basic ScreenBuffer)
	setCursor(_x: number, _y: number): void {
		// No-op for ScreenBuffer - this would be implemented by the real terminal
	}

	clearCursor(): void {
		// No-op for ScreenBuffer - this would be implemented by the real terminal
	}

	setCursorShape(_shape: number): void {
		// No-op for ScreenBuffer - this would be implemented by the real terminal
	}

	markForRefresh(): void {
		// No-op for ScreenBuffer - this would be implemented by the real Screen class
	}
}

/** Screen manager with double buffering */
export class Screen implements ScreenSurface {
	private frontBuffer: ScreenBuffer
	private backBuffer: ScreenBuffer
	private width: number
	private height: number
	private needsFullRefresh: boolean = false
	private cursorPosition: { x: number; y: number } | null = null
	private cursorVisible: boolean = false
	private cursorShape: number = 0 // Default cursor shape

	constructor(width: number = 80, height: number = 24) {
		this.width = width
		this.height = height
		this.frontBuffer = new ScreenBuffer(width, height)
		this.backBuffer = new ScreenBuffer(width, height)
	}

	/** Get screen dimensions */
	getSize(): { width: number; height: number } {
		return { width: this.width, height: this.height }
	}

	/** Resize both buffers */
	resize(width: number, height: number): void {
		this.width = width
		this.height = height
		this.frontBuffer.resize(width, height)
		this.backBuffer.resize(width, height)
	}

	/** Get the next buffer (the one being drawn to) */
	getBuffer(): ScreenBuffer {
		return this.backBuffer
	}

	/** Set default colors for blending operations */
	setDefaultColors(bg: Color, fg: Color): void {
		this.frontBuffer.setDefaultColors(bg, fg)
		this.backBuffer.setDefaultColors(bg, fg)
	}

	/** Set RGB mapping for indexed colors (indices 0-7) */
	setIndexRgbMapping(colors: RgbColor[]): void {
		this.frontBuffer.setIndexRgbMapping(colors)
		this.backBuffer.setIndexRgbMapping(colors)
	}

	/** Get a cell from the next buffer */
	getCell(x: number, y: number): Cell | null {
		return this.backBuffer.getCell(x, y)
	}

	/** Set a cell in the next buffer */
	setCell(x: number, y: number, cell: Cell): void {
		this.backBuffer.setCell(x, y, cell)
	}

	/** Set a character in the next buffer */
	setChar(x: number, y: number, char: string, style: Style, width: number): void {
		this.backBuffer.setChar(x, y, char, style, width)
	}

	/** Clear the next buffer */
	clear(): void {
		this.backBuffer.clear()
	}

	/** Fill a region in the next buffer */
	fill(
		x: number,
		y: number,
		width: number,
		height: number,
		char: string = ' ',
		style: Style = {},
	): void {
		this.backBuffer.fill(x, y, width, height, char, style)
	}

	/** Swap buffers (make the back buffer the front buffer) */
	present(): void {
		const temp = this.frontBuffer
		this.frontBuffer = this.backBuffer
		this.backBuffer = temp

		// Process wide characters in the new front buffer
		this.processWideCharacters()
	}

	/** Set continuation cells for wide characters in front buffer */
	private processWideCharacters(): void {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				const cell = this.frontBuffer.getCell(x, y)
				if (cell && cell.width > 1) {
					// Set continuation cells with the same style as the wide character
					for (let i = 1; i < cell.width; i++) {
						if (x + i < this.width) {
							this.frontBuffer.setCell(x + i, y, createCell(' ', cell.style, 1))
						}
					}
				}
			}
		}
	}

	/** Get differences between front and back buffers */
	getDiff(): CellDiff[] {
		const diffs: CellDiff[] = []

		// If full refresh is needed, return all cells as diffs
		if (this.needsFullRefresh) {
			for (let y = 0; y < this.height; y++) {
				for (let x = 0; x < this.width; x++) {
					const backCell = this.backBuffer.getCell(x, y)
					diffs.push({
						x,
						y,
						cell: backCell || EMPTY_CELL,
					})

					// If this is a wide character, skip the next cell(s) it covers
					if (backCell && backCell.width > 1) {
						x += backCell.width - 1 // Skip the continuation cells
					}
				}
			}
			this.needsFullRefresh = false // Reset flag after full refresh
			return diffs
		}

		// Normal diff calculation
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				const frontCell = this.frontBuffer.getCell(x, y)
				const backCell = this.backBuffer.getCell(x, y)

				// Fast path: if both cells are the same EMPTY_CELL singleton, skip
				// This is safe because setCell() always creates new cell objects,
				// so both being the singleton means neither has been written to
				if (frontCell === EMPTY_CELL && backCell === EMPTY_CELL) {
					continue
				}

				// Standard comparison for all other cases
				if (!frontCell || !backCell || !cellsEqual(frontCell, backCell)) {
					diffs.push({
						x,
						y,
						cell: backCell || EMPTY_CELL,
					})

					// If the BACK cell is a wide character, skip the next cell(s) it covers
					// Continuation cells now have inherited styles, so they'll generate diffs
					// naturally when they change - no need to emit them manually
					if (backCell && backCell.width > 1) {
						x += backCell.width - 1
					}
				} else if (
					backCell.char.length > 1 ||
					/[\u{1F000}-\u{1FFFF}]/u.test(backCell.char)
				) {
					// Even if no diff, skip continuation cells for wide characters
					if (backCell.width > 1) {
						x += backCell.width - 1
					}
				}
			}
		}

		return diffs
	}

	/** Get the front buffer (current displayed state) */
	getFrontBuffer(): ScreenBuffer {
		return this.frontBuffer
	}

	/** Get the back buffer (next state) */
	getBackBuffer(): ScreenBuffer {
		return this.backBuffer
	}

	/** Mark screen for full refresh on next render (bypasses diffing) */
	markForRefresh(): void {
		this.needsFullRefresh = true
	}

	/** Set hardware cursor position */
	setCursor(x: number, y: number): void {
		this.cursorPosition = { x, y }
		this.cursorVisible = true
	}

	/** Clear hardware cursor (hide it) */
	clearCursor(): void {
		this.cursorPosition = null
		this.cursorVisible = false
	}

	/** Get current cursor position */
	getCursor(): { x: number; y: number } | null {
		return this.cursorPosition
	}

	/** Get cursor visibility state */
	isCursorVisible(): boolean {
		return this.cursorVisible
	}

	/** Set cursor shape */
	setCursorShape(shape: number): void {
		this.cursorShape = shape
	}

	/** Get current cursor shape */
	getCursorShape(): number {
		return this.cursorShape
	}
}

/** Global counter for unique hyperlink IDs */
let hyperlinkIdCounter = 0

/** Create a unique hyperlink ID */
export function createHyperlinkId(): string {
	return `amp-${++hyperlinkIdCounter}`
}

/** Create a hyperlink object */
export function createHyperlink(uri: string, id?: string): Hyperlink {
	return {
		uri,
		id: id ?? createHyperlinkId(),
	}
}

/** Generate OSC 8 hyperlink start sequence */
export function hyperlinkStartSequence(hyperlink: Hyperlink): string {
	return `\x1b]8;id=${hyperlink.id};${hyperlink.uri}\x1b\\`
}

/** Generate OSC 8 hyperlink end sequence */
export function hyperlinkEndSequence(): string {
	return '\x1b]8;;\x1b\\'
}

/** Represents a cell difference for rendering */
export interface CellDiff {
	x: number
	y: number
	cell: Cell
}

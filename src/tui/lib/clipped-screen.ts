import type { Cell, Screen, Style } from './screen.js'
import { Screen as ScreenClass } from './screen.js'

/**
 * A wrapper around Screen that clips all drawing operations to a specific region.
 * Prevents content from drawing outside specified bounds.
 */
export class ClippedScreen extends ScreenClass {
	private _screen: Screen
	private _clipX: number
	private _clipY: number
	private _clipWidth: number
	private _clipHeight: number

	constructor(
		screen: Screen,
		clipX: number,
		clipY: number,
		clipWidth: number,
		clipHeight: number,
	) {
		// Initialize with dummy dimensions - we'll delegate to the underlying screen
		super(clipWidth, clipHeight)
		this._screen = screen
		this._clipX = clipX
		this._clipY = clipY
		this._clipWidth = clipWidth
		this._clipHeight = clipHeight
	}

	// Override the clipped drawing methods
	setChar(x: number, y: number, char: string, style?: Style, width: number = 1): void {
		// Check if the position is within the clipping region
		if (
			x >= this._clipX &&
			x < this._clipX + this._clipWidth &&
			y >= this._clipY &&
			y < this._clipY + this._clipHeight
		) {
			this._screen.setChar(x, y, char, style || {}, width)
		}
	}

	setCell(x: number, y: number, cell: Cell): void {
		// Check if the position is within the clipping region
		if (
			x >= this._clipX &&
			x < this._clipX + this._clipWidth &&
			y >= this._clipY &&
			y < this._clipY + this._clipHeight
		) {
			this._screen.setCell(x, y, cell)
		}
	}

	fill(
		x: number,
		y: number,
		width: number,
		height: number,
		char: string = ' ',
		style?: Style,
	): void {
		// Calculate the intersection of the fill area with the clipping region
		const fillLeft = Math.max(x, this._clipX)
		const fillTop = Math.max(y, this._clipY)
		const fillRight = Math.min(x + width, this._clipX + this._clipWidth)
		const fillBottom = Math.min(y + height, this._clipY + this._clipHeight)

		if (fillLeft < fillRight && fillTop < fillBottom) {
			this._screen.fill(
				fillLeft,
				fillTop,
				fillRight - fillLeft,
				fillBottom - fillTop,
				char,
				style,
			)
		}
	}

	// Delegate all other methods to the underlying screen
	getSize() {
		return this._screen.getSize()
	}
	resize(width: number, height: number) {
		return this._screen.resize(width, height)
	}
	getBuffer() {
		return this._screen.getBuffer()
	}
	getFrontBuffer() {
		return this._screen.getFrontBuffer()
	}
	getBackBuffer() {
		return this._screen.getBackBuffer()
	}
	getCell(x: number, y: number) {
		return this._screen.getCell(x, y)
	}
	clear() {
		return this._screen.clear()
	}
	present() {
		return this._screen.present()
	}
	getDiff() {
		return this._screen.getDiff()
	}
	markForRefresh() {
		return this._screen.markForRefresh()
	}
	setCursor(x: number, y: number) {
		// Check if the position is within the clipping region
		if (
			x >= this._clipX &&
			x < this._clipX + this._clipWidth &&
			y >= this._clipY &&
			y < this._clipY + this._clipHeight
		) {
			return this._screen.setCursor(x, y)
		} else {
			// Cursor is outside clipping bounds, clear it
			return this._screen.clearCursor()
		}
	}
	clearCursor() {
		return this._screen.clearCursor()
	}
	getCursor() {
		return this._screen.getCursor()
	}
	isCursorVisible() {
		return this._screen.isCursorVisible()
	}
}

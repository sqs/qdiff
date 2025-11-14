/**
 * Interface for objects that can be painted to by render objects.
 * This represents the drawing surface that widgets can use for rendering.
 */

import type { Cell, Style } from './screen.js'

export interface ScreenSurface {
	/** Get surface dimensions */
	getSize(): { width: number; height: number }

	/** Get a cell at the specified position */
	getCell(x: number, y: number): Cell | null

	/** Set a cell at the specified position */
	setCell(x: number, y: number, cell: Cell): void

	/** Set a character at the specified position */
	setChar(x: number, y: number, char: string, style: Style, width: number): void

	/** Clear the surface */
	clear(): void

	/** Fill a region on the surface */
	fill(x: number, y: number, width: number, height: number, char?: string, style?: Style): void

	/** Set cursor position */
	setCursor(x: number, y: number): void

	/** Clear/hide cursor */
	clearCursor(): void

	/** Set cursor shape */
	setCursorShape?(shape: number): void
}

/**
 * Get terminal pixel dimensions using ioctl(TIOCGWINSZ)
 *
 * This uses the winsize struct which contains:
 * - ws_row: rows in characters
 * - ws_col: columns in characters
 * - ws_xpixel: horizontal size in pixels
 * - ws_ypixel: vertical size in pixels
 */

interface TTYReadStream {
	columns?: number
	rows?: number
}

interface TTYWriteStream {
	getWindowSize?(): [number, number]
}

export interface TerminalPixelSize {
	rows: number
	columns: number
	pixelWidth: number
	pixelHeight: number
}

/**
 * Get terminal size including pixel dimensions using ioctl.
 * Falls back to character-only dimensions if ioctl fails.
 */
export function getTerminalPixelSize(): TerminalPixelSize | null {
	// First try the FFI approach if available
	const ioctlSize = tryIoctlGetWindowSize()
	if (ioctlSize) {
		return ioctlSize
	}

	// Fallback to Node.js built-in methods (character dimensions only)
	const fallback = getBasicTerminalSize()
	if (fallback) {
		return {
			...fallback,
			pixelWidth: 0, // Unknown
			pixelHeight: 0, // Unknown
		}
	}

	return null
}

/**
 * Try to get window size using ioctl(TIOCGWINSZ) via FFI
 */
function tryIoctlGetWindowSize(): TerminalPixelSize | null {
	try {
		// Try to require ffi-napi - this will throw if not installed
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const ffi = require('ffi-napi')
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const ref = require('ref-napi')
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const Struct = require('ref-struct-di')(ref)

		// Define the winsize struct
		const WinSize = Struct({
			ws_row: ref.types.ushort, // rows, in characters
			ws_col: ref.types.ushort, // columns, in characters
			ws_xpixel: ref.types.ushort, // horizontal size, pixels
			ws_ypixel: ref.types.ushort, // vertical size, pixels
		})

		// Define the ioctl function
		const libc = ffi.Library('libc', {
			ioctl: ['int', ['int', 'ulong', 'pointer']],
		})

		// TIOCGWINSZ constant (Linux/macOS)
		const TIOCGWINSZ =
			process.platform === 'darwin'
				? 0x40087468 // macOS
				: 0x00005413 // Linux

		// Create winsize struct instance
		const winsize = new WinSize()

		// Call ioctl to get window size
		const result = libc.ioctl(process.stdout.fd, TIOCGWINSZ, winsize.ref())

		if (result === 0) {
			return {
				rows: winsize.ws_row,
				columns: winsize.ws_col,
				pixelWidth: winsize.ws_xpixel,
				pixelHeight: winsize.ws_ypixel,
			}
		}

		return null
	} catch (error) {
		// FFI not available or ioctl failed
		return null
	}
}

/**
 * Get basic terminal size using Node.js built-in methods
 */
function getBasicTerminalSize(): { rows: number; columns: number } | null {
	try {
		// Try process.stdout first
		if (process.stdout.isTTY && process.stdout.columns && process.stdout.rows) {
			return {
				columns: process.stdout.columns,
				rows: process.stdout.rows,
			}
		}

		// Try process.stdin
		const stdinTTY = process.stdin as TTYReadStream
		if (process.stdin.isTTY && stdinTTY.columns && stdinTTY.rows) {
			return {
				columns: stdinTTY.columns,
				rows: stdinTTY.rows,
			}
		}

		// Try getWindowSize if available
		const stdoutTTY = process.stdout as TTYWriteStream
		if (typeof stdoutTTY.getWindowSize === 'function') {
			const size = stdoutTTY.getWindowSize()
			// getWindowSize returns [columns, rows] or [0, 0] on error
			if (size[0] > 0 && size[1] > 0) {
				return {
					columns: size[0],
					rows: size[1],
				}
			}
		}

		return null
	} catch (error) {
		return null
	}
}

/**
 * Check if pixel dimensions are available
 */
export function hasPixelDimensions(): boolean {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('ffi-napi')
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('ref-napi')
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require('ref-struct-di')
		return true
	} catch {
		return false
	}
}

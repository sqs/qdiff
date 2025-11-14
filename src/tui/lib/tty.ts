import { openSync } from 'node:fs'
import tty from 'node:tty'

import logger from '../logger.js'

/**
 * Check if running on Bun <1.2.22 which has /dev/tty bugs
 */
function isOldBunWithTTYBug(): boolean {
	const bunVersion = process.versions.bun
	if (!bunVersion) {
		return false
	}
	const parts = bunVersion.split('.').map(Number)
	const major = parts[0] ?? 0
	const minor = parts[1] ?? 0
	const patch = parts[2] ?? 0

	if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
		return false
	}

	// Bug fixed in 1.2.22
	if (major !== 1 || minor !== 2) {
		return false
	}

	return patch < 22
}

/**
 * Tty type for terminal input abstraction
 * Provides a minimal interface for terminal input operations
 * Output is handled directly via process.stdout
 */
export type Tty = {
	/**
	 * The underlying stdin stream
	 */
	stdin: tty.ReadStream | null

	/**
	 * Stored data callback
	 */
	dataCallback: ((data: Buffer) => void) | null

	/**
	 * Initialize the TTY (open /dev/tty or set up process.stdin)
	 */
	init(): void

	/**
	 * Register a callback for incoming data from the terminal
	 */
	on(event: 'data', callback: (data: Buffer) => void): void

	/**
	 * Pause reading from the terminal input
	 */
	pause(): void

	/**
	 * Resume reading from the terminal input
	 */
	resume(): void

	/**
	 * Dispose the TTY and clean up resources
	 */
	dispose(): void
}

/**
 * Create a TTY implementation that opens /dev/tty
 */
function createDevTty(): Tty {
	const ttyInstance: Tty = {
		stdin: null,
		dataCallback: null,

		init(): void {
			if (this.stdin !== null) {
				return
			}
			const fd = openSync('/dev/tty', 'r')
			if (!tty.isatty(fd)) {
				throw new Error('/dev/tty is not a TTY device')
			}
			const stream = new tty.ReadStream(fd)
			this.stdin = stream

			// Set raw mode
			stream.setRawMode(true)

			// Re-register callback if one exists
			if (this.dataCallback) {
				stream.on('data', this.dataCallback)
			}
		},

		on(event: 'data', callback: (data: Buffer) => void): void {
			// Remove existing listeners if we have a previous callback
			if (this.dataCallback && this.stdin) {
				this.stdin.removeAllListeners('data')
			}

			// Store the new callback
			this.dataCallback = callback

			// Register the callback on the stream
			this.stdin?.on(event, callback)
		},

		pause(): void {
			// Restore raw mode and destroy stream
			if (this.stdin) {
				this.stdin.setRawMode(false)
				if (this.dataCallback) {
					this.stdin.removeListener('data', this.dataCallback)
				}
				this.stdin.destroy()
			}
			this.stdin = null
		},

		resume(): void {
			this.init()
		},

		dispose(): void {
			// Restore raw mode and destroy stream
			if (this.stdin) {
				this.stdin.setRawMode(false)
				if (this.dataCallback) {
					this.stdin.removeListener('data', this.dataCallback)
				}
				this.stdin.destroy()
			}
			this.stdin = null
			this.dataCallback = null
		},
	}

	ttyInstance.init()
	return ttyInstance
}

/**
 * Create a TTY implementation that uses process.stdin
 */
function createStdinTty(): Tty {
	const ttyInstance: Tty = {
		stdin: null,
		dataCallback: null,

		init(): void {
			if (this.stdin !== null) {
				return
			}
			this.stdin = process.stdin as tty.ReadStream

			// Set raw mode if stdin is a TTY
			if (this.stdin.isTTY) {
				this.stdin.setRawMode(true)
			}

			// Re-register callback if one exists
			if (this.dataCallback) {
				this.stdin.on('data', this.dataCallback)
			}
		},

		on(event: 'data', callback: (data: Buffer) => void): void {
			// Remove existing listeners if we have a previous callback
			if (this.dataCallback && this.stdin) {
				this.stdin.removeAllListeners('data')
			}

			// Store the new callback
			this.dataCallback = callback

			// Register the callback on the stream
			this.stdin?.on(event, callback)
		},

		pause(): void {
			// Restore raw mode and pause stream
			if (this.stdin && this.stdin.isTTY) {
				this.stdin.setRawMode(false)
			}
			this.stdin?.pause()
		},

		resume(): void {
			// Set raw mode and resume stream
			if (this.stdin && this.stdin.isTTY) {
				this.stdin.setRawMode(true)
			}
			this.stdin?.resume()
		},

		dispose(): void {
			// Restore raw mode before disposing
			if (this.stdin && this.stdin.isTTY) {
				this.stdin.setRawMode(false)
			}
			if (this.stdin && this.dataCallback) {
				this.stdin.removeListener('data', this.dataCallback)
			}
			// Don't destroy process.stdin
			this.stdin = null
			this.dataCallback = null
		},
	}

	ttyInstance.init()
	return ttyInstance
}

/**
 * Create a Tty instance
 * On Unix-like systems, opens /dev/tty (uses process.stdin on old Bun)
 * On Windows, uses process.stdin
 */
export function createTty(): Tty {
	if (process.platform === 'win32') {
		return createStdinTty()
	}

	// Use process.stdin on Bun <1.2.22 to avoid ENXIO errors
	if (isOldBunWithTTYBug()) {
		logger.warn(
			'Detected Bun <1.2.22 which has known /dev/tty issues. Please upgrade to Bun 1.2.22 or later for proper TTY support. Using process.stdin instead.',
		)
		return createStdinTty()
	}

	return createDevTty()
}

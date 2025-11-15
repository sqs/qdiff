import { openSync } from 'node:fs'
import tty from 'node:tty'

import logger from '../logger.js'

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
			// Restore raw mode
			if (this.stdin && this.stdin.isTTY) {
				this.stdin.setRawMode(false)
			}

			// Remove listener to stop buffering
			if (this.stdin && this.dataCallback) {
				this.stdin.removeListener('data', this.dataCallback)
			}

			this.stdin?.pause()
		},

		resume(): void {
			// Set raw mode
			if (this.stdin && this.stdin.isTTY) {
				this.stdin.setRawMode(true)
			}

			// Re-add listener
			if (this.stdin && this.dataCallback) {
				this.stdin.on('data', this.dataCallback)
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
 * On Unix-like systems, opens /dev/tty
 * On Windows, uses process.stdin
 */
export function createTty(): Tty {
	if (process.platform === 'win32') {
		return createStdinTty()
	}

	return createDevTty()
}

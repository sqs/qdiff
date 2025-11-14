/**
 * Clipboard support using OSC 52 escape sequences with platform fallbacks
 */

import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import { promisify } from 'node:util'

import type { TerminalCapabilities } from './terminal-queries.js'

const execFileAsync = promisify(execFile)

/** OSC 52 clipboard sequences */
const OSC_52_WRITE = (data: string) => `\x1b]52;c;${data}\x1b\\`
const OSC_52_READ = '\x1b]52;c;?\x1b\\'
const OSC_52_PRIMARY_READ = '\x1b]52;p;?\x1b\\'

/**
 * Selection type for clipboard operations
 * - `clipboard`: Standard clipboard (Ctrl+C/Ctrl+V on all platforms)
 * - `primary`: X11 primary selection (Linux/Unix only, used for middle-click paste)
 */
type SelectionType = 'clipboard' | 'primary'

/**
 * Clipboard interface for writing text using OSC 52 with platform fallbacks
 */
export class Clipboard {
	private capabilities: TerminalCapabilities | null = null
	private pendingReadPromise: Promise<string | null> | null = null
	private readResolve: ((value: string | null) => void) | null = null
	private readTimeout: NodeJS.Timeout | null = null

	/**
	 * Set the terminal capabilities to check OSC 52 support
	 */
	setCapabilities(capabilities: TerminalCapabilities): void {
		this.capabilities = capabilities
	}

	/**
	 * Check if OSC 52 clipboard is supported
	 */
	isOsc52Supported(): boolean {
		return this.capabilities?.osc52 ?? false
	}

	/**
	 * Check if a command exists on the system
	 */
	private async commandExists(command: string): Promise<boolean> {
		try {
			await execFileAsync('which', [command])
			return true
		} catch {
			return false
		}
	}

	/**
	 * Write text to clipboard using pbcopy (macOS)
	 */
	private async writeToPbcopy(text: string): Promise<boolean> {
		try {
			const child = execFile('pbcopy')
			child.stdin?.write(text)
			child.stdin?.end()
			await new Promise<void>((resolve, reject) => {
				child.on('close', (code) => {
					if (code === 0) resolve()
					else reject(new Error(`pbcopy exited with code ${code}`))
				})
			})
			return true
		} catch {
			return false
		}
	}

	/**
	 * Write text to clipboard using wl-copy (Wayland)
	 */
	private async writeToWlCopy(text: string): Promise<boolean> {
		try {
			const child = execFile('wl-copy')
			child.stdin?.write(text)
			child.stdin?.end()
			await new Promise<void>((resolve, reject) => {
				child.on('close', (code) => {
					if (code === 0) resolve()
					else reject(new Error(`wl-copy exited with code ${code}`))
				})
			})
			return true
		} catch {
			return false
		}
	}

	/**
	 * Write text to clipboard using xclip (X11)
	 */
	private async writeToXclip(text: string): Promise<boolean> {
		try {
			const child = execFile('xclip', ['-selection', 'clipboard'])
			child.stdin?.write(text)
			child.stdin?.end()
			await new Promise<void>((resolve, reject) => {
				child.on('close', (code) => {
					if (code === 0) resolve()
					else reject(new Error(`xclip exited with code ${code}`))
				})
			})
			return true
		} catch {
			return false
		}
	}

	/**
	 * Read text from clipboard or selection using OSC 52
	 */
	private async readFromOSC52WithQuery(query: string): Promise<string | null> {
		if (!this.isOsc52Supported()) {
			return null
		}

		// Don't allow concurrent OSC 52 reads
		if (this.pendingReadPromise) {
			return this.pendingReadPromise
		}

		this.pendingReadPromise = new Promise<string | null>((resolve) => {
			this.readResolve = resolve

			// Set up timeout to avoid hanging
			this.readTimeout = setTimeout(() => {
				this.readResolve = null
				this.pendingReadPromise = null
				resolve(null)
			}, 2000) // 2 second timeout

			// Send OSC 52 read query
			process.stdout.write(query)
		})

		const result = await this.pendingReadPromise
		this.pendingReadPromise = null
		return result
	}

	/**
	 * Read text from clipboard using OSC 52
	 */
	private async readFromOSC52(): Promise<string | null> {
		return this.readFromOSC52WithQuery(OSC_52_READ)
	}

	/**
	 * Handle OSC 52 clipboard response from terminal
	 * This should be called by the terminal parser when it receives an OSC 52 response
	 */
	handleOSC52Response(base64Data: string): void {
		if (this.readResolve && this.readTimeout) {
			clearTimeout(this.readTimeout)
			this.readTimeout = null

			try {
				// Decode base64 data
				const clipboardText = Buffer.from(base64Data, 'base64').toString('utf8')
				this.readResolve(clipboardText)
			} catch {
				this.readResolve(null)
			}

			this.readResolve = null
			this.pendingReadPromise = null
		}
	}

	/**
	 * Read text from clipboard using pbpaste (macOS)
	 */
	private async readFromPbpaste(): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync('pbpaste')
			return stdout
		} catch {
			return null
		}
	}

	/**
	 * Read text from clipboard using wl-paste (Wayland)
	 */
	private async readFromWlPaste(selection: SelectionType): Promise<string | null> {
		try {
			const args = ['--no-newline']
			if (selection === 'primary') {
				args.push('--primary')
			}
			const { stdout } = await execFileAsync('wl-paste', args)
			return stdout
		} catch {
			return null
		}
	}

	/**
	 * Read text from clipboard using xclip (X11)
	 */
	private async readFromXclip(selection: SelectionType): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync('xclip', ['-selection', selection, '-o'])
			return stdout
		} catch {
			return null
		}
	}

	/**
	 * Read text from primary selection using OSC 52
	 */
	private async readFromOSC52Primary(): Promise<string | null> {
		return this.readFromOSC52WithQuery(OSC_52_PRIMARY_READ)
	}

	/**
	 * Read text from clipboard using the best available method
	 */
	async readText(): Promise<string | null> {
		// First try OSC 52 if supported
		if (this.isOsc52Supported()) {
			const result = await this.readFromOSC52()
			if (result !== null) {
				return result
			}
		}

		// Fall back to platform-specific clipboard utilities
		const currentPlatform = platform()

		if (currentPlatform === 'darwin') {
			// macOS: try pbpaste
			const result = await this.readFromPbpaste()
			if (result !== null) {
				return result
			}
		} else {
			// Linux/Unix: try wl-paste first (Wayland), then xclip (X11)
			if (await this.commandExists('wl-paste')) {
				const result = await this.readFromWlPaste('clipboard')
				if (result !== null) {
					return result
				}
			}

			if (await this.commandExists('xclip')) {
				const result = await this.readFromXclip('clipboard')
				if (result !== null) {
					return result
				}
			}
		}

		// If all methods fail, return null
		return null
	}

	/**
	 * Read text from primary selection (used for middle-click paste on Linux)
	 */
	async readPrimarySelection(): Promise<string | null> {
		const currentPlatform = platform()

		// Primary selection is only relevant on Linux/Unix
		if (currentPlatform === 'darwin') {
			// macOS doesn't have primary selection, fall back to clipboard
			return this.readText()
		}

		// First try OSC 52 primary selection if supported
		if (this.isOsc52Supported()) {
			const result = await this.readFromOSC52Primary()
			if (result !== null) {
				return result
			}
		}

		// Linux/Unix: try wl-paste --primary first (Wayland), then xclip -selection primary (X11)
		if (await this.commandExists('wl-paste')) {
			const result = await this.readFromWlPaste('primary')
			if (result !== null) {
				return result
			}
		}

		if (await this.commandExists('xclip')) {
			const result = await this.readFromXclip('primary')
			if (result !== null) {
				return result
			}
		}

		// If all methods fail, return null
		return null
	}

	/**
	 * Write text to clipboard using the best available method
	 */
	async writeText(text: string): Promise<void> {
		// First try OSC 52 if supported
		if (this.isOsc52Supported()) {
			const base64Data = Buffer.from(text).toString('base64')
			const sequence = OSC_52_WRITE(base64Data)
			process.stdout.write(sequence)
			return
		}

		// Fall back to platform-specific clipboard utilities
		const currentPlatform = platform()

		if (currentPlatform === 'darwin') {
			// macOS: try pbcopy
			if (await this.writeToPbcopy(text)) {
				return
			}
		} else {
			// Linux/Unix: try wl-copy first (Wayland), then xclip (X11)
			if ((await this.commandExists('wl-copy')) && (await this.writeToWlCopy(text))) {
				return
			}

			if ((await this.commandExists('xclip')) && (await this.writeToXclip(text))) {
				return
			}
		}

		// If all methods fail, silently do nothing
		// Could optionally log a debug message here
	}
}

/**
 * Default clipboard instance
 */
export const clipboard = new Clipboard()

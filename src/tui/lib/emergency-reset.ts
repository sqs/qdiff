/**
 * Emergency terminal reset for crash recovery
 */

import { LogStore } from './log-store.js'

/**
 * Emergency terminal reset that restores terminal to clean state
 * without clearing screen content. Use before showing crash errors.
 */
export function emergencyTerminalReset(): void {
	try {
		LogStore.getInstance().restoreConsole()

		// Reset mouse modes
		process.stdout.write('\x1b[?1002l') // Disable button event tracking
		process.stdout.write('\x1b[?1003l') // Disable all event tracking
		process.stdout.write('\x1b[?1004l') // Disable focus tracking
		process.stdout.write('\x1b[?1006l') // Disable SGR mouse mode
		process.stdout.write('\x1b[?1016l') // Disable pixel mouse mode
		process.stdout.write('\x1b[?2004l') // Disable bracketed paste
		process.stdout.write('\x1b[?2031l') // Disable color scheme reports
		process.stdout.write('\x1b[?2048l') // Disable resize reports
		process.stdout.write('\x1b[<u') // Pop kitty keyboard protocol stack

		// Exit alt screen mode
		process.stdout.write('\x1b[?1049l')

		// Reset cursor style
		process.stdout.write('\x1b[0 q') // Default cursor style

		// Reset cursor visibility
		process.stdout.write('\x1b[?25h') // Show cursor

		// Move cursor to bottom of screen but don't clear
		process.stdout.write('\x1b[999;1H') // Move to bottom-left

		// Reset text attributes
		process.stdout.write('\x1b[0m') // Reset all text styling

		// Turn off progress bar (avoid in iTerm2 due to compatibility issues)
		if (!process.env.TERM_PROGRAM?.startsWith('iTerm')) {
			process.stdout.write('\x1b]9;4;0\x1b\\')
		}
	} catch (error) {
		// If terminal reset fails, just continue - we're already in an error state
	}
}

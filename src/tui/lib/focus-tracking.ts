/**
 * TUI Focus Tracking Module
 * Provides module-level focus state tracking for the TUI
 * Similar to the CLI focus tracking but integrated with the TUI event system
 */

import type { FocusEvent } from './parser/types.js'
import type { Tui, TuiEvent } from './tui.js'

// Module-level focus state
let terminalFocused = true

/**
 * Initialize focus tracking for the TUI
 * Should be called once when the TUI is set up
 */
export function initFocusTracking(tui: Tui): void {
	// Register focus event handler with the TUI
	const handleFocusEvent = (event: TuiEvent) => {
		if (event.type === 'focus') {
			const focusEvent = event as FocusEvent
			terminalFocused = focusEvent.focused
		}
	}

	tui.onFocus(handleFocusEvent)
}

/**
 * Get the current terminal focus state
 * Returns true if terminal is focused, false otherwise
 */
export function getTerminalFocused(): boolean {
	return terminalFocused
}

/**
 * Manually set the terminal focus state
 * Useful for testing or explicit state management
 */
export function setTerminalFocused(focused: boolean): void {
	terminalFocused = focused
}

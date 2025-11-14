/**
 * TUI Idle Tracking Module
 * Provides module-level idle state tracking for the TUI
 * Monitors user activity and determines when the application is idle
 */

import type { Tui } from './tui.js'

// Module-level state
let lastUserInput = Date.now()
let idleThresholdMs = 5 * 60 * 1000 // 5 minutes default

/**
 * Initialize idle tracking for the TUI
 * Should be called once when the TUI is set up
 */
export function initIdleTracking(tui: Tui, thresholdMs: number = 5 * 60 * 1000): void {
	idleThresholdMs = thresholdMs
	lastUserInput = Date.now()

	// Register handlers for user activity events
	tui.onKey(() => {
		lastUserInput = Date.now()
	})

	tui.onMouse(() => {
		lastUserInput = Date.now()
	})
}

/**
 * Get the current idle state
 * Returns true if application is idle, false otherwise
 */
export function getIsIdle(): boolean {
	const now = Date.now()
	const timeSinceLastInput = now - lastUserInput
	return timeSinceLastInput >= idleThresholdMs
}

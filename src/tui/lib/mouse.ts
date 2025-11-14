/**
 * Mouse event handling and SGR button code decoding
 */

import type { SgrMouseEvent } from './parser/types.js'

/** Mouse button types */
export type MouseButton = 'left' | 'middle' | 'right' | 'wheel_up' | 'wheel_down' | 'unknown'

/** Mouse action types */
export type MouseAction = 'press' | 'release' | 'move' | 'scroll'

/** Mouse modifiers */
export interface MouseModifiers {
	shift: boolean
	ctrl: boolean
	alt: boolean
	meta: boolean
}

/** High-level mouse event */
export interface MouseEvent {
	type: 'mouse'
	action: MouseAction
	button: MouseButton
	x: number // 0-based screen coordinates in cells (fractional when pixel mouse available)
	y: number // 0-based screen coordinates in cells (fractional when pixel mouse available)
	modifiers: MouseModifiers
	drag: boolean // True when button is held during movement
}

/**
 * Decode SGR button code into button type and modifiers
 *
 * SGR button codes:
 * - 0-2: Left, Middle, Right button
 * - 3: Release (any button)
 * - 64-66: Scroll wheel up/down/horizontal
 * - +4: Shift modifier
 * - +8: Meta/Alt modifier
 * - +16: Ctrl modifier
 * - +32: Motion event (drag)
 */
export function decodeSgrButton(buttonCode: number): {
	button: MouseButton
	modifiers: MouseModifiers
	motion: boolean
} {
	// Extract modifiers
	const shift = (buttonCode & 4) !== 0
	const meta = (buttonCode & 8) !== 0
	const ctrl = (buttonCode & 16) !== 0
	const motion = (buttonCode & 32) !== 0

	// Base button code (remove modifier bits)
	const baseButton = buttonCode & ~(4 | 8 | 16 | 32)

	let button: MouseButton = 'unknown'

	switch (baseButton) {
		case 0:
			button = 'left'
			break
		case 1:
			button = 'middle'
			break
		case 2:
			button = 'right'
			break
		case 64:
			button = 'wheel_up'
			break
		case 65:
			button = 'wheel_down'
			break
		default:
			button = 'unknown'
			break
	}

	return {
		button,
		modifiers: {
			shift,
			ctrl,
			alt: meta, // SGR uses meta bit for alt
			meta: false, // We don't have a separate meta in SGR
		},
		motion,
	}
}

/**
 * Convert SGR mouse event to high-level MouseEvent
 */
export function sgrToMouseEvent(
	sgr: SgrMouseEvent,
	isPixelMode?: boolean,
	cellWidth?: number,
	cellHeight?: number,
): MouseEvent {
	const decoded = decodeSgrButton(sgr.button)

	// Determine action
	let action: MouseAction

	if (decoded.button === 'wheel_up' || decoded.button === 'wheel_down') {
		action = 'scroll'
	} else if (decoded.motion) {
		action = 'move'
	} else if (sgr.pressed) {
		action = 'press'
	} else {
		action = 'release'
	}

	// Calculate coordinates
	let x: number, y: number

	if (isPixelMode && cellWidth && cellHeight) {
		// In pixel mode, convert pixel coordinates to fractional cell coordinates
		x = (sgr.x - 1) / cellWidth // Convert from 1-based pixels to 0-based cells
		y = (sgr.y - 1) / cellHeight // Convert from 1-based pixels to 0-based cells
	} else {
		// In cell mode, use coordinates directly
		x = sgr.x - 1 // Convert from 1-based to 0-based
		y = sgr.y - 1 // Convert from 1-based to 0-based
	}

	return {
		type: 'mouse',
		action,
		button: decoded.button,
		x,
		y,
		modifiers: decoded.modifiers,
		drag: decoded.motion && sgr.pressed,
	}
}

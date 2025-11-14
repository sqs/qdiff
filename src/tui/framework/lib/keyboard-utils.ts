/**
 * Set of special (non-printable) key names that should not be inserted as text
 */
export const SPECIAL_KEYS = new Set<string>([
	// Navigation keys
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Home',
	'End',
	'PageUp',
	'PageDown',

	// Editing keys
	'Backspace',
	'Delete',
	'Insert',
	'Tab',
	'Enter',

	// Modifier keys
	'Shift',
	'Control',
	'Alt',
	'Meta',
	'CapsLock',
	'NumLock',
	'ScrollLock',

	// Function keys
	'F1',
	'F2',
	'F3',
	'F4',
	'F5',
	'F6',
	'F7',
	'F8',
	'F9',
	'F10',
	'F11',
	'F12',
	'F13',
	'F14',
	'F15',
	'F16',
	'F17',
	'F18',
	'F19',
	'F20',
	'F21',
	'F22',
	'F23',
	'F24',

	// Special keys
	'Escape',
	'PrintScreen',
	'Pause',
	'ContextMenu',

	// Media keys
	'MediaPlayPause',
	'MediaStop',
	'MediaTrackNext',
	'MediaTrackPrevious',
	'AudioVolumeDown',
	'AudioVolumeMute',
	'AudioVolumeUp',

	// Browser keys
	'BrowserBack',
	'BrowserFavorites',
	'BrowserForward',
	'BrowserHome',
	'BrowserRefresh',
	'BrowserSearch',
	'BrowserStop',

	// Other special keys
	'Clear',
	'Copy',
	'Cut',
	'Paste',
	'Undo',
	'Redo',
	'Find',
	'Help',
	'Menu',
	'Select',
	'Execute',
	'Sleep',
	'WakeUp',
])

/**
 * Determines if a keyboard event represents a special (non-printable) key.
 *
 * A key is considered special if:
 * - It's in the SPECIAL_KEYS set (navigation, function keys, etc.)
 * - It has modifier keys pressed (ctrl, alt, meta)
 * - It's a control character (character code < 32)
 *
 * @param event The keyboard event to check
 * @returns true if the key should not be inserted as text, false if it's printable
 */
export function isSpecialKey(event: {
	key: string
	ctrlKey?: boolean
	altKey?: boolean
	metaKey?: boolean
}): boolean {
	// Check if it's in our special keys set
	if (SPECIAL_KEYS.has(event.key)) {
		return true
	}

	// Check if any modifier keys are pressed (except Shift alone)
	if (event.ctrlKey || event.altKey || event.metaKey) {
		return true
	}

	// Check if it's a control character (but allow printable characters)
	if (event.key.length === 1) {
		const charCode = event.key.charCodeAt(0)
		// Control characters are from 0-31, except we allow some like Tab (9) and Enter (10,13)
		// which are already handled in SPECIAL_KEYS
		if (charCode < 32) {
			return true
		}
	}

	// Everything else is considered printable
	return false
}

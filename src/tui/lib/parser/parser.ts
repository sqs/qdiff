/**
 * Higher-level VT Parser
 * Provides a more user-friendly API on top of VTLexer
 */

import logger from '../../logger.js'

import type { MouseEvent } from '../mouse.js'
import { sgrToMouseEvent } from '../mouse.js'
import type { ResizeEvent } from '../tui.js'
import { VTLexer } from './lexer.js'
import type {
	ApcEvent,
	ColorPaletteChangeEvent,
	CsiEvent,
	CursorPositionReportEvent,
	DcsEvent,
	DecrqssResponseEvent,
	DeviceAttributesPrimaryEvent,
	EscapeEvent,
	ExecuteEvent,
	FocusEvent,
	KeyboardEvent,
	OscEvent,
	ParserEvent,
	PasteEvent,
	PrintEvent,
	SgrMouseEvent,
} from './types.js'

/** Extended Unicode key mappings for kitty keyboard protocol (official kitty source values) */
const KITTY_EXTENDED_KEYS: Record<number, string> = {
	// Navigation and editing keys
	57348: 'Insert',
	57349: 'Delete',
	57350: 'ArrowLeft',
	57351: 'ArrowRight',
	57352: 'ArrowUp',
	57353: 'ArrowDown',
	57354: 'PageUp',
	57355: 'PageDown',
	57356: 'Home',
	57357: 'End',

	// Lock and system keys
	57358: 'CapsLock',
	57359: 'ScrollLock',
	57360: 'NumLock',
	57361: 'PrintScreen',
	57362: 'Pause',
	57363: 'ContextMenu',

	// Function keys F1-F35
	57364: 'F1',
	57365: 'F2',
	57366: 'F3',
	57367: 'F4',
	57368: 'F5',
	57369: 'F6',
	57370: 'F7',
	57371: 'F8',
	57372: 'F9',
	57373: 'F10',
	57374: 'F11',
	57375: 'F12',
	57376: 'F13',
	57377: 'F14',
	57378: 'F15',
	57379: 'F16',
	57380: 'F17',
	57381: 'F18',
	57382: 'F19',
	57383: 'F20',
	57384: 'F21',
	57385: 'F22',
	57386: 'F23',
	57387: 'F24',
	57388: 'F25',
	57389: 'F26',
	57390: 'F27',
	57391: 'F28',
	57392: 'F29',
	57393: 'F30',
	57394: 'F31',
	57395: 'F32',
	57396: 'F33',
	57397: 'F34',
	57398: 'F35',

	// Keypad keys - mapped to regular key values to match W3C behavior
	57399: '0',
	57400: '1',
	57401: '2',
	57402: '3',
	57403: '4',
	57404: '5',
	57405: '6',
	57406: '7',
	57407: '8',
	57408: '9',
	57409: '.',
	57410: '/',
	57411: '*',
	57412: '-',
	57413: '+',
	57414: 'Enter',
	57415: '=',
	57416: ',',
	57417: 'ArrowLeft',
	57418: 'ArrowRight',
	57419: 'ArrowUp',
	57420: 'ArrowDown',
	57421: 'PageUp',
	57422: 'PageDown',
	57423: 'Home',
	57424: 'End',
	57425: 'Insert',
	57426: 'Delete',
	57427: 'Clear',

	// Media keys
	57428: 'MediaPlay',
	57429: 'MediaPause',
	57430: 'MediaPlayPause',
	57431: 'MediaReverse',
	57432: 'MediaStop',
	57433: 'MediaFastForward',
	57434: 'MediaRewind',
	57435: 'MediaTrackNext',
	57436: 'MediaTrackPrevious',
	57437: 'MediaRecord',
	57438: 'AudioVolumeDown',
	57439: 'AudioVolumeUp',
	57440: 'AudioVolumeMute',

	// Modifier keys (when pressed as regular keys)
	57441: 'ShiftLeft',
	57442: 'ControlLeft',
	57443: 'AltLeft',
	57444: 'MetaLeft',
	57445: 'HyperLeft',
	57446: 'MetaLeft',
	57447: 'ShiftRight',
	57448: 'ControlRight',
	57449: 'AltRight',
	57450: 'MetaRight',
	57451: 'HyperRight',
	57452: 'MetaRight',
	57453: 'AltGraph',
	57454: 'ISOLevel5Shift',
}

export class VTParser {
	private lexer: VTLexer
	private keyHandlers: ((event: KeyboardEvent) => void)[] = []
	private deviceAttributesHandlers: ((event: DeviceAttributesPrimaryEvent) => void)[] = []
	private decrqssHandlers: ((event: DecrqssResponseEvent) => void)[] = []
	private dcsHandlers: ((event: DcsEvent) => void)[] = []
	private oscHandlers: ((event: OscEvent) => void)[] = []
	private apcHandlers: ((event: ApcEvent) => void)[] = []
	private pasteHandlers: ((event: PasteEvent) => void)[] = []
	private sgrMouseHandlers: ((event: SgrMouseEvent) => void)[] = []
	private mouseHandlers: ((event: MouseEvent) => void)[] = []
	private focusHandlers: ((event: FocusEvent) => void)[] = []
	private resizeHandlers: ((event: ResizeEvent) => void)[] = []
	private colorPaletteChangeHandlers: ((event: ColorPaletteChangeEvent) => void)[] = []
	private cursorPositionReportHandlers: ((event: CursorPositionReportEvent) => void)[] = []
	private escapeTimeout: NodeJS.Timeout | null = null
	private readonly ESCAPE_TIMEOUT_MS = 25
	private pendingEscape: boolean = false
	private sgrToMouseConverter: (sgr: SgrMouseEvent) => MouseEvent = sgrToMouseEvent

	// Bracketed paste state
	private inPaste: boolean = false
	private pasteBuffer: string = ''

	constructor() {
		this.lexer = new VTLexer()
		this.lexer.onEvent(this.handleLexicalEvent.bind(this))
	}

	/** Add an event handler (backward compatibility with VTLexer) */
	onEvent(handler: (event: ParserEvent) => void): void {
		this.lexer.onEvent(handler)
	}

	/** Remove an event handler (backward compatibility with VTLexer) */
	offEvent(handler: (event: ParserEvent) => void): void {
		this.lexer.offEvent(handler)
	}

	/** Add a key event handler */
	onKey(handler: (event: KeyboardEvent) => void): void {
		this.keyHandlers.push(handler)
	}

	/** Remove a key event handler */
	offKey(handler: (event: KeyboardEvent) => void): void {
		const index = this.keyHandlers.indexOf(handler)
		if (index !== -1) {
			this.keyHandlers.splice(index, 1)
		}
	}

	/** Add a device attributes event handler */
	onDeviceAttributes(handler: (event: DeviceAttributesPrimaryEvent) => void): void {
		this.deviceAttributesHandlers.push(handler)
	}

	/** Add a DECRQSS response event handler */
	onDecrqss(handler: (event: DecrqssResponseEvent) => void): void {
		this.decrqssHandlers.push(handler)
	}

	/** Add a DCS event handler */
	onDcs(handler: (event: DcsEvent) => void): void {
		this.dcsHandlers.push(handler)
	}

	/** Add an OSC event handler */
	onOsc(handler: (event: OscEvent) => void): void {
		this.oscHandlers.push(handler)
	}

	/** Add an APC event handler */
	onApc(handler: (event: ApcEvent) => void): void {
		this.apcHandlers.push(handler)
	}

	/** Add a paste event handler */
	onPaste(handler: (event: PasteEvent) => void): void {
		this.pasteHandlers.push(handler)
	}

	/** Add an SGR mouse event handler */
	onSgrMouse(handler: (event: SgrMouseEvent) => void): void {
		this.sgrMouseHandlers.push(handler)
	}

	/** Add a mouse event handler */
	onMouse(handler: (event: MouseEvent) => void): void {
		this.mouseHandlers.push(handler)
	}

	/** Add a focus event handler */
	onFocus(handler: (event: FocusEvent) => void): void {
		this.focusHandlers.push(handler)
	}

	/** Add a resize event handler */
	onResize(handler: (event: ResizeEvent) => void): void {
		this.resizeHandlers.push(handler)
	}

	/** Add a color palette change event handler */
	onColorPaletteChange(handler: (event: ColorPaletteChangeEvent) => void): void {
		this.colorPaletteChangeHandlers.push(handler)
	}

	/** Add a cursor position report event handler */
	onCursorPositionReport(handler: (event: CursorPositionReportEvent) => void): void {
		this.cursorPositionReportHandlers.push(handler)
	}

	/** Set custom SGR to mouse event converter */
	setSgrToMouseConverter(converter: (sgr: SgrMouseEvent) => MouseEvent): void {
		this.sgrToMouseConverter = converter
	}

	/** Parse input data */
	parse(data: Uint8Array | string): void {
		// Check if this is a standalone escape first
		if (this.isStandaloneEscape(data)) {
			// Clear any existing escape timeout since we're receiving data
			if (this.escapeTimeout) {
				clearTimeout(this.escapeTimeout)
				this.escapeTimeout = null
			}
			this.scheduleEscapeTimeout()
			// Still parse it through the lexer so it can start escape sequences
			this.lexer.parse(data)
			return
		}

		// Clear any pending escape timeout since we're receiving non-escape data
		if (this.escapeTimeout) {
			clearTimeout(this.escapeTimeout)
			this.escapeTimeout = null
			this.pendingEscape = false
		}

		this.lexer.parse(data)
	}

	/** Check if data is a single escape byte */
	private isStandaloneEscape(data: Uint8Array | string): boolean {
		if (typeof data === 'string') {
			return data.length === 1 && data.charCodeAt(0) === 0x1b
		} else {
			return data.length === 1 && data[0] === 0x1b
		}
	}

	/** Schedule timeout to detect standalone escape */
	private scheduleEscapeTimeout(): void {
		this.pendingEscape = true
		this.escapeTimeout = setTimeout(() => {
			// No more data came, this was a standalone escape key press
			this.pendingEscape = false

			// Reset lexer state to prevent it from treating next character as part of escape sequence
			this.lexer.reset()

			const escapeEvent: KeyboardEvent = {
				type: 'key',
				key: 'Escape',
				shiftKey: false,
				ctrlKey: false,
				altKey: false,
				metaKey: false,
			}
			this.emitKeyEvent(escapeEvent)
			this.escapeTimeout = null
		}, this.ESCAPE_TIMEOUT_MS)
	}

	/** Clear escape timeout and pending state */
	private clearEscapeTimeout(): void {
		if (this.escapeTimeout) {
			clearTimeout(this.escapeTimeout)
			this.escapeTimeout = null
		}
		this.pendingEscape = false
	}

	/** Flush any pending data */
	flush(): void {
		this.lexer.flush()
	}

	/** Reset parser state */
	reset(): void {
		this.clearEscapeTimeout()
		this.lexer.reset()
	}

	/** Handle lexical events from lexer and convert to key events */
	private handleLexicalEvent(event: ParserEvent): void {
		switch (event.type) {
			case 'print':
				this.handlePrintEvent(event)
				break
			case 'execute':
				this.handleExecuteEvent(event)
				break
			case 'csi':
				this.handleCsiEvent(event)
				break
			case 'dcs':
				this.handleDcsEvent(event)
				break
			case 'osc':
				this.handleOscEvent(event)
				break
			case 'apc':
				this.handleApcEvent(event)
				break
			case 'escape':
				this.handleEscapeEvent(event)
				break
			// All other event types are ignored
		}
	}

	/** Convert print events to key events */
	private handlePrintEvent(event: PrintEvent): void {
		// If we're in bracketed paste mode, buffer the text
		if (this.inPaste) {
			this.pasteBuffer += event.grapheme
			return
		}

		// Check if we have a pending escape (Alt + ASCII)
		if (this.pendingEscape) {
			this.clearEscapeTimeout()
			const altKeyEvent: KeyboardEvent = {
				type: 'key',
				key: event.grapheme,
				shiftKey: this.isShifted(event.grapheme),
				ctrlKey: false,
				altKey: true,
				metaKey: false,
			}
			this.emitKeyEvent(altKeyEvent)
			return
		}

		// Regular print event
		const keyEvent: KeyboardEvent = {
			type: 'key',
			key: event.grapheme,
			shiftKey: this.isShifted(event.grapheme),
			ctrlKey: false,
			altKey: false,
			metaKey: false,
		}
		this.emitKeyEvent(keyEvent)
	}

	/** Handle execute events (control characters) */
	private handleExecuteEvent(event: ExecuteEvent): void {
		// If we're in bracketed paste mode, buffer certain control characters as literal text
		if (this.inPaste) {
			switch (event.code) {
				case 0x0a: // LF (Line Feed) - preserve as newline in paste
					this.pasteBuffer += '\n'
					return
				case 0x0d: // CR (Carriage Return) - preserve as carriage return in paste
					this.pasteBuffer += '\r'
					return
				case 0x09: // HT (Tab) - preserve as tab in paste
					this.pasteBuffer += '\t'
					return
				default:
					// Ignore all other control characters during paste
					return
			}
		}

		// HACK: Claude Code adds a command to iTerm2 and VSCode so that shift+enter sends a "\n" byte.
		// We need to intercept this raw newline (0x0a) and convert it to a shift+enter event.
		if (event.code === 0x0a) {
			const shiftEnterEvent: KeyboardEvent = {
				type: 'key',
				key: 'Enter',
				shiftKey: true,
				ctrlKey: false,
				altKey: false,
				metaKey: false,
			}
			this.emitKeyEvent(shiftEnterEvent)
			return
		}

		const grapheme = this.controlCharacterToGrapheme(event.code)
		if (grapheme) {
			const keyEvent: KeyboardEvent = {
				type: 'key',
				key: grapheme,
				shiftKey: false,
				ctrlKey:
					this.isControlCharacter(event.code) &&
					event.code !== 0x7f &&
					event.code !== 0x08 &&
					event.code !== 0x09 &&
					event.code !== 0x0a &&
					event.code !== 0x0d &&
					event.code !== 0x1b,
				altKey: false,
				metaKey: false,
			}
			this.emitKeyEvent(keyEvent)
		}
	}

	/** Convert control character code to meaningful grapheme */
	private controlCharacterToGrapheme(code: number): string | null {
		switch (code) {
			case 0x08:
				return 'Backspace' // BS
			case 0x09:
				return 'Tab' // HT
			case 0x0a:
				return 'Enter' // LF
			case 0x0d:
				return 'Enter' // CR
			case 0x1b:
				return 'Escape' // ESC
			case 0x7f:
				return 'Backspace' // DEL
			// Ctrl+letter combinations
			case 0x00:
				return '@' // Ctrl+@
			case 0x01:
				return 'a' // Ctrl+A
			case 0x02:
				return 'b' // Ctrl+B
			case 0x03:
				return 'c' // Ctrl+C
			case 0x04:
				return 'd' // Ctrl+D
			case 0x05:
				return 'e' // Ctrl+E
			case 0x06:
				return 'f' // Ctrl+F
			case 0x07:
				return 'g' // Ctrl+G
			case 0x0b:
				return 'k' // Ctrl+K
			case 0x0c:
				return 'l' // Ctrl+L
			case 0x0e:
				return 'n' // Ctrl+N
			case 0x0f:
				return 'o' // Ctrl+O
			case 0x10:
				return 'p' // Ctrl+P
			case 0x11:
				return 'q' // Ctrl+Q
			case 0x12:
				return 'r' // Ctrl+R
			case 0x13:
				return 's' // Ctrl+S
			case 0x14:
				return 't' // Ctrl+T
			case 0x15:
				return 'u' // Ctrl+U
			case 0x16:
				return 'v' // Ctrl+V
			case 0x17:
				return 'w' // Ctrl+W
			case 0x18:
				return 'x' // Ctrl+X
			case 0x19:
				return 'y' // Ctrl+Y
			case 0x1a:
				return 'z' // Ctrl+Z
			default:
				return null
		}
	}

	/** Check if a control code represents a control character */
	private isControlCharacter(code: number): boolean {
		return (code >= 0x00 && code <= 0x1a) || code === 0x1b || code === 0x7f
	}

	/** Handle escape events */
	private handleEscapeEvent(event: EscapeEvent): void {
		// Cancel any pending escape timeout since we got a complete escape sequence
		this.clearEscapeTimeout()

		const key = this.escapeToKey(event)
		if (key) {
			this.emitKeyEvent(key)
		}
	}

	/** Handle DCS events (device control strings) */
	private handleDcsEvent(event: DcsEvent): void {
		// Emit DCS event to handlers
		for (const handler of this.dcsHandlers) {
			handler(event)
		}
	}

	/** Handle OSC events (operating system commands) */
	private handleOscEvent(event: OscEvent): void {
		// Emit OSC event to handlers
		for (const handler of this.oscHandlers) {
			handler(event)
		}
	}

	/** Handle APC events (application program commands) */
	private handleApcEvent(event: ApcEvent): void {
		// Emit APC event to handlers
		for (const handler of this.apcHandlers) {
			handler(event)
		}
	}

	/** Handle CSI events (escape sequences) */
	private handleCsiEvent(event: CsiEvent): void {
		// Cancel any pending escape timeout since we got a complete escape sequence
		this.clearEscapeTimeout()

		// Check if this is a bracketed paste start/end
		if (this.handleBracketedPaste(event)) {
			return
		}

		// Check if this is a focus event
		const focusEvent = this.csiToFocus(event)
		if (focusEvent) {
			this.emitFocusEvent(focusEvent)
			return
		}

		// Check if this is a cursor position report (CPR)
		const cprEvent = this.csiToCursorPositionReport(event)
		if (cprEvent) {
			this.emitCursorPositionReportEvent(cprEvent)
			return
		}

		// Check if this is a DA1 response
		const da1Event = this.csiToDeviceAttributes(event)
		if (da1Event) {
			this.emitDeviceAttributesEvent(da1Event)
			return
		}

		// Check if this is a DECRQSS response
		const decrqssEvent = this.csiToDecrqss(event)
		if (decrqssEvent) {
			this.emitDecrqssEvent(decrqssEvent)
			return
		}

		// Check if this is a kitty keyboard protocol response
		const kittyKeyboardEvent = this.csiToKittyKeyboardResponse(event)
		if (kittyKeyboardEvent) {
			this.emitDecrqssEvent(kittyKeyboardEvent)
			return
		}

		// Check if this is an in-band resize event (CSI 48 ; rows ; cols ; pixel_y ; pixel_x t)
		const resizeEvent = this.csiToInBandResize(event)
		if (resizeEvent) {
			this.emitResizeEvent(resizeEvent)
			return
		}

		// Check if this is a color palette change notification (mode 2031)
		// Format: CSI ? 997 ; <value> n (value is 1 for dark, 2 for light)
		if (event.final === 'n' && event.private === '?' && event.params[0]?.value === 997) {
			const mode = event.params[1]?.value ?? 0
			logger.info('Received color palette change notification (mode 2031)', { mode })
			this.emitColorPaletteChangeEvent({
				type: 'colorPaletteChange',
				colorIndex: -1,
				value: '',
			})
			return
		}

		// Check if this is an SGR mouse event
		const sgrMouseEvent = this.csiToSgrMouse(event)
		if (sgrMouseEvent) {
			this.emitSgrMouseEvent(sgrMouseEvent)

			// Also emit high-level mouse event
			const mouseEvent = this.sgrToMouseConverter(sgrMouseEvent)
			this.emitMouseEvent(mouseEvent)
			return
		}

		const key = this.csiToKey(event)
		if (key) {
			this.emitKeyEvent(key)
		}
	}

	/** Convert escape sequence to key event */
	private escapeToKey(event: EscapeEvent): KeyboardEvent | null {
		// Function keys F1-F4 (ESC O P/Q/R/S)
		if (event.intermediates === 'O') {
			if (event.final === 'P') return this.createKeyEvent('F1')
			if (event.final === 'Q') return this.createKeyEvent('F2')
			if (event.final === 'R') return this.createKeyEvent('F3')
			if (event.final === 'S') return this.createKeyEvent('F4')
		}

		// Alt+ASCII combinations (ESC + ASCII character)
		if (event.intermediates === '' && event.final.length === 1) {
			const charCode = event.final.charCodeAt(0)
			// Check if it's a printable ASCII character
			if (charCode >= 0x20 && charCode <= 0x7e) {
				return {
					type: 'key',
					key: event.final,
					shiftKey: this.isShifted(event.final),
					ctrlKey: false,
					altKey: true,
					metaKey: false,
				}
			} else if (charCode == 0x7f) {
				// Handle ESC + Backspace
				return {
					type: 'key',
					key: 'Backspace',
					shiftKey: false,
					ctrlKey: false,
					altKey: true,
					metaKey: false,
				}
			}
		}

		return null
	}

	/** Convert CSI sequence to key event */
	private csiToKey(event: CsiEvent): KeyboardEvent | null {
		const final = event.final
		let params = event.params

		// Default to a single parameter of 1 if none are present or if first param is 0 (matches Vaxis)
		if (params.length === 0 || (params.length === 1 && params[0]?.value === 0)) {
			params = [{ value: 1 }]
		}

		let keycode: string | null = null
		let modifiers = { shift: false, ctrl: false, alt: false, meta: false }
		let eventType = 1
		let text = ''

		// Handle parameters directly (our lexer separates semicolon-delimited params)
		if (params.length >= 1) {
			const firstParam = params[0]?.value ?? 1

			// Special case: Tab with shift (1Z)
			if (firstParam === 1 && final === 'Z') {
				keycode = 'Tab'
				modifiers.shift = true
			} else {
				// Try special key lookup first, then unicode
				keycode = this.getSpecialKey(firstParam, final) ?? this.unicodeToKey(firstParam)
			}
		}

		// Handle modifiers from second parameter
		if (params.length >= 2) {
			const modifierParam = params[1]?.value ?? 1
			modifiers = this.parseModifiers(modifierParam)
		}

		// Handle event type from third parameter (Kitty extended protocol)
		if (params.length >= 3) {
			const eventTypeParam = params[2]?.value ?? 1
			if (final === 'u') {
				eventType = eventTypeParam - 1
			} else if (final === '~' && params[0]?.value === 27) {
				// Special case: 27;mods;key~ format for Ctrl+Enter, etc.
				keycode = this.unicodeToKey(eventTypeParam)
			}
		}

		// Only handle key press events for now
		if (eventType !== 1 && eventType !== 0) {
			return null
		}

		if (!keycode) {
			return null
		}

		// Handle text generation for shift+printable characters (workaround for terminal bugs)
		if (
			text === '' &&
			modifiers.shift &&
			!modifiers.ctrl &&
			!modifiers.alt &&
			!modifiers.meta
		) {
			const unicode = this.keyToUnicode(keycode)
			if (unicode && unicode >= 32 && unicode <= 126) {
				text = keycode.toUpperCase()
			}
		}

		return this.createKeyEventWithModifiers(keycode, modifiers, text)
	}

	/** Parse modifier flags from CSI parameter */
	private parseModifiers(modifierParam: number): {
		shift: boolean
		ctrl: boolean
		alt: boolean
		meta: boolean
	} {
		// If no modifier parameter, no modifiers
		if (modifierParam === 0 || modifierParam === 1) {
			return { shift: false, ctrl: false, alt: false, meta: false }
		}

		// Standard modifier encoding (subtract 1 from parameter)
		const mod = modifierParam - 1
		return {
			shift: (mod & 1) !== 0,
			alt: (mod & 2) !== 0,
			ctrl: (mod & 4) !== 0,
			meta: (mod & 8) !== 0,
		}
	}

	/** Convert Unicode codepoint to key name or character */
	private unicodeToKey(unicode: number): string | null {
		// Special keys
		if (unicode === 13) return 'Enter'
		if (unicode === 9) return 'Tab'
		if (unicode === 27) return 'Escape'
		if (unicode === 127) return 'Backspace'
		if (unicode === 32) return ' ' // Space

		// Control characters (Ctrl+A = 1, Ctrl+B = 2, etc.)
		if (unicode >= 1 && unicode <= 26) {
			return String.fromCharCode(unicode + 96) // Convert to lowercase letter
		}

		// Check extended kitty keyboard protocol keys
		if (KITTY_EXTENDED_KEYS[unicode]) {
			return KITTY_EXTENDED_KEYS[unicode]
		}

		// Printable characters
		if (unicode >= 32 && unicode <= 126) {
			return String.fromCharCode(unicode)
		}

		// High Unicode characters (including emoji, accented characters, etc.)
		if (unicode > 126) {
			try {
				return String.fromCharCode(unicode)
			} catch {
				return null
			}
		}

		return null
	}

	/** Create a key event with default modifiers */
	private createKeyEvent(key: string): KeyboardEvent {
		return {
			type: 'key',
			key,
			shiftKey: false,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
		}
	}

	/** Create a key event with specified modifiers */
	private createKeyEventWithModifiers(
		key: string,
		modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean },
		text?: string,
	): KeyboardEvent {
		return {
			type: 'key',
			key,
			shiftKey: modifiers.shift,
			ctrlKey: modifiers.ctrl,
			altKey: modifiers.alt,
			metaKey: modifiers.meta,
		}
	}

	/** Special key mappings (matches Vaxis specialsKeys) */
	private static readonly SPECIAL_KEYS = new Map<string, string>([
		// Arrow keys
		['1:A', 'ArrowUp'],
		['1:B', 'ArrowDown'],
		['1:C', 'ArrowRight'],
		['1:D', 'ArrowLeft'],

		// Home/End keys
		['1:H', 'Home'],
		['1:F', 'End'],

		// Function keys F1-F4 (CSI format)
		['1:P', 'F1'],
		['1:Q', 'F2'],
		['1:R', 'F3'],
		['1:S', 'F4'],

		// Tilde sequences
		['1:~', 'Home'],
		['2:~', 'Insert'],
		['3:~', 'Delete'],
		['4:~', 'End'],
		['5:~', 'PageUp'],
		['6:~', 'PageDown'],
		['7:~', 'Home'],
		['8:~', 'End'],
		['9:~', 'Tab'],
		['11:~', 'F1'],
		['12:~', 'F2'],
		['13:~', 'F3'],
		['14:~', 'F4'],
		['15:~', 'F5'],
		['17:~', 'F6'],
		['18:~', 'F7'],
		['19:~', 'F8'],
		['20:~', 'F9'],
		['21:~', 'F10'],
		['23:~', 'F11'],
		['24:~', 'F12'],
	])

	/** Get special key mapping based on keycode and final character */
	private getSpecialKey(keycode: number, final: string): string | null {
		const key = `${keycode}:${final}`
		return VTParser.SPECIAL_KEYS.get(key) || null
	}

	/** Convert key name to Unicode codepoint */
	private keyToUnicode(key: string): number | null {
		if (key.length === 1) {
			return key.charCodeAt(0)
		}

		// Special keys
		switch (key) {
			case 'Enter':
				return 13
			case 'Tab':
				return 9
			case 'Escape':
				return 27
			case 'Backspace':
				return 127
			case ' ':
				return 32
		}

		return null
	}

	/** Check if a grapheme represents a shifted character */
	private isShifted(grapheme: string): boolean {
		return grapheme !== grapheme.toLowerCase()
	}

	/** Emit a key event to all handlers */
	private emitKeyEvent(event: KeyboardEvent): void {
		for (const handler of this.keyHandlers) {
			handler(event)
		}
	}

	/** Convert CSI sequence to DA1 event */
	private csiToDeviceAttributes(event: CsiEvent): DeviceAttributesPrimaryEvent | null {
		// Device Attributes (DA1) - ESC[?num;num;...c
		if (event.final === 'c' && event.private === '?') {
			let primary = 0
			let secondary: number[] = []

			if (event.params.length > 0) {
				primary = event.params[0]?.value || 0
				// Filter out parameters that are undefined/null and trailing zero from empty params
				let secondaryParams = event.params.slice(1)
				// Remove trailing parameter if it's zero and was from an empty parameter (like ending semicolon)
				if (
					secondaryParams.length > 0 &&
					secondaryParams[secondaryParams.length - 1]?.value === 0
				) {
					secondaryParams = secondaryParams.slice(0, -1)
				}
				secondary = secondaryParams.map((p) => p.value)
			}

			return {
				type: 'device_attributes_primary',
				primary,
				secondary,
			}
		}

		return null
	}

	/** Convert CSI sequence to DECRQSS event */
	private csiToDecrqss(event: CsiEvent): DecrqssResponseEvent | null {
		// DECRQSS response - ESC[?request;response$y
		if (event.final === 'y' && event.intermediates.includes('$')) {
			// Parameters should be [request, response] like ?2026;2
			if (event.params.length >= 2) {
				const request = `?${event.params[0]?.value || 0}`
				const response = String(event.params[1]?.value || 0)

				return {
					type: 'decrqss_response',
					request,
					response,
				}
			}
		}

		return null
	}

	/** Convert CSI sequence to Kitty keyboard protocol response */
	private csiToKittyKeyboardResponse(event: CsiEvent): DecrqssResponseEvent | null {
		// Kitty keyboard protocol response - ESC[?flags;mode1;mode2;...u
		if (event.final === 'u' && event.private === '?') {
			// First parameter is flags, which tells us what's supported
			if (event.params.length >= 1) {
				const flags = event.params[0]?.value || 0
				// If flags > 0, kitty keyboard protocol is supported
				const response = flags > 0 ? '1' : '0'

				return {
					type: 'decrqss_response',
					request: 'u',
					response,
				}
			}
		}

		return null
	}

	/** Emit a device attributes event to handlers */
	private emitDeviceAttributesEvent(event: DeviceAttributesPrimaryEvent): void {
		for (const handler of this.deviceAttributesHandlers) {
			handler(event)
		}
	}

	/** Convert CSI sequence to SGR mouse event */
	private csiToSgrMouse(event: CsiEvent): SgrMouseEvent | null {
		// SGR mouse events: ESC[<button;col;row;M or ESC[<button;col;row;m
		if ((event.final === 'M' || event.final === 'm') && event.private === '<') {
			if (event.params.length >= 3) {
				const button = event.params[0]?.value || 0
				const x = event.params[1]?.value || 1
				const y = event.params[2]?.value || 1

				// In SGR protocol:
				// - Button 3 means "no button pressed" (motion only)
				// - Button 0,1,2 with final 'M' means button press/drag
				// - Any button with final 'm' means release
				const baseButton = button & ~(4 | 8 | 16 | 32) // Remove modifier bits
				const pressed = event.final === 'M' && baseButton !== 3

				return {
					type: 'sgr_mouse',
					button,
					x,
					y,
					pressed,
				}
			}
		}

		return null
	}

	/** Emit a DECRQSS event to handlers */
	private emitDecrqssEvent(event: DecrqssResponseEvent): void {
		for (const handler of this.decrqssHandlers) {
			handler(event)
		}
	}

	/** Emit an SGR mouse event to handlers */
	private emitSgrMouseEvent(event: SgrMouseEvent): void {
		for (const handler of this.sgrMouseHandlers) {
			handler(event)
		}
	}

	/** Emit a mouse event to handlers */
	private emitMouseEvent(event: MouseEvent): void {
		for (const handler of this.mouseHandlers) {
			handler(event)
		}
	}

	/** Convert CSI sequence to focus event */
	private csiToFocus(event: CsiEvent): FocusEvent | null {
		// Focus events: ESC[I (focus in) and ESC[O (focus out)
		// Check for CSI with no intermediate and final I or O
		if (event.intermediates === '' && (event.final === 'I' || event.final === 'O')) {
			return {
				type: 'focus',
				focused: event.final === 'I',
			}
		}

		return null
	}

	/** Parse in-band resize events (CSI 48 ; rows ; cols ; pixel_y ; pixel_x t) */
	private csiToInBandResize(event: CsiEvent): ResizeEvent | null {
		// In-band resize: ESC[48;rows;cols;pixel_y;pixel_x;t
		if (event.final === 't' && event.params.length >= 5 && event.params[0]?.value === 48) {
			const rows = event.params[1]?.value || 0
			const cols = event.params[2]?.value || 0
			const pixelHeight = event.params[3]?.value || 0
			const pixelWidth = event.params[4]?.value || 0

			return {
				type: 'resize',
				width: cols,
				height: rows,
				pixelWidth,
				pixelHeight,
			}
		}

		return null
	}

	private csiToCursorPositionReport(event: CsiEvent): CursorPositionReportEvent | null {
		// Cursor Position Report: ESC[row;colR
		if (event.final === 'R' && event.params.length === 2) {
			const row = event.params[0]?.value || 0
			const col = event.params[1]?.value || 0

			return {
				type: 'cursor_position_report',
				row,
				col,
			}
		}

		return null
	}

	/** Emit a focus event to handlers */
	private emitFocusEvent(event: FocusEvent): void {
		for (const handler of this.focusHandlers) {
			handler(event)
		}
	}

	/** Emit a color palette change event to handlers */
	private emitColorPaletteChangeEvent(event: ColorPaletteChangeEvent): void {
		for (const handler of this.colorPaletteChangeHandlers) {
			handler({ ...event, type: 'colorPaletteChange' })
		}
	}

	/** Emit a cursor position report event to handlers */
	private emitCursorPositionReportEvent(event: CursorPositionReportEvent): void {
		for (const handler of this.cursorPositionReportHandlers) {
			handler(event)
		}
	}

	/** Emit a resize event to handlers */
	private emitResizeEvent(event: ResizeEvent): void {
		for (const handler of this.resizeHandlers) {
			handler(event)
		}
	}

	/** Handle bracketed paste start/end sequences */
	private handleBracketedPaste(event: CsiEvent): boolean {
		// Bracketed paste start: ESC[200~
		// Bracketed paste end: ESC[201~
		if (event.final === '~' && event.params.length === 1) {
			const param = event.params[0]?.value
			if (param === 200) {
				// Start bracketed paste
				this.inPaste = true
				this.pasteBuffer = ''
				return true
			} else if (param === 201) {
				// End bracketed paste
				if (this.inPaste) {
					this.inPaste = false
					this.emitPasteEvent({
						type: 'paste',
						text: this.pasteBuffer,
					})
					this.pasteBuffer = ''
				}
				return true
			}
		}
		return false
	}

	/** Emit a paste event to handlers */
	private emitPasteEvent(event: PasteEvent): void {
		for (const handler of this.pasteHandlers) {
			handler(event)
		}
	}
}

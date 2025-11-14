/**
 * Terminal feature detection system
 */

import logger from '../logger.js'

import { isJetBrainsTerminal } from '../ide-environment.js'
import { getTerminalPixelSize } from './terminal-size-ioctl.js'

export type UnderlineSupport = 'none' | 'standard' | 'fancy'

export interface TerminalCapabilities {
	/** Terminal supports synchronized output */
	syncOutput: boolean
	/** Terminal supports proper emoji width (mode 2027) */
	emojiWidth: boolean
	/** Terminal supports pixel-based mouse reporting (mode 1016) */
	pixelMouse: boolean
	/** Terminal reports pixel dimensions via winsize struct */
	pixelDimensions: boolean
	/** Terminal version string from XTVERSION */
	xtversion: string | null
	/** Terminal supports RGB colors (detected from TERM_PROGRAM) */
	canRgb: boolean
	/** Terminal supports cursor shape sequences */
	supportsCursorShape: boolean
	/** Terminal animation support level */
	animationSupport: 'fast' | 'slow' | 'disabled'
	/** Terminal supports Kitty keyboard protocol */
	kittyKeyboard: boolean
	/** Terminal supports OSC 52 clipboard (Ms termcap capability) */
	osc52: boolean
	/** Terminal supports Kitty graphics protocol */
	kittyGraphics: boolean
	/** Terminal background color mode (detected via OSC 11) */
	background: 'dark' | 'light' | 'unknown'
	/** Terminal supports color palette change notifications (mode 2031) */
	colorPaletteNotifications: boolean
	/** Terminal supports Kitty explicit width text sizing */
	kittyExplicitWidth: boolean
	/** Terminal underline rendering support level */
	underlineSupport: UnderlineSupport
	/** Terminal-optimized scroll step size */
	scrollStep(): number
}

/**
 * Creates a default terminal capabilities object with safe fallback values.
 *
 * **IMPORTANT**: This should only be used as a fallback when actual terminal
 * capabilities cannot be detected. Prefer using detected capabilities from
 * TerminalQueryParser.getCapabilities() whenever possible.
 *
 * Common use cases:
 * - Test environments where terminal detection is not available
 * - Fallback when getCapabilities() returns null/undefined
 * - Initial values before capability detection completes
 *
 * The defaults are conservative to ensure compatibility across terminals:
 * - Advanced features (syncOutput, pixelMouse, kittyKeyboard, osc52) are disabled
 * - Basic features (canRgb, supportsCursorShape) are enabled for broad compatibility
 * - Animation support defaults to 'fast' (can be overridden per-terminal)
 *
 * @param overrides - Optional partial overrides to customize specific capabilities
 * @returns A complete TerminalCapabilities object with all fields set
 */
export function createDefaultTerminalCapabilities(
	overrides?: Partial<TerminalCapabilities>,
): TerminalCapabilities {
	return {
		syncOutput: false,
		emojiWidth: false,
		pixelMouse: false,
		pixelDimensions: false,
		xtversion: null,
		canRgb: true,
		supportsCursorShape: true,
		animationSupport: 'fast',
		kittyKeyboard: false,
		osc52: false,
		kittyGraphics: false,
		background: 'unknown',
		colorPaletteNotifications: false,
		kittyExplicitWidth: false,
		underlineSupport: isJetBrainsTerminal() ? 'none' : 'standard',
		scrollStep: () => 3,
		...overrides,
	}
}

export interface TerminalQuery {
	/** The sequence to send to the terminal */
	sequence: string
	/** Human-readable description */
	description: string
	/** Is this the final query (DA1)? */
	isFinal?: boolean
	/** Should this query be sent? Return false to skip */
	shouldSend?(): boolean
}

/**
 * Terminal query sequences in order they should be sent
 */
export const TERMINAL_QUERIES: TerminalQuery[] = [
	{
		sequence: '\x1b[?1049h\x1b[H\x1b]66;w=1; \x1b\\\x1b[6n\x1b[?1049l',
		description: 'Query Kitty explicit width support',
	},
	{
		sequence: '\x1b]10;?\x07',
		description: 'Query terminal foreground color (OSC 10)',
	},
	{
		sequence: '\x1b]11;?\x07',
		description: 'Query terminal background color (OSC 11)',
	},
	{
		sequence: '\x1b]12;?\x07',
		description: 'Query terminal cursor color (OSC 12)',
	},
	{
		sequence: '\x1b]4;0;?\x07',
		description: 'Query terminal color 0 (OSC 4)',
	},
	{
		sequence: '\x1b]4;1;?\x07',
		description: 'Query terminal color 1 (OSC 4)',
	},
	{
		sequence: '\x1b]4;2;?\x07',
		description: 'Query terminal color 2 (OSC 4)',
	},
	{
		sequence: '\x1b]4;3;?\x07',
		description: 'Query terminal color 3 (OSC 4)',
	},
	{
		sequence: '\x1b]4;4;?\x07',
		description: 'Query terminal color 4 (OSC 4)',
	},
	{
		sequence: '\x1b]4;5;?\x07',
		description: 'Query terminal color 5 (OSC 4)',
	},
	{
		sequence: '\x1b]4;6;?\x07',
		description: 'Query terminal color 6 (OSC 4)',
	},
	{
		sequence: '\x1b]4;7;?\x07',
		description: 'Query terminal color 7 (OSC 4)',
	},
	{
		sequence: '\x1b[?2026$p',
		description: 'Query synchronized output support',
	},
	{
		sequence: '\x1b[?2027$p',
		description: 'Query emoji width mode support',
	},
	{
		sequence: '\x1b[?1016$p',
		description: 'Query pixel mouse mode support',
	},
	{
		sequence: '\x1b[?2031$p',
		description: 'Query color palette change notifications support (mode 2031)',
	},
	{
		sequence: '\x1b[?u',
		description: 'Query Kitty keyboard protocol support',
	},
	{
		sequence: '\x1b[>0q',
		description: 'Query terminal version (XTVERSION)',
	},
	{
		sequence: '\x1bP+q4d73\x1b\\',
		description: 'Query OSC 52 clipboard support (XTGETTCAP Ms)',
	},
	{
		sequence: '\x1b_Gi=1,a=q\x1b\\',
		description: 'Query Kitty graphics protocol support',
		shouldSend: () => !isJetBrainsTerminal() && process.env.TERM_PROGRAM !== 'Apple_Terminal',
	},
	{
		sequence: '\x1b[c',
		description: 'Device Attributes (DA1)',
		isFinal: true,
	},
]

/**
 * Parse terminal responses and extract capabilities
 */
export class TerminalQueryParser {
	private capabilities: TerminalCapabilities = {
		syncOutput: false,
		emojiWidth: false,
		pixelMouse: false,
		pixelDimensions: false,
		xtversion: null,
		canRgb: this.detectRgbSupport(),
		supportsCursorShape: this.detectCursorShapeSupport(),
		animationSupport: this.detectAnimationSupport(),
		kittyKeyboard: false,
		osc52: false,
		kittyGraphics: false,
		background: 'unknown',
		colorPaletteNotifications: false,
		kittyExplicitWidth: false,
		underlineSupport: isJetBrainsTerminal() ? 'none' : 'standard',
		scrollStep: () => this.getScrollStep(),
	}

	private complete: boolean = false
	private colorUpdateTimer: NodeJS.Timeout | null = null
	private onColorPaletteChange?: () => void
	private inbandPixelData: {
		pixelWidth: number
		pixelHeight: number
		columns: number
		rows: number
	} | null = null
	private kittyWidthQuerySent: boolean = false

	private rgbColors: {
		foreground: { r: number; g: number; b: number } | null
		background: { r: number; g: number; b: number } | null
		cursor: { r: number; g: number; b: number } | null
		indices: Array<{ r: number; g: number; b: number } | null>
	} = {
		foreground: null,
		background: null,
		cursor: null,
		indices: [null, null, null, null, null, null, null, null],
	}

	/**
	 * Process a DECRQSS response
	 */
	processDecrqss(request: string, response: string): boolean {
		// Handle synchronized output query response
		if (request === '?2026') {
			// Response can be "1" or "2" for supported, "0" for not supported
			this.capabilities.syncOutput = response === '1' || response === '2'
		}

		// Handle emoji width mode query response
		if (request === '?2027') {
			// Response can be "1" or "2" for supported, "0" for not supported
			this.capabilities.emojiWidth = response === '1' || response === '2'
		}

		// Handle pixel mouse mode query response
		if (request === '?1016') {
			// Response can be "1" or "2" for supported, "0" for not supported
			this.capabilities.pixelMouse = response === '1' || response === '2'
		}

		// Handle color palette change notifications query response (mode 2031)
		if (request === '?2031') {
			// Response can be "1" or "2" for supported, "0" for not supported
			this.capabilities.colorPaletteNotifications = response === '1' || response === '2'
		}

		// Handle kitty keyboard protocol query response
		if (request === 'u') {
			// Any response indicates support (terminals that don't support it won't respond)
			this.capabilities.kittyKeyboard = true
		}

		// DECRQSS responses don't complete initialization
		return false
	}

	/**
	 * Process a device attributes response
	 */
	processDeviceAttributes(_primary: number, _secondary: number[]): boolean {
		// Check for pixel dimensions capability
		this.checkPixelDimensions()

		// Apply JetBrains-specific capability overrides
		if (this.detectJetBrains()) {
			this.capabilities.emojiWidth = true
		}

		// DA1 means we're complete
		this.complete = true
		return true
	}

	/**
	 * Process an XTVERSION response (DCS format)
	 */
	processXtversion(versionString: string): boolean {
		this.capabilities.xtversion = versionString
		// XTVERSION doesn't complete initialization
		return false
	}

	/**
	 * Process an XTGETTCAP response for OSC 52 capability (DCS format)
	 */
	processXtgettcap(capability: string, value: string): boolean {
		// Check for Ms (OSC 52 clipboard) capability (case insensitive)
		if (capability.toLowerCase() === '4d73') {
			// "Ms" in hex
			// Any non-empty value indicates OSC 52 support
			this.capabilities.osc52 = value.length > 0
		}
		// XTGETTCAP doesn't complete initialization
		return false
	}

	/**
	 * Process a Kitty graphics protocol query response (APC format)
	 */
	processKittyGraphics(): boolean {
		// Any APC response starting with _G indicates Kitty graphics support
		this.capabilities.kittyGraphics = true
		// Kitty graphics response doesn't complete initialization
		return false
	}

	/**
	 * Process a cursor position report (CPR) for Kitty width detection
	 * Format: CSI row ; col R
	 *
	 * We send: cursor home + explicit width space + CPR query
	 * Expected: cursor at (1,2) if kitty supports explicit width
	 */
	processCursorPositionReport(row: number, col: number): boolean {
		if (this.kittyWidthQuerySent) {
			// After sending cursor home + width=1 space, check if cursor is at column 2
			// If kitty supports explicit width, cursor should be at (1, 2)
			const cursorMoved = row === 1 && col === 2

			if (cursorMoved) {
				this.capabilities.kittyExplicitWidth = true
				logger.info('Kitty explicit width support detected')
			}

			// Reset state
			this.kittyWidthQuerySent = false
		}

		// CPR doesn't complete initialization
		return false
	}

	/**
	 * Mark that kitty width query has been sent
	 */
	markKittyWidthQuerySent(): void {
		this.kittyWidthQuerySent = true
	}

	/**
	 * Process an OSC 10 foreground color response
	 * Format: "10;rgb:RRRR/GGGG/BBBB" or "10;rgba:RRRR/GGGG/BBBB/AAAA"
	 */
	processOsc10(data: string): boolean {
		const match = data.match(/^10;rgba?:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i)
		if (!match || !match[1] || !match[2] || !match[3]) {
			return false
		}

		const rHex = match[1]
		const gHex = match[2]
		const bHex = match[3]

		const normalize = (hex: string): number => {
			const value = Number.parseInt(hex, 16)
			const bits = hex.length * 4
			return (value / (2 ** bits - 1)) * 255
		}

		const r = Math.round(normalize(rHex))
		const g = Math.round(normalize(gHex))
		const b = Math.round(normalize(bHex))

		this.rgbColors.foreground = { r, g, b }

		return false
	}

	/**
	 * Process an OSC 11 background color response
	 * Format: "11;rgb:RRRR/GGGG/BBBB" or "11;rgba:RRRR/GGGG/BBBB/AAAA"
	 */
	processOsc11(data: string): boolean {
		const match = data.match(/^11;rgba?:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i)
		if (!match || !match[1] || !match[2] || !match[3]) {
			return false
		}

		const rHex = match[1]
		const gHex = match[2]
		const bHex = match[3]

		const normalize = (hex: string): number => {
			const value = Number.parseInt(hex, 16)
			const bits = hex.length * 4
			return (value / (2 ** bits - 1)) * 255
		}

		const r = Math.round(normalize(rHex))
		const g = Math.round(normalize(gHex))
		const b = Math.round(normalize(bHex))

		this.rgbColors.background = { r, g, b }

		const luminance = 0.299 * r + 0.587 * g + 0.114 * b
		this.capabilities.background = luminance < 128 ? 'dark' : 'light'

		return false
	}

	/**
	 * Process an OSC 12 cursor color response
	 * Format: "12;rgb:RRRR/GGGG/BBBB" or "12;rgba:RRRR/GGGG/BBBB/AAAA"
	 */
	processOsc12(data: string): boolean {
		const match = data.match(/^12;rgba?:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i)
		if (!match || !match[1] || !match[2] || !match[3]) {
			return false
		}

		const rHex = match[1]
		const gHex = match[2]
		const bHex = match[3]

		const normalize = (hex: string): number => {
			const value = Number.parseInt(hex, 16)
			const bits = hex.length * 4
			return (value / (2 ** bits - 1)) * 255
		}

		const r = Math.round(normalize(rHex))
		const g = Math.round(normalize(gHex))
		const b = Math.round(normalize(bHex))

		this.rgbColors.cursor = { r, g, b }

		return false
	}

	/**
	 * Process an OSC 4 color query response
	 * Format: "4;N;rgb:RRRR/GGGG/BBBB" or "4;N;rgba:RRRR/GGGG/BBBB/AAAA"
	 */
	processOsc4(data: string): boolean {
		const match = data.match(/^4;(\d+);rgba?:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i)
		if (!match || !match[1] || !match[2] || !match[3] || !match[4]) {
			return false
		}

		const index = Number.parseInt(match[1], 10)
		const rHex = match[2]
		const gHex = match[3]
		const bHex = match[4]

		const normalize = (hex: string): number => {
			const value = Number.parseInt(hex, 16)
			const bits = hex.length * 4
			return (value / (2 ** bits - 1)) * 255
		}

		const r = Math.round(normalize(rHex))
		const g = Math.round(normalize(gHex))
		const b = Math.round(normalize(bHex))

		if (index >= 0 && index <= 7) {
			this.rgbColors.indices[index] = { r, g, b }
		}

		return false
	}

	/**
	 * Set callback for color palette change notifications
	 */
	setColorPaletteChangeCallback(callback: () => void): void {
		this.onColorPaletteChange = callback
	}

	/**
	 * Handle color palette change notification from mode 2031.
	 * Triggers re-query of all colors and notifies callback when complete.
	 */
	handleColorPaletteChangeNotification(): void {
		logger.info('Color palette changed, re-querying colors...')

		// Reset cached colors to trigger fresh queries
		this.rgbColors = {
			foreground: null,
			background: null,
			cursor: null,
			indices: [null, null, null, null, null, null, null, null],
		}

		// Debounce: wait a bit before checking results in case terminal is slow
		if (this.colorUpdateTimer) {
			clearTimeout(this.colorUpdateTimer)
		}

		this.colorUpdateTimer = setTimeout(() => {
			// Check if we got all the responses
			const completeColors = this.getRgbColors()
			if (this.onColorPaletteChange && completeColors) {
				logger.info('Color re-query complete, notifying callback')
				this.onColorPaletteChange()
			}
			this.colorUpdateTimer = null
		}, 200) // 200ms to wait for all OSC responses
	}

	/**
	 * Get color query sequences to send when re-querying colors
	 */
	getColorQuerySequences(): string[] {
		return [
			'\x1b]10;?\x07', // Foreground
			'\x1b]11;?\x07', // Background
			'\x1b]12;?\x07', // Cursor
			'\x1b]4;0;?\x07', // Color 0
			'\x1b]4;1;?\x07', // Color 1
			'\x1b]4;2;?\x07', // Color 2
			'\x1b]4;3;?\x07', // Color 3
			'\x1b]4;4;?\x07', // Color 4
			'\x1b]4;5;?\x07', // Color 5
			'\x1b]4;6;?\x07', // Color 6
			'\x1b]4;7;?\x07', // Color 7
		]
	}

	/**
	 * Update pixel dimensions from in-band resize event
	 */
	updateInbandPixelData(
		width: number,
		height: number,
		pixelWidth?: number,
		pixelHeight?: number,
	): void {
		if (pixelWidth && pixelHeight && pixelWidth > 0 && pixelHeight > 0) {
			this.inbandPixelData = {
				pixelWidth,
				pixelHeight,
				columns: width,
				rows: height,
			}
			this.capabilities.pixelDimensions = true
		}
	}

	/**
	 * Check if terminal provides pixel dimensions via winsize struct or in-band resize
	 */
	private checkPixelDimensions(): void {
		// First check if we already have in-band pixel data
		if (this.inbandPixelData) {
			this.capabilities.pixelDimensions = true
			return
		}

		// Fallback to ioctl
		const pixelSize = getTerminalPixelSize()
		this.capabilities.pixelDimensions = !!(
			pixelSize &&
			pixelSize.pixelWidth > 0 &&
			pixelSize.pixelHeight > 0
		)
	}

	/**
	 * Check if all queries have been processed
	 */
	isComplete(): boolean {
		return this.complete
	}

	/**
	 * Get the detected capabilities
	 */
	getCapabilities(): TerminalCapabilities {
		return { ...this.capabilities }
	}

	/**
	 * Get queried RGB colors from terminal.
	 * Returns null if any required color query failed to receive a response.
	 */
	getRgbColors(): {
		fg: { r: number; g: number; b: number }
		bg: { r: number; g: number; b: number }
		cursor: { r: number; g: number; b: number }
		indices: Array<{ r: number; g: number; b: number }>
	} | null {
		if (!this.rgbColors.foreground || !this.rgbColors.background || !this.rgbColors.cursor) {
			logger.info('Missing fg, bg, or cursor color', {
				fg: !!this.rgbColors.foreground,
				bg: !!this.rgbColors.background,
				cursor: !!this.rgbColors.cursor,
			})
			return null
		}

		for (let i = 0; i < 8; i++) {
			if (!this.rgbColors.indices[i]) {
				logger.info(`Missing palette color ${i}`)
				return null
			}
		}

		logger.info('All RGB colors available', {
			fg: this.rgbColors.foreground,
			bg: this.rgbColors.background,
			cursor: this.rgbColors.cursor,
			indicesCount: this.rgbColors.indices.filter((c) => c !== null).length,
		})

		return {
			fg: this.rgbColors.foreground,
			bg: this.rgbColors.background,
			cursor: this.rgbColors.cursor,
			indices: this.rgbColors.indices as Array<{ r: number; g: number; b: number }>,
		}
	}

	/**
	 * Check if pixel mouse mode should be enabled
	 * Requires both pixel mouse support and pixel dimensions
	 */
	shouldUsePixelMouse(): boolean {
		return this.capabilities.pixelMouse && this.capabilities.pixelDimensions
	}

	/**
	 * Get pixel dimensions (prefers in-band data over ioctl)
	 */
	getPixelDimensions(): {
		pixelWidth: number
		pixelHeight: number
		columns: number
		rows: number
	} | null {
		// Prefer in-band pixel data if available
		if (this.inbandPixelData) {
			return this.inbandPixelData
		}

		// Fallback to ioctl
		const pixelSize = getTerminalPixelSize()
		if (pixelSize && pixelSize.pixelWidth > 0 && pixelSize.pixelHeight > 0) {
			return {
				pixelWidth: pixelSize.pixelWidth,
				pixelHeight: pixelSize.pixelHeight,
				columns: pixelSize.columns,
				rows: pixelSize.rows,
			}
		}

		return null
	}

	/**
	 * Get pending queries that haven't been responded to
	 */
	getPendingQueries(): string[] {
		return this.complete ? [] : ['\x1b[c']
	}

	/**
	 * Detect RGB color support based on TERM_PROGRAM environment variable
	 */
	private detectRgbSupport(): boolean {
		const termProgram = process.env['TERM_PROGRAM']

		// Apple Terminal has limited RGB support
		if (termProgram === 'Apple_Terminal') {
			return false
		}

		// Default to true for other terminals
		return true
	}

	/**
	 * Detect cursor shape sequence support
	 */
	private detectCursorShapeSupport(): boolean {
		// Skip cursor shape sequences in JetBrains terminals due to bugs
		// TODO: Remove this workaround once https://github.com/JetBrains/jediterm/pull/311 is merged and deployed
		// Emacs vterm is alright, but eat is not. Just skip for both.
		return !this.detectEmacs() && !this.detectJetBrains()
	}

	/**
	 * Detect animation support level
	 */
	private detectAnimationSupport(): 'fast' | 'slow' | 'disabled' {
		// Emacs terminals and SSH connections don't support animations
		if (this.detectEmacs() || this.detectSSH()) {
			return 'disabled'
		}
		// JetBrains connections are typically slower
		if (this.detectJetBrains()) {
			return 'slow'
		}
		// Default to fast for other terminals
		return 'fast'
	}

	/**
	 * Detect an Emacs terminal emulator
	 */
	private detectEmacs(): boolean {
		return !!process.env.INSIDE_EMACS
	}

	/**
	 * Detect JetBrains terminal
	 */
	private detectJetBrains(): boolean {
		return process.env.TERMINAL_EMULATOR?.includes('JetBrains') ?? false
	}

	/**
	 * Detect SSH connection
	 */
	private detectSSH(): boolean {
		return !!(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION)
	}

	/**
	 * Get terminal-optimized scroll step size
	 */
	private getScrollStep(): number {
		// Return 1 for Ghostty terminal for optimal scrolling
		if (this.capabilities.xtversion?.startsWith('ghostty')) {
			return 1
		}
		// Return 1 for JetBrains terminals for optimal scrolling
		if (isJetBrainsTerminal()) {
			return 1
		}
		// Default scroll step for other terminals
		return 3
	}
}

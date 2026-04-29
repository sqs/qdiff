/**
 * Main TUI library for terminal applications
 * Handles initialization, event management, and cleanup
 */

import type * as tty from 'node:tty'

import logger from '../logger.js'

import { isJetBrainsTerminal } from '../ide-environment.js'
import { clipboard } from './clipboard.js'
import type { MouseEvent } from './mouse.js'
import { sgrToMouseEvent } from './mouse.js'
import type { MouseCursorShape } from './mouse-cursor.js'
import { MouseCursor } from './mouse-cursor.js'
import type { FocusEvent, KeyboardEvent, OscEvent, PasteEvent } from './parser/index.js'
import { VTParser } from './parser/index.js'
import type { SgrMouseEvent } from './parser/types.js'
import { preprocessPasteText } from './paste-preprocessor.js'
import type { CursorShapeType } from './renderer.js'
import { Renderer } from './renderer.js'
import { Screen } from './screen.js'
import { setHighlightBackground } from './syntax-highlighter.js'
import type { TerminalCapabilities } from './terminal-queries.js'
import {
	createDefaultTerminalCapabilities,
	TERMINAL_QUERIES,
	TerminalQueryParser,
} from './terminal-queries.js'
import type { Tty } from './tty.js'
import { createTty } from './tty.js'

/** JetBrains terminals wheel event buffer window in milliseconds */
const JETBRAINS_WHEEL_BUFFER_WINDOW_MS = 50

/** JetBrains terminals wheel filter timeout in milliseconds */
const JETBRAINS_WHEEL_FILTER_TIMEOUT_MS = 200

/** Allow trailing terminal input to settle before handing stdin to a child process */
const SUBPROCESS_INPUT_SETTLE_MS = 25

/**
 * JetBrains terminal wheel event burst filter
 * Buffers initial events to determine direction, then filters subsequent events
 */
class JetBrainsWheelFilter {
	private eventBuffer: MouseEvent[] = []
	private bufferTimer: NodeJS.Timeout | null = null
	private filterDirection: 'wheel_up' | 'wheel_down' | null = null
	private lastEventTime: number = 0
	private onEmitEvent: (event: MouseEvent) => void = () => {}

	constructor(onEmitEvent: (event: MouseEvent) => void) {
		this.onEmitEvent = onEmitEvent
	}

	/**
	 * Process wheel events - buffer first burst, then filter subsequent events
	 */
	handleWheelEvent(event: MouseEvent): boolean {
		if (event.button !== 'wheel_up' && event.button !== 'wheel_down') {
			return true // Not a wheel event, allow it through immediately
		}

		const now = Date.now()

		// If we have an active filter, use it
		if (this.filterDirection !== null) {
			// Check if filter should expire
			if (now - this.lastEventTime > JETBRAINS_WHEEL_FILTER_TIMEOUT_MS) {
				this.filterDirection = null
			} else {
				this.lastEventTime = now
				// Filter based on determined direction
				return event.button === this.filterDirection
			}
		}

		// No active filter - use buffer logic
		this.lastEventTime = now
		this.eventBuffer.push(event)

		// If no timer exists, create one (rolling window from first event)
		if (!this.bufferTimer) {
			this.bufferTimer = setTimeout(() => {
				this.processBuffer()
			}, JETBRAINS_WHEEL_BUFFER_WINDOW_MS)
		}

		// Block the original event (we'll emit filtered ones later)
		return false
	}

	/**
	 * Process the buffered events, set filter direction, and emit results
	 */
	private processBuffer(): void {
		this.bufferTimer = null

		if (this.eventBuffer.length === 0) {
			return
		}

		// Check if we saw any wheel_down events
		const hasWheelDown = this.eventBuffer.some((event) => event.button === 'wheel_down')

		// Set filter direction based on buffer contents
		if (hasWheelDown) {
			this.filterDirection = 'wheel_down'
			// Only emit wheel_down events from buffer
			for (const event of this.eventBuffer) {
				if (event.button === 'wheel_down') {
					this.onEmitEvent(event)
				}
			}
		} else {
			this.filterDirection = 'wheel_up'
			// Emit all events from buffer (they're all wheel_up)
			for (const event of this.eventBuffer) {
				this.onEmitEvent(event)
			}
		}

		// Clear the buffer
		this.eventBuffer = []
	}
}

/** Terminal resize event */
export interface ResizeEvent {
	type: 'resize'
	width: number
	height: number
	pixelWidth?: number
	pixelHeight?: number
}

/** Terminal capability change event */
export interface CapabilityEvent {
	type: 'capability'
	capabilities: TerminalCapabilities
}

/** Union of all event types */
export type TuiEvent =
	| KeyboardEvent
	| MouseEvent
	| ResizeEvent
	| FocusEvent
	| PasteEvent
	| CapabilityEvent

/** Event handler function type */
export type EventHandler<T extends TuiEvent> = (event: T) => void

/** Main TUI class */
export class Tui {
	private parser: VTParser | null = null
	private initialized: boolean = false
	private inAltScreen: boolean = false
	private suspended: boolean = false

	// TTY abstraction for input
	private tty: Tty

	// Screen management
	private screen: Screen
	private renderer: Renderer

	// Terminal query system
	private queryParser: TerminalQueryParser | null = null
	private capabilities: TerminalCapabilities | null = null
	private capabilityPromise: Promise<TerminalCapabilities | null> | null = null
	private capabilityResolve: ((capabilities: TerminalCapabilities | null) => void) | null = null
	private capabilityTimeout: NodeJS.Timeout | null = null

	// Cached terminal size
	private terminalSize: { width: number; height: number } = { width: 80, height: 24 }

	// Note: Cursor state is now managed by the Screen object

	// Clipboard instance

	// JetBrains wheel filter instance
	private jetBrainsWheelFilter: JetBrainsWheelFilter

	// Mouse input is disabled for qdiff.
	private readonly mouseInputEnabled = false

	// Event handlers
	private keyHandlers: EventHandler<KeyboardEvent>[] = []
	private mouseHandlers: EventHandler<MouseEvent>[] = []
	private resizeHandlers: EventHandler<ResizeEvent>[] = []
	private focusHandlers: EventHandler<FocusEvent>[] = []
	private pasteHandlers: EventHandler<PasteEvent>[] = []
	private capabilityHandlers: EventHandler<CapabilityEvent>[] = []

	// Bound methods for cleanup
	private boundHandleResize = this.handleResize.bind(this)
	private boundCleanup = this.cleanup.bind(this)
	private boundHandleResume = this.handleResume.bind(this)

	// Resize handling state
	private resizeDebounceTimer: NodeJS.Timeout | null = null
	private pendingResize = false

	constructor() {
		this.screen = new Screen(80, 24)
		this.renderer = new Renderer()
		this.tty = createTty()

		this.jetBrainsWheelFilter = new JetBrainsWheelFilter((event: MouseEvent) => {
			// Emit filtered event to handlers
			for (const handler of this.mouseHandlers) {
				handler(event)
			}
		})
	}

	/** Initialize the library */
	init(): void {
		if (this.initialized) {
			throw new Error('TUI is already initialized')
		}
		if (!process.stdout.isTTY) {
			throw new Error('qdiff requires an interactive terminal; stdout is not a TTY')
		}

		try {
			// Create VT parser
			this.parser = new VTParser()
			this.parser.onKey(this.handleKeyEvent.bind(this))
			this.parser.onPaste(this.handlePasteEvent.bind(this))
			this.parser.onOsc(this.handleOscEvent.bind(this))

			// Initialize terminal query system
			this.queryParser = new TerminalQueryParser()

			// Set up query event handlers
			this.parser.onDeviceAttributes((event) => {
				if (this.queryParser && this.initialized) {
					const isComplete = this.queryParser.processDeviceAttributes(
						event.primary,
						event.secondary,
					)
					if (isComplete) {
						this.finishInitialization()
					}
				}
			})

			this.parser.onDecrqss((event) => {
				if (this.queryParser && this.initialized) {
					this.queryParser.processDecrqss(event.request, event.response)
				}
			})

			this.parser.onDcs((event) => {
				if (this.queryParser && this.initialized) {
					// XTVERSION responses come as DCS events with final character 'q'
					if (event.final === '|' && event.private === '>') {
						this.queryParser.processXtversion(event.data)
					}
					// XTGETTCAP responses come as DCS events with final character 'r'
					// Format: DCS 1 + r <capability>=<value> ST
					// Example: DCS 1 + r 4d73=\E]52;;?\E\\ ST (for Ms capability)
					if (
						event.final === 'r' &&
						event.intermediates === '+' &&
						event.params.length > 0 &&
						event.params[0]?.value === 1
					) {
						this.parseXtgettcapResponse(event.data)
					}
				}
			})

			this.parser.onApc((event) => {
				if (this.queryParser && this.initialized) {
					// Kitty graphics protocol responses start with 'G'
					if (event.data.startsWith('G')) {
						this.queryParser.processKittyGraphics()
					}
				}
			})

			this.parser.onCursorPositionReport((event) => {
				if (this.queryParser && this.initialized) {
					this.queryParser.processCursorPositionReport(event.row, event.col)
				}
			})

			this.parser.onColorPaletteChange((_event) => {
				if (this.queryParser && this.initialized) {
					// Re-query all colors when palette changes (mode 2031 notification)
					logger.info('Color palette change detected, re-querying colors')
					const queries = this.queryParser.getColorQuerySequences()
					for (const query of queries) {
						process.stdout.write(query)
					}
					// Notification will be sent after responses are received
					this.queryParser.handleColorPaletteChangeNotification()
				}
			})

			// Set up mouse event forwarding with JetBrains wheel filtering
			this.parser.onMouse((event) => {
				// Apply JetBrains wheel filtering only in JetBrains terminals
				if (isJetBrainsTerminal() && !this.jetBrainsWheelFilter.handleWheelEvent(event)) {
					return // Event was buffered for filtering
				}

				// For non-JetBrains terminals or non-wheel events, forward directly
				for (const handler of this.mouseHandlers) {
					handler(event)
				}
			})

			// Set up focus event forwarding
			this.parser.onFocus((event) => {
				for (const handler of this.focusHandlers) {
					handler(event)
				}
			})

			// Set up inband resize event forwarding
			this.parser.onResize((event) => {
				this.handleInbandResize(event)
			})

			// Handle input data from tty
			this.tty.on('data', (data: Buffer) => {
				// Always parse through the VT parser
				this.parser?.parse(data)
			})

			// Resume tty to start receiving data
			this.tty.resume()

			// Handle terminal resize via SIGWINCH signal
			process.on('SIGWINCH', this.boundHandleResize)

			// Get initial terminal size
			this.updateTerminalSize()

			// Resize screen to match actual terminal size
			this.screen.resize(this.terminalSize.width, this.terminalSize.height)

			// Setup cleanup handlers
			this.setupCleanupHandlers()

			this.initialized = true

			// Enable bracketed paste immediately.
			// Mouse reporting stays disabled to keep qdiff keyboard-only.
			if (this.mouseInputEnabled) {
				this.enableMouse()
			}
			this.enableBracketedPaste()

			// Create capability promise before starting detection
			this.createCapabilityPromise()

			// Start background capability detection
			this.startCapabilityDetection()
		} catch (error) {
			this.deinit()
			throw error
		}
	}

	/** Deinitialize the library */
	deinit(): void {
		// Reset styles, exit alt screen, show cursor before cleanup
		if (this.initialized) {
			let output = ''
			output +=
				this.renderer.reset() +
				this.renderer.disableMouse() +
				this.renderer.disableEmojiWidth() +
				this.renderer.disableInBandResize() +
				this.renderer.disableBracketedPaste() +
				this.renderer.disableKittyKeyboard() +
				this.renderer.setCursorShape(0) +
				this.renderer.showCursor()

			// Disable color palette notifications if enabled
			if (this.capabilities?.colorPaletteNotifications) {
				output += '\x1b[?2031l'
			}

			if (this.capabilities?.xtversion?.startsWith('ghostty')) {
				output += this.renderer.setProgressBarOff()
			}

			if (this.inAltScreen) {
				output += this.renderer.exitAltScreen()
				this.inAltScreen = false
			}

			process.stdout.write(output)
		}

		// Clean up resize timer
		if (this.resizeDebounceTimer) {
			clearTimeout(this.resizeDebounceTimer)
			this.resizeDebounceTimer = null
		}

		// Clean up capability timeout
		if (this.capabilityTimeout) {
			clearTimeout(this.capabilityTimeout)
			this.capabilityTimeout = null
		}

		// Clear all event handler arrays to prevent memory leaks
		this.keyHandlers.length = 0
		this.mouseHandlers.length = 0
		this.resizeHandlers.length = 0
		this.focusHandlers.length = 0
		this.pasteHandlers.length = 0
		this.capabilityHandlers.length = 0

		// Remove signal handlers
		process.removeListener('SIGWINCH', this.boundHandleResize)
		process.removeListener('SIGINT', this.boundCleanup)
		process.removeListener('SIGTERM', this.boundCleanup)
		process.removeListener('exit', this.boundCleanup)
		process.removeListener('SIGCONT', this.boundHandleResume)

		// Clean up tty (handles raw mode restoration)
		this.tty.dispose()

		this.parser = null
		this.queryParser = null
		this.capabilities = null
		this.capabilityPromise = null
		this.capabilityResolve = null
		this.initialized = false
	}

	/** Register a key event handler */
	onKey(handler: EventHandler<KeyboardEvent>): void {
		this.keyHandlers.push(handler)
	}

	/** Remove a key event handler */
	offKey(handler: EventHandler<KeyboardEvent>): void {
		const index = this.keyHandlers.indexOf(handler)
		if (index !== -1) {
			this.keyHandlers.splice(index, 1)
		}
	}

	/** Register a mouse event handler */
	onMouse(handler: EventHandler<MouseEvent>): void {
		this.mouseHandlers.push(handler)
	}

	/** Remove a mouse event handler */
	offMouse(handler: EventHandler<MouseEvent>): void {
		const index = this.mouseHandlers.indexOf(handler)
		if (index !== -1) {
			this.mouseHandlers.splice(index, 1)
		}
	}

	/** Register a resize event handler */
	onResize(handler: EventHandler<ResizeEvent>): void {
		this.resizeHandlers.push(handler)
	}

	/** Remove a resize event handler */
	offResize(handler: EventHandler<ResizeEvent>): void {
		const index = this.resizeHandlers.indexOf(handler)
		if (index !== -1) {
			this.resizeHandlers.splice(index, 1)
		}
	}

	/** Register a focus event handler */
	onFocus(handler: EventHandler<FocusEvent>): void {
		this.focusHandlers.push(handler)
	}

	/** Remove a focus event handler */
	offFocus(handler: EventHandler<FocusEvent>): void {
		const index = this.focusHandlers.indexOf(handler)
		if (index !== -1) {
			this.focusHandlers.splice(index, 1)
		}
	}

	/** Register a paste event handler */
	onPaste(handler: EventHandler<PasteEvent>): void {
		this.pasteHandlers.push(handler)
	}

	/** Remove a paste event handler */
	offPaste(handler: EventHandler<PasteEvent>): void {
		const index = this.pasteHandlers.indexOf(handler)
		if (index !== -1) {
			this.pasteHandlers.splice(index, 1)
		}
	}

	/** Register a capability change event handler */
	onCapabilities(handler: EventHandler<CapabilityEvent>): void {
		this.capabilityHandlers.push(handler)
	}

	/** Remove a capability change event handler */
	offCapabilities(handler: EventHandler<CapabilityEvent>): void {
		const index = this.capabilityHandlers.indexOf(handler)
		if (index !== -1) {
			this.capabilityHandlers.splice(index, 1)
		}
	}

	/** Check if library is initialized */
	isInitialized(): boolean {
		return this.initialized
	}

	/** Get detected terminal capabilities */
	getCapabilities(): TerminalCapabilities | null {
		return this.capabilities
	}

	/** Get terminal query parser */
	getQueryParser(): TerminalQueryParser | null {
		return this.queryParser
	}

	/** Wait for terminal capabilities to be detected */
	async waitForCapabilities(timeout: number = 1000): Promise<TerminalCapabilities | null> {
		if (!this.initialized) {
			throw new Error('TUI is not initialized')
		}

		if (this.capabilities) {
			return this.capabilities
		}

		if (!this.capabilityPromise) {
			throw new Error('Capability detection not started')
		}

		return this.capabilityPromise
	}

	/** Get terminal size */
	getSize(): { width: number; height: number } {
		return { ...this.terminalSize }
	}

	/** Get the screen buffer for drawing */
	getScreen(): Screen {
		return this.screen
	}

	/** Render the current screen to the terminal */
	render(): void {
		if (!this.initialized) {
			throw new Error('TUI not initialized')
		}

		if (this.suspended) {
			return
		}

		const diffs = this.screen.getDiff()
		const cursorPosition = this.screen.getCursor()
		const needsRender = diffs.length > 0 || cursorPosition !== null

		if (needsRender) {
			let output = ''

			// Start synchronized output
			output += this.renderer.startSync()

			// Hide cursor during rendering
			output += this.renderer.hideCursor()

			// Reset all styles and position cursor to ensure clean state
			output += this.renderer.reset()
			output += this.renderer.moveTo(0, 0)

			// Render the diffs
			const renderedDiffs = this.renderer.render(diffs)
			output += renderedDiffs

			// Handle cursor positioning
			if (cursorPosition && this.screen.isCursorVisible()) {
				output += this.renderer.moveTo(cursorPosition.x, cursorPosition.y)
				output += this.renderer.setCursorShape(
					this.screen.getCursorShape() as CursorShapeType,
				)
				output += this.renderer.showCursor()
			} else {
				output += this.renderer.hideCursor()
			}

			// End synchronized output
			output += this.renderer.endSync()

			process.stdout.write(output)
			this.screen.present() // Swap buffers
		}
	}

	/** Clear the screen and reset cursor */
	clearScreen(): void {
		const output = this.renderer.clearScreen() + this.renderer.hideCursor()
		process.stdout.write(output)
		this.renderer.resetState()
	}

	/** Show the cursor */
	showCursor(): void {
		process.stdout.write(this.renderer.showCursor())
	}

	/** Hide the cursor */
	hideCursor(): void {
		process.stdout.write(this.renderer.hideCursor())
	}

	/** Set cursor position for next render */
	setCursor(x: number, y: number): void {
		this.screen.setCursor(x, y)
	}

	/** Clear cursor (hide it) */
	clearCursor(): void {
		this.screen.clearCursor()
	}

	/** Set cursor shape */
	setCursorShape(shape: CursorShapeType): void {
		this.screen.setCursorShape(shape)
	}

	/** Set mouse cursor shape */
	setMouseCursor(shape: MouseCursorShape): void {
		// Most terminals support OSC 22 sequence for cursor shape
		const escape = `\x1b]22;${shape}\x07`
		process.stdout.write(escape)
	}

	/** Reset mouse cursor to default */
	resetMouseCursor(): void {
		this.setMouseCursor(MouseCursor.DEFAULT)
	}

	/** Enable bracketed paste mode */
	enableBracketedPaste(): void {
		process.stdout.write(this.renderer.enableBracketedPaste())
	}

	/** Disable bracketed paste mode */
	disableBracketedPaste(): void {
		process.stdout.write(this.renderer.disableBracketedPaste())
	}

	/** Enable kitty keyboard protocol */
	enableKittyKeyboard(): void {
		process.stdout.write(this.renderer.enableKittyKeyboard())
	}

	/** Disable kitty keyboard protocol */
	disableKittyKeyboard(): void {
		process.stdout.write(this.renderer.disableKittyKeyboard())
	}

	/** Write text to clipboard */
	async writeClipboard(text: string): Promise<void> {
		return clipboard.writeText(text)
	}

	/** Get the clipboard instance */
	get clipboard() {
		return clipboard
	}

	/** Enter alternate screen buffer */
	enterAltScreen(): void {
		if (!this.initialized) {
			throw new Error('TUI not initialized')
		}

		if (!this.inAltScreen) {
			process.stdout.write(this.renderer.enterAltScreen())
			this.inAltScreen = true
		}
	}

	/** Exit alternate screen buffer */
	exitAltScreen(): void {
		if (this.inAltScreen) {
			process.stdout.write(this.renderer.exitAltScreen())
			this.inAltScreen = false
		}
	}

	/** Check if currently in alternate screen */
	isInAltScreen(): boolean {
		return this.inAltScreen
	}

	/** Enable mouse reporting */
	enableMouse(): void {
		if (this.initialized) {
			const usePixelMouse = this.queryParser?.shouldUsePixelMouse() ?? false
			const mouseSequence = this.renderer.enableMouse(usePixelMouse)
			process.stdout.write(mouseSequence)
		}
	}

	/** Disable mouse reporting */
	disableMouse(): void {
		if (this.initialized) {
			// Always disable all mouse modes to ensure clean state
			process.stdout.write(this.renderer.disableMouse())
		}
	}

	/** Enable emoji width mode */
	enableEmojiWidth(): void {
		if (this.initialized) {
			const emojiSequence = this.renderer.enableEmojiWidth()
			process.stdout.write(emojiSequence)
		}
	}

	/** Disable emoji width mode */
	disableEmojiWidth(): void {
		if (this.initialized) {
			process.stdout.write(this.renderer.disableEmojiWidth())
		}
	}

	/** Enable in-band resize mode */
	enableInBandResize(): void {
		if (this.initialized) {
			const resizeSequence = this.renderer.enableInBandResize()
			process.stdout.write(resizeSequence)
		}
	}

	/** Disable in-band resize mode */
	disableInBandResize(): void {
		if (this.initialized) {
			process.stdout.write(this.renderer.disableInBandResize())
		}
	}

	/** Enable color palette change notifications (mode 2031) */
	enableColorPaletteNotifications(): void {
		if (this.initialized) {
			logger.info('Enabling mode 2031 (color palette change notifications)')
			process.stdout.write('\x1b[?2031h')
		}
	}

	/** Disable color palette change notifications (mode 2031) */
	disableColorPaletteNotifications(): void {
		if (this.initialized) {
			process.stdout.write('\x1b[?2031l')
		}
	}

	/** Set mouse cursor shape */
	setMouseShape(shape: string): void {
		if (this.initialized) {
			process.stdout.write(this.renderer.setMouseShape(shape))
		}
	}

	private buildSuspendOutput(): string {
		let output = ''
		output +=
			this.renderer.reset() +
			this.renderer.disableMouse() +
			this.renderer.disableEmojiWidth() +
			this.renderer.disableInBandResize() +
			this.renderer.disableBracketedPaste() +
			this.renderer.disableKittyKeyboard() +
			this.renderer.setCursorShape(0) +
			this.renderer.showCursor()

		if (this.capabilities?.colorPaletteNotifications) {
			output += '\x1b[?2031l'
		}

		if (this.capabilities?.xtversion?.startsWith('ghostty')) {
			output += this.renderer.setProgressBarOff()
		}

		if (this.inAltScreen) {
			output += this.renderer.exitAltScreen()
			this.inAltScreen = false
		}

		return output
	}

	private finishSuspend(): void {
		// Pause tty (handles raw mode)
		this.tty.pause()

		// Explicitly pause process.stdin to prevent input contention
		// This is critical when spawning child processes that need stdin
		// even if we use spawn with stdio: 'inherit'
		if (process.stdin && !process.stdin.destroyed) {
			process.stdin.pause()
		}

		this.suspended = true

		// Flush stdout before suspending
		if (process.stdout.isTTY) {
			process.stdout.uncork()
		}
	}

	private async writeStdout(output: string): Promise<void> {
		if (output.length === 0) {
			return
		}

		await new Promise<void>((resolve, reject) => {
			process.stdout.write(output, (error?: Error | null) => {
				if (error) {
					reject(error)
					return
				}

				resolve()
			})
		})
	}

	/** Suspend TUI - exit alt screen and reset all terminal state */
	suspend(): void {
		if (!this.initialized || this.suspended) {
			return
		}

		process.stdout.write(this.buildSuspendOutput())
		this.finishSuspend()
	}

	/** Suspend TUI before spawning an interactive child process */
	async suspendForSubprocess(): Promise<void> {
		if (!this.initialized || this.suspended) {
			return
		}

		await this.writeStdout(this.buildSuspendOutput())

		// Keep reading briefly so terminal-generated trailing bytes from the
		// triggering key chord do not leak into the child process.
		await new Promise((resolve) => setTimeout(resolve, SUBPROCESS_INPUT_SETTLE_MS))

		this.parser?.reset()
		this.finishSuspend()
	}

	/** Resume TUI - re-enter alt screen and restore all terminal state */
	resume(): void {
		if (!this.initialized || !this.suspended) {
			return
		}

		// Resume tty (handles raw mode)
		this.tty.resume()

		// Reset parser state to handle any partial sequences
		if (this.parser) {
			this.parser.reset()
		}

		// Re-enter alternate screen buffer
		this.enterAltScreen()

		// Hide cursor after re-entering alt screen
		this.hideCursor()

		// Re-enable terminal features
		if (this.mouseInputEnabled) {
			this.enableMouse()
		}
		this.enableBracketedPaste()

		// Re-enable optional features if they were supported
		if (this.capabilities?.emojiWidth) {
			this.enableEmojiWidth()
		}

		if (this.capabilities?.kittyKeyboard) {
			this.enableKittyKeyboard()
		}

		// Always re-enable in-band resize mode
		this.enableInBandResize()

		// Mark screen for full refresh
		this.screen.markForRefresh()

		// Mark as resumed
		this.suspended = false
	}

	/** Check if TUI is currently suspended */
	isSuspended(): boolean {
		return this.suspended
	}

	/** Handle suspend request - suspends TUI and sends SIGTSTP to process */
	handleSuspend(): void {
		if (!this.initialized || this.suspended) {
			return
		}

		// Only attempt to suspend if the system supports SIGTSTP (Unix-like systems)
		if (process.platform === 'win32') {
			return
		}

		// Suspend the TUI (this handles all cleanup)
		this.suspend()

		try {
			process.kill(0, 'SIGTSTP')
			logger.debug(`Successfully suspended process ${process.pid}`)
		} catch (error) {
			logger.debug(`Failed to suspend process ${process.pid}: ${error}`)
		}
	}

	/** Handle SIGCONT signal (fg) */
	private handleResume(): void {
		if (!this.initialized || !this.suspended) {
			return
		}

		// Resume the TUI (this restores all state)
		this.resume()

		// Force immediate render to prevent blank screen after resume
		// Use setImmediate to ensure terminal state is fully restored first
		// This fixes the issue where the screen appears blank until a key is pressed
		setImmediate(() => {
			if (this.initialized && !this.suspended) {
				this.render()
			}
		})
	}

	/** Update cached terminal size */
	private updateTerminalSize(): void {
		if (!this.tty.stdin || !isTTY(this.tty.stdin)) {
			this.terminalSize = { width: 80, height: 24 }
			return
		}

		try {
			// Fallback: Try to get from process.stdout if it's a TTY
			if (process.stdout.isTTY && process.stdout.columns && process.stdout.rows) {
				this.terminalSize = { width: process.stdout.columns, height: process.stdout.rows }
				return
			}

			// Last fallback: Try getWindowSize if available
			const size = process.stdout.getWindowSize()
			// getWindowSize returns [columns, rows] or [0, 0] on error
			if (size[0] > 0 && size[1] > 0) {
				this.terminalSize = { width: size[0], height: size[1] }
				return
			}
		} catch (error) {
			// Ignore errors and keep current size
		}
	}

	/** Handle key events from parser */
	private handleKeyEvent(event: KeyboardEvent): void {
		for (const handler of this.keyHandlers) {
			handler(event)
		}
	}

	private handlePasteEvent(event: PasteEvent): void {
		// Preprocess paste text to normalize line endings and strip control characters
		const processedEvent: PasteEvent = {
			type: 'paste',
			text: preprocessPasteText(event.text),
		}

		for (const handler of this.pasteHandlers) {
			handler(processedEvent)
		}
	}

	/** Handle OSC events from terminal */
	private handleOscEvent(event: OscEvent): void {
		// Check if this is an OSC 10 foreground color response
		// OSC 10 responses have format: "10;rgb:RRRR/GGGG/BBBB" or "10;rgba:RRRR/GGGG/BBBB/AAAA"
		if (event.data.startsWith('10;') && this.queryParser) {
			this.queryParser.processOsc10(event.data)
			return
		}

		// Check if this is an OSC 11 background color response
		// OSC 11 responses have format: "11;rgb:RRRR/GGGG/BBBB" or "11;rgba:RRRR/GGGG/BBBB/AAAA"
		if (event.data.startsWith('11;') && this.queryParser) {
			this.queryParser.processOsc11(event.data)
			return
		}

		// Check if this is an OSC 12 cursor color response
		// OSC 12 responses have format: "12;rgb:RRRR/GGGG/BBBB" or "12;rgba:RRRR/GGGG/BBBB/AAAA"
		if (event.data.startsWith('12;') && this.queryParser) {
			this.queryParser.processOsc12(event.data)
			return
		}

		// Check if this is an OSC 4 color query response
		// OSC 4 responses have format: "4;N;rgb:RRRR/GGGG/BBBB" or "4;N;rgba:RRRR/GGGG/BBBB/AAAA"
		if (event.data.startsWith('4;') && this.queryParser) {
			this.queryParser.processOsc4(event.data)
			return
		}

		// Check if this is an OSC 52 clipboard response
		// OSC 52 responses have format: "52;c;base64data"
		if (event.data.startsWith('52;c;')) {
			const base64Data = event.data.slice(5) // Remove "52;c;" prefix
			if (base64Data && base64Data !== '?') {
				// Pass to clipboard handler
				clipboard.handleOSC52Response(base64Data)
			}
		}
	}

	/** Create capability promise */
	private createCapabilityPromise(): void {
		this.capabilityPromise = new Promise<TerminalCapabilities | null>((resolve) => {
			this.capabilityResolve = resolve
		})
	}

	/** Start background capability detection (non-blocking) */
	private startCapabilityDetection(): void {
		if (!this.tty.stdin || !isTTY(this.tty.stdin)) {
			// Resolve with null capabilities for non-TTY
			if (this.capabilityResolve) {
				this.capabilityResolve(null)
			}
			return
		}

		// Create the query parser to handle responses
		this.queryParser = new TerminalQueryParser()

		// Bypass for Apple Terminal with hardcoded capabilities
		if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
			const appleTerminalCapabilities = createDefaultTerminalCapabilities({
				canRgb: false, // Apple Terminal has limited RGB support
			})

			this.capabilities = appleTerminalCapabilities

			// Notify capability change handlers
			const capabilityEvent: CapabilityEvent = {
				type: 'capability',
				capabilities: this.capabilities,
			}

			// Update renderer with new capabilities for RGB fallback
			this.renderer.updateCapabilities(this.capabilities)

			for (const handler of this.capabilityHandlers) {
				handler(capabilityEvent)
			}

			// Resolve immediately with hardcoded capabilities
			if (this.capabilityResolve) {
				this.capabilityResolve(appleTerminalCapabilities)
				this.capabilityResolve = null
			}

			return
		}

		// Send terminal queries immediately
		for (const query of TERMINAL_QUERIES) {
			if (query.shouldSend && !query.shouldSend()) {
				continue
			}
			process.stdout.write(query.sequence)

			// Mark when kitty width query is sent
			if (query.description === 'Query Kitty explicit width support') {
				this.queryParser.markKittyWidthQuerySent()
			}
		}

		// Set timeout in case DA1 doesn't arrive, but resolve with partial capabilities
		this.capabilityTimeout = setTimeout(() => {
			if (!this.capabilities && this.capabilityResolve && this.queryParser) {
				this.finishInitialization()
			}
		}, 2_000)
	}

	/** Process capability detection responses - only called once when DA1 is received */
	private finishInitialization(): void {
		// Check if still initialized (avoid race condition with deinit)
		if (!this.initialized || !this.queryParser || this.capabilities) {
			return
		}

		// Store capabilities when they're updated
		this.capabilities = this.queryParser.getCapabilities()

		// Clear the timeout since we got a response
		if (this.capabilityTimeout) {
			clearTimeout(this.capabilityTimeout)
			this.capabilityTimeout = null
		}

		// Notify capability change handlers
		const capabilityEvent: CapabilityEvent = {
			type: 'capability',
			capabilities: this.capabilities,
		}

		// Update renderer with new capabilities for RGB fallback
		this.renderer.updateCapabilities(this.capabilities)

		// Update syntax highlighting color scheme based on background
		setHighlightBackground(this.capabilities.background)

		for (const handler of this.capabilityHandlers) {
			handler(capabilityEvent)
		}

		// Resolve the capability promise
		if (this.capabilityResolve) {
			// Log discovered terminal capabilities when promise resolves
			logger.info('Terminal capabilities detected:', this.capabilities)
			this.capabilityResolve(this.capabilities)
			this.capabilityResolve = null
		}

		// Set up pixel mouse converter if both pixel mouse and pixel dimensions are available
		if (this.queryParser.shouldUsePixelMouse()) {
			const pixelDimensions = this.queryParser.getPixelDimensions()
			if (pixelDimensions) {
				const cellWidth = pixelDimensions.pixelWidth / pixelDimensions.columns
				const cellHeight = pixelDimensions.pixelHeight / pixelDimensions.rows

				this.parser?.setSgrToMouseConverter((sgr: SgrMouseEvent) =>
					sgrToMouseEvent(sgr, true, cellWidth, cellHeight),
				)
			}
		}

		// Enable emoji width mode if supported
		if (this.capabilities.emojiWidth) {
			this.enableEmojiWidth()
		}

		// Enable kitty keyboard protocol if supported
		if (this.capabilities.kittyKeyboard) {
			this.enableKittyKeyboard()
		}

		// Always enable in-band resize mode
		this.enableInBandResize()

		// Enable color palette change notifications if supported
		if (this.capabilities.colorPaletteNotifications) {
			this.enableColorPaletteNotifications()
		}

		// Update clipboard with capabilities
		clipboard.setCapabilities(this.capabilities)
	}

	/** Parse XTGETTCAP response data */
	private parseXtgettcapResponse(data: string): void {
		if (!this.queryParser) {
			return
		}

		// XTGETTCAP response format: "<capability>=<value>"
		// Example: "4d73=\E]52;;?\E\\" for Ms capability
		// No need to check for 'r' prefix since that's the DCS final character
		const equalIndex = data.indexOf('=')
		if (equalIndex !== -1) {
			const capability = data.slice(0, equalIndex)
			const value = data.slice(equalIndex + 1)

			const isComplete = this.queryParser.processXtgettcap(capability, value)
			if (isComplete) {
				this.finishInitialization()
			}
		}
	}

	/** Handle terminal resize from SIGWINCH signal */
	private handleResize(): void {
		// Mark that we have a pending resize
		this.pendingResize = true

		// Clear any existing debounce timer
		if (this.resizeDebounceTimer) {
			clearTimeout(this.resizeDebounceTimer)
		}

		// Debounce resize handling to avoid processing rapid signals
		this.resizeDebounceTimer = setTimeout(() => {
			this.processResize()
		}, 10) // Small delay to batch rapid resize events
	}

	/** Handle inband resize events from terminal */
	private handleInbandResize(event: ResizeEvent): void {
		// Update our cached terminal size with the precise values
		this.terminalSize = {
			width: event.width,
			height: event.height,
		}

		// Update pixel dimensions in capability detection if available
		if (this.queryParser && event.pixelWidth && event.pixelHeight) {
			const wasPixelMouseAvailable = this.queryParser.shouldUsePixelMouse()

			this.queryParser.updateInbandPixelData(
				event.width,
				event.height,
				event.pixelWidth,
				event.pixelHeight,
			)

			const isPixelMouseAvailable = this.queryParser.shouldUsePixelMouse()

			// If pixel mouse just became available, re-enable mouse with pixel mode
			if (
				this.mouseInputEnabled &&
				!wasPixelMouseAvailable &&
				isPixelMouseAvailable
			) {
				this.disableMouse()
				this.enableMouse()
			}

			// Re-setup pixel mouse converter with updated data if pixel mouse is supported
			if (isPixelMouseAvailable) {
				const cellWidth = event.pixelWidth / event.width
				const cellHeight = event.pixelHeight / event.height

				this.parser?.setSgrToMouseConverter((sgr: SgrMouseEvent) =>
					sgrToMouseEvent(sgr, true, cellWidth, cellHeight),
				)
			}
		}

		// Resize screen buffers immediately (no debouncing needed for inband)
		this.screen.resize(event.width, event.height)

		// Forward the complete event (including pixel dimensions) to handlers
		setImmediate(() => {
			for (const handler of this.resizeHandlers) {
				try {
					handler(event)
				} catch (error) {
					logger.error('Error in resize handler:', error)
				}
			}
		})
	}

	/** Process the actual resize after debouncing */
	private processResize(): void {
		if (!this.pendingResize || !this.initialized) {
			return
		}

		// Get old size before updating
		const oldSize = { ...this.terminalSize }

		// Update cached size
		this.updateTerminalSize()

		// Check if size actually changed
		if (
			oldSize.width === this.terminalSize.width &&
			oldSize.height === this.terminalSize.height
		) {
			this.pendingResize = false
			return
		}

		// Size changed, proceed with resize
		this.finishResize()
		this.pendingResize = false
	}

	/** Complete the resize process after size change is confirmed */
	private finishResize(): void {
		// Resize screen buffers
		this.screen.resize(this.terminalSize.width, this.terminalSize.height)

		const resizeEvent: ResizeEvent = {
			type: 'resize',
			width: this.terminalSize.width,
			height: this.terminalSize.height,
		}

		// Deliver resize events asynchronously to avoid blocking signal processing
		setImmediate(() => {
			for (const handler of this.resizeHandlers) {
				try {
					handler(resizeEvent)
				} catch (error) {
					logger.error('Error in resize handler:', error)
				}
			}
		})
	}

	/** Setup cleanup handlers for graceful shutdown */
	private setupCleanupHandlers(): void {
		// Silence EventEmitter warnings in production
		if (process.env.NODE_ENV === 'production') {
			process.setMaxListeners(0) // Unlimited listeners in production
		}

		process.on('SIGINT', this.boundCleanup)
		process.on('SIGTERM', this.boundCleanup)
		process.on('exit', this.boundCleanup)
		process.on('SIGCONT', this.boundHandleResume)
	}

	/** Cleanup method for signal handlers */
	private cleanup(): void {
		try {
			this.deinit()
		} catch {
			// Ignore cleanup errors
		}
	}
}

/** Factory function to create a new TUI instance */
export function createTui(): Tui {
	return new Tui()
}

/** Type guard to safely identify TTY streams */
function isTTY(stream: NodeJS.ReadableStream): stream is tty.ReadStream {
	return (
		'isTTY' in stream &&
		stream.isTTY === true &&
		typeof (stream as Partial<tty.ReadStream>).setRawMode === 'function'
	)
}

import logger from '../logger.js'

import type { MouseEvent } from '../lib/mouse.js'
import type { KeyboardEvent, PasteEvent } from '../lib/parser/types.js'
import type { ScreenSurface } from '../lib/screen-surface.js'
import { createDefaultTerminalCapabilities } from '../lib/terminal-queries.js'
import type { ResizeEvent } from '../lib/tui.js'
import { Tui } from '../lib/tui.js'
import { BuildOwner } from './build-owner.js'
import { setSchedulers } from './build-scheduler.js'
import { FocusManager } from './focus/focus-manager.js'
import { FramePhase, FrameScheduler } from './frame-scheduler.js'
import { FrameStatsOverlay } from './frame-stats-overlay.js'
import { MediaQuery, MediaQueryData } from './media-query.js'
import { MouseManager } from './mouse/mouse-manager.js'
import { PipelineOwner } from './pipeline-owner.js'
import type { RenderObject } from './render-object.js'
import type { Element, Widget } from './widget.js'

/**
 * Unified binding that manages the complete Flutter-style widget framework.
 *
 * WidgetsBinding combines:
 * - Terminal integration (Vaxis)
 * - Widget engine (BuildOwner, PipelineOwner, Scheduler)
 * - Application lifecycle management
 * - Event handling and MediaQuery data
 *
 * This replaces the old App class with a cleaner, Flutter-like architecture.
 */
export class WidgetsBinding {
	private static _instance?: WidgetsBinding

	// Widget engine components
	readonly frameScheduler = FrameScheduler.instance
	readonly buildOwner: BuildOwner
	readonly pipelineOwner: PipelineOwner
	readonly focusManager = FocusManager.instance
	readonly mouseManager = MouseManager.instance
	readonly frameStatsOverlay = new FrameStatsOverlay()

	// Terminal integration
	private tui = new Tui()
	private rootElement?: Element
	private isRunning = false
	private rootElementMountedCallback?: (rootElement: Element) => void

	// Event callbacks
	private eventCallbacks: {
		key: Array<(event: KeyboardEvent) => void>
		mouse: Array<(event: MouseEvent) => void>
		paste: Array<(event: PasteEvent) => void>
	} = {
		key: [],
		mouse: [],
		paste: [],
	}

	// RGB color change callbacks
	private rgbColorChangeCallbacks: Array<() => void> = []
	private cachedRgbColors: {
		fg: { r: number; g: number; b: number }
		bg: { r: number; g: number; b: number }
		cursor: { r: number; g: number; b: number }
		indices: Array<{ r: number; g: number; b: number }>
	} | null = null

	/**
	 * Get the singleton WidgetsBinding instance.
	 * @returns The global widgets binding instance
	 */
	static get instance(): WidgetsBinding {
		return (this._instance ??= new WidgetsBinding())
	}

	/**
	 * Creates a new WidgetsBinding and initializes the widget framework.
	 * Sets up the complete rendering pipeline and event handling system.
	 */
	// Resize handling state
	private pendingResizeEvent: ResizeEvent | null = null

	constructor() {
		// Create components first
		this.buildOwner = new BuildOwner()
		this.pipelineOwner = new PipelineOwner()

		// Immediately register frame callbacks so they're available when components request frames
		this.frameScheduler.addFrameCallback(
			'resize',
			() => this.processResizeIfPending(),
			FramePhase.BUILD,
			-1000, // Process resize events before any other build operations
			'WidgetsBinding.processResizeIfPending',
		)

		this.frameScheduler.addFrameCallback(
			'build',
			() => this.buildOwner.buildScopes(),
			FramePhase.BUILD,
			0,
			'BuildOwner.buildScopes',
		)

		this.frameScheduler.addFrameCallback(
			'layout',
			() => {
				this.updateRootConstraints()
				this.pipelineOwner.flushLayout()
			},
			FramePhase.LAYOUT,
			0,
			'PipelineOwner.flushLayout',
		)

		this.frameScheduler.addFrameCallback(
			'paint',
			() => this.paint(),
			FramePhase.PAINT,
			0,
			'WidgetsBinding.paint',
		)

		this.frameScheduler.addFrameCallback(
			'render',
			() => this.render(),
			FramePhase.RENDER,
			0,
			'WidgetsBinding.render',
		)

		// Initialize schedulers to break circular dependencies
		setSchedulers(
			{ scheduleBuildFor: (element) => this.buildOwner.scheduleBuildFor(element) },
			{
				requestLayout: (renderObject) => this.pipelineOwner.requestLayout(renderObject),
				requestPaint: (renderObject) => this.pipelineOwner.requestPaint(renderObject),
				removeFromQueues: (renderObject) =>
					this.pipelineOwner.removeFromQueues(renderObject),
			},
		)

		// Set up global error handler
		this.setupErrorHandler()
	}

	/**
	 * Set up the global error handler to show error screens.
	 */
	private setupErrorHandler(): void {
		// Simple error logging for now
		process.on('uncaughtException', (error) => {
			logger.error('Framework uncaught exception', error)
		})
	}

	/**
	 * Get cached RGB colors from terminal queries.
	 * Returns null if RGB colors are not available.
	 */
	getRgbColors(): {
		fg: { r: number; g: number; b: number }
		bg: { r: number; g: number; b: number }
		cursor: { r: number; g: number; b: number }
		indices: Array<{ r: number; g: number; b: number }>
	} | null {
		return this.cachedRgbColors
	}

	/**
	 * Subscribe to RGB color change notifications.
	 * Returns an unsubscribe function.
	 */
	onRgbColorsChanged(callback: () => void): () => void {
		this.rgbColorChangeCallbacks.push(callback)
		return () => {
			const index = this.rgbColorChangeCallbacks.indexOf(callback)
			if (index !== -1) {
				this.rgbColorChangeCallbacks.splice(index, 1)
			}
		}
	}

	/**
	 * Notify subscribers that RGB colors have changed.
	 * This will trigger theme updates in RgbThemeProvider.
	 */
	private notifyRgbColorsChanged(): void {
		for (const callback of this.rgbColorChangeCallbacks) {
			callback()
		}
	}

	/**
	 * Update RGB colors and notify subscribers.
	 * Call this when terminal theme changes are detected.
	 */
	updateRgbColors(colors: {
		fg: { r: number; g: number; b: number }
		bg: { r: number; g: number; b: number }
		cursor: { r: number; g: number; b: number }
		indices: Array<{ r: number; g: number; b: number }>
	}): void {
		this.cachedRgbColors = colors

		// Update screen buffers
		const screen = this.tui.getScreen()
		screen.setDefaultColors(
			{ type: 'rgb', value: colors.bg },
			{ type: 'rgb', value: colors.fg },
		)
		screen.setIndexRgbMapping(colors.indices)

		// Notify subscribers (triggers theme rebuild)
		this.notifyRgbColorsChanged()

		// Request a frame to repaint with new colors
		this.frameScheduler.requestFrame()
	}

	/**
	 * Run the application with the given root widget.
	 * This is the single entry point that replaces both App.run() and runApp().
	 * @param rootWidget The root widget of the application
	 * @returns Promise that resolves when the application exits
	 */
	async runApp(rootWidget: Widget): Promise<void> {
		if (this.isRunning) {
			throw new Error('App is already running')
		}

		try {
			this.isRunning = true

			// Initialize Vaxis terminal
			this.tui.init()
			this.tui.enterAltScreen()

			// Initialize focus tracking
			const { initFocusTracking } = await import('../lib/focus-tracking.js')
			initFocusTracking(this.tui)

			// Initialize idle tracking
			const { initIdleTracking } = await import('../lib/idle-tracking.js')
			initIdleTracking(this.tui)

			// Wait for terminal capability detection to complete
			await this.tui.waitForCapabilities(1000)

			// Apply RGB colors to screen if available
			const queryParser = this.tui.getQueryParser()
			const rgbColors = queryParser?.getRgbColors()
			logger.info('Initial RGB colors from terminal', { available: !!rgbColors })
			if (rgbColors) {
				// Cache colors and notify subscribers (triggers theme update)
				this.updateRgbColors(rgbColors)
			}

			// Set up callback for color palette changes (mode 2031)
			if (queryParser) {
				queryParser.setColorPaletteChangeCallback(() => {
					const updatedColors = queryParser.getRgbColors()
					if (updatedColors) {
						this.updateRgbColors(updatedColors)
					}
				})
			}

			// Create MediaQuery wrapper with terminal capabilities
			const mediaQueryWidget = this.createMediaQueryWrapper(rootWidget)

			// Set up the root element
			this.rootElement = mediaQueryWidget.createElement()
			this.rootElement.mount()

			// Call the root element mounted callback if set
			if (this.rootElementMountedCallback) {
				this.rootElementMountedCallback(this.rootElement)
			}

			// Set up root render object for layout management
			let rootRenderObject = this.rootElement.renderObject
			if (!rootRenderObject && this.rootElement.children.length > 0) {
				rootRenderObject = this.rootElement.children[0]?.renderObject
			}
			if (rootRenderObject) {
				this.pipelineOwner.setRootRenderObject(rootRenderObject)
				// Set initial root constraints
				this.updateRootConstraints()
			}

			// Set up mouse hit testing with root render object
			if (this.rootElement.renderObject) {
				this.mouseManager.setRootRenderObject(this.rootElement.renderObject)
			}

			// Set up mouse cursor management
			this.mouseManager.setTui(this.tui)

			// Set up event handlers
			logger.debug('Setting up event handlers...')
			this.setupEventHandlers()

			// Trigger initial frame
			logger.debug('Requesting initial frame...')
			this.frameScheduler.requestFrame()

			// Keep the process alive
			logger.debug('Waiting for exit...', { isRunning: this.isRunning })
			await this.waitForExit()
			logger.debug('waitForExit completed')
		} finally {
			logger.debug('Cleaning up...')
			await this.cleanup()
		}
	}

	/**
	 * Stop the application.
	 */
	stop(): void {
		this.isRunning = false
		// Resolve the exit promise if waiting
		if (this.exitResolve) {
			this.exitResolve()
			this.exitResolve = null
		}
	}

	/**
	 * Update root constraints before layout phase.
	 * Called by scheduler before flushLayout.
	 */
	private updateRootConstraints(): void {
		const terminalSize = this.tui.getSize()
		this.pipelineOwner.updateRootConstraints(terminalSize)
	}

	/**
	 * Process pending resize events before any other frame operations.
	 * This runs first in the BUILD phase (priority -1000) to ensure
	 * MediaQuery data and constraints are updated before widgets rebuild.
	 */
	private processResizeIfPending(): void {
		if (!this.pendingResizeEvent) return

		const event = this.pendingResizeEvent
		this.pendingResizeEvent = null

		// Update MediaQuery data with new terminal size
		if (this.rootElement) {
			const newSize = { width: event.width, height: event.height }
			const capabilities = this.tui.getCapabilities() || createDefaultTerminalCapabilities()
			const newMediaQueryData = new MediaQueryData(newSize, capabilities)

			// Update the MediaQuery widget at the root with new data
			const mediaQueryElement = this.rootElement
			if (mediaQueryElement.widget instanceof MediaQuery) {
				const updatedWidget = new MediaQuery({
					data: newMediaQueryData,
					child: mediaQueryElement.widget.child,
				})
				mediaQueryElement.update(updatedWidget)
			}

			// Mark the screen for full refresh to ensure clean redraw
			const screen = this.tui.getScreen()
			screen.markForRefresh()

			// Update root constraints for new terminal size
			this.pipelineOwner.updateRootConstraints(newSize)

			// Trigger rebuild
			this.rootElement.markNeedsRebuild()
			this.frameScheduler.requestFrame()

			// Re-establish hover state after the rebuild and render are complete
			this.frameScheduler.addPostFrameCallback(() => {
				this.mouseManager.reestablishHoverState()
			}, 'MouseManager.reestablishHoverState')
		}
	}

	/**
	 * Paint widgets to screen buffer.
	 * Converts widget tree to screen buffer content.
	 */
	private paint(): void {
		// First flush the paint pipeline to clear needsPaint flags
		this.pipelineOwner.flushPaint()

		if (!this.rootElement) return

		// Get the root render object (handle MediaQuery wrapper)
		let renderObject = this.rootElement.renderObject
		if (!renderObject && this.rootElement.children.length > 0) {
			renderObject = this.rootElement.children[0]?.renderObject
		}

		if (!renderObject) {
			return
		}

		try {
			// Clear and paint to screen buffer
			const screen = this.tui.getScreen()
			screen.clear()
			screen.clearCursor() // Hide cursor at start of each paint - widgets can show it if needed

			// Paint the root render object to the screen buffer
			this.renderRenderObject(renderObject, screen, 0, 0)

			// Draw frame stats overlay after painting (doesn't affect calculations)
			const stats = this.frameScheduler.frameStats
			this.frameStatsOverlay.recordStats(stats)
			this.frameStatsOverlay.draw(screen, stats)
		} catch (error) {
			logger.error('Paint error:', error)
		}
	}

	/**
	 * Render screen buffer to terminal.
	 * Converts screen buffer diffs to terminal ANSI output.
	 */
	private render(): void {
		try {
			// Flush screen buffer to terminal
			this.tui.render()
		} catch (error) {
			logger.error('Render error:', error)
		}
	}

	/**
	 * Render the root render object - it will handle painting itself and its children.
	 */
	private renderRenderObject(
		renderObject: RenderObject,
		screen: ScreenSurface,
		x: number,
		y: number,
	): void {
		// Call the render object's paint method - it handles its own children
		if ('paint' in renderObject && typeof renderObject.paint === 'function') {
			renderObject.paint(screen, x, y)
		}

		// Note: Don't manually traverse children here!
		// The paint() method of each render object is responsible for
		// painting its own children at the correct positions.
	}

	/**
	 * Create a MediaQuery wrapper around the root widget.
	 * @param child The child widget to wrap with MediaQuery
	 * @returns MediaQuery widget wrapping the child
	 */
	private createMediaQueryWrapper(child: Widget): Widget {
		const capabilities = this.tui.getCapabilities() || createDefaultTerminalCapabilities()
		const terminalSize = this.tui.getSize()
		const mediaQueryData = new MediaQueryData(terminalSize, capabilities)

		return new MediaQuery({
			data: mediaQueryData,
			child: child,
		})
	}

	/**
	 * Set up terminal event handlers.
	 */
	private setupEventHandlers(): void {
		// Handle resize events
		this.tui.onResize((event) => {
			// Clear mouse hover state since render objects will be recreated
			this.mouseManager.clearHoverState()

			// Store the latest resize event and request a frame
			// The frame scheduler will batch multiple resize events automatically
			this.pendingResizeEvent = event
			this.frameScheduler.requestFrame()
		})

		// Handle key events through focus system first, then global shortcuts
		this.tui.onKey((event) => {
			const startTime = performance.now()

			// Notify event callbacks
			for (const callback of this.eventCallbacks.key) {
				callback(event)
			}

			// First, try to handle the event through the focus system
			const handled = this.focusManager.handleKeyEvent(event)

			if (handled) {
				// Record timing for key event
				const eventTime = performance.now() - startTime
				this.frameStatsOverlay.recordKeyEvent(eventTime)
				return // Event was consumed by a focused widget
			}

			// Handle global shortcuts if event wasn't consumed
			this.handleGlobalKeyEvent(event)

			// Record timing for key event
			const eventTime = performance.now() - startTime
			this.frameStatsOverlay.recordKeyEvent(eventTime)
		})

		// Handle mouse events through mouse system
		this.tui.onMouse((event) => {
			const startTime = performance.now()
			// Notify event callbacks
			for (const callback of this.eventCallbacks.mouse) {
				callback(event)
			}
			this.mouseManager.handleMouseEvent(event)
			const eventTime = performance.now() - startTime
			this.frameStatsOverlay.recordMouseEvent(eventTime)
		})

		// Handle paste events through focus system
		this.tui.onPaste((event: PasteEvent) => {
			// Notify event callbacks
			for (const callback of this.eventCallbacks.paste) {
				callback(event)
			}
			this.focusManager.handlePasteEvent(event)
		})

		// Handle capability changes (like after DA1 response)
		this.tui.onCapabilities((event) => {
			// Update MediaQuery data with new capabilities
			if (this.rootElement) {
				const terminalSize = this.tui.getSize()
				const newMediaQueryData = new MediaQueryData(terminalSize, event.capabilities)

				// Update the MediaQuery widget at the root with new data
				const mediaQueryElement = this.rootElement
				if (mediaQueryElement.widget instanceof MediaQuery) {
					const updatedWidget = new MediaQuery({
						data: newMediaQueryData,
						child: mediaQueryElement.widget.child,
					})
					mediaQueryElement.update(updatedWidget)
				}

				// Trigger rebuild to update all widgets that depend on MediaQuery
				this.rootElement.markNeedsRebuild()
				this.frameScheduler.requestFrame()
			}
		})
	}

	/**
	 * Handle global keyboard shortcuts that aren't consumed by focused widgets.
	 * @param event The key event to handle
	 */
	private handleGlobalKeyEvent(event: KeyboardEvent): void {
		// Handle Ctrl+Z for suspend - global system command that works regardless of focus
		if (
			event.ctrlKey &&
			event.key === 'z' &&
			!event.shiftKey &&
			!event.altKey &&
			!event.metaKey
		) {
			this.tui.handleSuspend()
			return
		}

		// Handle Ctrl+C for exit
		if (
			event.ctrlKey &&
			event.key === 'c' &&
			!event.shiftKey &&
			!event.altKey &&
			!event.metaKey
		) {
			this.stop()
			return
		}
	}

	/**
	 * Toggle the frame stats overlay.
	 */
	toggleFrameStatsOverlay(): void {
		const newState = !this.frameStatsOverlay.isEnabled()
		this.frameStatsOverlay.setEnabled(newState)
		this.frameScheduler.requestFrame() // Trigger a redraw
	}

	private exitPromise: Promise<void> | null = null
	private exitResolve: (() => void) | null = null

	/**
	 * Wait for the application to be stopped.
	 */
	private async waitForExit(): Promise<void> {
		if (this.exitPromise) {
			return this.exitPromise
		}

		this.exitPromise = new Promise<void>((resolve) => {
			this.exitResolve = resolve
			// If already stopped, resolve immediately
			if (!this.isRunning) {
				resolve()
			}
		})

		return this.exitPromise
	}

	/**
	 * Clean up all resources.
	 */
	private async cleanup(): Promise<void> {
		this.isRunning = false

		// Unmount the element tree
		if (this.rootElement) {
			this.rootElement.unmount()
			this.rootElement = undefined as any
		}

		// Clean up engine components
		this.buildOwner.dispose()
		this.pipelineOwner.dispose()
		this.focusManager.dispose()
		this.mouseManager.dispose()

		// Remove all callbacks from frame scheduler
		this.frameScheduler.removeFrameCallback('resize')
		this.frameScheduler.removeFrameCallback('build')
		this.frameScheduler.removeFrameCallback('layout')
		this.frameScheduler.removeFrameCallback('paint')
		this.frameScheduler.removeFrameCallback('render')

		// Deinitialize Vaxis
		await this.tui.deinit()
	}

	/**
	 * Get the TUI instance for advanced usage.
	 * @returns The underlying TUI terminal interface
	 */
	get tuiInstance(): Tui {
		return this.tui
	}

	/**
	 * Get the root element (for debugging/testing).
	 * @returns The root element instance, or undefined if not set
	 */
	get rootElementInstance(): Element | undefined {
		return this.rootElement
	}

	/**
	 * Set callback to be called when the root element is mounted
	 */
	setRootElementMountedCallback(callback: (rootElement: Element) => void): void {
		this.rootElementMountedCallback = callback
	}

	/**
	 * Register a callback for terminal events (key, mouse, paste)
	 *
	 * @returns Function to unsubscribe the callback
	 */
	on<K extends 'key' | 'mouse' | 'paste'>(
		event: K,
		callback: K extends 'key'
			? (event: KeyboardEvent) => void
			: K extends 'mouse'
				? (event: MouseEvent) => void
				: (event: PasteEvent) => void,
	): () => void {
		const callbacks = this.eventCallbacks[event] as any[]
		callbacks.push(callback)

		// Return unsubscribe function
		return () => {
			const index = callbacks.indexOf(callback)
			if (index !== -1) {
				callbacks.splice(index, 1)
			}
		}
	}
}

/**
 * Convenience function to run an application - Flutter-style API
 * @param rootWidget The root widget of the application
 * @returns Promise that resolves when the application exits
 */
export interface RunAppOptions {
	stdin?: NodeJS.ReadableStream
	onRootElementMounted?: (rootElement: Element) => void
}

export async function runApp(rootWidget: Widget, options?: RunAppOptions): Promise<void> {
	const binding = WidgetsBinding.instance

	// Store the callback to call after root element is mounted
	if (options?.onRootElementMounted) {
		binding.setRootElementMountedCallback(options.onRootElementMounted)
	}

	await binding.runApp(rootWidget)
}

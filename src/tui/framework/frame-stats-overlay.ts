import type { Color } from '../lib/screen.js'
import { Colors, createCell } from '../lib/screen.js'
import type { ScreenSurface } from '../lib/screen-surface.js'
import { FRAME_TIME, FramePhase } from './frame-scheduler.js'

/**
 * Performance statistics for frame monitoring.
 */
export interface FrameSchedulerStats {
	lastFrameTime: number
	phaseStats: Record<
		FramePhase,
		{
			lastTime: number
		}
	>
}

/**
 * Calculate p99 value from an array of numbers.
 */
function calculateP99(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const index = Math.ceil(sorted.length * 0.99) - 1
	return sorted[Math.max(0, index)] || 0
}

/**
 * Frame statistics tracker that maintains p99 values for each phase.
 */
export class FrameStatsTracker {
	private frameTimes: number[] = []
	private phaseTimes: Record<FramePhase, number[]> = {
		[FramePhase.BUILD]: [],
		[FramePhase.LAYOUT]: [],
		[FramePhase.PAINT]: [],
		[FramePhase.RENDER]: [],
	}
	private keyEventTimes: number[] = []
	private mouseEventTimes: number[] = []
	private lastKeyEventTime = 0
	private lastMouseEventTime = 0

	private readonly MAX_SAMPLES = 1024 // Keep last 1024 samples for p99 calculation (~17 seconds at 60 FPS)

	/**
	 * Record a frame time.
	 */
	recordFrame(frameTime: number): void {
		this.frameTimes.push(frameTime)
		if (this.frameTimes.length > this.MAX_SAMPLES) {
			this.frameTimes.shift()
		}
	}

	/**
	 * Record a phase time.
	 */
	recordPhase(phase: FramePhase, phaseTime: number): void {
		const times = this.phaseTimes[phase]
		times.push(phaseTime)
		if (times.length > this.MAX_SAMPLES) {
			times.shift()
		}
	}

	/**
	 * Record a key event time.
	 */
	recordKeyEvent(eventTime: number): void {
		this.lastKeyEventTime = eventTime
		this.keyEventTimes.push(eventTime)
		if (this.keyEventTimes.length > this.MAX_SAMPLES) {
			this.keyEventTimes.shift()
		}
	}

	/**
	 * Record a mouse event time.
	 */
	recordMouseEvent(eventTime: number): void {
		this.lastMouseEventTime = eventTime
		this.mouseEventTimes.push(eventTime)
		if (this.mouseEventTimes.length > this.MAX_SAMPLES) {
			this.mouseEventTimes.shift()
		}
	}

	/**
	 * Get p99 value for total frame time.
	 */
	getFrameP99(): number {
		return calculateP99(this.frameTimes)
	}

	/**
	 * Get p99 value for a specific phase.
	 */
	getPhaseP99(phase: FramePhase): number {
		return calculateP99(this.phaseTimes[phase])
	}

	/**
	 * Get last key event time.
	 */
	getLastKeyEventTime(): number {
		return this.lastKeyEventTime
	}

	/**
	 * Get p99 value for key event time.
	 */
	getKeyEventP99(): number {
		return calculateP99(this.keyEventTimes)
	}

	/**
	 * Get last mouse event time.
	 */
	getLastMouseEventTime(): number {
		return this.lastMouseEventTime
	}

	/**
	 * Get p99 value for mouse event time.
	 */
	getMouseEventP99(): number {
		return calculateP99(this.mouseEventTimes)
	}

	/**
	 * Reset all tracked statistics.
	 */
	reset(): void {
		this.frameTimes = []
		for (const phase of Object.values(FramePhase)) {
			this.phaseTimes[phase] = []
		}
		this.keyEventTimes = []
		this.mouseEventTimes = []
		this.lastKeyEventTime = 0
		this.lastMouseEventTime = 0
	}
}

/**
 * Frame statistics overlay that draws performance stats in the top right corner.
 */
export class FrameStatsOverlay {
	private enabled = false
	private readonly tracker = new FrameStatsTracker()

	/**
	 * Enable or disable the stats overlay.
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled
	}

	/**
	 * Check if the overlay is enabled.
	 */
	isEnabled(): boolean {
		return this.enabled
	}

	/**
	 * Record a key event time.
	 */
	recordKeyEvent(eventTime: number): void {
		this.tracker.recordKeyEvent(eventTime)
	}

	/**
	 * Record a mouse event time.
	 */
	recordMouseEvent(eventTime: number): void {
		this.tracker.recordMouseEvent(eventTime)
	}

	/**
	 * Record frame statistics.
	 */
	recordStats(stats: FrameSchedulerStats): void {
		this.tracker.recordFrame(stats.lastFrameTime)
		for (const phase of Object.values(FramePhase)) {
			this.tracker.recordPhase(phase, stats.phaseStats[phase].lastTime)
		}
	}

	/**
	 * Draw the stats overlay on the screen.
	 * This should be called after the paint phase to not affect rendering calculations.
	 */
	draw(screen: ScreenSurface, stats: FrameSchedulerStats): void {
		if (!this.enabled) return

		const { width, height } = screen.getSize()

		// Calculate overlay dimensions
		const overlayWidth = 26
		const overlayHeight = 12
		const x = width - overlayWidth - 2 // 2 cells from right edge
		const y = 1 // 1 cell from top

		// Don't draw if screen is too small
		if (x < 0 || y + overlayHeight >= height) return

		// Draw border
		const borderColor = Colors.default()
		const textColor = Colors.brightWhite
		const highlightColor = Colors.yellow

		// Top border with centered title
		const title = ' Gotta Go Fast '
		const titleStart = Math.floor((overlayWidth - title.length) / 2)

		screen.setCell(x, y, createCell('╭', { fg: textColor }))
		for (let i = 1; i < overlayWidth - 1; i++) {
			if (i >= titleStart && i < titleStart + title.length) {
				screen.setCell(
					x + i,
					y,
					createCell(title[i - titleStart] || '─', { fg: highlightColor }),
				)
			} else {
				screen.setCell(x + i, y, createCell('─', { fg: textColor }))
			}
		}
		screen.setCell(x + overlayWidth - 1, y, createCell('╮', { fg: textColor }))

		// Side borders and content
		for (let row = 1; row < overlayHeight - 1; row++) {
			screen.setCell(x, y + row, createCell('│', { fg: textColor }))
			screen.setCell(x + overlayWidth - 1, y + row, createCell('│', { fg: textColor }))

			// Clear content area
			for (let col = 1; col < overlayWidth - 1; col++) {
				screen.setCell(x + col, y + row, createCell(' ', { fg: textColor }))
			}
		}

		// Bottom border
		screen.setCell(x, y + overlayHeight - 1, createCell('╰', { fg: textColor }))
		for (let i = 1; i < overlayWidth - 1; i++) {
			screen.setCell(x + i, y + overlayHeight - 1, createCell('─', { fg: textColor }))
		}
		screen.setCell(
			x + overlayWidth - 1,
			y + overlayHeight - 1,
			createCell('╯', { fg: textColor }),
		)

		// Draw content
		const contentX = x + 1
		let contentY = y + 1

		// Column headers
		this.drawText(screen, contentX, contentY++, '          Last     P99', borderColor)

		// Key event timing
		const lastKeyTimeValue = this.tracker.getLastKeyEventTime()
		const keyP99Value = this.tracker.getKeyEventP99()
		const lastKeyTime = lastKeyTimeValue.toFixed(2).padStart(5, ' ')
		const keyP99 = keyP99Value.toFixed(2).padStart(5, ' ')
		const lastKeyColor = this.getTimingColor(lastKeyTimeValue)
		const keyP99Color = this.getTimingColor(keyP99Value)

		const keyLabel = ` ${'Key'.padStart(6, ' ')}  `
		this.drawText(screen, contentX, contentY, keyLabel, borderColor)
		this.drawText(screen, contentX + keyLabel.length, contentY, lastKeyTime, lastKeyColor)
		this.drawText(
			screen,
			contentX + keyLabel.length + lastKeyTime.length,
			contentY,
			'   ',
			borderColor,
		)
		this.drawText(
			screen,
			contentX + keyLabel.length + lastKeyTime.length + 3,
			contentY++,
			keyP99,
			keyP99Color,
		)

		// Mouse event timing
		const lastMouseTimeValue = this.tracker.getLastMouseEventTime()
		const mouseP99Value = this.tracker.getMouseEventP99()
		const lastMouseTime = lastMouseTimeValue.toFixed(2).padStart(5, ' ')
		const mouseP99 = mouseP99Value.toFixed(2).padStart(5, ' ')
		const lastMouseColor = this.getTimingColor(lastMouseTimeValue)
		const mouseP99Color = this.getTimingColor(mouseP99Value)

		const mouseLabel = ` ${'Mouse'.padStart(6, ' ')}  `
		this.drawText(screen, contentX, contentY, mouseLabel, borderColor)
		this.drawText(screen, contentX + mouseLabel.length, contentY, lastMouseTime, lastMouseColor)
		this.drawText(
			screen,
			contentX + mouseLabel.length + lastMouseTime.length,
			contentY,
			'   ',
			borderColor,
		)
		this.drawText(
			screen,
			contentX + mouseLabel.length + lastMouseTime.length + 3,
			contentY++,
			mouseP99,
			mouseP99Color,
		)

		// Empty line separator
		contentY++

		// Phase times with last and p99
		for (const phase of [
			FramePhase.BUILD,
			FramePhase.LAYOUT,
			FramePhase.PAINT,
			FramePhase.RENDER,
		]) {
			const lastTimeValue = stats.phaseStats[phase].lastTime
			const phaseP99Value = this.tracker.getPhaseP99(phase)
			const lastTime = lastTimeValue.toFixed(2).padStart(5, ' ')
			const phaseP99 = phaseP99Value.toFixed(2).padStart(5, ' ')
			const lastTimeColor = this.getTimingColor(lastTimeValue)
			const phaseP99Color = this.getTimingColor(phaseP99Value)
			const phaseName = (phase.charAt(0).toUpperCase() + phase.slice(1)).padStart(6, ' ')

			const phaseLabel = ` ${phaseName}  `
			this.drawText(screen, contentX, contentY, phaseLabel, borderColor)
			this.drawText(screen, contentX + phaseLabel.length, contentY, lastTime, lastTimeColor)
			this.drawText(
				screen,
				contentX + phaseLabel.length + lastTime.length,
				contentY,
				'   ',
				borderColor,
			)
			this.drawText(
				screen,
				contentX + phaseLabel.length + lastTime.length + 3,
				contentY++,
				phaseP99,
				phaseP99Color,
			)
		}

		// Empty line separator
		contentY++

		// Frame time row
		const frameTimeValue = stats.lastFrameTime
		const frameP99NumericValue = this.tracker.getFrameP99()
		const frameTime = frameTimeValue.toFixed(2).padStart(5, ' ')
		const frameP99Value = frameP99NumericValue.toFixed(2).padStart(5, ' ')
		const frameTimeColor = this.getTimingColor(frameTimeValue)
		const frameP99Color = this.getTimingColor(frameP99NumericValue)

		const frameLabel = ` ${'Frame'.padStart(6, ' ')}  `
		this.drawText(screen, contentX, contentY, frameLabel, textColor)
		this.drawText(screen, contentX + frameLabel.length, contentY, frameTime, frameTimeColor)
		this.drawText(
			screen,
			contentX + frameLabel.length + frameTime.length,
			contentY,
			'   ',
			textColor,
		)
		this.drawText(
			screen,
			contentX + frameLabel.length + frameTime.length + 3,
			contentY++,
			frameP99Value,
			frameP99Color,
		)
	}

	/**
	 * Get color for a timing value based on thresholds.
	 */
	private getTimingColor(value: number): Color {
		const redThreshold = FRAME_TIME
		const yellowThreshold = FRAME_TIME * 0.7

		if (value >= redThreshold) {
			return Colors.red
		}
		if (value >= yellowThreshold) {
			return Colors.yellow
		}
		return Colors.default()
	}

	/**
	 * Helper to draw text at a specific position.
	 */
	private drawText(screen: ScreenSurface, x: number, y: number, text: string, fg: Color): void {
		for (let i = 0; i < text.length; i++) {
			screen.setCell(x + i, y, createCell(text[i] || ' ', { fg }))
		}
	}
}

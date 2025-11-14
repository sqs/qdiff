import logger from '../logger.js'

import { assert } from '../lib/assert.js'

/**
 * Frame phases that execute in a specific order during each frame.
 * This ensures proper Flutter-style rendering pipeline ordering.
 */
export enum FramePhase {
	BUILD = 'build',
	LAYOUT = 'layout',
	PAINT = 'paint',
	RENDER = 'render',
}

/**
 * Standard frame rate for TUI animations and updates.
 */
export const TARGET_FPS = 60

/**
 * Frame time in milliseconds for 60 FPS.
 */
export const FRAME_TIME = 1000 / TARGET_FPS // 16.67ms

/**
 * Frame callback with phase and priority information.
 */
interface FrameCallbackInfo {
	callback: () => void
	phase: FramePhase
	priority: number
	name?: string
}

/**
 * Post-frame callback that executes after the frame completes.
 */
interface PostFrameCallback {
	callback: () => void
	name?: string
}

/**
 * Performance statistics for frame monitoring.
 */
interface FrameSchedulerStats {
	lastFrameTime: number
	phaseStats: Record<
		FramePhase,
		{
			lastTime: number
		}
	>
}

/**
 * Unified frame scheduler that coordinates all frame-based operations.
 *
 * Replaces scattered setTimeout(0) calls with a single coordinated pipeline:
 * 1. Collect all dirty elements/render objects
 * 2. Execute phases in order: BUILD → LAYOUT → PAINT → RENDER
 * 3. Execute post-frame callbacks
 * 4. Wait for next frame
 *
 * This ensures:
 * - Only one timer per frame regardless of dirty elements
 * - Guaranteed phase ordering
 * - Automatic terminal rendering after paint
 * - Post-frame callbacks execute after terminal flush
 */
export class FrameScheduler {
	private static _instance?: FrameScheduler

	private _frameCallbacks = new Map<string, FrameCallbackInfo>()
	private _postFrameCallbacks: PostFrameCallback[] = []
	private _frameScheduled = false
	private _frameInProgress = false

	// Performance monitoring
	private _stats: FrameSchedulerStats = {
		lastFrameTime: 0,
		phaseStats: {
			[FramePhase.BUILD]: { lastTime: 0 },
			[FramePhase.LAYOUT]: { lastTime: 0 },
			[FramePhase.PAINT]: { lastTime: 0 },
			[FramePhase.RENDER]: { lastTime: 0 },
		},
	}
	private _lastCompletedStats: FrameSchedulerStats = this.deepCopyStats(this._stats)

	/**
	 * Get the singleton FrameScheduler instance.
	 */
	static get instance(): FrameScheduler {
		return (this._instance ??= new FrameScheduler())
	}

	/**
	 * Request a frame to be processed. Multiple requests in the same tick
	 * will be batched into a single frame.
	 */
	requestFrame(): void {
		if (this._frameScheduled) {
			return // Frame already scheduled
		}

		this._frameScheduled = true
		// Always render immediately - don't artificially delay for frame pacing
		// The event loop naturally batches updates within the same tick
		setImmediate(() => this.executeFrame())
	}

	/**
	 * Add a callback to be executed during a specific frame phase.
	 * Callbacks with the same key will replace previous ones.
	 *
	 * @param key Unique identifier for this callback
	 * @param callback Function to execute
	 * @param phase Frame phase when callback should execute
	 * @param priority Lower numbers execute first within the same phase
	 * @param name Optional name for debugging
	 */
	addFrameCallback(
		key: string,
		callback: () => void,
		phase: FramePhase,
		priority = 0,
		name?: string,
	): void {
		this._frameCallbacks.set(key, {
			callback,
			phase,
			priority,
			name: name || key,
		})
	}

	/**
	 * Remove a frame callback by key.
	 * @param key The key of the callback to remove
	 */
	removeFrameCallback(key: string): void {
		this._frameCallbacks.delete(key)
	}

	/**
	 * Add a callback to be executed after the current frame completes.
	 * This is equivalent to Flutter's WidgetsBinding.addPostFrameCallback.
	 *
	 * @param callback Function to execute after the frame
	 * @param name Optional name for debugging
	 */
	addPostFrameCallback(callback: () => void, name?: string): void {
		this._postFrameCallbacks.push({ callback, name })

		// Ensure a frame is scheduled to process the callback
		if (!this._frameScheduled && !this._frameInProgress) {
			this.requestFrame()
		}
	}

	/**
	 * Execute the complete frame pipeline.
	 */
	private executeFrame(): void {
		if (this._frameInProgress) {
			return // Frame already in progress
		}
		const frameStart = performance.now()
		this._frameScheduled = false
		this._frameInProgress = true

		try {
			// Execute frame phases in order (synchronously)
			for (const phase of [
				FramePhase.BUILD,
				FramePhase.LAYOUT,
				FramePhase.PAINT,
				FramePhase.RENDER,
			]) {
				this.executePhase(phase)
			}

			// Execute post-frame callbacks after frame is complete
			this.executePostFrameCallbacks()
		} catch (error) {
			logger.error(
				'Frame execution error:',
				error instanceof Error ? error.message : String(error),
			)
		} finally {
			// Record performance stats
			this.recordFrameStats(performance.now() - frameStart)
			// Publish coherent snapshot of completed frame
			this._lastCompletedStats = this.deepCopyStats(this._stats)
			this._frameInProgress = false
		}
	}

	/**
	 * Execute all callbacks for a specific phase.
	 * @param phase The frame phase to execute
	 */
	private executePhase(phase: FramePhase): void {
		const phaseStart = performance.now()

		try {
			// Get callbacks for this phase, sorted by priority
			const phaseCallbacks = Array.from(this._frameCallbacks.values())
				.filter((info) => info.phase === phase)
				.sort((a, b) => a.priority - b.priority)

			// Execute callbacks in priority order
			for (const info of phaseCallbacks) {
				try {
					info.callback()
				} catch (error) {
					logger.error(`Frame callback error in ${phase} phase (${info.name})`, {
						errorMessage: error instanceof Error ? error.message : String(error),
						errorType: error?.constructor?.name,
						stackTrace: error instanceof Error ? error.stack : undefined,
					})

					// Use assert for clean debug mode exit with proper terminal cleanup
					assert(false, `FATAL: ${phase} error in ${info.name}: ${error}`)
				}
			}
		} finally {
			// Record phase timing
			const phaseTime = performance.now() - phaseStart
			this.recordPhaseStats(phase, phaseTime)
		}
	}

	/**
	 * Execute all post-frame callbacks.
	 */
	private executePostFrameCallbacks(): void {
		if (this._postFrameCallbacks.length === 0) {
			return
		}

		// Take current callbacks and clear the list
		const callbacks = this._postFrameCallbacks.splice(0)

		// Execute all callbacks
		for (const { callback, name } of callbacks) {
			try {
				callback()
			} catch (error) {
				logger.error(
					`Post-frame callback error (${name || 'anonymous'}):`,
					error instanceof Error ? error.message : String(error),
				)
				// Continue with other callbacks
			}
		}
	}

	/**
	 * Record performance statistics for the frame.
	 * @param frameTime Total frame time in milliseconds
	 */
	private recordFrameStats(frameTime: number): void {
		this._stats.lastFrameTime = frameTime
	}

	/**
	 * Record performance statistics for a specific phase.
	 * @param phase The frame phase
	 * @param phaseTime Time taken for the phase in milliseconds
	 */
	private recordPhaseStats(phase: FramePhase, phaseTime: number): void {
		this._stats.phaseStats[phase].lastTime = phaseTime
	}

	/**
	 * Check if a frame is currently scheduled or in progress.
	 */
	get isFrameScheduled(): boolean {
		return this._frameScheduled || this._frameInProgress
	}

	/**
	 * Check if a frame is currently executing.
	 */
	get isFrameInProgress(): boolean {
		return this._frameInProgress
	}

	/**
	 * Get current performance statistics.
	 * Returns a snapshot of the last completed frame to ensure coherent data.
	 */
	get frameStats(): Readonly<FrameSchedulerStats> {
		return this.deepCopyStats(this._lastCompletedStats)
	}

	/**
	 * Deep copy frame stats to ensure immutability.
	 */
	private deepCopyStats(stats: FrameSchedulerStats): FrameSchedulerStats {
		return {
			...stats,
			phaseStats: {
				[FramePhase.BUILD]: { ...stats.phaseStats[FramePhase.BUILD] },
				[FramePhase.LAYOUT]: { ...stats.phaseStats[FramePhase.LAYOUT] },
				[FramePhase.PAINT]: { ...stats.phaseStats[FramePhase.PAINT] },
				[FramePhase.RENDER]: { ...stats.phaseStats[FramePhase.RENDER] },
			},
		}
	}

	/**
	 * Reset performance statistics.
	 */
	resetStats(): void {
		this._stats = {
			lastFrameTime: 0,
			phaseStats: {
				[FramePhase.BUILD]: { lastTime: 0 },
				[FramePhase.LAYOUT]: { lastTime: 0 },
				[FramePhase.PAINT]: { lastTime: 0 },
				[FramePhase.RENDER]: { lastTime: 0 },
			},
		}
	}

	/**
	 * Get the number of pending post-frame callbacks.
	 */
	get pendingPostFrameCallbacks(): number {
		return this._postFrameCallbacks.length
	}

	/**
	 * Clear all callbacks and reset state (for testing/cleanup).
	 */
	dispose(): void {
		this._frameCallbacks.clear()
		this._postFrameCallbacks.length = 0
		this._frameScheduled = false
		this._frameInProgress = false
		this.resetStats()
	}
}

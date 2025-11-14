import logger from '../logger.js'

import { FrameScheduler } from './frame-scheduler.js'
import type { Element } from './widget.js'

/**
 * Build performance statistics for development monitoring.
 */
interface BuildStats {
	totalRebuilds: number
	elementsRebuiltThisFrame: number
	maxElementsPerFrame: number
	averageElementsPerFrame: number
	lastBuildTime: number
	averageBuildTime: number
	maxBuildTime: number
}

/**
 * Manages dirty element tracking and rebuild ordering.
 *
 * The BuildOwner ensures that:
 * 1. Elements marked for rebuild are tracked efficiently
 * 2. Parent elements rebuild before their children
 * 3. Multiple rebuild requests are batched into a single frame
 * 4. No element rebuilds more than once per frame
 */
export class BuildOwner {
	private _dirtyElements = new Set<Element>()

	// Performance monitoring (dev-only)
	private _stats: BuildStats = {
		totalRebuilds: 0,
		elementsRebuiltThisFrame: 0,
		maxElementsPerFrame: 0,
		averageElementsPerFrame: 0,
		lastBuildTime: 0,
		averageBuildTime: 0,
		maxBuildTime: 0,
	}
	private _buildTimes: number[] = []
	private _elementsPerFrame: number[] = []

	/**
	 * Creates a new BuildOwner.
	 * The WidgetsBinding will register this with the frame scheduler.
	 */
	constructor() {
		// BuildOwner is now registered by WidgetsBinding
		// This reduces coupling and allows for better lifecycle management
	}

	/**
	 * Schedule an element for rebuild. Called by Element.markNeedsRebuild().
	 * @param element The element to schedule for rebuild
	 */
	scheduleBuildFor(element: Element): void {
		// Avoid duplicate scheduling
		if (this._dirtyElements.has(element)) {
			return
		}
		this._dirtyElements.add(element)
		FrameScheduler.instance.requestFrame()
	}

	/**
	 * Rebuild all dirty elements in the correct order.
	 * Called by the Scheduler during the build phase.
	 */
	buildScopes(): void {
		if (this._dirtyElements.size === 0) return

		const buildStartTime = performance.now()
		let elementsRebuilt = 0

		try {
			// Process dirty elements until none remain (Flutter-style while loop)
			// This ensures that elements marked dirty during rebuilding are also processed
			while (this._dirtyElements.size > 0) {
				// Sort elements by depth: parents (lower depth) rebuild before children
				// This ensures proper rebuild order and avoids redundant child rebuilds
				const elementsArray = Array.from(this._dirtyElements)
				this._dirtyElements.clear()

				elementsArray.sort((a, b) => a.depth - b.depth)

				// Rebuild all dirty elements
				for (const element of elementsArray) {
					// Element might have been cleaned up during another element's rebuild
					if (element.dirty) {
						try {
							element.performRebuild()
							// Clear the dirty flag after successful rebuild
							;(element as any)._dirty = false
							elementsRebuilt++
						} catch (error) {
							// Log rebuild errors with full details
							logger.error('Element rebuild error:', {
								error: error instanceof Error ? error.message : String(error),
								stack: error instanceof Error ? error.stack : undefined,
								elementType: element.widget.constructor.name,
								elementDebugLabel: (element.widget as any).debugLabel,
							})

							// Clear the dirty flag even on error to prevent infinite rebuild loops
							;(element as any)._dirty = false
						}
					}
				}
			}
		} finally {
			// Record performance stats
			this.recordBuildStats(performance.now() - buildStartTime, elementsRebuilt)
		}
	}

	/**
	 * Record build performance statistics.
	 * @param buildTime Time taken for the build operation in milliseconds
	 * @param elementsRebuilt Number of elements that were rebuilt
	 */
	private recordBuildStats(buildTime: number, elementsRebuilt: number): void {
		this._stats.totalRebuilds += elementsRebuilt
		this._stats.elementsRebuiltThisFrame = elementsRebuilt
		this._stats.lastBuildTime = buildTime
		this._stats.maxElementsPerFrame = Math.max(this._stats.maxElementsPerFrame, elementsRebuilt)
		this._stats.maxBuildTime = Math.max(this._stats.maxBuildTime, buildTime)

		// Keep rolling windows for averages
		this._buildTimes.push(buildTime)
		this._elementsPerFrame.push(elementsRebuilt)

		if (this._buildTimes.length > 60) {
			// Keep last 60 builds
			this._buildTimes.shift()
			this._elementsPerFrame.shift()
		}

		// Calculate averages
		this._stats.averageBuildTime =
			this._buildTimes.reduce((a, b) => a + b, 0) / this._buildTimes.length
		this._stats.averageElementsPerFrame =
			this._elementsPerFrame.reduce((a, b) => a + b, 0) / this._elementsPerFrame.length
	}

	/**
	 * Get the current list of dirty elements (for debugging/testing)
	 * @returns Read-only array of elements scheduled for rebuild
	 */
	get dirtyElements(): readonly Element[] {
		return Array.from(this._dirtyElements)
	}

	/**
	 * Check if there are any dirty elements scheduled for rebuild
	 * @returns True if there are elements waiting to be rebuilt
	 */
	get hasDirtyElements(): boolean {
		return this._dirtyElements.size > 0
	}

	/**
	 * Get current build performance statistics (dev-only).
	 * @returns Read-only copy of current build performance metrics
	 */
	get buildStats(): Readonly<BuildStats> {
		return { ...this._stats }
	}

	/**
	 * Reset build performance statistics (dev-only).
	 */
	resetBuildStats(): void {
		this._stats = {
			totalRebuilds: 0,
			elementsRebuiltThisFrame: 0,
			maxElementsPerFrame: 0,
			averageElementsPerFrame: 0,
			lastBuildTime: 0,
			averageBuildTime: 0,
			maxBuildTime: 0,
		}
		this._buildTimes.length = 0
		this._elementsPerFrame.length = 0
	}

	/**
	 * Clean up the BuildOwner
	 */
	dispose(): void {
		// WidgetsBinding handles frame callback cleanup
		this._dirtyElements.clear()
	}
}

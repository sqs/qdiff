import type { RenderObject } from './render-object.js'
import type { Element } from './widget.js'

/**
 * Build scheduler interface to break circular dependencies.
 *
 * This allows elements and render objects to schedule builds/paints
 * without directly importing the binding.
 */
export interface BuildScheduler {
	scheduleBuildFor(element: Element): void
}

export interface PaintScheduler {
	requestLayout(renderObject: RenderObject): void
	requestPaint(renderObject: RenderObject): void
	removeFromQueues(renderObject: RenderObject): void
}

/**
 * Global schedulers - will be set by WidgetsBinding during initialization
 */
export let buildScheduler: BuildScheduler | null = null
export let paintScheduler: PaintScheduler | null = null

/**
 * Set the global schedulers (called by WidgetsBinding)
 */
export function setSchedulers(build: BuildScheduler, paint: PaintScheduler): void {
	buildScheduler = build
	paintScheduler = paint
}

/**
 * Check if we're in a test environment
 */
function isTestEnvironment(): boolean {
	return (
		typeof process !== 'undefined' &&
		(process.env.NODE_ENV === 'test' ||
			process.env.BUN_TEST === '1' ||
			(globalThis as any).Bun?.jest !== undefined ||
			typeof (globalThis as any).test === 'function')
	)
}

/**
 * Get the current build scheduler, with fallback for tests
 */
export function getBuildScheduler(): BuildScheduler {
	if (!buildScheduler) {
		// In test environments, provide a no-op scheduler to avoid breaking tests
		if (isTestEnvironment()) {
			return { scheduleBuildFor: () => {} }
		}
		throw new Error('Build scheduler not initialized. Make sure WidgetsBinding is created.')
	}
	return buildScheduler
}

/**
 * Get the current paint scheduler, with fallback for tests
 */
export function getPaintScheduler(): PaintScheduler {
	if (!paintScheduler) {
		// In test environments, provide a no-op scheduler to avoid breaking tests
		if (isTestEnvironment()) {
			return {
				requestLayout: () => {},
				requestPaint: () => {},
				removeFromQueues: () => {},
			}
		}
		throw new Error('Paint scheduler not initialized. Make sure WidgetsBinding is created.')
	}
	return paintScheduler
}

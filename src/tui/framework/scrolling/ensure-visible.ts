import type { BuildContext } from '../build-context.js'
import type { RenderBox } from '../render-object.js'
import type { ScrollController } from './scroll-controller.js'

/**
 * Rectangle in local coordinates to be made visible.
 */
export interface EnsureVisibleRect {
	top: number
	bottom: number
}

/**
 * Options for ensureVisible behavior.
 */
export interface EnsureVisibleOptions {
	/** Padding around the target rect (default: 1) */
	padding?: number
}

/**
 * Internal interface for viewport render objects that support ensureVisible.
 * Matches _SingleChildViewportRenderObject.
 */
interface ViewportRenderObject extends RenderBox {
	scrollController?: ScrollController
}

/**
 * Ensure a rectangle is visible within the nearest scrollable ancestor viewport.
 *
 * This is a minimal Phase 1 implementation that:
 * - Works with single-level viewports (no nesting yet)
 * - Handles vertical scrolling only
 * - Performs immediate jumps (no animation)
 * - Uses simple edge detection
 *
 * Based on Flutter's ensureVisible pattern, where the child doesn't detect
 * viewport boundaries itself, but instead requests the parent to scroll.
 *
 * @param context - Build context of the widget requesting visibility
 * @param rectInLocal - Rectangle in the widget's local coordinate space
 * @param options - Options for padding around the target
 */
export function ensureVisible(
	context: BuildContext,
	rectInLocal: EnsureVisibleRect,
	options: EnsureVisibleOptions = {},
): void {
	const padding = options.padding ?? 1

	// Get the render object for the target widget
	const targetRenderObject = context.findRenderObject() as RenderBox | undefined
	if (!targetRenderObject) {
		return
	}

	// Walk up the render tree to find the nearest viewport
	const viewport = findNearestViewport(targetRenderObject)
	if (!viewport) {
		// No scrollable ancestor found
		return
	}

	const scrollController = viewport.scrollController
	if (!scrollController) {
		// Viewport has no scroll controller
		return
	}

	// Calculate target rect in viewport's coordinate space
	const targetRect = transformRectToAncestor(targetRenderObject, rectInLocal, viewport)
	if (!targetRect) {
		return
	}
    // console.log('ensureVisible', { rectInLocal, targetRect, currentOffset, viewportHeight, padding })

	// Get viewport dimensions
	const viewportHeight = viewport.size.height
	const currentOffset = scrollController.offset

	// Determine if scrolling is needed and calculate new offset
	let newOffset = currentOffset

	if (targetRect.top < padding) {
		// Target is above viewport - scroll up
		newOffset = currentOffset + targetRect.top - padding
	} else if (targetRect.bottom > viewportHeight - padding) {
		// Target is below viewport - scroll down
		newOffset = currentOffset + (targetRect.bottom - (viewportHeight - padding))
	} else {
		// Target is already visible - no scroll needed
		return
	}

	// Clamp to valid scroll range
	const maxExtent = scrollController.maxScrollExtent
	newOffset = Math.max(0, Math.min(newOffset, maxExtent))

	// Apply scroll offset
	if (newOffset !== currentOffset) {
		scrollController.jumpTo(newOffset)
	}
}

/**
 * Find the nearest viewport render object by walking up the render tree.
 * Returns the first ancestor that has a scrollController property.
 */
function findNearestViewport(
	target: RenderBox,
): (RenderBox & { scrollController?: ScrollController }) | null {
	let current: RenderBox | undefined = target.parent as RenderBox | undefined

	while (current) {
		// Check if this render object has a scrollController property
		// This matches _SingleChildViewportRenderObject
		if ('scrollController' in current && current.scrollController) {
			return current as ViewportRenderObject
		}

		// Move to parent
		current = current.parent as RenderBox | undefined
		if (current && !('size' in current)) {
			// Parent is not a RenderBox, stop here
			break
		}
	}

	return null
}

/**
 * Transform a rectangle from target's local coordinates to ancestor's coordinate space.
 * Accumulates offsets by walking up the render tree.
 */
function transformRectToAncestor(
	target: RenderBox,
	rect: EnsureVisibleRect,
	ancestor: RenderBox,
): { top: number; bottom: number } | null {
	let top = rect.top
	let bottom = rect.bottom
	let current: RenderBox | undefined = target

	// Walk up the tree, accumulating offsets
	while (current && current !== ancestor) {
		const offset = current.offset
		top += offset.y
		bottom += offset.y

		// Move to parent
		current = current.parent as RenderBox | undefined
		if (current && !('size' in current)) {
			// Parent is not a RenderBox, can't continue
			return null
		}
	}

	// Verify we reached the ancestor
	if (current !== ancestor) {
		// Target is not a descendant of ancestor
		return null
	}

	return { top, bottom }
}

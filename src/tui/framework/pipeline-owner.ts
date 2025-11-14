import { FrameScheduler } from './frame-scheduler.js'
import type { RenderObject } from './render-object.js'
import { BoxConstraints } from './render-object.js'

/**
 * Manages layout and paint phases of the rendering pipeline.
 *
 * The PipelineOwner ensures that:
 * 1. Layout happens before paint
 * 2. Parent render objects layout before their children
 * 3. Paint operations are batched efficiently
 * 4. Multiple invalidation requests are deduplicated
 */
export class PipelineOwner {
	private _nodesNeedingPaint = new Set<RenderObject>()
	private _rootRenderObject: RenderObject | null = null
	private _rootConstraints: BoxConstraints | null = null

	/**
	 * Creates a new PipelineOwner.
	 * The WidgetsBinding will register this with the frame scheduler.
	 */
	constructor() {
		// PipelineOwner is now registered by WidgetsBinding
		// This reduces coupling and allows for better lifecycle management
	}

	/**
	 * Request layout for a render object. Called by RenderObject.markNeedsLayout().
	 * @param node The render object that needs layout (unused - layout cascades from root)
	 */
	requestLayout(node: RenderObject): void {
		// Only request a new frame if we're not already in a frame that will handle layout
		// If we're currently in BUILD phase, the current frame's LAYOUT phase will handle this
		if (!FrameScheduler.instance.isFrameInProgress) {
			FrameScheduler.instance.requestFrame()
		}
	}

	/**
	 * Request paint for a render object. Called by RenderObject.markNeedsPaint().
	 * Multiple requests for the same object are deduplicated.
	 * @param node The render object that needs paint
	 */
	requestPaint(node: RenderObject): void {
		// Avoid duplicate scheduling
		if (this._nodesNeedingPaint.has(node)) return

		this._nodesNeedingPaint.add(node)

		// Only request a new frame if we're not already in a frame that will handle painting
		// If we're currently in BUILD/LAYOUT phases, the current frame's PAINT phase will handle this
		if (!FrameScheduler.instance.isFrameInProgress) {
			FrameScheduler.instance.requestFrame()
		}
	}

	/**
	 * Set the root render object for layout management.
	 * @param rootRenderObject The root render object to manage
	 */
	setRootRenderObject(rootRenderObject: RenderObject): void {
		this._rootRenderObject = rootRenderObject
	}

	/**
	 * Update root constraints (called before layout when terminal size changes).
	 * @param terminalSize Current terminal dimensions
	 */
	updateRootConstraints(terminalSize: { width: number; height: number }): void {
		const newConstraints = new BoxConstraints(0, terminalSize.width, 0, terminalSize.height)

		// Only mark for layout if constraints actually changed
		const constraintsChanged =
			!this._rootConstraints ||
			this._rootConstraints.maxWidth !== newConstraints.maxWidth ||
			this._rootConstraints.maxHeight !== newConstraints.maxHeight

		this._rootConstraints = newConstraints

		if (
			constraintsChanged &&
			this._rootRenderObject &&
			'markNeedsLayout' in this._rootRenderObject
		) {
			this._rootRenderObject.markNeedsLayout()
		}
	}

	/**
	 * Perform layout for all nodes that need it.
	 * Called by the Scheduler during the layout phase.
	 */
	flushLayout(): void {
		// Simple approach: only check if root needs layout
		if (
			this._rootRenderObject &&
			this._rootConstraints &&
			'needsLayout' in this._rootRenderObject &&
			this._rootRenderObject.needsLayout
		) {
			if (
				'layout' in this._rootRenderObject &&
				typeof this._rootRenderObject.layout === 'function'
			) {
				// Call layout on root - it will cascade down to children
				this._rootRenderObject.layout(this._rootConstraints)
			}
		}
	}

	/**
	 * Perform paint for all nodes that need it.
	 * Called by the Scheduler during the paint phase.
	 *
	 * Note: This just clears the needsPaint flags. The actual rendering
	 * to the screen happens in WidgetsBinding.render().
	 */
	flushPaint(): void {
		if (this._nodesNeedingPaint.size === 0) return

		try {
			// Paint order doesn't need sorting - paint is generally independent
			// However, we could optimize by painting from back to front if needed
			for (const node of this._nodesNeedingPaint) {
				// Node might no longer need paint due to layout changes
				if (node.needsPaint) {
					// Just clear the needsPaint flag - actual rendering happens later
					;(node as any)._needsPaint = false
				}
			}
		} finally {
			// Clear the paint queue
			this._nodesNeedingPaint.clear()
		}
	}

	/**
	 * Get the current list of nodes needing layout (for debugging/testing)
	 * @returns Empty array since layout cascades from root
	 */
	get nodesNeedingLayout(): readonly RenderObject[] {
		return []
	}

	/**
	 * Get the current list of nodes needing paint (for debugging/testing)
	 * @returns Read-only array of render objects that need paint
	 */
	get nodesNeedingPaint(): readonly RenderObject[] {
		return Array.from(this._nodesNeedingPaint)
	}

	/**
	 * Check if there are any nodes scheduled for layout
	 * @returns False since layout cascades from root
	 */
	get hasNodesNeedingLayout(): boolean {
		return false
	}

	/**
	 * Check if there are any nodes scheduled for paint
	 * @returns True if there are render objects waiting for paint
	 */
	get hasNodesNeedingPaint(): boolean {
		return this._nodesNeedingPaint.size > 0
	}

	/**
	 * Clean up the PipelineOwner
	 */
	dispose(): void {
		// WidgetsBinding handles frame callback cleanup
		this._nodesNeedingPaint.clear()
	}

	/**
	 * Remove a render object from paint queue.
	 * Called when a render object is being disposed/replaced.
	 */
	removeFromQueues(node: RenderObject): void {
		this._nodesNeedingPaint.delete(node)
	}
}

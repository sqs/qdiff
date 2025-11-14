import { RenderObject } from '../render-object.js'
import type { MousePosition } from './mouse-events.js'

/**
 * Result of a hit test operation.
 */
export interface HitTestResult {
	/** The render objects that were hit, from front to back */
	readonly hits: readonly HitTestEntry[]
}

/**
 * A single hit test entry containing the render object and local coordinates.
 */
export interface HitTestEntry {
	/** The render object that was hit */
	readonly target: RenderObject
	/** The position relative to the target's coordinate system */
	readonly localPosition: MousePosition
}

/**
 * Performs hit testing to determine which render objects are under a given point.
 *
 * This is similar to Flutter's hit testing system but simplified for terminal UI.
 * The coordinate system is based on terminal character cells (0-based).
 */
export class HitTestManager {
	/**
	 * Perform a hit test at the given global position.
	 * Returns a HitTestResult with all render objects that contain the point.
	 */
	static hitTest(root: RenderObject, position: MousePosition): HitTestResult {
		const result = new HitTestResultImpl()

		;(root as any).hitTest(result, position)
		return result
	}
}

/**
 * Implementation of HitTestResult that collects hit test entries.
 */
class HitTestResultImpl implements HitTestResult, HitTestResultInterface {
	private _hits: HitTestEntry[] = []

	get hits(): readonly HitTestEntry[] {
		return this._hits
	}

	/**
	 * Add a hit test entry to the result.
	 * Called by render objects during hit testing.
	 */
	add(entry: HitTestEntry): void {
		this._hits.push(entry)
	}

	/**
	 * Add a hit with a render object and position.
	 * Convenience method for render objects.
	 */
	addWithPaintOffset(target: RenderObject, offset: MousePosition, position: MousePosition): void {
		const localPosition: MousePosition = {
			x: position.x - offset.x,
			y: position.y - offset.y,
		}

		this.add({
			target,
			localPosition,
		})
	}

	/**
	 * Add a mouse target (used by MouseRegion hit testing).
	 * This is a placeholder for now - the actual implementation
	 * will be handled by MouseManager.
	 */
	addMouseTarget(_target: RenderObject, _position: MousePosition): void {
		// This method is called by MouseRegion.hitTest()
		// but the actual mouse target tracking is handled
		// by MouseManager through normal hit test results
	}
}

/**
 * Hit test behavior interface that render objects can implement.
 */
export interface HitTestTarget {
	/**
	 * Perform hit testing on this object.
	 * Should call result.add() if the position hits this object.
	 */
	hitTest(
		result: HitTestResultInterface,
		position: MousePosition,
		parentAbsX?: number,
		parentAbsY?: number,
	): boolean
}

/**
 * Interface for the hit test result that render objects interact with.
 */
export interface HitTestResultInterface {
	add(entry: HitTestEntry): void
	addWithPaintOffset(target: RenderObject, offset: MousePosition, position: MousePosition): void
	addMouseTarget(target: RenderObject, position: MousePosition): void
}

/**
 * Mixin to add hit testing capabilities to render objects.
 */
export function addHitTestToRenderObject() {
	// Add hitTest method to RenderObject prototype
	if (!(RenderObject.prototype as any).hitTest) {
		;(RenderObject.prototype as any).hitTest = function (
			this: RenderObject,
			result: HitTestResultInterface,
			position: MousePosition,
			parentAbsX: number = 0,
			parentAbsY: number = 0,
		): boolean {
			// Check if this is a RenderBox with bounds
			if ('size' in this && 'offset' in this) {
				const renderBox = this as any // Cast to access RenderBox properties
				const size = renderBox.size
				const offset = renderBox.offset

				if (size && offset) {
					// Calculate absolute position of this render object
					const absX = parentAbsX + offset.x
					const absY = parentAbsY + offset.y

					// Compare against absolute bounds
					const withinX = position.x >= absX && position.x < absX + size.width
					const withinY = position.y >= absY && position.y < absY + size.height

					// PERFORMANCE: Only traverse children if this box was hit (spatial pruning)
					if (withinX && withinY) {
						// Hit! Add to result with local position
						const localPosition = {
							x: position.x - absX,
							y: position.y - absY,
						}
						result.add({ target: this, localPosition })

						// Test children (in reverse order, front to back)
						const children = this.children
						let hitAny = true // We already hit this box
						for (let i = children.length - 1; i >= 0; i--) {
							const child = children[i]
							// Pass down global position and our absolute position
							if ((child as any).hitTest(result, position, absX, absY)) {
								hitAny = true
							}
						}

						return hitAny
					}

					// Parent bounds not hit - check if we should still traverse children (for overlays/stacks)
					if (this.allowHitTestOutsideBounds) {
						let hitAny = false
						const children = this.children
						for (let i = children.length - 1; i >= 0; i--) {
							const child = children[i]
							if ((child as any).hitTest(result, position, absX, absY)) {
								hitAny = true
							}
						}
						return hitAny
					}

					// Spatial pruning: don't traverse children when parent not hit
					return false
				}
			}

			// Default for objects without bounds: test all children (pass-through containers)
			let hitAny = false
			for (const child of this.children) {
				if ((child as any).hitTest(result, position, parentAbsX, parentAbsY)) {
					hitAny = true
				}
			}

			return hitAny
		}
	}
}

// Note: We don't extend RenderObject interface to avoid conflicts
// The hit testing is handled through the addHitTestToRenderObject() function

// Initialize hit testing support
addHitTestToRenderObject()

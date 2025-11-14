import { assert } from '../lib/assert.js'
import type { ScreenSurface } from '../lib/screen-surface.js'
import { getPaintScheduler } from './build-scheduler.js'
import type { HitTestResultInterface } from './mouse/hit-test.js'
import type { MousePosition } from './mouse/mouse-events.js'
import type { ParentData } from './parent-data.js'
import type { Offset, Size } from './types.js'

/**
 * Base class for all objects in the render tree.
 *
 * RenderObjects are responsible for the actual rendering, layout, and
 * hit testing of the user interface. They form a tree parallel to the
 * widget tree but with a longer lifetime.
 */
export abstract class RenderObject {
	private _parent?: RenderObject
	private _children: RenderObject[] = []
	protected _needsLayout = false
	private _needsPaint = false
	private _cachedDepth?: number
	private _attached = false
	private _debugData: Record<string, any> = {}

	/**
	 * Whether hit testing should check children even when this object's bounds aren't hit.
	 * Used for overlays, stacks, and other containers where children can extend outside parent bounds.
	 * Default: false (enables spatial pruning)
	 */
	allowHitTestOutsideBounds = false

	/**
	 * Data stored by parent widgets for layout purposes.
	 */
	parentData?: ParentData

	/**
	 * Setup parent data for a child render object.
	 * Subclasses override this to initialize child.parentData with the appropriate type.
	 * Default implementation does nothing.
	 */
	protected setupParentData(child: RenderObject): void {
		// No-op by default
	}

	/**
	 * Send arbitrary debug data for this render object instance.
	 * This data will be visible in the widget tree debugger.
	 */
	sendDebugData(data: Record<string, any>): void {
		this._debugData = { ...this._debugData, ...data }
	}

	/**
	 * Get the debug data for this render object (internal use by debugger).
	 */
	get debugData(): Record<string, any> {
		return this._debugData
	}

	/**
	 * The parent of this render object in the render tree.
	 */
	get parent(): RenderObject | undefined {
		return this._parent
	}

	/**
	 * The children of this render object.
	 */
	get children(): readonly RenderObject[] {
		return this._children
	}

	/**
	 * Get the depth of this render object in the tree (for layout ordering).
	 */
	get depth(): number {
		if (this._cachedDepth !== undefined) {
			return this._cachedDepth
		}

		let depth = 0
		let current = this._parent
		while (current) {
			depth++
			current = current._parent
		}

		this._cachedDepth = depth
		return depth
	}

	/**
	 * Invalidate the cached depth - called when parent changes.
	 * @private
	 */
	private _invalidateDepth(): void {
		this._cachedDepth = undefined
		// Recursively invalidate all children's cached depths
		for (const child of this._children) {
			child._invalidateDepth()
		}
	}

	/**
	 * Whether this render object needs layout.
	 */
	get needsLayout(): boolean {
		return this._needsLayout
	}

	/**
	 * Whether this render object needs paint.
	 */
	get needsPaint(): boolean {
		return this._needsPaint
	}

	/**
	 * Whether this render object is attached to the render tree.
	 */
	get attached(): boolean {
		return this._attached
	}

	/**
	 * Adds a child render object to this render object.
	 *
	 * @param child - The render object to add as a child
	 */
	adoptChild(child: RenderObject): void {
		child._parent = this
		child._invalidateDepth()
		this._children.push(child)
		this.setupParentData(child)
		// If this render object is attached, attach the new child
		if (this._attached) {
			child.attach()
		}

		this.markNeedsLayout()
	}

	/**
	 * Removes a child render object from this render object.
	 *
	 * @param child - The render object to remove
	 */
	dropChild(child: RenderObject): void {
		const index = this._children.indexOf(child)
		if (index !== -1) {
			// Detach the child if it's attached
			if (child._attached) {
				child.detach()
			}
			this._children.splice(index, 1)
			;(child as any)._parent = undefined
			child._invalidateDepth()
			this.markNeedsLayout()
		}
	}

	/**
	 * Removes all children.
	 */
	removeAllChildren(): void {
		for (const child of this._children) {
			// Detach each child if it's attached
			if (child._attached) {
				child.detach()
			}
			;(child as any)._parent = undefined
			child._invalidateDepth()
		}
		this._children.length = 0
		this.markNeedsLayout()
	}

	/**
	 * Replaces the children array without calling lifecycle methods.
	 * Assumes lifecycle (attach/detach) is already managed by the element layer.
	 * Updates parent pointers, invalidates depth, and sets up parent data.
	 */
	replaceChildren(newChildren: RenderObject[]): void {
		// Update all parent pointers to point to this render object
		for (const child of newChildren) {
			child._parent = this
			child._invalidateDepth()
			this.setupParentData(child)
		}

		this._children = newChildren
		this.markNeedsLayout()
	}

	/**
	 * Called when this render object is attached to the render tree.
	 */
	attach(): void {
		if (this._attached) return
		this._attached = true
		for (const child of this._children) {
			child.attach()
		}
	}

	/**
	 * Called when this render object is detached from the render tree.
	 */
	detach(): void {
		if (!this._attached) return
		this._attached = false
		for (const child of this._children) {
			child.detach()
		}
	}

	/**
	 * Mark this render object as needing layout.
	 * This will schedule a layout pass for this object and its children.
	 */
	markNeedsLayout(): void {
		if (this._needsLayout) return
		// Don't schedule layout for detached objects
		if (!this._attached) return

		// Mark this node as needing layout
		this._needsLayout = true

		// Propagate up to parent
		if (this.parent) {
			this.parent.markNeedsLayout()
		} else {
			// This is the root - schedule layout
			getPaintScheduler().requestLayout(this)
		}
	}

	/**
	 * Mark this render object as needing to be repainted.
	 * This will schedule a paint pass for this object.
	 */
	markNeedsPaint(): void {
		if (this._needsPaint) return
		// Don't schedule paint for detached objects
		if (!this._attached) return
		this._needsPaint = true

		// Use paint scheduler to avoid circular dependency
		getPaintScheduler().requestPaint(this)
	}

	/**
	 * Perform layout for this render object.
	 * Subclasses should override this to implement their layout logic.
	 */
	performLayout(): void {
		// Debug logging disabled to prevent massive logs during layout loops
		// Uncomment for debugging:
		// logger.debug('performLayout', { type: this.constructor.name })
		// Override in subclasses for actual layout logic
		// Note: _needsLayout flag is cleared by layout() method
	}

	/**
	 * Paint this render object to the screen.
	 * Subclasses should override this to implement their painting logic.
	 *
	 * @param screen - The screen buffer to paint to
	 * @param offsetX - X offset from the parent object
	 * @param offsetY - Y offset from the parent object
	 */
	paint(screen: ScreenSurface, offsetX: number = 0, offsetY: number = 0): void {
		// Clear the needs paint flag
		this._needsPaint = false

		// Paint children by default, adding their offsets to the current position
		for (const child of this.children) {
			// Check if this child has offset positioning (RenderBox)
			if ('offset' in child) {
				const renderBox = child as RenderBox
				const childOffsetX = offsetX + renderBox.offset.x
				const childOffsetY = offsetY + renderBox.offset.y
				child.paint(screen, childOffsetX, childOffsetY)
			} else {
				// Non-positioned render objects paint at the current offset
				child.paint(screen, offsetX, offsetY)
			}
		}
	}

	/**
	 * Mouse system hit test - added by mixin in hit-test.ts
	 * This method is dynamically added by the addHitTestToRenderObject() function.
	 */

	/**
	 * Visit this render object and all its descendants.
	 * Useful for debugging and tree traversal.
	 *
	 * @param visitor - Function to call for each child render object
	 */
	visitChildren(visitor: (child: RenderObject) => void): void {
		for (const child of this._children) {
			visitor(child)
		}
	}

	/**
	 * Release any resources held by this render object.
	 *
	 * The object that creates a RenderObject is in charge of disposing it.
	 * Implementations of this method should end with a call to the inherited method.
	 *
	 * The object is no longer usable after calling dispose.
	 */
	dispose(): void {
		// Remove from pipeline owner's paint queue to prevent memory leaks
		getPaintScheduler().removeFromQueues(this)

		// Clear cached values to prevent memory leaks
		this._cachedDepth = undefined

		// Clear parent/child relationships
		this._parent = undefined
		this._children.length = 0

		// Base implementation - subclasses should call super.dispose()
	}
}

/**
 * A render object that uses a box layout model.
 * This is the base class for most terminal UI render objects.
 */
export abstract class RenderBox extends RenderObject {
	private _size = { width: 0, height: 0 }

	/**
	 * The size of this render box in terminal cells.
	 */
	get size(): Size {
		return { ...this._size }
	}

	/**
	 * Sets the size of this render box.
	 *
	 * @param width - Width in terminal cells
	 * @param height - Height in terminal cells
	 */
	setSize(width: number, height: number): void {
		assert(
			Number.isFinite(width) && Number.isFinite(height),
			`RenderBox.setSize received non-finite dimension: ${width}x${height}`,
		)
		this._size.width = width
		this._size.height = height
	}

	/**
	 * The position of this render box relative to its parent.
	 */
	protected _offset = { x: 0, y: 0 }

	get offset(): Offset {
		return { ...this._offset }
	}

	/**
	 * Sets the offset position of this render box relative to its parent.
	 * Coordinates are rounded to integers since terminal cells are discrete.
	 *
	 * @param x - X coordinate offset in terminal cells
	 * @param y - Y coordinate offset in terminal cells
	 */
	setOffset(x: number, y: number): void {
		// Round coordinates to integers since terminal cells are discrete
		// Handle undefined/NaN values gracefully
		const newX = Number.isFinite(x) ? Math.round(x) : 0
		const newY = Number.isFinite(y) ? Math.round(y) : 0

		this._offset.x = newX
		this._offset.y = newY
	}

	/**
	 * Convert a local coordinate to global coordinate.
	 * Walks up the render tree accumulating offsets.
	 */
	localToGlobal(localPoint: Offset): Offset {
		let globalX = localPoint.x
		let globalY = localPoint.y

		// Walk up the render tree, accumulating offsets
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		let current: RenderBox | undefined = this
		while (current) {
			globalX += current._offset.x
			globalY += current._offset.y

			// Move to parent (only if it's a RenderBox with offset info)
			current = current.parent as RenderBox | undefined
			if (current && !('_offset' in current)) {
				// Parent is not a RenderBox, stop here
				break
			}
		}

		return { x: globalX, y: globalY }
	}

	/**
	 * Convert a global coordinate to local coordinate.
	 * This is the inverse of localToGlobal.
	 */
	globalToLocal(globalPoint: Offset): Offset {
		// First get our global position
		const ourGlobalPos = this.localToGlobal({ x: 0, y: 0 })

		// Subtract our global position from the global point
		return {
			x: globalPoint.x - ourGlobalPos.x,
			y: globalPoint.y - ourGlobalPos.y,
		}
	}

	protected _lastConstraints?: BoxConstraints

	/**
	 * Perform layout with the given constraints.
	 * This is the public API that calls performLayout() internally.
	 *
	 * @param constraints - Box constraints that define minimum and maximum dimensions
	 */
	layout(constraints: BoxConstraints): void {
		// Only layout if needed: if this object needs layout or constraints changed
		const constraintsChanged =
			!this._lastConstraints || !constraints.equals(this._lastConstraints)

		if (!this._needsLayout && !constraintsChanged) {
			return
		}

		// Store constraints for potential re-layout
		this._lastConstraints = constraints

		// Clear the needs layout flag
		this._needsLayout = false

		// Call the implementation
		this.performLayout()
	}

	/**
	 * Returns the minimum width this render box would like to have.
	 * This is called during intrinsic sizing calculations.
	 *
	 * Default implementation: returns the max of all children's min intrinsic widths
	 *
	 * @param height - The height for which the minimum width is calculated
	 * @returns The minimum width in terminal cells
	 */
	getMinIntrinsicWidth(height: number): number {
		const children = this.children as RenderBox[]
		if (children.length === 0) return 0

		let maxWidth = 0
		for (const child of children) {
			maxWidth = Math.max(maxWidth, child.getMinIntrinsicWidth(height))
		}
		return maxWidth
	}

	/**
	 * Returns the maximum width this render box would like to have.
	 * This is called during intrinsic sizing calculations.
	 *
	 * Default implementation: returns the max of all children's max intrinsic widths
	 *
	 * @param height - The height for which the maximum width is calculated
	 * @returns The maximum width in terminal cells
	 */
	getMaxIntrinsicWidth(height: number): number {
		const children = this.children as RenderBox[]
		if (children.length === 0) return 0

		let maxWidth = 0
		for (const child of children) {
			maxWidth = Math.max(maxWidth, child.getMaxIntrinsicWidth(height))
		}
		return maxWidth
	}

	/**
	 * Returns the minimum height this render box would like to have.
	 * This is called during intrinsic sizing calculations.
	 *
	 * Default implementation: returns the max of all children's min intrinsic heights
	 *
	 * @param width - The width for which the minimum height is calculated
	 * @returns The minimum height in terminal cells
	 */
	getMinIntrinsicHeight(width: number): number {
		const children = this.children as RenderBox[]
		if (children.length === 0) return 0

		let maxHeight = 0
		for (const child of children) {
			maxHeight = Math.max(maxHeight, child.getMinIntrinsicHeight(width))
		}
		return maxHeight
	}

	/**
	 * Returns the maximum height this render box would like to have.
	 * This is called during intrinsic sizing calculations.
	 *
	 * Default implementation: returns the max of all children's max intrinsic heights
	 *
	 * @param width - The width for which the maximum height is calculated
	 * @returns The maximum height in terminal cells
	 */
	getMaxIntrinsicHeight(width: number): number {
		const children = this.children as RenderBox[]
		if (children.length === 0) return 0

		let maxHeight = 0
		for (const child of children) {
			maxHeight = Math.max(maxHeight, child.getMaxIntrinsicHeight(width))
		}
		return maxHeight
	}

	/**
	 * Paint this render box to the screen.
	 * Overrides the base paint method to handle box-specific offset calculations.
	 *
	 * @param screen - The screen buffer to paint to
	 * @param offsetX - X offset from the parent object
	 * @param offsetY - Y offset from the parent object
	 */
	paint(screen: ScreenSurface, offsetX: number = 0, offsetY: number = 0): void {
		// Paint children with proper offset calculation and viewport culling
		const screenSize = screen.getSize()
		const viewportWidth = screenSize.width
		const viewportHeight = screenSize.height

		for (const child of this.children) {
			if (child instanceof RenderBox) {
				const childX = offsetX + this.offset.x + child.offset.x
				const childY = offsetY + this.offset.y + child.offset.y

				// Viewport culling: skip painting if child is completely outside viewport
				const childRight = childX + child.size.width
				const childBottom = childY + child.size.height

				const isVisible = !(
					childX >= viewportWidth || // Left edge is right of viewport
					childY >= viewportHeight || // Top edge is below viewport
					childRight <= 0 || // Right edge is left of viewport
					childBottom <= 0 // Bottom edge is above viewport
				)

				if (isVisible) {
					child.paint(screen, offsetX + this.offset.x, offsetY + this.offset.y)
				}
			}
		}
	}

	/**
	 * Performs hit testing for mouse events on this render box.
	 * Tests if the given position intersects with this render box's bounds.
	 *
	 * @param result - Hit test result object to add hits to
	 * @param position - Mouse position to test
	 * @param parentAbsX - Absolute X position of the parent
	 * @param parentAbsY - Absolute Y position of the parent
	 * @returns True if this render box or its children were hit
	 */
	hitTest(
		result: HitTestResultInterface,
		position: MousePosition,
		parentAbsX: number = 0,
		parentAbsY: number = 0,
	): boolean {
		// Calculate absolute position of this render object once
		const absX = parentAbsX + this.offset.x
		const absY = parentAbsY + this.offset.y

		const withinX = position.x >= absX && position.x < absX + this.size.width
		const withinY = position.y >= absY && position.y < absY + this.size.height

		// PERFORMANCE: Only traverse children if this box was hit (spatial pruning)
		if (withinX && withinY) {
			// Pass absolute offset for correct local coordinate calculation
			result.addWithPaintOffset(this, { x: absX, y: absY }, position)

			// Test children (front to back) with global position and our absolute position
			let hitAny = true // We already hit this box
			for (let i = this.children.length - 1; i >= 0; i--) {
				const child = this.children[i]
				if ((child as any).hitTest(result, position, absX, absY)) {
					hitAny = true
				}
			}
			return hitAny
		}

		// Parent bounds not hit - check if we should still traverse children (for overlays/stacks)
		if (this.allowHitTestOutsideBounds) {
			let hitAny = false
			for (let i = this.children.length - 1; i >= 0; i--) {
				const child = this.children[i]
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

/**
 * Constraints for box layout that define minimum and maximum dimensions.
 * Used to communicate layout requirements between parent and child render objects.
 */
/**
 * Ensures a value is finite, returning fallback if infinite.
 */
export function finite(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback
}

export class BoxConstraints {
	public readonly minWidth: number
	public readonly maxWidth: number
	public readonly minHeight: number
	public readonly maxHeight: number

	/**
	 * Creates new box constraints.
	 *
	 * @param minWidth - Minimum width in terminal cells
	 * @param maxWidth - Maximum width in terminal cells (can be Infinity)
	 * @param minHeight - Minimum height in terminal cells
	 * @param maxHeight - Maximum height in terminal cells (can be Infinity)
	 */
	constructor(minWidth?: number, maxWidth?: number, minHeight?: number, maxHeight?: number)
	constructor(constraints: Partial<BoxConstraints>)
	constructor(
		minWidthOrConstraints?: number | Partial<BoxConstraints>,
		maxWidth?: number,
		minHeight?: number,
		maxHeight?: number,
	) {
		if (typeof minWidthOrConstraints === 'object') {
			this.minWidth = minWidthOrConstraints.minWidth ?? 0
			this.maxWidth = minWidthOrConstraints.maxWidth ?? Infinity
			this.minHeight = minWidthOrConstraints.minHeight ?? 0
			this.maxHeight = minWidthOrConstraints.maxHeight ?? Infinity
		} else {
			this.minWidth = minWidthOrConstraints ?? 0
			this.maxWidth = maxWidth ?? Infinity
			this.minHeight = minHeight ?? 0
			this.maxHeight = maxHeight ?? Infinity
		}
	}

	/**
	 * Creates constraints with tight (fixed) dimensions.
	 * The resulting constraints force an exact size.
	 *
	 * @param width - Fixed width in terminal cells
	 * @param height - Fixed height in terminal cells
	 * @returns BoxConstraints with fixed dimensions
	 */
	static tight(width: number, height: number): BoxConstraints {
		return new BoxConstraints(width, width, height, height)
	}

	/**
	 * Creates constraints with loose (flexible) dimensions.
	 * The resulting constraints allow flexibility from 0 to the maximum size.
	 *
	 * @param maxWidth - Maximum width in terminal cells
	 * @param maxHeight - Maximum height in terminal cells
	 * @returns BoxConstraints with flexible dimensions
	 */
	static loose(maxWidth: number, maxHeight: number): BoxConstraints {
		return new BoxConstraints(0, maxWidth, 0, maxHeight)
	}

	/**
	 * Whether these constraints have a finite maximum width.
	 */
	get hasBoundedWidth(): boolean {
		return this.maxWidth !== Infinity
	}

	/**
	 * Whether these constraints have a finite maximum height.
	 */
	get hasBoundedHeight(): boolean {
		return this.maxHeight !== Infinity
	}

	/**
	 * Whether these constraints force a specific width.
	 */
	get hasTightWidth(): boolean {
		return this.minWidth >= this.maxWidth
	}

	/**
	 * Whether these constraints force a specific height.
	 */
	get hasTightHeight(): boolean {
		return this.minHeight >= this.maxHeight
	}

	/**
	 * Constrains the given size to fit within these constraints.
	 * Clamps the provided dimensions to the minimum and maximum bounds.
	 *
	 * @param width - Desired width in terminal cells
	 * @param height - Desired height in terminal cells
	 * @returns Size object with width and height constrained to these bounds
	 */
	constrain(width: number, height: number): { width: number; height: number } {
		// Assert that input dimensions are finite - infinite inputs indicate layout bugs
		assert(
			isFinite(width),
			`BoxConstraints.constrain received infinite width: ${width}. This indicates a layout bug where a widget is not properly calculating its desired size.`,
		)
		assert(
			isFinite(height),
			`BoxConstraints.constrain received infinite height: ${height}. This indicates a layout bug where a widget is not properly calculating its desired size.`,
		)

		return {
			width: Math.max(this.minWidth, Math.min(this.maxWidth, width)),
			height: Math.max(this.minHeight, Math.min(this.maxHeight, height)),
		}
	}

	/**
	 * Returns new box constraints that respect the given constraints while being
	 * as close as possible to the original constraints (this).
	 *
	 * This clamps the given constraints to fit within this constraint's range.
	 * For example, if this is [0, 30] and other is [50, 50], the result is [30, 30].
	 *
	 * This is how Flutter's enforce() works - it clamps values rather than doing
	 * interval intersection which can produce invalid ranges (min > max).
	 *
	 * @param other - Constraints to clamp into this constraint's range
	 * @returns New BoxConstraints with other's values clamped to this range
	 */
	enforce(other: BoxConstraints): BoxConstraints {
		const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
		return new BoxConstraints(
			clamp(other.minWidth, this.minWidth, this.maxWidth),
			clamp(other.maxWidth, this.minWidth, this.maxWidth),
			clamp(other.minHeight, this.minHeight, this.maxHeight),
			clamp(other.maxHeight, this.minHeight, this.maxHeight),
		)
	}

	/**
	 * The biggest size that satisfies these constraints.
	 */
	get biggest(): { width: number; height: number } {
		return { width: this.maxWidth, height: this.maxHeight }
	}

	/**
	 * The smallest size that satisfies these constraints.
	 */
	get smallest(): { width: number; height: number } {
		return { width: this.minWidth, height: this.minHeight }
	}

	/**
	 * Returns loosened constraints where minimum constraints become 0.
	 */
	loosen(): BoxConstraints {
		return new BoxConstraints(0, this.maxWidth, 0, this.maxHeight)
	}

	/**
	 * Returns new box constraints with a tight width and/or height as close to the given
	 * width and height as possible while still respecting the original box constraints.
	 *
	 * This clamps the provided width/height to fit within this constraint's range.
	 *
	 * @param width - Optional width to tighten to
	 * @param height - Optional height to tighten to
	 * @returns New BoxConstraints with tightened dimensions
	 */
	tighten({ width, height }: { width?: number; height?: number } = {}): BoxConstraints {
		return new BoxConstraints(
			width === undefined
				? this.minWidth
				: Math.max(this.minWidth, Math.min(this.maxWidth, width)),
			width === undefined
				? this.maxWidth
				: Math.max(this.minWidth, Math.min(this.maxWidth, width)),
			height === undefined
				? this.minHeight
				: Math.max(this.minHeight, Math.min(this.maxHeight, height)),
			height === undefined
				? this.maxHeight
				: Math.max(this.minHeight, Math.min(this.maxHeight, height)),
		)
	}

	/**
	 * Creates tight constraints for specified dimensions, leaving unspecified dimensions unconstrained.
	 *
	 * @param width - Optional width (becomes both min and max)
	 * @param height - Optional height (becomes both min and max)
	 * @returns New BoxConstraints with tight dimensions for specified values
	 */
	static tightFor({ width, height }: { width?: number; height?: number } = {}): BoxConstraints {
		return new BoxConstraints(width ?? 0, width ?? Infinity, height ?? 0, height ?? Infinity)
	}

	/**
	 * Check if these constraints are equal to another set of constraints.
	 *
	 * @param other - The other constraints to compare with
	 * @returns true if all constraint values are equal
	 */
	equals(other: BoxConstraints): boolean {
		return (
			this.minWidth === other.minWidth &&
			this.maxWidth === other.maxWidth &&
			this.minHeight === other.minHeight &&
			this.maxHeight === other.maxHeight
		)
	}
}

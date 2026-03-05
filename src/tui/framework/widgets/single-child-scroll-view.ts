import { assert } from '../../lib/assert.js'
import { ClippedScreen } from '../../lib/clipped-screen.js'
import type { Screen } from '../../lib/screen.js'
import type { BuildContext } from '../build-context.js'
import type { Key } from '../key.js'
import { BoxConstraints, RenderBox } from '../render-object.js'
import { SingleChildRenderObjectWidget } from '../render-object-widget.js'
import type { ScrollController } from '../scrolling/scroll-controller.js'
import { Axis, Scrollable } from '../scrolling/scrollable.js'
import { StatelessWidget } from '../stateless-widget.js'
import type { Widget } from '../widget.js'

/**
 * A scrollable widget that takes a single child.
 *
 * Similar to Flutter's SingleChildScrollView, this widget is designed
 * to scroll arbitrary content like Column, Row, or complex layouts.
 */
export class SingleChildScrollView extends StatelessWidget {
	readonly child: Widget
	readonly controller?: ScrollController
	readonly scrollDirection: Axis
	readonly autofocus: boolean
	readonly enableMouseScroll: boolean
	readonly position: 'top' | 'bottom'

	constructor({
		key,
		child,
		controller,
		scrollDirection = Axis.vertical,
		autofocus = true,
		enableMouseScroll = true,
		position = 'top',
	}: {
		key?: Key
		child: Widget
		controller?: ScrollController
		scrollDirection?: Axis
		autofocus?: boolean
		enableMouseScroll?: boolean
		position?: 'top' | 'bottom'
	}) {
		super(key ? { key } : {})
		this.child = child
		this.controller = controller
		this.scrollDirection = scrollDirection
		this.autofocus = autofocus
		this.enableMouseScroll = enableMouseScroll
		this.position = position
	}

	build(context: BuildContext): Widget {
		return new Scrollable({
			controller: this.controller,
			axisDirection: this.scrollDirection,
			autofocus: this.autofocus,
			enableMouseScroll: this.enableMouseScroll,
			viewportBuilder: (
				context: BuildContext,
				offset: number,
				shouldFollow: boolean,
				controller?: ScrollController,
			) => {
				return new _SingleChildViewport(this.child, {
					axisDirection: this.scrollDirection,
					offset,
					scrollController: controller || this.controller,
					position: this.position,
				})
			},
		})
	}
}

/**
 * A viewport that properly measures single child content for scrolling.
 */
class _SingleChildViewport extends SingleChildRenderObjectWidget {
	readonly axisDirection: Axis
	readonly offset: number
	readonly scrollController?: ScrollController
	readonly position: 'top' | 'bottom'

	constructor(
		child: Widget,
		{
			key,
			axisDirection = Axis.vertical,
			offset = 0,
			scrollController,
			position = 'top',
		}: {
			key?: Key
			axisDirection?: Axis
			offset?: number
			scrollController?: ScrollController
			position?: 'top' | 'bottom'
		} = {},
	) {
		super(key ? { child, key } : { child })
		this.axisDirection = axisDirection
		this.offset = offset
		this.scrollController = scrollController
		this.position = position
	}

	createRenderObject(): _SingleChildViewportRenderObject {
		return new _SingleChildViewportRenderObject(
			this.axisDirection,
			this.offset,
			this.scrollController,
			this.position,
		)
	}

	updateRenderObject(renderObject: _SingleChildViewportRenderObject): void {
		renderObject.updateProperties(
			this.axisDirection,
			this.offset,
			this.scrollController,
			this.position,
		)
	}
}

/**
 * Render object for single child viewport that properly calculates scroll extents.
 */
class _SingleChildViewportRenderObject extends RenderBox {
	private _axisDirection: Axis
	private _scrollOffset: number
	private _scrollController?: ScrollController
	private _position: 'top' | 'bottom'

	/**
	 * Expose the scroll controller for ensureVisible functionality.
	 * This allows child widgets to request scrolling to make themselves visible.
	 */
	get scrollController(): ScrollController | undefined {
		return this._scrollController
	}

	constructor(
		axisDirection: Axis,
		scrollOffset: number,
		scrollController?: ScrollController,
		position: 'top' | 'bottom' = 'top',
	) {
		super()
		this._axisDirection = axisDirection
		this._scrollOffset = scrollOffset
		this._scrollController = scrollController
		this._position = position
	}

	updateProperties(
		axisDirection: Axis,
		scrollOffset: number,
		scrollController?: ScrollController,
		position: 'top' | 'bottom' = 'top',
	): void {
		if (this._axisDirection !== axisDirection) {
			this._axisDirection = axisDirection
			this.markNeedsLayout()
		}

		if (this._scrollController !== scrollController) {
			this._scrollController = scrollController
			this.markNeedsLayout()
		}

		if (this._position !== position) {
			this._position = position
			this.markNeedsLayout()
		}

		if (this._scrollOffset !== scrollOffset) {
			this._scrollOffset = scrollOffset
			// Update child offset immediately without waiting for layout
			this.updateChildOffset()
		}
	}

	private updateChildOffset(): void {
		if (this.children.length === 0) {
			return
		}

		const child = this.children[0] as RenderBox

		// Position the child based on scroll offset
		let childOffsetX = 0
		let childOffsetY = 0

		if (this._axisDirection === Axis.vertical) {
			childOffsetY = -this._scrollOffset
		} else {
			childOffsetX = -this._scrollOffset
		}

		child.setOffset(childOffsetX, childOffsetY)
	}

	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		if (this.children.length === 0) {
			this.setSize(constraints.minWidth, constraints.minHeight)
			super.performLayout()
			return
		}

		const child = this.children[0] as RenderBox

		// Give child unlimited space in the scroll direction, like Flutter's SingleChildScrollView
		if (this._axisDirection === Axis.vertical) {
			// For vertical scrolling, give unlimited height but constrain width
			const childConstraints = new BoxConstraints(
				constraints.minWidth,
				constraints.maxWidth,
				0, // No minimum height
				Number.POSITIVE_INFINITY, // Unlimited height
			)
			child.layout(childConstraints)
		} else {
			// For horizontal scrolling, give unlimited width but constrain height
			const childConstraints = new BoxConstraints(
				0, // No minimum width
				Number.POSITIVE_INFINITY, // Unlimited width
				constraints.minHeight,
				constraints.maxHeight,
			)
			child.layout(childConstraints)
		}

		// Set our size to match the viewport constraints
		this.setSize(constraints.maxWidth, constraints.maxHeight)

		// Update the scroll controller's max scroll extent and handle follow mode
		if (this._scrollController) {
			const scrollExtent = this.totalScrollExtent
			const viewportDimension =
				this._axisDirection === Axis.vertical ? this.size.height : this.size.width

			// Store the current bottom state before updating extent
			const wasAtBottom = this._scrollController.atBottom

			// Update scroll controller with new extent
			this._scrollController.updateMaxScrollExtent(scrollExtent)
			this._scrollController.updateViewportDimension(viewportDimension)

			// Handle follow mode - if we were at bottom and follow mode is enabled, stay at bottom
			if (this._scrollController.followMode && wasAtBottom) {
				this._scrollController.jumpTo(scrollExtent)
			} else if (this._scrollController.offset > scrollExtent) {
				// Fix over-scrolling
				this._scrollController.jumpTo(scrollExtent)
			}

			// Update our scroll offset to match controller
			this._scrollOffset = this._scrollController.offset
		}

		// Handle bottom positioning for when content is smaller than viewport
		this.handleBottomPositioning(constraints, child)

		// Position the child based on scroll offset
		this.updateChildOffset()

		super.performLayout()
	}

	/**
	 * Handles bottom positioning logic when content is smaller than viewport.
	 */
	private handleBottomPositioning(constraints: BoxConstraints, child: RenderBox): void {
		if (this._position !== 'bottom') {
			return
		}

		const viewportSize =
			this._axisDirection === Axis.vertical ? constraints.maxHeight : constraints.maxWidth
		const contentSize =
			this._axisDirection === Axis.vertical ? child.size.height : child.size.width

		// If content is smaller than viewport and position is 'bottom', align to bottom
		if (contentSize <= viewportSize) {
			const bottomOffset = -(viewportSize - contentSize)
			this._scrollOffset = bottomOffset
		}
	}

	/**
	 * Calculate the total scrollable extent.
	 * This is what makes scrolling work!
	 */
	get totalScrollExtent(): number {
		if (this.children.length === 0) {
			return 0
		}

		const child = this.children[0] as RenderBox

		// Ensure both child and viewport have valid sizes
		if (
			child.size.width <= 0 ||
			child.size.height <= 0 ||
			this.size.width <= 0 ||
			this.size.height <= 0
		) {
			return 0
		}

		if (this._axisDirection === Axis.vertical) {
			// For vertical scrolling, scroll extent is child height minus viewport height
			const childHeight = child.size.height
			const viewportHeight = this.size.height

			// Ensure we don't have infinite values
			if (!Number.isFinite(childHeight) || !Number.isFinite(viewportHeight)) {
				return 0
			}

			const scrollExtent = Math.max(0, childHeight - viewportHeight)
			return scrollExtent
		} else {
			// For horizontal scrolling, scroll extent is child width minus viewport width
			const childWidth = child.size.width
			const viewportWidth = this.size.width

			// Ensure we don't have infinite values
			if (!Number.isFinite(childWidth) || !Number.isFinite(viewportWidth)) {
				return 0
			}

			return Math.max(0, childWidth - viewportWidth)
		}
	}

	paint(screen: Screen, offsetX: number = 0, offsetY: number = 0): void {
		// Paint children with clipping to the viewport bounds
		for (const child of this.children) {
			if ('offset' in child && 'paint' in child) {
				// Don't add the child's offset here - it's already positioned by setOffset()
				// The child will apply its own offset during painting
				const clippedScreen = new ClippedScreen(
					screen,
					offsetX,
					offsetY,
					this.size.width,
					this.size.height,
				)

				child.paint(clippedScreen, offsetX, offsetY)
			}
		}
	}
}

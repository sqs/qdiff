import { assert } from '../../lib/assert.js'
import { ClippedScreen } from '../../lib/clipped-screen.js'
import type { KeyboardEvent, SgrMouseEvent } from '../../lib/parser/types.js'
import type { Screen } from '../../lib/screen.js'
import type { BuildContext } from '../build-context.js'
import { KeyEventResult } from '../focus/focus-node.js'
import type { Key } from '../key.js'
import type { MouseScrollEvent } from '../mouse/mouse-events.js'
import type { BoxConstraints, RenderObject } from '../render-object.js'
import { RenderBox } from '../render-object.js'
import { SingleChildRenderObjectWidget } from '../render-object-widget.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'
import { Focus } from '../widgets/focus.js'
import { MouseRegion } from '../widgets/mouse-region.js'
import { ScrollBehavior } from './scroll-behavior.js'
import { ScrollController } from './scroll-controller.js'
import type { ScrollPhysics } from './scroll-physics.js'
import { ClampingScrollPhysics } from './scroll-physics.js'

/**
 * Direction of scrolling.
 */
export enum Axis {
	horizontal = 'horizontal',
	vertical = 'vertical',
}

/**
 * A widget that manages scrolling for its child.
 *
 * This is the core scrolling widget that handles user input,
 * manages scroll physics, and coordinates with a ScrollController.
 */
export class Scrollable extends StatefulWidget {
	readonly axisDirection: Axis
	readonly controller: ScrollController | undefined
	readonly physics: ScrollPhysics | undefined
	readonly enableMouseScroll: boolean
	readonly viewportBuilder: (
		context: BuildContext,
		offset: number,
		shouldFollow: boolean,
		controller?: ScrollController,
	) => Widget
	readonly autofocus: boolean

	constructor({
		key,
		axisDirection = Axis.vertical,
		controller,
		physics,
		viewportBuilder,
		autofocus = false,
		enableMouseScroll = true,
	}: {
		key?: Key
		axisDirection?: Axis
		controller?: ScrollController
		physics?: ScrollPhysics
		viewportBuilder: (
			context: BuildContext,
			offset: number,
			shouldFollow: boolean,
			controller?: ScrollController,
		) => Widget
		autofocus?: boolean
		enableMouseScroll?: boolean
	}) {
		super(key ? { key } : {})
		this.axisDirection = axisDirection
		this.controller = controller
		this.physics = physics
		this.viewportBuilder = viewportBuilder
		this.autofocus = autofocus
		this.enableMouseScroll = enableMouseScroll
	}

	createState(): State<this> {
		return new ScrollableState() as unknown as State<this>
	}
}

/**
 * State for Scrollable widget.
 */
export class ScrollableState extends State<Scrollable> {
	private _controller: ScrollController | null = null
	private _physics: ScrollPhysics | null = null
	private _scrollBehavior: ScrollBehavior | null = null
	private _boundOnScrollChanged = this._onScrollChanged.bind(this)
	private _boundHandleKeyEvent = this.handleKeyEvent.bind(this)
	private _boundHandleMouseScrollEvent = this.handleMouseScrollEvent.bind(this)

	get controller(): ScrollController {
		return this._controller!
	}

	get physics(): ScrollPhysics {
		return this._physics!
	}

	initState(): void {
		super.initState()
		this._controller = this.widget.controller || new ScrollController()
		this._physics = this.widget.physics || new ClampingScrollPhysics()
		this._scrollBehavior = new ScrollBehavior(this)

		// Listen to scroll controller changes and rebuild when position changes
		this._controller.addListener(this._boundOnScrollChanged)
	}

	dispose(): void {
		// Remove listener before disposing
		if (this._controller) {
			this._controller.removeListener(this._boundOnScrollChanged)
		}

		// Only dispose if we created the controller
		if (!this.widget.controller) {
			this._controller?.dispose()
		}
		super.dispose()
	}

	build(context: BuildContext): Widget {
		const currentOffset = this._controller!.offset

		// Update scroll behavior context for terminal-aware scrolling
		this._scrollBehavior?.updateContext(context)

		// Determine if we should follow (controller decides the policy)
		const shouldFollow = this._controller!.followMode && this._controller!.atBottom

		let viewport = this.widget.viewportBuilder(
			context,
			currentOffset,
			shouldFollow,
			this._controller || undefined,
		)

		// If the viewport is a Viewport widget, update it with the scroll controller
		if (viewport instanceof Viewport && viewport.child) {
			// Create a new viewport with the scroll controller
			viewport = new Viewport(viewport.child, {
				axisDirection: viewport.axisDirection,
				offset: viewport.offset,
				scrollController: this._controller || undefined,
			})
		}

		const focusChild = this.widget.enableMouseScroll
			? new MouseRegion({
					onScroll: this._boundHandleMouseScrollEvent,
					opaque: false, // Allow events to pass through to other handlers
					child: viewport,
			})
			: viewport

		// Wrap viewport with Focus for keyboard events.
		return new Focus({
			onKey: this._boundHandleKeyEvent,
			autofocus: this.widget.autofocus,
			debugLabel: 'Scrollable',
			child: focusChild,
		})
	}

	/**
	 * Called when the scroll controller's position changes.
	 * Triggers a rebuild to update the viewport with new scroll position.
	 */
	private _onScrollChanged(): void {
		this.setState(() => {
			// The setState will trigger a rebuild with the new scroll position
		})
	}

	/**
	 * Handles key events for scrolling.
	 */
	private handleKeyEvent(event: KeyboardEvent): KeyEventResult {
		if (!this._scrollBehavior) {
			return KeyEventResult.ignored
		}

		try {
			return this._scrollBehavior.handleKeyEvent(event)
		} catch (error) {
			return KeyEventResult.ignored
		}
	}

	/**
	 * Handles mouse scroll events through the mouse region system.
	 */
	private handleMouseScrollEvent(event: MouseScrollEvent): void {
		// Convert scroll direction to delta
		const scrollStep = this.getScrollStep()
		const delta = event.direction === 'down' ? scrollStep : -scrollStep

		this.handleScrollDelta(delta)
	}

	/**
	 * Get the step size for scrolling operations.
	 */
	private getScrollStep(): number {
		// Scroll 1 line per wheel event for precise control
		return 1
	}

	/**
	 * Handles mouse events, particularly mouse wheel scrolling.
	 */
	handleMouseEvent(event: SgrMouseEvent): boolean {
		return this._scrollBehavior!.handleMouseEvent(event)
	}

	/**
	 * Handles scroll input from user interaction.
	 */
	handleScrollDelta(delta: number): void {
		if (!this._physics!.shouldAcceptUserOffset()) {
			return
		}

		const currentOffset = this._controller!.offset
		const newOffset = currentOffset + delta

		// Apply physics boundary conditions using the controller's current max extent
		const minScrollExtent = 0
		const maxScrollExtent = this._controller!.maxScrollExtent

		const clampedOffset = this._physics!.applyBoundaryConditions(
			newOffset,
			minScrollExtent,
			maxScrollExtent,
		)

		this._controller!.updateOffset(clampedOffset)
	}
}

/**
 * A viewport is the visible area of a scrollable widget.
 * It clips its child to the visible area and positions it based on scroll offset.
 * The child must be a SliverList.
 */
export class Viewport extends SingleChildRenderObjectWidget {
	readonly axisDirection: Axis
	readonly offset: number
	readonly scrollController?: ScrollController

	constructor(
		child: Widget,
		{
			key,
			axisDirection = Axis.vertical,
			offset = 0,
			scrollController,
		}: {
			key?: Key
			axisDirection?: Axis
			offset?: number
			scrollController?: ScrollController
		} = {},
	) {
		super(key ? { child, key } : { child })
		this.axisDirection = axisDirection
		this.offset = offset
		this.scrollController = scrollController
	}

	createRenderObject(): RenderObject {
		return new ViewportRenderObject(this.axisDirection, this.offset, this.scrollController)
	}

	updateRenderObject(renderObject: RenderObject): void {
		const viewportRenderObject = renderObject as ViewportRenderObject
		viewportRenderObject.updateProperties(
			this.axisDirection,
			this.offset,
			this.scrollController,
		)
	}
}

/**
 * Render object for Viewport.
 * Handles clipping and positioning of scrollable content.
 */
export class ViewportRenderObject extends RenderBox {
	private _axisDirection: Axis
	private _scrollOffset: number
	private _scrollController?: ScrollController

	constructor(axisDirection: Axis, scrollOffset: number, scrollController?: ScrollController) {
		super()
		this._axisDirection = axisDirection
		this._scrollOffset = scrollOffset
		this._scrollController = scrollController
	}

	updateProperties(
		axisDirection: Axis,
		scrollOffset: number,
		scrollController?: ScrollController,
	): void {
		let needsLayout = false

		if (this._axisDirection !== axisDirection) {
			this._axisDirection = axisDirection
			needsLayout = true
		}

		if (this._scrollOffset !== scrollOffset) {
			this._scrollOffset = scrollOffset
			needsLayout = true
		}

		if (this._scrollController !== scrollController) {
			this._scrollController = scrollController
			needsLayout = true
		}

		if (needsLayout) {
			this.markNeedsLayout()
		}
	}

	performLayout(): void {
		super.performLayout()

		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		if (this.children.length === 0) {
			this.setSize(constraints.minWidth, constraints.minHeight)
			return
		}

		const sliverChild = this.children[0] as any

		// Handle scroll positioning before layout
		if (this._scrollController && typeof sliverChild?.getTotalContentHeight === 'function') {
			const totalContentHeight = sliverChild.getTotalContentHeight()
			const newScrollExtent = Math.max(0, totalContentHeight - constraints.maxHeight)

			// Store the current bottom state before updating extent
			const wasAtBottom = this._scrollController.atBottom

			// Update scroll controller with new extent
			this._scrollController.updateMaxScrollExtent(newScrollExtent)
			this._scrollController.updateViewportDimension(constraints.maxHeight)

			// Handle follow mode and repositioning before layout
			if (this._scrollController.followMode && wasAtBottom) {
				this._scrollController.jumpTo(newScrollExtent)
			} else if (this._scrollController.offset > newScrollExtent) {
				// Fix over-scrolling
				this._scrollController.jumpTo(newScrollExtent)
			}

			// Update our scroll offset to match controller
			this._scrollOffset = this._scrollController.offset
		}

		// Pass the current scroll offset to the sliver child (if method exists)
		if (typeof sliverChild.setScrollOffset === 'function') {
			sliverChild.setScrollOffset(this._scrollOffset)
		}

		// Give the child the same constraints
		sliverChild.layout(constraints)

		// Check for bottom positioning after child layout completes
		this.handleBottomPositioning(constraints, sliverChild)

		// Position the child based on scroll offset
		const childOffsetY = -this._scrollOffset
		sliverChild.setOffset(0, childOffsetY)

		// Set our size to match constraints
		this.setSize(constraints.maxWidth, constraints.maxHeight)
	}

	/**
	 * Handles bottom positioning logic after child (sliver) layout completes.
	 */
	private handleBottomPositioning(constraints: BoxConstraints, sliverChild: any): void {
		// Check if the child has the required methods
		if (
			typeof sliverChild.getTotalContentHeight !== 'function' ||
			typeof sliverChild.getPosition !== 'function'
		) {
			return
		}

		const viewportHeight = constraints.maxHeight
		const totalContentHeight = sliverChild.getTotalContentHeight()
		const position = sliverChild.getPosition()

		if (totalContentHeight <= viewportHeight && position === 'bottom') {
			const bottomOffset = -(viewportHeight - totalContentHeight)
			this._scrollOffset = bottomOffset
		}
	}

	paint(screen: Screen, offsetX: number = 0, offsetY: number = 0): void {
		// Paint children with clipping to the viewport bounds
		for (const child of this.children) {
			if ('offset' in child) {
				const renderBox = child as RenderBox
				const childOffsetX = offsetX + renderBox.offset.x
				const childOffsetY = offsetY + renderBox.offset.y

				// Create a clipped screen region for the child
				const clippedScreen = new ClippedScreen(
					screen,
					offsetX,
					offsetY,
					this.size.width,
					this.size.height,
				)

				child.paint(clippedScreen, childOffsetX, childOffsetY)
			} else {
				child.paint(screen, offsetX, offsetY)
			}
		}
	}

	get axisDirection(): Axis {
		return this._axisDirection
	}

	get scrollOffset(): number {
		return this._scrollOffset
	}

	/**
	 * Gets the maximum scroll extent from the child sliver.
	 */
	getMaxScrollExtent(): number {
		if (this.children.length === 0) {
			return 0
		}

		const sliverChild = this.children[0] as any
		return sliverChild?.totalScrollExtent || 0
	}

	dispose(): void {
		super.dispose()
	}
}

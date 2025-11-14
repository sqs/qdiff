import type { BuildContext } from '../build-context.js'
import type { Key } from '../key.js'
import type { Widget } from '../widget.js'
import type {
	MouseClickEvent,
	MouseDragEvent,
	MouseHoverEvent,
} from '../mouse/mouse-events.js'
import { RenderBox, type RenderObject } from '../render-object.js'
import {
	RenderObjectWidget,
	SingleChildRenderObjectWidget,
} from '../render-object-widget.js'
import type { ScrollController } from '../scrolling/scroll-controller.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import { MouseRegion } from './mouse-region.js'
import { assert } from '../../lib/assert.js'
import { MouseCursor } from '../../lib/mouse-cursor.js'
import type { Color } from '../../lib/screen.js'
import type { ScreenSurface } from '../../lib/screen-surface.js'

export interface ScrollbarInfo {
	/** The total content height in lines */
	totalContentHeight: number
	/** The visible viewport height in lines */
	viewportHeight: number
	/** Current scroll offset */
	scrollOffset: number
}

/**
 * A vertical scrollbar widget that shows the current scroll position
 * and allows visual indication of the viewport relative to total content.
 * Supports mouse drag interaction with fractional pixel precision.
 */
export class Scrollbar extends StatefulWidget {
	readonly child: Widget
	readonly controller: ScrollController
	readonly getScrollInfo: () => ScrollbarInfo
	readonly thickness: number
	readonly trackChar: string
	readonly thumbChar: string
	readonly showTrack: boolean
	readonly thumbColor: Color
	readonly trackColor: Color

	constructor({
		key,
		child,
		controller,
		getScrollInfo,
		thickness = 1,
		trackChar = '█',
		thumbChar = '█',
		showTrack = true,
		thumbColor,
		trackColor,
	}: {
		key?: Key
		child: Widget
		controller: ScrollController
		getScrollInfo: () => ScrollbarInfo
		thickness?: number
		trackChar?: string
		thumbChar?: string
		showTrack?: boolean
		thumbColor: Color
		trackColor: Color
	}) {
		super(key ? { key } : {})
		this.child = child
		this.controller = controller
		this.getScrollInfo = getScrollInfo
		this.thickness = thickness
		this.trackChar = trackChar
		this.thumbChar = thumbChar
		this.showTrack = showTrack
		this.thumbColor = thumbColor
		this.trackColor = trackColor
	}

	createState(): State<this> {
		return new ScrollbarState() as unknown as State<this>
	}
}

class ScrollbarState extends State<Scrollbar> {
	private _dragStartY: number | null = null
	private _dragStartOffset: number | null = null
	private _isOverThumb = false
    private _isDraggingThumb = false

	private _isPositionOverThumb(x: number, y: number): boolean {
		const { totalContentHeight, viewportHeight } = this.widget.getScrollInfo()
		const renderObject = this.context.findRenderObject() as RenderBox | undefined
		
        if (!renderObject) return false

        // Check if x is within scrollbar thickness
        const scrollbarX = renderObject.size.width - this.widget.thickness
        if (x < scrollbarX) {
            return false
        }

		const scrollbarHeight = renderObject.size.height ?? 0

		if (scrollbarHeight === 0 || totalContentHeight <= viewportHeight) {
			return false
		}

		const scrollInfo = this.widget.getScrollInfo()
		const thumbSizeRatio = Math.min(1, viewportHeight / totalContentHeight)
		const thumbSizeFloat = Math.max(1, scrollbarHeight * thumbSizeRatio)
		const scrollRatio = Math.max(
			0,
			Math.min(1, scrollInfo.scrollOffset / (totalContentHeight - viewportHeight)),
		)
		const availableTrackSpace = scrollbarHeight - thumbSizeFloat
		const thumbStartFloat = Math.max(0, availableTrackSpace * scrollRatio)
		const thumbEndFloat = thumbStartFloat + thumbSizeFloat

		return y >= thumbStartFloat && y <= thumbEndFloat
	}

	private _handleHover = (event: MouseHoverEvent): void => {
		const wasOverThumb = this._isOverThumb
		this._isOverThumb = this._isPositionOverThumb(event.localPosition.x, event.localPosition.y)

		if (wasOverThumb !== this._isOverThumb) {
			this.setState()
		}
	}

	private _handleDrag = (event: MouseDragEvent): void => {
        if (!this._isDraggingThumb) {
            return
        }

		const { totalContentHeight, viewportHeight, scrollOffset } = this.widget.getScrollInfo()
		const renderObject = this.context.findRenderObject() as RenderBox | undefined
		const scrollbarHeight = renderObject?.size.height ?? 0

		if (scrollbarHeight === 0 || totalContentHeight <= viewportHeight) {
			return
		}

		if (this._dragStartY === null) {
			this._dragStartY = event.localPosition.y
			this._dragStartOffset = scrollOffset
		}

		const deltaY = event.localPosition.y - this._dragStartY
		const thumbSizeRatio = Math.min(1, viewportHeight / totalContentHeight)
		const thumbSizeFloat = Math.max(1, scrollbarHeight * thumbSizeRatio)
		const availableTrackSpace = scrollbarHeight - thumbSizeFloat

		if (availableTrackSpace <= 0) {
			return
		}

		const scrollRange = totalContentHeight - viewportHeight
		const pixelsPerScrollUnit = availableTrackSpace / scrollRange

		const scrollDelta = deltaY / pixelsPerScrollUnit
		const newOffset = Math.max(0, Math.min(scrollRange, this._dragStartOffset! + scrollDelta))

		this.widget.controller.jumpTo(newOffset)
	}

	private _handleRelease = (): void => {
		this._dragStartY = null
		this._dragStartOffset = null
        this._isDraggingThumb = false
	}

	private _handleClick = (event: MouseClickEvent): void => {
		if (event.button !== 'left') {
			return
		}

		const renderObject = this.context.findRenderObject() as RenderBox | undefined
        if (!renderObject) return

        // Check if click is within scrollbar thickness
        const scrollbarX = renderObject.size.width - this.widget.thickness
        if (event.localPosition.x < scrollbarX) {
            return
        }

		const clickY = event.localPosition.y
		const { totalContentHeight, viewportHeight, scrollOffset } = this.widget.getScrollInfo()
		const scrollbarHeight = renderObject?.size.height ?? 0

		if (scrollbarHeight === 0 || totalContentHeight <= viewportHeight) {
			return
		}

		const thumbSizeRatio = Math.min(1, viewportHeight / totalContentHeight)
		const thumbSizeFloat = Math.max(1, scrollbarHeight * thumbSizeRatio)
		const scrollRange = totalContentHeight - viewportHeight
		const availableTrackSpace = scrollbarHeight - thumbSizeFloat
		const scrollRatio = Math.max(
			0,
			Math.min(1, scrollOffset / (totalContentHeight - viewportHeight)),
		)
		const thumbStartFloat = Math.max(0, availableTrackSpace * scrollRatio)
		const thumbEndFloat = thumbStartFloat + thumbSizeFloat
		
		if (clickY >= thumbStartFloat && clickY <= thumbEndFloat) {
		this._isDraggingThumb = true
			return
		}

		if (clickY < thumbStartFloat) {
			this.widget.controller.animateTo(Math.max(0, scrollOffset - viewportHeight))
		} else {
			this.widget.controller.animateTo(Math.min(scrollRange, scrollOffset + viewportHeight))
		}
	}

	build(context: BuildContext) {
		return new MouseRegion({
			onClick: this._handleClick,
			onHover: this._handleHover,
			onDrag: this._handleDrag,
			onRelease: this._handleRelease,
            opaque: false, // Allow clicks to pass through to content if not handled
			cursor: this._isOverThumb ? MouseCursor.POINTER : MouseCursor.DEFAULT,
			child: new ScrollbarVisual({
				child: this.widget.child,
				controller: this.widget.controller,
				getScrollInfo: this.widget.getScrollInfo,
				thickness: this.widget.thickness,
				trackChar: this.widget.trackChar,
				thumbChar: this.widget.thumbChar,
				showTrack: this.widget.showTrack,
				thumbColor: this.widget.thumbColor,
				trackColor: this.widget.trackColor,
			}),
		})
	}
}

class ScrollbarVisual extends SingleChildRenderObjectWidget {
	readonly controller: ScrollController
	readonly getScrollInfo: () => ScrollbarInfo
	readonly thickness: number
	readonly trackChar: string
	readonly thumbChar: string
	readonly showTrack: boolean
	readonly thumbColor: Color
	readonly trackColor: Color

	constructor({
		key,
		child,
		controller,
		getScrollInfo,
		thickness = 1,
		trackChar = '█',
		thumbChar = '█',
		showTrack = true,
		thumbColor,
		trackColor,
	}: {
		key?: Key
		child: Widget
		controller: ScrollController
		getScrollInfo: () => ScrollbarInfo
		thickness?: number
		trackChar?: string
		thumbChar?: string
		showTrack?: boolean
		thumbColor: Color
		trackColor: Color
	}) {
		super(key ? { key, child } : { child })
		this.controller = controller
		this.getScrollInfo = getScrollInfo
		this.thickness = thickness
		this.trackChar = trackChar
		this.thumbChar = thumbChar
		this.showTrack = showTrack
		this.thumbColor = thumbColor
		this.trackColor = trackColor
	}

	createRenderObject(): RenderObject {
		return new ScrollbarRenderObject(this)
	}

	updateRenderObject(renderObject: RenderObject): void {
		const scrollbarRenderObject = renderObject as ScrollbarRenderObject
		scrollbarRenderObject.updateWidget(this)
	}
}

/**
 * Render object for the Scrollbar widget that handles layout and painting.
 */
class ScrollbarRenderObject extends RenderBox {
	private _widget: ScrollbarVisual

	constructor(widget: ScrollbarVisual) {
		super()
		this._widget = widget
	}

	updateWidget(widget: ScrollbarVisual): void {
		this._widget = widget
		this.markNeedsLayout()
	}

	performLayout(): void {
		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		// Layout child if present
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			child.layout(constraints)
			const childSize = child.size
			child.setOffset(0, 0)
			this.setSize(childSize.width, childSize.height)
		} else {
			// Default behavior if no child (fallback to old behavior)
			const width = Math.min(constraints.maxWidth, this._widget.thickness)
			const height = constraints.maxHeight
			this.setSize(width, height)
		}

		super.performLayout()
	}

	getMinIntrinsicWidth(height: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMinIntrinsicWidth(height)
		}
		return this._widget.thickness
	}

	getMaxIntrinsicWidth(height: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMaxIntrinsicWidth(height)
		}
		return this._widget.thickness
	}

	getMinIntrinsicHeight(width: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMinIntrinsicHeight(width)
		}
		return 0
	}

	getMaxIntrinsicHeight(width: number): number {
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			return child.getMaxIntrinsicHeight(width)
		}
		return Infinity
	}

	paint(surface: ScreenSurface, offsetX: number, offsetY: number): void {
		// Paint child first
		if (this.children.length > 0) {
			const child = this.children[0] as RenderBox
			child.paint(surface, offsetX + this.offset.x, offsetY + this.offset.y)
		}

		const { thumbStartFloat, thumbSizeFloat, showScrollbar } = this._calculateScrollbarMetrics()

		if (!showScrollbar) {
			return
		}

		// Use theme colors from widget
		const trackColor = this._widget.trackColor
		const thumbColor = this._widget.thumbColor

		// Unicode block characters for sub-character precision
		const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

		// Paint each line of the scrollbar
		const thumbStart = thumbStartFloat
		const thumbEnd = thumbStartFloat + thumbSizeFloat

		for (let line = 0; line < this.size.height; line++) {
			// Pure track (reversed by default)
			let char = '█'
			let reverse = true

			if (line === Math.floor(thumbStart)) {
				// Line contains the top of the thumb - partial fill from bottom
				// 0.25 means that 0.75 of the line is thumb
				const fillAmount = 1 - (thumbStart - line) // How much of this line is filled
				const blockIndex = Math.floor(fillAmount * 8)
				char = blocks[blockIndex] || '█'
				reverse = false
			} else if (line === Math.floor(thumbEnd)) {
				const fillAmount = 1 - (thumbEnd - line) // How much of this line is filled
				const blockIndex = Math.floor(fillAmount * 8)
				char = blocks[blockIndex] || '█'
			} else if (line > thumbStart && line < thumbEnd) {
				reverse = false
			}

			surface.setChar(
				offsetX + this.size.width - this._widget.thickness, // Align scrollbar to right edge of widget
				offsetY + line,
				char,
				{
					fg: thumbColor,
					bg: trackColor,
					reverse,
				},
				1, // Character width
			)
		}
	}

	/**
	 * Calculates the scrollbar thumb position and size with floating-point precision.
	 */
	private _calculateScrollbarMetrics(): {
		thumbStartFloat: number
		thumbSizeFloat: number
		showScrollbar: boolean
	} {
		const { totalContentHeight, viewportHeight, scrollOffset } = this._widget.getScrollInfo()
		const availableHeight = this.size.height

		// Don't show scrollbar if content fits in viewport
		if (totalContentHeight <= viewportHeight || availableHeight <= 0) {
			return {
				thumbStartFloat: 0,
				thumbSizeFloat: 0,
				showScrollbar: false,
			}
		}

		// Calculate proportions
		const scrollRatio = Math.max(
			0,
			Math.min(1, scrollOffset / (totalContentHeight - viewportHeight)),
		)
		const thumbSizeRatio = Math.min(1, viewportHeight / totalContentHeight)

		// Calculate thumb size with floating-point precision (minimum 1 character)
		const thumbSizeFloat = Math.max(1, availableHeight * thumbSizeRatio)

		// Calculate thumb position with floating-point precision
		const availableTrackSpace = availableHeight - thumbSizeFloat
		const thumbStartFloat = Math.max(0, availableTrackSpace * scrollRatio)

		return {
			thumbStartFloat,
			thumbSizeFloat,
			showScrollbar: true,
		}
	}
}

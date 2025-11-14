import logger from '../../logger.js'

/**
 * A controller for scrollable widgets.
 *
 * Similar to Flutter's ScrollController, this manages scroll position,
 * provides scroll event notifications, and allows programmatic scrolling.
 * In our TUI context, all scroll positions are measured in lines.
 */
export class ScrollController {
	private _offset: number = 0
	private _listeners: (() => void)[] = []
	private _disposed: boolean = false
	private _maxScrollExtent: number = 0
	private _hasInitialOffset: boolean = false
	private _animationTimer: NodeJS.Timeout | null = null
	private _animationTarget: number | null = null
	private _animationStartTime: number = 0
	private _animationDuration: number = 0
	private _followMode: boolean = true
	private _viewportDimension: number = 0

	/**
	 * The current scroll offset in lines.
	 */
	get offset(): number {
		return this._offset
	}

	/**
	 * The current scroll line position (alias for offset for clarity).
	 */
	get currentLine(): number {
		return this._offset
	}

	/**
	 * The maximum scroll extent in lines.
	 */
	get maxScrollExtent(): number {
		return this._maxScrollExtent
	}

	/**
	 * The viewport dimension in lines.
	 */
	get viewportDimension(): number {
		return this._viewportDimension
	}

	/**
	 * Whether the scroll position is at the top edge (line 0).
	 */
	get atTop(): boolean {
		return this._offset <= 0
	}

	/**
	 * Whether the scroll position is at the bottom edge (max scroll extent).
	 */
	get atBottom(): boolean {
		return this._offset >= this._maxScrollExtent
	}

	/**
	 * Whether the scroll position is at either edge (top or bottom).
	 */
	get atEdge(): boolean {
		return this.atTop || this.atBottom
	}

	/**
	 * Whether follow mode is enabled.
	 * When enabled, the controller automatically scrolls to show new content.
	 */
	get followMode(): boolean {
		return this._followMode
	}

	/**
	 * Sets whether follow mode is enabled.
	 */
	set followMode(enabled: boolean) {
		this._followMode = enabled
	}

	/**
	 * Whether this controller has been disposed.
	 */
	get isDisposed(): boolean {
		return this._disposed
	}

	/**
	 * Whether this controller has been given an initial offset.
	 */
	get hasInitialOffset(): boolean {
		return this._hasInitialOffset
	}

	/**
	 * Adds a listener that will be called whenever the scroll position changes.
	 */
	addListener(listener: () => void): void {
		if (this._disposed) {
			throw new Error('ScrollController is disposed')
		}
		this._listeners.push(listener)
	}

	/**
	 * Removes a previously added listener.
	 */
	removeListener(listener: () => void): void {
		const index = this._listeners.indexOf(listener)
		if (index !== -1) {
			this._listeners.splice(index, 1)
		}
	}

	/**
	 * Updates the maximum scroll extent.
	 * This is typically called by the scrollable widget when the content size changes.
	 */
	updateMaxScrollExtent(maxExtent: number): void {
		if (this._disposed) return

		const oldExtent = this._maxScrollExtent
		this._maxScrollExtent = maxExtent

		// Notify listeners if the max scroll extent changed
		if (oldExtent !== maxExtent) {
			this._notifyListeners()
		}
	}

	/**
	 * Updates the viewport dimension.
	 * This is typically called by the scrollable widget when the viewport size changes.
	 */
	updateViewportDimension(dimension: number): void {
		if (this._disposed) return

		const oldDimension = this._viewportDimension
		this._viewportDimension = dimension

		// Notify listeners if the viewport dimension changed
		if (oldDimension !== dimension) {
			this._notifyListeners()
		}
	}

	/**
	 * Updates the scroll offset and notifies listeners.
	 * This is typically called by the scrollable widget, not directly by users.
	 */
	updateOffset(newOffset: number): void {
		if (this._disposed) return

		if (this._offset !== newOffset) {
			this._offset = newOffset
			this._hasInitialOffset = true
			this._notifyListeners()
		}
	}

	/**
	 * Animates the scroll position to the given line with smooth scrolling.
	 * Uses delta time for frame-rate independent animation like games.
	 * Accumulates multiple calls during animation instead of canceling.
	 */
	animateTo(targetLine: number, duration: number = 150): void {
		if (this._disposed) return

		const clampedTarget = Math.max(0, Math.min(this._maxScrollExtent, targetLine))

		// If distance is 0 or very small, just jump
		if (Math.abs(this._offset - clampedTarget) <= 1) {
			this.jumpTo(clampedTarget)
			return
		}

		// If we're already animating, accumulate the target instead of canceling
		if (this._animationTimer && this._animationTarget !== null) {
			// Update target to accumulate the movement
			// Don't add duration as it messes up the progress calculation
			this._animationTarget = clampedTarget
			return
		}

		// Start new animation
		this._animationTarget = clampedTarget
		this._animationStartTime = Date.now()
		this._animationDuration = duration
		const startPosition = this._offset
		const frameTime = 16 // ~60fps, but animation is frame-rate independent

		this._animationTimer = setInterval(() => {
			const elapsed = Date.now() - this._animationStartTime
			const currentTarget = this._animationTarget!
			const totalDistance = currentTarget - startPosition
			const progress = Math.min(elapsed / this._animationDuration, 1.0) // Clamp to [0,1]

			if (progress >= 1.0) {
				// Animation complete - land exactly on target
				if (this._animationTimer) {
					clearInterval(this._animationTimer)
					this._animationTimer = null
					this._animationTarget = null
				}
				this.updateOffset(currentTarget)
			} else {
				// Interpolate position based on elapsed time
				const currentPosition = startPosition + totalDistance * progress
				this.updateOffset(Math.round(currentPosition))
			}
		}, frameTime)
	}

	/**
	 * Immediately changes the scroll position to the given line.
	 */
	jumpTo(line: number): void {
		if (this._disposed) return
		// Clamp to valid scroll range
		const clampedLine = Math.max(0, Math.min(this._maxScrollExtent, line))
		this.updateOffset(clampedLine)
	}

	/**
	 * Animates to the given line (alias for animateTo for clarity).
	 */
	animateToLine(line: number, duration?: number): void {
		this.animateTo(line, duration)
	}

	/**
	 * Jumps to the given line (alias for jumpTo for clarity).
	 */
	jumpToLine(line: number): void {
		this.jumpTo(line)
	}

	/**
	 * Scrolls to the top of the content (line 0).
	 */
	scrollToTop(): void {
		this.jumpTo(0)
	}

	/**
	 * Scrolls to the bottom of the content (max scroll extent line).
	 */
	scrollToBottom(): void {
		this.jumpTo(this._maxScrollExtent)
	}

	/**
	 * Animates to the bottom of the content (max scroll extent line).
	 */
	animateToBottom(duration: number = 150): void {
		this.animateTo(this._maxScrollExtent, duration)
	}

	/**
	 * Enables follow mode. When enabled, automatically scrolls to show new content.
	 */
	enableFollowMode(): void {
		this._followMode = true
	}

	/**
	 * Disables follow mode. User will need to manually scroll to see new content.
	 */
	disableFollowMode(): void {
		this._followMode = false
	}

	/**
	 * Toggles follow mode on/off.
	 */
	toggleFollowMode(): void {
		this._followMode = !this._followMode
	}

	/**
	 * Scrolls up by the given amount of lines (decreases offset).
	 * Clears any pending follow positioning since user is manually scrolling.
	 */
	scrollUp(lines: number): void {
		if (this._disposed) return
		const newOffset = Math.max(0, this._offset - lines)

		this.jumpTo(newOffset)
	}

	/**
	 * Scrolls down by the given amount of lines (increases offset).
	 * Clears any pending follow positioning unless scrolling to bottom.
	 */
	scrollDown(lines: number): void {
		if (this._disposed) return
		const newOffset = Math.min(this._maxScrollExtent, this._offset + lines)

		this.jumpTo(newOffset)
	}

	/**
	 * Animates the scroll position up by the given amount of lines (decreases offset).
	 */
	animateScrollUp(lines: number, duration?: number): void {
		if (this._disposed) return

		// If we're currently animating, calculate new offset from the animation target
		// to accumulate movement properly
		const baseOffset = this._animationTarget ?? this._offset
		const newOffset = Math.max(0, baseOffset - lines)
		this.animateTo(newOffset, duration)
	}

	/**
	 * Animates the scroll position down by the given amount of lines (increases offset).
	 */
	animateScrollDown(lines: number, duration?: number): void {
		if (this._disposed) return

		// If we're currently animating, calculate new offset from the animation target
		// to accumulate movement properly
		const baseOffset = this._animationTarget ?? this._offset
		const newOffset = baseOffset + lines
		this.animateTo(newOffset, duration)
	}

	/**
	 * Scrolls by a "page" amount, typically half the viewport height.
	 */
	scrollPageUp(viewportHeight: number): void {
		const pageAmount = Math.max(1, Math.floor(viewportHeight / 2))
		this.scrollUp(pageAmount) // Page Up scrolls UP (decreases offset)
	}

	/**
	 * Scrolls by a "page" amount, typically half the viewport height.
	 */
	scrollPageDown(viewportHeight: number): void {
		const pageAmount = Math.max(1, Math.floor(viewportHeight / 2))
		this.scrollDown(pageAmount) // Page Down scrolls DOWN (increases offset)
	}

	/**
	 * Animates scrolling by a "page" amount (full viewport height).
	 */
	animatePageUp(viewportHeight: number, duration?: number): void {
		const pageAmount = Math.max(1, viewportHeight)
		this.animateScrollUp(pageAmount, duration ?? 100) // Page Up scrolls UP (decreases offset)
	}

	/**
	 * Animates scrolling by a "page" amount (full viewport height).
	 */
	animatePageDown(viewportHeight: number, duration?: number): void {
		const pageAmount = Math.max(1, viewportHeight)
		this.animateScrollDown(pageAmount, duration ?? 100) // Page Down scrolls DOWN (increases offset)
	}

	/**
	 * Disposes the controller and removes all listeners.
	 */
	dispose(): void {
		if (this._disposed) return

		// Cancel any active animation
		if (this._animationTimer) {
			clearInterval(this._animationTimer)
			this._animationTimer = null
			this._animationTarget = null
		}

		this._listeners.length = 0
		this._disposed = true
	}

	private _notifyListeners(): void {
		// Make a copy to avoid issues if listeners are modified during notification
		const listeners = [...this._listeners]
		for (const listener of listeners) {
			try {
				listener()
			} catch (error) {
				logger.error('Error in scroll listener:', error)
			}
		}
	}
}

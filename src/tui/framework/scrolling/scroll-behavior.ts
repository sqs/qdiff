import type { KeyboardEvent, SgrMouseEvent } from '../../lib/parser/types.js'
import type { BuildContext } from '../build-context.js'
import { KeyEventResult } from '../focus/focus-node.js'
import { MediaQuery } from '../media-query.js'
import type { ScrollableState } from './scrollable.js'

/**
 * Handles scroll-related user input for scrollable widgets.
 *
 * This provides keyboard and mouse wheel scrolling behavior.
 */
export class ScrollBehavior {
	private scrollableState: ScrollableState
	private context: BuildContext | null = null

	constructor(scrollableState: ScrollableState) {
		this.scrollableState = scrollableState
	}

	/**
	 * Update the build context for accessing terminal capabilities
	 */
	updateContext(context: BuildContext): void {
		this.context = context
	}

	/**
	 * Handles key events for scrolling.
	 * Returns true if the event was handled.
	 */
	handleKeyEvent(event: KeyboardEvent): KeyEventResult {
		const { key } = event

		// Handle vertical scrolling
		if (this.scrollableState.widget.axisDirection === 'vertical') {
			switch (key) {
				// Arrow keys - 1 line scrolling
				case 'ArrowUp':
					this.scrollableState.handleScrollDelta(-this.getScrollStep())
					return KeyEventResult.handled

				case 'ArrowDown':
					this.scrollableState.handleScrollDelta(this.getScrollStep())
					return KeyEventResult.handled

				// Vim keybinds - 1 line scrolling
				case 'k':
					this.scrollableState.handleScrollDelta(-this.getScrollStep())
					return KeyEventResult.handled

				case 'j':
					this.scrollableState.handleScrollDelta(this.getScrollStep())
					return KeyEventResult.handled

				// Page scrolling
				case 'PageUp':
					this.scrollableState.handleScrollDelta(-this.getPageScrollStep())
					return KeyEventResult.handled

				case 'PageDown':
					this.scrollableState.handleScrollDelta(this.getPageScrollStep())
					return KeyEventResult.handled

				// Vim page scrolling
				case 'u':
					if (event.ctrlKey) {
						// Ctrl+U - page up
						this.scrollableState.handleScrollDelta(-this.getPageScrollStep())
						return KeyEventResult.handled
					}
					break

				case 'd':
					if (event.ctrlKey) {
						// Ctrl+D - page down
						this.scrollableState.handleScrollDelta(this.getPageScrollStep())
						return KeyEventResult.handled
					}
					break

				// Jump to top/bottom
				case 'Home':
					this.scrollableState.controller.scrollToTop()
					return KeyEventResult.handled

				case 'End':
					this.scrollableState.controller.scrollToBottom()
					return KeyEventResult.handled

				// Vim jump to top/bottom
				case 'g':
					if (event.shiftKey) {
						// Shift+G - jump to bottom
						this.scrollableState.controller.scrollToBottom()
						return KeyEventResult.handled
					} else {
						// g - jump to top (would need gg in real vim, but g is simpler here)
						this.scrollableState.controller.scrollToTop()
						return KeyEventResult.handled
					}
			}
		}

		// Handle horizontal scrolling
		if (this.scrollableState.widget.axisDirection === 'horizontal') {
			switch (key) {
				// Arrow keys - 1 character scrolling
				case 'ArrowLeft':
					this.scrollableState.handleScrollDelta(-this.getScrollStep())
					return KeyEventResult.handled

				case 'ArrowRight':
					this.scrollableState.handleScrollDelta(this.getScrollStep())
					return KeyEventResult.handled

				// Vim keybinds - 1 character scrolling
				case 'h':
					this.scrollableState.handleScrollDelta(-this.getScrollStep())
					return KeyEventResult.handled

				case 'l':
					this.scrollableState.handleScrollDelta(this.getScrollStep())
					return KeyEventResult.handled

				// Jump to start/end
				case 'Home':
					this.scrollableState.controller.scrollToTop()
					return KeyEventResult.handled

				case 'End':
					this.scrollableState.controller.scrollToBottom()
					return KeyEventResult.handled

				// Vim jump to start/end (same as vertical)
				case 'g':
					if (event.shiftKey) {
						// Shift+G - jump to end
						this.scrollableState.controller.scrollToBottom()
						return KeyEventResult.handled
					} else {
						// g - jump to start
						this.scrollableState.controller.scrollToTop()
						return KeyEventResult.handled
					}
			}
		}

		return KeyEventResult.ignored
	}

	/**
	 * Handles mouse wheel scrolling.
	 * Delta should be positive for scroll down/right, negative for scroll up/left.
	 */
	handleMouseWheel(delta: number): void {
		const scrollDelta = delta * this.getScrollStep()
		this.scrollableState.handleScrollDelta(scrollDelta)
	}

	/**
	 * Handles SGR mouse events, particularly wheel events.
	 * Returns true if the event was handled.
	 */
	handleMouseEvent(event: SgrMouseEvent): boolean {
		// Mouse wheel events are encoded as button codes 64-67
		// 64: wheel up, 65: wheel down, 66: wheel left, 67: wheel right

		if (event.button >= 64 && event.button <= 67 && event.pressed) {
			switch (event.button) {
				case 64: // Wheel up
					if (this.scrollableState.widget.axisDirection === 'vertical') {
						this.scrollableState.handleScrollDelta(-this.getScrollStep())
						return true
					}
					break
				case 65: // Wheel down
					if (this.scrollableState.widget.axisDirection === 'vertical') {
						this.scrollableState.handleScrollDelta(this.getScrollStep())
						return true
					}
					break
				case 66: // Wheel left
					if (this.scrollableState.widget.axisDirection === 'horizontal') {
						this.scrollableState.handleScrollDelta(-this.getScrollStep())
						return true
					}
					break
				case 67: // Wheel right
					if (this.scrollableState.widget.axisDirection === 'horizontal') {
						this.scrollableState.handleScrollDelta(this.getScrollStep())
						return true
					}
					break
			}
		}
		return false
	}

	/**
	 * Gets the step size for single-line scrolling.
	 */
	private getScrollStep(): number {
		// Use terminal-aware scroll step if context is available
		if (this.context) {
			try {
				const capabilities = MediaQuery.capabilitiesOf(this.context)
				return capabilities.scrollStep()
			} catch {
				// Fall back to default if MediaQuery is not available
			}
		}

		// Default scroll step for terminals without capabilities detection
		return 3
	}

	/**
	 * Gets the step size for page scrolling.
	 */
	private getPageScrollStep(): number {
		// Page scroll is typically the viewport height
		// For now, use a reasonable default
		return 10
	}
}

/**
 * Utility function to create a scrollable widget with keyboard support.
 */
export function makeScrollable<T extends ScrollableState>(
	_scrollableState: T,
	child: unknown,
): unknown {
	// In a real implementation, this would wrap the child with Focus widget
	// and attach the key event handler
	// For now, we'll return the child as-is and handle scrolling elsewhere
	return child
}

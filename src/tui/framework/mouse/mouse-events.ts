import type { MouseEvent as TuiMouseEvent } from '../../lib/mouse.js'

/**
 * Mouse event types for widget-level mouse handling.
 * Based on Flutter's mouse event system but adapted for terminal UI.
 */

export interface MousePosition {
	readonly x: number
	readonly y: number
}

/**
 * Base interface for all widget-level mouse events.
 */
export interface WidgetMouseEvent {
	readonly position: MousePosition
	readonly localPosition: MousePosition // Relative to the widget's bounds
	readonly modifiers: {
		readonly shift: boolean
		readonly ctrl: boolean
		readonly alt: boolean
	}
}

/**
 * Mouse click event (press + release in same location).
 */
export interface MouseClickEvent extends WidgetMouseEvent {
	readonly type: 'click'
	readonly button: 'left' | 'middle' | 'right'
	readonly clickCount: number // 1 = single click, 2 = double click, 3 = triple click, etc.
}

/**
 * Mouse enter event (mouse moved into widget bounds).
 */
export interface MouseEnterEvent extends WidgetMouseEvent {
	readonly type: 'enter'
}

/**
 * Mouse exit event (mouse moved out of widget bounds).
 */
export interface MouseExitEvent extends WidgetMouseEvent {
	readonly type: 'exit'
}

/**
 * Mouse hover event (mouse moved within widget bounds).
 */
export interface MouseHoverEvent extends WidgetMouseEvent {
	readonly type: 'hover'
}

/**
 * Mouse scroll event (wheel movement).
 */
export interface MouseScrollEvent extends WidgetMouseEvent {
	readonly type: 'scroll'
	readonly direction: 'up' | 'down'
}

/**
 * Mouse drag event (button held while moving).
 */
export interface MouseDragEvent extends WidgetMouseEvent {
	readonly type: 'drag'
	readonly button: 'left' | 'middle' | 'right'
	readonly deltaX: number
	readonly deltaY: number
}

/**
 * Mouse release event (button released).
 */
export interface MouseReleaseEvent extends WidgetMouseEvent {
	readonly type: 'release'
	readonly button: 'left' | 'middle' | 'right'
}

/**
 * Union type for all widget mouse events.
 */
export type AnyMouseEvent =
	| MouseClickEvent
	| MouseEnterEvent
	| MouseExitEvent
	| MouseHoverEvent
	| MouseScrollEvent
	| MouseDragEvent
	| MouseReleaseEvent

/**
 * Mouse event handler function types.
 */
export type MouseClickHandler = (event: MouseClickEvent) => void
export type MouseEnterHandler = (event: MouseEnterEvent) => void
export type MouseExitHandler = (event: MouseExitEvent) => void
export type MouseHoverHandler = (event: MouseHoverEvent) => void
export type MouseScrollHandler = (event: MouseScrollEvent) => void
export type MouseDragHandler = (event: MouseDragEvent) => void
export type MouseReleaseHandler = (event: MouseReleaseEvent) => void

/**
 * Convert a Vaxis mouse event to widget mouse event coordinates.
 */
export function createWidgetMouseEvent(
	vaxisEvent: TuiMouseEvent,
	globalPosition: MousePosition,
	localPosition: MousePosition,
): Omit<WidgetMouseEvent, 'type'> {
	return {
		position: globalPosition,
		localPosition,
		modifiers: {
			shift: vaxisEvent.modifiers.shift,
			ctrl: vaxisEvent.modifiers.ctrl,
			alt: vaxisEvent.modifiers.alt,
		},
	}
}

/**
 * Create a mouse click event from a Vaxis mouse event.
 */
export function createMouseClickEvent(
	vaxisEvent: TuiMouseEvent,
	globalPosition: MousePosition,
	localPosition: MousePosition,
	clickCount = 1,
): MouseClickEvent {
	const button =
		vaxisEvent.button === 'left'
			? 'left'
			: vaxisEvent.button === 'middle'
				? 'middle'
				: vaxisEvent.button === 'right'
					? 'right'
					: 'left' // fallback

	return {
		type: 'click',
		button,
		clickCount,
		...createWidgetMouseEvent(vaxisEvent, globalPosition, localPosition),
	}
}

/**
 * Create a mouse scroll event from a Vaxis mouse event.
 */
export function createMouseScrollEvent(
	vaxisEvent: TuiMouseEvent,
	globalPosition: MousePosition,
	localPosition: MousePosition,
): MouseScrollEvent {
	const direction = vaxisEvent.button === 'wheel_up' ? 'up' : 'down'

	return {
		type: 'scroll',
		direction,
		...createWidgetMouseEvent(vaxisEvent, globalPosition, localPosition),
	}
}

/**
 * Interface for RenderObjects that can handle mouse events directly.
 * Similar to Flutter's approach where any RenderObject can opt into mouse event handling.
 */
export interface MouseEventTarget {
	/**
	 * Handle a mouse event that occurred within this render object's bounds.
	 */
	handleMouseEvent(event: AnyMouseEvent): void

	/**
	 * Whether this render object is interested in mouse events.
	 * Used to optimize event dispatch.
	 */
	hasMouseListeners?: boolean

	/**
	 * Whether this target is opaque to hit testing.
	 * If true, hit testing stops at this target.
	 */
	opaque?: boolean
}

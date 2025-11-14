/**
 * Common type utilities for the UI framework
 */

/** Constructor type for classes */
export type Constructor<T> = new (...args: any[]) => T

/** Widget-specific constructor */
export type WidgetConstructor<T> = new (...args: any[]) => T

/** Element-specific constructor */
export type ElementConstructor<T> = new (...args: any[]) => T

/** Size interface for width and height dimensions */
export interface Size {
	readonly width: number
	readonly height: number
}

/** Offset interface for x and y coordinates */
export interface Offset {
	readonly x: number
	readonly y: number
}

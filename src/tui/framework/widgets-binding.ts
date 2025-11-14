import { FrameScheduler } from './frame-scheduler.js'

/**
 * TUI equivalent of Flutter's WidgetsBinding.
 *
 * Provides utilities for scheduling callbacks that execute after the current frame
 * completes, which is essential for operations that need to wait for layout to finish.
 */
export class WidgetsBinding {
	private static _instance?: WidgetsBinding

	/**
	 * Get the singleton WidgetsBinding instance.
	 */
	static get instance(): WidgetsBinding {
		return (this._instance ??= new WidgetsBinding())
	}

	/**
	 * Schedule a callback to be executed after the current frame completes.
	 *
	 * This is equivalent to Flutter's WidgetsBinding.instance.addPostFrameCallback.
	 * Use this when you need to perform operations that depend on the layout being
	 * complete, such as:
	 * - Scrolling to a specific position after adding new content
	 * - Querying the size or position of widgets after layout
	 * - Any operation that needs the current frame's layout to be finished
	 *
	 * @param callback Function to execute after the current frame
	 */
	addPostFrameCallback(callback: () => void): void {
		// Use the unified frame scheduler instead of setTimeout
		// This ensures the callback runs after the complete frame pipeline
		FrameScheduler.instance.addPostFrameCallback(
			callback,
			'WidgetsBinding.addPostFrameCallback',
		)
	}

	/**
	 * Schedule a callback to be executed after the next layout phase completes.
	 *
	 * This is similar to addPostFrameCallback but specifically waits for layout
	 * to complete before executing the callback.
	 *
	 * @param callback Function to execute after layout completes
	 */
	addPostLayoutCallback(callback: () => void): void {
		// For our TUI implementation, post-layout is the same as post-frame
		// since our frame phases are: build → layout → paint → render
		this.addPostFrameCallback(callback)
	}
}

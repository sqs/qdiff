import type { BuildContext } from '../build-context.js'
import type { Widget } from '../widget.js'

/**
 * A single entry in an Overlay.
 *
 * Similar to Flutter's OverlayEntry, this represents a widget that can be
 * inserted into and removed from the global overlay stack. Each entry
 * is built using a builder function and can maintain its state across rebuilds.
 *
 * @example
 * ```typescript
 * const entry = new OverlayEntry(
 *   (context) => new Positioned({
 *     left: 100,
 *     top: 50,
 *     child: new Container({
 *       child: new Text({ text: 'Popup content' })
 *     })
 *   })
 * )
 *
 * Overlay.of(context).insert(entry)
 * // Later...
 * entry.remove()
 * ```
 */
export class OverlayEntry {
	private _overlayState?: import('./overlay.js').OverlayState
	private _needsBuild = true

	/**
	 * Creates a new overlay entry.
	 *
	 * @param builder Function that builds the widget for this entry
	 * @param maintainState Whether to maintain state across rebuilds (default: false)
	 */
	constructor(
		public readonly builder: (context: BuildContext) => Widget,
		public readonly maintainState: boolean = false,
	) {}

	/**
	 * Whether this entry is currently inserted in an overlay.
	 */
	get mounted(): boolean {
		return this._overlayState !== undefined
	}

	/**
	 * Removes this entry from its overlay.
	 *
	 * After calling this method, the entry is no longer visible and cannot
	 * be used again. Create a new OverlayEntry if needed.
	 */
	remove(): void {
		if (this._overlayState) {
			this._overlayState.remove(this)
		}
	}

	/**
	 * Marks this entry as needing to be rebuilt.
	 *
	 * This will cause the builder function to be called again on the next frame.
	 */
	markNeedsBuild(): void {
		this._needsBuild = true
		if (this._overlayState) {
			this._overlayState._markNeedsRebuild()
		}
	}

	/**
	 * @internal
	 * Sets the overlay state that owns this entry. Called by OverlayState.
	 */
	_setOverlayState(overlayState: import('./overlay.js').OverlayState | undefined): void {
		this._overlayState = overlayState
	}

	/**
	 * @internal
	 * Whether this entry needs to be rebuilt on the next frame.
	 */
	_needsRebuild(): boolean {
		return this._needsBuild
	}

	/**
	 * @internal
	 * Clears the rebuild flag after the entry has been rebuilt.
	 */
	_clearNeedsRebuild(): void {
		this._needsBuild = false
	}
}

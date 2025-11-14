/**
 * Global overlay system for the TUI framework.
 *
 * This module provides Flutter-style overlay functionality, allowing widgets
 * to be displayed on top of the main UI in a managed stack. This is useful
 * for tooltips, popups, modals, autocomplete suggestions, and other overlaid content.
 *
 * @example
 * ```typescript
 * import { Overlay, OverlayEntry } from './framework/overlay'
 *
 * // Create overlay entry
 * const entry = new OverlayEntry(
 *   (context) => new Positioned({
 *     left: 100,
 *     top: 50,
 *     child: new Container({
 *       decoration: { backgroundColor: 'popup' },
 *       child: new Text({ text: 'Popup content' })
 *     })
 *   })
 * )
 *
 * // Insert into overlay
 * Overlay.of(context).insert(entry)
 *
 * // Remove when done
 * entry.remove()
 * ```
 */

export { Overlay, OverlayState } from './overlay.js'
export { OverlayEntry } from './overlay-entry.js'

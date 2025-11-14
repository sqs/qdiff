import logger from '../../logger.js'

import { assert } from '../../lib/assert.js'
import type { BuildContext } from '../build-context.js'
import { RenderBox, type RenderObject } from '../render-object.js'
import { MultiChildRenderObjectWidget } from '../render-object-widget.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'
import type { OverlayEntry } from './overlay-entry.js'

/**
 * A stack of entries that can be managed independently.
 *
 * Similar to Flutter's Overlay widget, this manages a stack of OverlayEntry
 * objects that are displayed on top of the main UI. Each entry can be inserted,
 * removed, and reordered independently.
 *
 * The Overlay widget should be placed near the root of the widget tree to ensure
 * overlays can appear over all other content.
 *
 * @example
 * ```typescript
 * // In your main app widget:
 * new Overlay({
 *   initialEntries: [],
 *   child: new Column({
 *     children: [
 *       // Your main UI here
 *       new TextField(...),
 *       new MessageView(...),
 *     ]
 *   })
 * })
 *
 * // Somewhere else in your code:
 * const overlayState = Overlay.of(context)
 * const entry = new OverlayEntry((ctx) => new Positioned({...}))
 * overlayState.insert(entry)
 * ```
 */
export class Overlay extends StatefulWidget {
	constructor(
		public props: {
			/**
			 * Initial entries to display in the overlay.
			 */
			initialEntries?: OverlayEntry[]
			/**
			 * The widget to display underneath all overlay entries.
			 * This is typically your main application content.
			 */
			child?: Widget
		} = {},
	) {
		super()
	}

	/**
	 * Finds the nearest Overlay widget and returns its state.
	 *
	 * This is similar to Flutter's Overlay.of(context) method.
	 *
	 * @param context The build context to search from
	 * @returns The OverlayState for managing overlay entries
	 * @throws Error if no Overlay ancestor is found
	 */
	static of(context: BuildContext): OverlayState {
		// Use the proper Flutter pattern to find ancestor state
		const overlayState = context.findAncestorStateOfType(OverlayState)
		if (overlayState) {
			return overlayState
		}

		throw new Error(
			'Overlay.of() called with a context that does not contain an Overlay widget',
		)
	}

	createState(): State<this> {
		return new OverlayState() as unknown as State<this>
	}
}

/**
 * State for the Overlay widget.
 *
 * Manages the stack of OverlayEntry objects and handles their lifecycle.
 */
export class OverlayState extends State<Overlay> {
	private entries: OverlayEntry[] = []

	initState(): void {
		super.initState()

		// Add initial entries if provided
		const initialEntries = this.widget.props.initialEntries || []
		for (const entry of initialEntries) {
			this._addEntry(entry)
		}
	}

	dispose(): void {
		// Clean up all entries
		for (const entry of this.entries) {
			entry._setOverlayState(undefined)
		}
		this.entries = []
		super.dispose()
	}

	/**
	 * Inserts an overlay entry at the top of the stack.
	 *
	 * @param entry The overlay entry to insert
	 * @param above Optional entry to insert above. If not provided, inserts at the top.
	 */
	insert(entry: OverlayEntry, above?: OverlayEntry): void {
		if (entry.mounted) {
			throw new Error('OverlayEntry is already mounted in an overlay')
		}

		if (above) {
			const index = this.entries.indexOf(above)
			if (index === -1) {
				throw new Error('The "above" entry is not in this overlay')
			}
			this.entries.splice(index + 1, 0, entry)
			entry._setOverlayState(this)
			entry.markNeedsBuild()
		} else {
			this._addEntry(entry)
		}

		this.setState(() => {})
	}

	/**
	 * Removes an overlay entry from the stack.
	 *
	 * @param entry The overlay entry to remove
	 */
	remove(entry: OverlayEntry): void {
		const index = this.entries.indexOf(entry)
		if (index === -1) {
			return // Entry not found, nothing to do
		}

		this.entries.splice(index, 1)
		entry._setOverlayState(undefined)
		this.setState(() => {})
	}

	/**
	 * Removes all overlay entries from the stack.
	 */
	removeAll(): void {
		for (const entry of this.entries) {
			entry._setOverlayState(undefined)
		}
		this.entries = []
		this.setState(() => {})
	}

	/**
	 * Rearranges the overlay entries.
	 *
	 * @param entries The new order of entries
	 */
	rearrange(entries: OverlayEntry[]): void {
		// Validate that all entries are currently in this overlay
		for (const entry of entries) {
			if (!this.entries.includes(entry)) {
				throw new Error('Cannot rearrange: entry is not in this overlay')
			}
		}

		// Validate that no entries are missing
		if (entries.length !== this.entries.length) {
			throw new Error('Cannot rearrange: entry count mismatch')
		}

		this.entries = [...entries]
		this.setState(() => {})
	}

	/**
	 * @internal
	 * Marks the overlay as needing a rebuild. Called by OverlayEntry.
	 */
	_markNeedsRebuild(): void {
		this.setState(() => {})
	}

	/**
	 * Adds an entry to the overlay and sets up its state.
	 */
	private _addEntry(entry: OverlayEntry): void {
		this.entries.push(entry)
		entry._setOverlayState(this)
		entry.markNeedsBuild() // Ensure it gets built on next frame
	}

	build(context: BuildContext): Widget {
		const children: Widget[] = []

		// Add the main child widget first (bottom layer)
		if (this.widget.props.child) {
			children.push(this.widget.props.child)
		}

		// Add all overlay entries on top
		for (const entry of this.entries) {
			try {
				const entryWidget = entry.builder(context)
				children.push(entryWidget)
				entry._clearNeedsRebuild()
			} catch (error) {
				logger.error('Error building overlay entry:', error)
			}
		}

		// Use a specialized overlay container that doesn't interfere with child positioning
		return new OverlayContainer({
			children,
		})
	}
}

/**
 * A container widget that allows children to position themselves without interference.
 * Unlike Stack, this doesn't try to manage child positioning - it lets children like
 * CompositedTransformFollower position themselves directly.
 */
class OverlayContainer extends MultiChildRenderObjectWidget {
	constructor({
		children = [],
	}: {
		children?: Widget[]
	} = {}) {
		super({ children })
	}

	createRenderObject(): OverlayContainerRenderObject {
		return new OverlayContainerRenderObject()
	}

	updateRenderObject(_renderObject: RenderObject): void {
		// No properties to update
	}
}

/**
 * Render object for OverlayContainer that doesn't interfere with child positioning
 */
class OverlayContainerRenderObject extends RenderBox {
	constructor() {
		super()
		// PERFORMANCE: Allow children to be hit-tested outside our bounds (needed for overlays)
		this.allowHitTestOutsideBounds = true
	}

	performLayout(): void {
		super.performLayout()

		const constraints = this._lastConstraints
		assert(!!constraints, 'performLayout called without constraints')

		// Layout all children with full constraints but don't position them
		// Let children position themselves (e.g., CompositedTransformFollower)
		const children = this.children as RenderBox[]

		let maxWidth = constraints.minWidth
		let maxHeight = constraints.minHeight

		for (const child of children) {
			child.layout(constraints)
			// Don't call setOffset - let child position itself!
			// But track size for our own sizing
			maxWidth = Math.max(maxWidth, child.size.width)
			maxHeight = Math.max(maxHeight, child.size.height)
		}

		this.setSize(
			Math.min(constraints.maxWidth, maxWidth),
			Math.min(constraints.maxHeight, maxHeight),
		)
	}
}

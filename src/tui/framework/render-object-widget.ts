import type { Key } from './key.js'
import type { RenderObject } from './render-object.js'
import { Element, Widget } from './widget.js'

/**
 * Base class for widgets that have associated RenderObjects.
 *
 * RenderObjectWidgets provide the configuration for RenderObjects, which do the
 * actual work of laying out and painting child widgets.
 *
 * This is the Flutter pattern for widgets that directly create render objects.
 */
export abstract class RenderObjectWidget extends Widget {
	constructor({ key }: { key?: Key } = {}) {
		super(key !== undefined ? { key } : {})
	}

	createElement(): RenderObjectElement {
		return new RenderObjectElement(this)
	}

	/**
	 * Creates the RenderObject associated with this widget.
	 *
	 * This method is called when the element is first created.
	 * The render object should be configured based on the widget's properties.
	 */
	abstract createRenderObject(): RenderObject

	/**
	 * Updates the RenderObject associated with this widget.
	 *
	 * This method is called when the widget is updated with new properties.
	 * The render object should be reconfigured based on the new widget's properties.
	 *
	 * By default, this calls createRenderObject(), but subclasses can override
	 * for more efficient updates.
	 */
	updateRenderObject(_renderObject: RenderObject): void {
		// Default implementation: recreate the render object
		// Subclasses should override this for efficiency
	}
}

/**
 * Base class for widgets that have at most one child.
 */
export abstract class SingleChildRenderObjectWidget extends RenderObjectWidget {
	public readonly child: Widget | undefined

	constructor({
		key,
		child,
	}: {
		key?: Key
		child?: Widget
	} = {}) {
		super(key ? { key } : {})
		this.child = child
	}

	createElement(): SingleChildRenderObjectElement {
		return new SingleChildRenderObjectElement(this)
	}
}

/**
 * Base class for widgets that have multiple children.
 */
export abstract class MultiChildRenderObjectWidget extends RenderObjectWidget {
	public readonly children: readonly Widget[]

	constructor({
		key,
		children = [],
	}: {
		key?: Key
		children?: Widget[]
	} = {}) {
		super(key ? { key } : {})
		this.children = [...children] // Make immutable copy
	}

	createElement(): MultiChildRenderObjectElement {
		return new MultiChildRenderObjectElement(this)
	}
}

/**
 * Base class for widgets that have no children (leaf widgets).
 */
export abstract class LeafRenderObjectWidget extends RenderObjectWidget {
	constructor({ key }: { key?: Key } = {}) {
		super(key ? { key } : {})
	}

	createElement(): LeafRenderObjectElement {
		return new LeafRenderObjectElement(this)
	}
}

/**
 * Element for RenderObjectWidget.
 */
export class RenderObjectElement extends Element {
	private _renderObject?: RenderObject

	constructor(widget: RenderObjectWidget) {
		super(widget)
	}

	get renderObjectWidget(): RenderObjectWidget {
		return this.widget as RenderObjectWidget
	}

	get renderObject(): RenderObject | undefined {
		return this._renderObject
	}

	mount(): void {
		this._renderObject = this.renderObjectWidget.createRenderObject()
		this._renderObject.attach()
		this.markMounted()
	}

	unmount(): void {
		if (this._renderObject) {
			this._renderObject.detach()
			;(this as any)._renderObject = undefined
		}
		super.unmount()
	}

	update(newWidget: Widget): void {
		super.update(newWidget)
		const widget = this.renderObjectWidget

		if (this._renderObject) {
			widget.updateRenderObject(this._renderObject)
		}
	}

	performRebuild(): void {
		// RenderObjectElements typically don't rebuild themselves
		// Updates happen through the update() method when widget properties change
	}
}

/**
 * Element for SingleChildRenderObjectWidget.
 */
export class SingleChildRenderObjectElement extends RenderObjectElement {
	private _child?: Element

	constructor(widget: SingleChildRenderObjectWidget) {
		super(widget)
	}

	get singleChildWidget(): SingleChildRenderObjectWidget {
		return this.widget as SingleChildRenderObjectWidget
	}

	get child(): Element | undefined {
		return this._child
	}

	mount(): void {
		super.mount()

		if (this.singleChildWidget.child) {
			this._child = this.singleChildWidget.child.createElement()
			this.addChild(this._child)
			this._child.mount()

			// Connect render objects
			if (this._child.renderObject && this.renderObject) {
				this.renderObject.adoptChild(this._child.renderObject)
			}
		}
	}

	unmount(): void {
		if (this._child) {
			this._child.unmount()
			this.removeChild(this._child)
			;(this as any)._child = undefined
		}

		super.unmount()
	}

	update(newWidget: Widget): void {
		super.update(newWidget)
		const widget = this.singleChildWidget

		// Update child
		if (widget.child && this._child) {
			if (this._child.widget.canUpdate(widget.child)) {
				this._child.update(widget.child)
			} else {
				// Replace child
				this._child.unmount()
				this.removeChild(this._child)
				this._child = widget.child.createElement()
				this.addChild(this._child)
				this._child.mount()

				// Reconnect render objects
				if (this.renderObject) {
					this.renderObject.removeAllChildren()
					if (this._child.renderObject) {
						this.renderObject.adoptChild(this._child.renderObject)
					}
				}
			}
		} else if (widget.child && !this._child) {
			// Add new child
			this._child = widget.child.createElement()
			this.addChild(this._child)
			this._child.mount()

			if (this.renderObject && this._child.renderObject) {
				this.renderObject.adoptChild(this._child.renderObject)
			}
		} else if (!widget.child && this._child) {
			// Remove child
			this._child.unmount()
			this.removeChild(this._child)
			;(this as any)._child = undefined

			if (this.renderObject) {
				this.renderObject.removeAllChildren()
			}
		}
	}

	performRebuild(): void {
		// SingleChildRenderObjectElements typically don't rebuild themselves
		// Updates happen through the update() method when widget properties change
	}
}

/**
 * Element for MultiChildRenderObjectWidget.
 */
export class MultiChildRenderObjectElement extends RenderObjectElement {
	private _childElements: Element[] = []

	constructor(widget: MultiChildRenderObjectWidget) {
		super(widget)
	}

	get multiChildWidget(): MultiChildRenderObjectWidget {
		return this.widget as MultiChildRenderObjectWidget
	}

	get children(): readonly Element[] {
		return this._childElements
	}

	mount(): void {
		super.mount()

		for (const childWidget of this.multiChildWidget.children) {
			const childElement = childWidget.createElement()
			this._childElements.push(childElement)
			this.addChild(childElement)
			childElement.mount()

			// Connect render objects
			if (childElement.renderObject && this.renderObject) {
				this.renderObject.adoptChild(childElement.renderObject)
			}
		}
	}

	unmount(): void {
		for (const child of this._childElements) {
			child.unmount()
			this.removeChild(child)
		}
		this._childElements.length = 0

		super.unmount()
	}

	update(newWidget: Widget): void {
		super.update(newWidget)
		const widget = this.multiChildWidget

		// Implement Flutter's updateChildren algorithm for proper key-based reconciliation
		this.updateChildren(this._childElements, [...widget.children])
	}

	/**
	 * Updates the list of child elements, performing efficient diffing and reconciliation.
	 * This implements a simplified version of Flutter's updateChildren algorithm.
	 */
	private updateChildren(oldChildren: Element[], newWidgets: Widget[]): void {
		const newChildren: Element[] = []
		let oldChildrenStart = 0
		let newChildrenStart = 0
		let oldChildrenEnd = oldChildren.length - 1
		let newChildrenEnd = newWidgets.length - 1

		// Step 1: Scan from the start, matching widgets that can be updated in place
		while (oldChildrenStart <= oldChildrenEnd && newChildrenStart <= newChildrenEnd) {
			const child = oldChildren[oldChildrenStart]
			const newWidget = newWidgets[newChildrenStart]
			if (!child || !newWidget || !child.widget.canUpdate(newWidget)) {
				break
			}

			// Skip update if the exact same widget instance is provided
			if (child.widget !== newWidget) {
				child.update(newWidget)
			}
			newChildren.push(child)
			oldChildrenStart++
			newChildrenStart++
		}

		// Store end matches separately (don't add to newChildren yet)
		const endMatches: Element[] = []

		// Step 2: Scan from the end, matching widgets that can be updated in place
		while (oldChildrenStart <= oldChildrenEnd && newChildrenStart <= newChildrenEnd) {
			const child = oldChildren[oldChildrenEnd]
			const newWidget = newWidgets[newChildrenEnd]
			if (!child || !newWidget || !child.widget.canUpdate(newWidget)) break

			// Skip update if the exact same widget instance is provided
			if (child.widget !== newWidget) {
				child.update(newWidget)
			}
			endMatches.unshift(child) // Insert at beginning since we're scanning backwards
			oldChildrenEnd--
			newChildrenEnd--
		}

		// Step 3: If we've processed all old children, create new ones for remaining new widgets
		if (oldChildrenStart > oldChildrenEnd) {
			for (let i = newChildrenStart; i <= newChildrenEnd; i++) {
				const widget = newWidgets[i]
				if (widget) {
					const child = this.createChildElement(widget)
					newChildren.push(child)
				}
			}
		}
		// Step 4: If we've processed all new widgets, remove remaining old children
		else if (newChildrenStart > newChildrenEnd) {
			for (let i = oldChildrenStart; i <= oldChildrenEnd; i++) {
				const child = oldChildren[i]
				if (child) {
					this.deactivateChild(child)
				}
			}
		}
		// Step 5: Handle middle section with potential reordering/key matching
		else {
			// Create a map of keyed old children for efficient lookup
			// Use key.toString() for map keys to ensure value equality instead of reference equality
			const oldKeyedChildren = new Map<string, Element>()
			const oldKeyIndex = new Map<string, number>()
			for (let i = oldChildrenStart; i <= oldChildrenEnd; i++) {
				const child = oldChildren[i]!
				if (child.widget.key) {
					const keyString = child.widget.key.toString()
					oldKeyedChildren.set(keyString, child)
					oldKeyIndex.set(keyString, i)
				}
			}

			// Process middle section of new widgets
			for (let i = newChildrenStart; i <= newChildrenEnd; i++) {
				const newWidget = newWidgets[i]
				if (!newWidget) continue
				let child: Element | undefined

				if (newWidget.key) {
					// Try to find a matching keyed child using key.toString() for value equality
					const keyString = newWidget.key.toString()
					child = oldKeyedChildren.get(keyString)
					if (child) {
						oldKeyedChildren.delete(keyString)
						// IMPORTANT: Mark as consumed in oldChildren array so Step 6 won't deactivate it
						const idx = oldKeyIndex.get(keyString)
						if (idx !== undefined) {
							oldChildren[idx] = null as any
						}
						// Skip update if the exact same widget instance is returned
						if (child.widget === newWidget) {
							// Keep using existing child, no update needed
						} else if (child.widget.canUpdate(newWidget)) {
							child.update(newWidget)
						} else {
							this.deactivateChild(child)
							child = this.createChildElement(newWidget)
						}
					} else {
						child = this.createChildElement(newWidget)
					}
				} else {
					// For non-keyed widgets, try to reuse from remaining old children
					let foundMatch = false
					for (let j = oldChildrenStart; j <= oldChildrenEnd; j++) {
						const oldChild = oldChildren[j]
						if (oldChild && !oldChild.widget.key) {
							// Skip update if the exact same widget instance is returned
							if (oldChild.widget === newWidget) {
								child = oldChild
								oldChildren[j] = null as any // Mark as used
								foundMatch = true
								break
							} else if (oldChild.widget.canUpdate(newWidget)) {
								child = oldChild
								oldChildren[j] = null as any // Mark as used
								child.update(newWidget)
								foundMatch = true
								break
							}
						}
					}

					if (!foundMatch) {
						child = this.createChildElement(newWidget)
					}
				}

				if (child) {
					newChildren.push(child)
				}
			}

			// Step 6: Remove any remaining old children that weren't reused
			for (let i = oldChildrenStart; i <= oldChildrenEnd; i++) {
				const child = oldChildren[i]
				if (child) {
					this.deactivateChild(child)
				}
			}

			// Clean up remaining keyed children
			for (const child of oldKeyedChildren.values()) {
				this.deactivateChild(child)
			}
		}

		// Step 7: Add the end matches we stored earlier
		newChildren.push(...endMatches)

		// Step 8: Update our children list and render object connections
		this._childElements = newChildren

		// Update render object child list efficiently - only change what's actually different
		if (this.renderObject) {
			// Build list of current render objects
			const newRenderObjects: RenderObject[] = []
			for (const child of newChildren) {
				if (child.renderObject) {
					newRenderObjects.push(child.renderObject)
				}
			}

			// Only rebuild render object hierarchy if it actually changed
			const oldRenderObjects = this.renderObject.children
			const renderObjectsChanged =
				oldRenderObjects.length !== newRenderObjects.length ||
				oldRenderObjects.some((ro, i) => ro !== newRenderObjects[i])

			if (renderObjectsChanged) {
				// Use replaceChildren to avoid detaching render objects that are just being reordered
				this.renderObject.replaceChildren(newRenderObjects)
			}
		}
	}

	/**
	 * Creates and mounts a new child element.
	 */
	private createChildElement(widget: Widget): Element {
		const element = widget.createElement()
		this.addChild(element)
		element.mount()
		return element
	}

	/**
	 * Deactivates and removes a child element.
	 */
	private deactivateChild(child: Element): void {
		child.unmount()
		this.removeChild(child)
	}

	performRebuild(): void {
		// MultiChildRenderObjectElements typically don't rebuild themselves
		// Updates happen through the update() method when widget properties change
	}
}

/**
 * Element for LeafRenderObjectWidget.
 */
export class LeafRenderObjectElement extends RenderObjectElement {
	constructor(widget: LeafRenderObjectWidget) {
		super(widget)
	}

	get leafWidget(): LeafRenderObjectWidget {
		return this.widget as LeafRenderObjectWidget
	}

	// Leaf elements have no children, so just use base implementation

	performRebuild(): void {
		// LeafRenderObjectElements typically don't rebuild themselves
		// Updates happen through the update() method when widget properties change
	}
}

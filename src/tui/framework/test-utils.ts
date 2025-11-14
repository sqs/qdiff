/**
 * Test utilities for TUI framework widget testing
 */

import { createDefaultTerminalCapabilities } from '../lib/terminal-queries.js'
import { MediaQuery } from './media-query.js'
import type { RenderObject } from './render-object.js'
import type { StatefulElement } from './stateful-widget.js'
import type { Element, Widget } from './widget.js'

/**
 * Helper function to find the first render object in an element tree.
 * Recursively searches through the element hierarchy to locate a render object.
 *
 * @param element - The root element to search from
 * @returns The first render object found, or null if none exists
 */
export function findRenderObject(element: Element): RenderObject | null {
	if (element.renderObject) {
		return element.renderObject
	}

	// Search through children for render objects
	for (const child of element.children) {
		const renderObject = findRenderObject(child)
		if (renderObject) {
			return renderObject
		}
	}

	return null
}

/**
 * Creates a widget wrapped with MediaQuery for complete lifecycle testing.
 * This provides the necessary context for widgets that depend on media query data.
 *
 * @param widget - The widget to wrap with MediaQuery context
 * @returns Object containing the root element and the target widget's element
 */
export function createWidgetWithMediaQuery<T extends Widget>(
	widget: T,
): {
	rootElement: Element
	targetElement: StatefulElement | Element
} {
	const mediaQuery = new MediaQuery({
		data: {
			size: { width: 80, height: 24 },
			supportsEmojiWidth: false,
			capabilities: createDefaultTerminalCapabilities(),
			supportsSyncOutput: false,
		},
		child: widget,
	})

	const rootElement = mediaQuery.createElement()
	rootElement.mount()

	// Find the target widget element in the tree
	function findTargetElement(
		element: Element,
		targetWidgetType: new (...args: any[]) => T,
	): Element | null {
		if (element.widget.constructor === targetWidgetType) {
			return element
		}
		for (const child of element.children) {
			const result = findTargetElement(child, targetWidgetType)
			if (result) return result
		}
		return null
	}

	const targetElement = findTargetElement(
		rootElement,
		widget.constructor as new (...args: any[]) => T,
	)
	if (!targetElement) {
		throw new Error(`Target widget element not found in tree for ${widget.constructor.name}`)
	}

	return { rootElement, targetElement }
}

/**
 * Creates a mock paint scheduler for testing widget lifecycle without actual rendering.
 * This prevents tests from depending on the full rendering pipeline.
 */
export function createMockPaintScheduler() {
	return {
		requestLayout: () => {},
		requestPaint: () => {},
		removeFromQueues: () => {},
	}
}

/**
 * Searches for a specific text sequence within a rendered screen buffer.
 * This is useful for verifying that specific text content appears somewhere in the output.
 *
 * @param screen - The screen buffer to search
 * @param searchText - The text sequence to find
 * @param maxWidth - Maximum width to search (defaults to screen width)
 * @param maxHeight - Maximum height to search (defaults to screen height)
 * @returns true if the text sequence is found, false otherwise
 */
export function findTextInScreen(
	screen: { getCell: (x: number, y: number) => { char: string } | null },
	searchText: string,
	maxWidth?: number,
	maxHeight?: number,
): boolean {
	const width = maxWidth ?? 80
	const height = maxHeight ?? 24

	for (let y = 0; y < height; y++) {
		for (let x = 0; x <= width - searchText.length; x++) {
			const chars = []
			for (let i = 0; i < searchText.length; i++) {
				const cell = screen.getCell(x + i, y)
				chars.push(cell?.char || '')
			}
			if (chars.join('') === searchText) {
				return true
			}
		}
	}
	return false
}

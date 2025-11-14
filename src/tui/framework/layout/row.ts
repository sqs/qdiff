import type { Key } from '../key.js'
import type { Widget } from '../widget.js'
import { Axis, CrossAxisAlignment, Flex, MainAxisAlignment, MainAxisSize } from './flex.js'

/**
 * A widget that displays its children in a horizontal array.
 *
 * Row is a convenience widget that creates a Flex with horizontal direction.
 */
export class Row extends Flex {
	constructor({
		key,
		children = [],
		mainAxisAlignment = MainAxisAlignment.start,
		crossAxisAlignment = CrossAxisAlignment.center,
		mainAxisSize = MainAxisSize.max,
	}: {
		key?: Key
		children?: Widget[]
		mainAxisAlignment?: MainAxisAlignment
		crossAxisAlignment?: CrossAxisAlignment
		mainAxisSize?: MainAxisSize
	} = {}) {
		super({
			...(key ? { key } : {}),
			direction: Axis.horizontal,
			children,
			mainAxisAlignment,
			crossAxisAlignment,
			mainAxisSize,
		})
	}

	/**
	 * Creates a Row with start alignment (default).
	 */
	static start(children: Widget[]): Row {
		return new Row({ children, mainAxisAlignment: MainAxisAlignment.start })
	}

	/**
	 * Creates a Row with center alignment.
	 */
	static center(children: Widget[]): Row {
		return new Row({ children, mainAxisAlignment: MainAxisAlignment.center })
	}

	/**
	 * Creates a Row with end alignment.
	 */
	static end(children: Widget[]): Row {
		return new Row({ children, mainAxisAlignment: MainAxisAlignment.end })
	}

	/**
	 * Creates a Row with space between children.
	 */
	static spaceBetween(children: Widget[]): Row {
		return new Row({ children, mainAxisAlignment: MainAxisAlignment.spaceBetween })
	}

	/**
	 * Creates a Row with space around children.
	 */
	static spaceAround(children: Widget[]): Row {
		return new Row({ children, mainAxisAlignment: MainAxisAlignment.spaceAround })
	}

	/**
	 * Creates a Row with space evenly distributed.
	 */
	static spaceEvenly(children: Widget[]): Row {
		return new Row({ children, mainAxisAlignment: MainAxisAlignment.spaceEvenly })
	}
}

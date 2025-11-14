import type { Key } from '../key.js'
import type { Widget } from '../widget.js'
import { Axis, CrossAxisAlignment, Flex, MainAxisAlignment, MainAxisSize } from './flex.js'

/**
 * A widget that displays its children in a vertical array.
 *
 * Column is a convenience widget that creates a Flex with vertical direction.
 */
export class Column extends Flex {
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
			direction: Axis.vertical,
			children,
			mainAxisAlignment,
			crossAxisAlignment,
			mainAxisSize,
		})
	}

	/**
	 * Creates a Column with start alignment (default).
	 */
	static start(children: Widget[]): Column {
		return new Column({ children, mainAxisAlignment: MainAxisAlignment.start })
	}

	/**
	 * Creates a Column with center alignment.
	 */
	static center(children: Widget[]): Column {
		return new Column({ children, mainAxisAlignment: MainAxisAlignment.center })
	}

	/**
	 * Creates a Column with end alignment.
	 */
	static end(children: Widget[]): Column {
		return new Column({ children, mainAxisAlignment: MainAxisAlignment.end })
	}

	/**
	 * Creates a Column with space between children.
	 */
	static spaceBetween(children: Widget[]): Column {
		return new Column({ children, mainAxisAlignment: MainAxisAlignment.spaceBetween })
	}

	/**
	 * Creates a Column with space around children.
	 */
	static spaceAround(children: Widget[]): Column {
		return new Column({ children, mainAxisAlignment: MainAxisAlignment.spaceAround })
	}

	/**
	 * Creates a Column with space evenly distributed.
	 */
	static spaceEvenly(children: Widget[]): Column {
		return new Column({ children, mainAxisAlignment: MainAxisAlignment.spaceEvenly })
	}
}

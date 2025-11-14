import type { Key } from '../key.js'
import { Widget } from '../widget.js'
import { Container } from './container.js'
import { Expanded } from './expanded.js'
import { SizedBox } from './sized-box.js'

/**
 * A widget that creates space between other widgets.
 *
 * In Flex contexts (Row, Column), creates flexible space that expands to fill available space.
 * In other contexts, creates fixed space with the specified width and/or height.
 */
export class Spacer extends Widget {
	/**
	 * The flex factor to use when this spacer is in a Flex context.
	 * Higher values take up proportionally more space.
	 */
	readonly flex: number

	/**
	 * Fixed width for non-flex contexts.
	 */
	readonly width: number | undefined

	/**
	 * Fixed height for non-flex contexts.
	 */
	readonly height: number | undefined

	constructor({
		key,
		flex = 1,
		width,
		height,
	}: {
		key?: Key
		flex?: number
		width?: number
		height?: number
	} = {}) {
		super(key ? { key } : {})
		this.flex = flex
		this.width = width
		this.height = height
	}

	createElement() {
		/** In flex contexts, this will be treated as an Expanded with empty child */
		/** In other contexts, this will be treated as a SizedBox */

		if (this.width !== undefined || this.height !== undefined) {
			/** Fixed size spacer */
			const sizedBoxProps: {
				width?: number
				height?: number
				child: Widget
			} = { child: new Container() }

			if (this.width !== undefined) {
				sizedBoxProps.width = this.width
			}
			if (this.height !== undefined) {
				sizedBoxProps.height = this.height
			}

			return new SizedBox(sizedBoxProps).createElement()
		} else {
			/** Flexible spacer - use Expanded with SizedBox.shrink() like Flutter */
			return new Expanded({
				flex: this.flex,
				child: SizedBox.shrink(),
			}).createElement()
		}
	}

	/**
	 * Creates a horizontal spacer with fixed width.
	 */
	static horizontal(width: number): Spacer {
		return new Spacer({ width })
	}

	/**
	 * Creates a vertical spacer with fixed height.
	 */
	static vertical(height: number): Spacer {
		return new Spacer({ height })
	}

	/**
	 * Creates a flexible spacer that expands to fill available space.
	 */
	static flexible(flex = 1): Spacer {
		return new Spacer({ flex })
	}
}

import type { MouseCursorShape } from '../../lib/mouse-cursor.js'
import type { Color } from '../../lib/screen.js'
import { Colors } from '../../lib/screen.js'
import type { BuildContext } from '../build-context.js'
import type { Key } from '../key.js'
import { BoxDecoration, Container } from '../layout/container.js'
import { EdgeInsets } from '../layout/padding.js'
import { StatelessWidget } from '../stateless-widget.js'
import type { Widget } from '../widget.js'
import { MouseRegion } from './mouse-region.js'
import { RichText, TextSpan, TextStyle } from './rich-text.js'

export interface ButtonProps {
	text: string
	onPressed: () => void | Promise<void>
	padding?: EdgeInsets
	cursor?: MouseCursorShape
	color?: Color
	reverse?: boolean
	key?: Key
}

export class Button extends StatelessWidget {
	public readonly text: string
	public readonly onPressed: () => void | Promise<void>
	public readonly padding: EdgeInsets
	public readonly cursor: MouseCursorShape
	public readonly color?: Color
	public readonly reverse: boolean

	constructor({ text, onPressed, padding, cursor, color, reverse, key }: ButtonProps) {
		super({ key })
		this.text = text
		this.onPressed = onPressed
		this.padding = padding ?? EdgeInsets.symmetric(2, 1)
		this.cursor = cursor ?? 'pointer'
		this.color = color
		this.reverse = reverse ?? false
	}

	build(context: BuildContext): Widget {
		const textStyle = this.reverse
			? new TextStyle({ color: Colors.black })
			: this.color
				? new TextStyle({ color: this.color })
				: undefined

		const richText = new RichText({
			text: new TextSpan(this.text, textStyle),
		})

		const paddedText = new Container({
			padding: this.padding,
			decoration: this.reverse
				? new BoxDecoration(this.color ?? Colors.default())
				: undefined,
			child: richText,
		})

		return new MouseRegion({
			onClick: async () => {
				await this.onPressed()
			},
			cursor: this.cursor,
			child: paddedText,
		})
	}
}

import { Colors } from '../../lib/screen.js'
import type { BuildContext } from '../build-context.js'
import type { Key } from '../key.js'
import { Column } from '../layout/column.js'
import { CrossAxisAlignment, MainAxisSize } from '../layout/flex.js'
import { Row } from '../layout/row.js'
import { SizedBox } from '../layout/sized-box.js'
import type { MouseClickEvent } from '../mouse/mouse-events.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'
import { MouseRegion } from './mouse-region.js'
import { RichText, TextSpan, TextStyle } from './rich-text.js'

/**
 * A collapsible details widget that shows/hides its content.
 */
export class Details extends StatefulWidget {
	readonly title: RichText
	readonly child: Widget
	readonly expanded: boolean
	readonly onChanged?: (expanded: boolean) => void

	constructor({
		key,
		title,
		child,
		expanded = false,
		onChanged,
	}: {
		key?: Key
		title: RichText
		child: Widget
		expanded?: boolean
		onChanged?: (expanded: boolean) => void
	}) {
		super({ key })
		this.title = title
		this.child = child
		this.expanded = expanded
		this.onChanged = onChanged
	}

	createState(): State<this> {
		return new DetailsState() as unknown as State<this>
	}
}

export class DetailsState extends State<Details> {
	get expanded(): boolean {
		return this.widget.expanded
	}

	toggle(): void {
		this.widget.onChanged?.(!this.expanded)
	}

	initState(): void {
		super.initState()
	}

	didUpdateWidget(oldWidget: Details): void {
		super.didUpdateWidget(oldWidget)
		if (oldWidget.expanded !== this.widget.expanded) {
			this.setState()
		}
	}

	build(context: BuildContext): Widget {
		// Create the arrow indicator
		const arrow = new RichText({
			text: new TextSpan(
				this.expanded ? '▼' : '▶',
				new TextStyle({ color: Colors.index(8) }),
			),
		})

		// Create the clickable title row
		const titleRow = new MouseRegion({
			onClick: this._handleClick.bind(this),
			cursor: 'pointer',
			child: new Row({
				mainAxisSize: MainAxisSize.min,
				children: [this.widget.title, new SizedBox({ width: 1 }), arrow],
			}),
		})

		// Always return a Column for consistent layout
		const children: Widget[] = [titleRow]
		if (this.expanded) {
			children.push(this.widget.child)
		}

		return new Column({
			mainAxisSize: MainAxisSize.min,
			crossAxisAlignment: CrossAxisAlignment.start,
			children,
		})
	}

	private _handleClick(_event: MouseClickEvent): void {
		this.toggle()
	}
}

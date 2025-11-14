import type { BuildContext } from './build-context.js'
import { State } from './state.js'
import { StatefulWidget } from './stateful-widget.js'
import type { Widget } from './widget.js'

export interface StatefulBuilderProps<T = void> {
	builder: (context: BuildContext, setState: (fn: (state: T) => T) => void, state: T) => Widget
	initialState: T
	onDispose?: (state: T) => void
}

export class StatefulBuilder<T = void> extends StatefulWidget {
	constructor(public readonly props: StatefulBuilderProps<T>) {
		super()
	}

	createState(): State<this> {
		return new StatefulBuilderState<T>() as unknown as State<this>
	}
}

class StatefulBuilderState<T> extends State<StatefulBuilder<T>> {
	private _state!: T

	initState(): void {
		super.initState()
		this._state = this.widget.props.initialState
	}

	build(context: BuildContext): Widget {
		const setStateWrapper = (fn: (state: T) => T) => {
			this.setState(() => {
				this._state = fn(this._state)
			})
		}
		return this.widget.props.builder(context, setStateWrapper, this._state)
	}
}

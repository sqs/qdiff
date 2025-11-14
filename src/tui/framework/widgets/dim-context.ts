import type { BuildContext } from '../build-context.js'
import { InheritedWidget } from '../inherited-widget.js'
import type { Key } from '../key.js'
import type { Widget } from '../widget.js'

/**
 * An InheritedWidget that forces descendant widgets to render with dim style.
 *
 * This widget provides a boolean flag that descendant widgets (like RichText and Container)
 * can check to determine if they should apply dim rendering.
 *
 * Usage:
 * ```typescript
 * new DimContext({
 *   forceDim: true,
 *   child: new RichText({ text: new TextSpan('This will be dimmed') }),
 * })
 * ```
 */
export class DimContext extends InheritedWidget {
	public readonly forceDim: boolean

	constructor({ key, forceDim, child }: { key?: Key; forceDim: boolean; child: Widget }) {
		super({ key, child })
		this.forceDim = forceDim
	}

	/**
	 * Get the DimContext from the nearest ancestor, or null if none found.
	 */
	static maybeOf(context: BuildContext): DimContext | null {
		const element = context.dependOnInheritedWidgetOfExactType(DimContext)
		if (element) {
			return element.widget as DimContext
		}
		return null
	}

	/**
	 * Check if dim rendering should be forced for the current context.
	 */
	static shouldForceDim(context: BuildContext): boolean {
		const dimContext = DimContext.maybeOf(context)
		return dimContext?.forceDim ?? false
	}

	updateShouldNotify(oldWidget: DimContext): boolean {
		return this.forceDim !== oldWidget.forceDim
	}
}

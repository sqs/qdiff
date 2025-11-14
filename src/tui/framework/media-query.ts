import type { TerminalCapabilities } from '../lib/terminal-queries.js'
import type { BuildContext } from './build-context.js'
import { InheritedWidget } from './inherited-widget.js'
import type { Key } from './key.js'
import type { Widget } from './widget.js'

/**
 * Information about the terminal environment and capabilities.
 * Similar to Flutter's MediaQueryData.
 */
export class MediaQueryData {
	constructor(
		/** Terminal dimensions in cells */
		public readonly size: { width: number; height: number },
		/** Terminal capabilities detected during initialization */
		public readonly capabilities: TerminalCapabilities,
	) {}

	/**
	 * Whether the terminal supports proper emoji width reporting (mode 2027).
	 */
	get supportsEmojiWidth(): boolean {
		return this.capabilities.emojiWidth
	}

	/**
	 * Whether the terminal supports synchronized output.
	 */
	get supportsSyncOutput(): boolean {
		return this.capabilities.syncOutput
	}
}

/**
 * Widget that provides media query data to its descendants.
 * Similar to Flutter's MediaQuery widget.
 */
export class MediaQuery extends InheritedWidget {
	public readonly data: MediaQueryData

	constructor({ key, data, child }: { key?: Key; data: MediaQueryData; child: Widget }) {
		super(key !== undefined ? { key, child } : { child })
		this.data = data
	}

	updateShouldNotify(oldWidget: MediaQuery): boolean {
		return (
			this.data !== oldWidget.data ||
			this.data.size.width !== oldWidget.data.size.width ||
			this.data.size.height !== oldWidget.data.size.height ||
			this.data.capabilities !== oldWidget.data.capabilities
		)
	}

	/**
	 * Get the MediaQuery data from the given context.
	 * This uses the proper InheritedWidget pattern with dependency tracking.
	 */
	static of(context: BuildContext): MediaQueryData {
		const element = context.dependOnInheritedWidgetOfExactType(MediaQuery)
		if (element) {
			return (element.widget as MediaQuery).data
		}

		throw new Error('MediaQuery not found in context. Wrap your app with MediaQuery widget.')
	}

	/**
	 * Convenience method to get just the terminal size.
	 */
	static sizeOf(context: BuildContext): { width: number; height: number } {
		return MediaQuery.of(context).size
	}

	/**
	 * Convenience method to get terminal capabilities.
	 */
	static capabilitiesOf(context: BuildContext): TerminalCapabilities {
		return MediaQuery.of(context).capabilities
	}
}

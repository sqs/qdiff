import logger from '../../logger.js'

import { WidgetsBinding } from '../binding.js'
import type { BuildContext } from '../build-context.js'
import { State } from '../state.js'
import { StatefulWidget } from '../stateful-widget.js'
import type { Widget } from '../widget.js'
import { Theme, ThemeData } from './theme.js'

/**
 * Provides a Theme that dynamically updates when RGB colors are detected.
 *
 * Starts with index-based colors, then updates to RGB colors once terminal
 * queries complete. Can also update when terminal theme changes.
 */
export class RgbThemeProvider extends StatefulWidget {
	constructor(public readonly child: Widget) {
		super()
	}

	createState(): State<this> {
		return new RgbThemeProviderState() as unknown as State<this>
	}
}

class RgbThemeProviderState extends State<RgbThemeProvider> {
	private themeData: ThemeData = ThemeData.default()
	private unsubscribe?: () => void

	initState(): void {
		// Check for RGB colors after mount
		this.checkAndUpdateRgbColors()

		// Subscribe to RGB color change notifications
		this.unsubscribe = WidgetsBinding.instance.onRgbColorsChanged(() => {
			this.checkAndUpdateRgbColors()
		})
	}

	dispose(): void {
		if (this.unsubscribe) {
			this.unsubscribe()
		}
	}

	private checkAndUpdateRgbColors(): void {
		const binding = WidgetsBinding.instance
		const rgbColors = binding.getRgbColors()

		logger.info('RgbThemeProvider checking for RGB colors', { found: !!rgbColors })

		if (rgbColors) {
			logger.info('RgbThemeProvider updating theme with RGB colors')
			this.setState(() => {
				this.themeData = ThemeData.withRgb(rgbColors)
			})
		}
	}

	build(_context: BuildContext): Widget {
		return new Theme({
			data: this.themeData,
			child: this.widget.child,
		})
	}
}

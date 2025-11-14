import type { Color } from '../../lib/screen.js'
import { Colors } from '../../lib/screen.js'
import type { BuildContext } from '../build-context.js'
import { InheritedWidget } from '../inherited-widget.js'
import type { Key } from '../key.js'
import type { Widget } from '../widget.js'

/**
 * Color scheme data that defines the semantic colors used throughout the UI.
 */
export class ColorScheme {
	public readonly foreground: Color
	public readonly mutedForeground: Color
	public readonly background: Color
	public readonly cursor: Color
	public readonly primary: Color
	public readonly secondary: Color
	public readonly accent: Color
	public readonly border: Color
	public readonly success: Color
	public readonly warning: Color
	public readonly info: Color
	public readonly destructive: Color
	public readonly selection: Color
	public readonly copyHighlight: Color
	public readonly tableBorder: Color

	constructor({
		foreground,
		mutedForeground,
		background,
		cursor,
		primary,
		secondary,
		accent,
		border,
		success,
		warning,
		info,
		destructive,
		selection,
		copyHighlight,
		tableBorder,
	}: {
		foreground: Color
		mutedForeground: Color
		background: Color
		cursor: Color
		primary: Color
		secondary: Color
		accent: Color
		border: Color
		success: Color
		warning: Color
		info: Color
		destructive: Color
		selection: Color
		copyHighlight: Color
		tableBorder: Color
	}) {
		this.foreground = foreground
		this.mutedForeground = mutedForeground
		this.background = background
		this.cursor = cursor
		this.primary = primary
		this.secondary = secondary
		this.accent = accent
		this.border = border
		this.success = success
		this.warning = warning
		this.info = info
		this.destructive = destructive
		this.selection = selection
		this.copyHighlight = copyHighlight
		this.tableBorder = tableBorder
	}

	/**
	 * Creates a default color scheme using semantic terminal colors.
	 */
	static default(): ColorScheme {
		return new ColorScheme({
			foreground: Colors.default(),
			mutedForeground: Colors.default(),
			background: Colors.default(),
			cursor: Colors.default(),
			primary: Colors.blue,
			secondary: Colors.cyan,
			accent: Colors.magenta,
			border: Colors.default(),
			success: Colors.green,
			warning: Colors.yellow,
			info: Colors.index(12),
			destructive: Colors.red,
			selection: Colors.index(8),
			copyHighlight: Colors.yellow,
			tableBorder: Colors.default(),
		})
	}

	/**
	 * Creates a color scheme using queried RGB values from the terminal.
	 */
	static fromRgb(colors: {
		fg: { r: number; g: number; b: number }
		bg: { r: number; g: number; b: number }
		cursor: { r: number; g: number; b: number }
		indices: Array<{ r: number; g: number; b: number }>
	}): ColorScheme {
		return new ColorScheme({
			foreground: Colors.rgb(colors.fg.r, colors.fg.g, colors.fg.b),
			mutedForeground: Colors.rgb(
				colors.indices[7]!.r,
				colors.indices[7]!.g,
				colors.indices[7]!.b,
			),
			background: Colors.rgb(colors.bg.r, colors.bg.g, colors.bg.b),
			cursor: Colors.rgb(colors.cursor.r, colors.cursor.g, colors.cursor.b),
			primary: Colors.rgb(colors.indices[4]!.r, colors.indices[4]!.g, colors.indices[4]!.b),
			secondary: Colors.rgb(colors.indices[6]!.r, colors.indices[6]!.g, colors.indices[6]!.b),
			accent: Colors.rgb(colors.indices[5]!.r, colors.indices[5]!.g, colors.indices[5]!.b),
			border: Colors.rgb(colors.fg.r, colors.fg.g, colors.fg.b),
			success: Colors.rgb(colors.indices[2]!.r, colors.indices[2]!.g, colors.indices[2]!.b),
			warning: Colors.rgb(colors.indices[3]!.r, colors.indices[3]!.g, colors.indices[3]!.b),
			info: Colors.rgb(colors.indices[6]!.r, colors.indices[6]!.g, colors.indices[6]!.b),
			destructive: Colors.rgb(
				colors.indices[1]!.r,
				colors.indices[1]!.g,
				colors.indices[1]!.b,
			),
			selection: Colors.index(8),
			copyHighlight: Colors.rgb(
				colors.indices[3]!.r,
				colors.indices[3]!.g,
				colors.indices[3]!.b,
			),
			tableBorder: Colors.rgb(colors.fg.r, colors.fg.g, colors.fg.b),
		})
	}
}

/**
 * Complete theme data for the application.
 */
export class ThemeData {
	public readonly colorScheme: ColorScheme

	constructor({ colorScheme }: { colorScheme: ColorScheme }) {
		this.colorScheme = colorScheme
	}

	/**
	 * Creates a default theme.
	 */
	static default(): ThemeData {
		return new ThemeData({
			colorScheme: ColorScheme.default(),
		})
	}

	/**
	 * Creates a theme using queried RGB values from the terminal.
	 */
	static withRgb(colors: {
		fg: { r: number; g: number; b: number }
		bg: { r: number; g: number; b: number }
		cursor: { r: number; g: number; b: number }
		indices: Array<{ r: number; g: number; b: number }>
	}): ThemeData {
		return new ThemeData({
			colorScheme: ColorScheme.fromRgb(colors),
		})
	}
}

/**
 * A widget that provides theme data to its descendants.
 *
 * The Theme widget is an InheritedWidget that propagates theme information
 * down the widget tree. Descendant widgets can access the theme using Theme.of(context).
 */
export class Theme extends InheritedWidget {
	public readonly data: ThemeData

	constructor({ key, data, child }: { key?: Key; data: ThemeData; child: Widget }) {
		super({ key, child })
		this.data = data
	}

	/**
	 * Get the theme data from the nearest Theme widget ancestor.
	 */
	static of(context: BuildContext): ThemeData {
		const element = context.dependOnInheritedWidgetOfExactType(Theme)
		if (element) {
			return (element.widget as Theme).data
		}
		return ThemeData.default()
	}

	/**
	 * Get the theme data from the nearest Theme widget ancestor, or null if none found.
	 */
	static maybeOf(context: BuildContext): ThemeData | null {
		const element = context.dependOnInheritedWidgetOfExactType(Theme)
		if (element) {
			return (element.widget as Theme).data
		}
		return null
	}

	updateShouldNotify(oldWidget: Theme): boolean {
		return this.data !== oldWidget.data
	}
}

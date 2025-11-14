/**
 * Intent system for declarative keyboard shortcuts
 *
 * Inspired by Flutter's Intent/Actions pattern, this provides a way to
 * declaratively map keyboard input to semantic actions.
 */

/**
 * Base class for all intents.
 *
 * An Intent represents a semantic action that can be triggered by user input,
 * decoupled from the actual implementation of that action.
 */
export abstract class Intent {
	/**
	 * A unique identifier for this intent type.
	 * Used for matching in Actions widgets.
	 */
	abstract get intentType(): string

	/**
	 * Returns a string representation of this intent.
	 */
	toString(): string {
		return `${this.constructor.name}()`
	}
}

/**
 * Navigation intents
 */
export class PageUpIntent extends Intent {
	get intentType(): string {
		return 'pageUp'
	}
}

export class PageDownIntent extends Intent {
	get intentType(): string {
		return 'pageDown'
	}
}

export class HomeIntent extends Intent {
	get intentType(): string {
		return 'home'
	}
}

export class EndIntent extends Intent {
	get intentType(): string {
		return 'end'
	}
}

export class FocusMessageViewIntent extends Intent {
	get intentType(): string {
		return 'focusMessageView'
	}
}

export class ToggleFrameStatsIntent extends Intent {
	get intentType(): string {
		return 'toggleFrameStats'
	}
}

export class ShowCommandPaletteIntent extends Intent {
	get intentType(): string {
		return 'showCommandPalette'
	}
}

/**
 * Custom intent that can carry additional data
 */
export class CustomIntent<T = unknown> extends Intent {
	constructor(
		public readonly type: string,
		public readonly data?: T,
	) {
		super()
	}

	get intentType(): string {
		return this.type
	}

	toString(): string {
		return `CustomIntent(${this.type}, ${JSON.stringify(this.data)})`
	}
}

/**
 * Base class for all intents.
 *
 * An Intent describes a generic action that the user wants to perform.
 * It contains all the data needed to invoke a specific action, but
 * doesn't define how the action should be performed.
 */
export abstract class Intent {
	/**
	 * Creates an Intent.
	 */
	constructor() {}

	/**
	 * Returns a string representation of this intent for debugging.
	 */
	toString(): string {
		return `${this.constructor.name}()`
	}
}

/**
 * An intent that is bound to a VoidCallback.
 *
 * This is a convenience class for creating simple intents that don't
 * need custom action implementations.
 */
export class VoidCallbackIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for copying the current selection to the clipboard.
 */
export class CopySelectionIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for cutting the current selection to the clipboard.
 */
export class CutSelectionIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for pasting from the clipboard.
 */
export class PasteTextIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for pasting an image from the clipboard.
 */
export class PasteImageIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for selecting all content.
 */
export class SelectAllIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for undoing the last action.
 */
export class UndoIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for redoing the last undone action.
 */
export class RedoIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for deleting the current selection or character.
 */
export class DeleteIntent extends Intent {
	constructor(public readonly forward: boolean = true) {
		super()
	}

	toString(): string {
		return `DeleteIntent(forward: ${this.forward})`
	}
}

/**
 * Intent for moving the text cursor.
 */
export class MoveCursorIntent extends Intent {
	constructor(
		public readonly direction: 'left' | 'right' | 'up' | 'down',
		public readonly extendSelection: boolean = false,
		public readonly byWord: boolean = false,
	) {
		super()
	}

	toString(): string {
		return `MoveCursorIntent(direction: ${this.direction}, extendSelection: ${this.extendSelection}, byWord: ${this.byWord})`
	}
}

/**
 * Intent for scrolling the viewport.
 */
export class ScrollIntent extends Intent {
	constructor(
		public readonly direction: 'up' | 'down' | 'left' | 'right',
		public readonly type: 'line' | 'page' = 'line',
		public readonly amount: number = 1,
	) {
		super()
	}

	toString(): string {
		return `ScrollIntent(direction: ${this.direction}, type: ${this.type}, amount: ${this.amount})`
	}
}

/**
 * Intent for activating or selecting the focused item.
 */
export class ActivateIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for moving focus to the next focusable widget.
 */
export class NextFocusIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for moving focus to the previous focusable widget.
 */
export class PreviousFocusIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for dismissing the current context (like closing a modal).
 */
export class DismissIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent for exiting the application.
 */
export class ExitIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to toggle the console overlay.
 */
export class ToggleConsoleOverlayIntent extends Intent {
	constructor() {
		super()
	}
}

export class ToggleThinkingBlocksIntent extends Intent {
	constructor() {
		super()
	}
}

export class ToggleCostDisplayIntent extends Intent {
	constructor() {
		super()
	}
}

export class ToggleFrameStatsIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to refresh/clear the screen.
 */
export class RefreshScreenIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to toggle agent mode between fast and smart.
 */
export class ToggleAgentModeIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to toggle workspace filtering in the thread picker.
 */
export class ToggleThreadPickerWorkspaceFilterIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to navigate to the next user message in the thread.
 */
export class NavigateToUserMessageIntent extends Intent {
	constructor(public readonly direction: 'next' | 'previous') {
		super()
	}

	toString(): string {
		return `NavigateToUserMessageIntent(direction: ${this.direction})`
	}
}

/**
 * Intent to navigate to the next prompt history item.
 */
export class NavigateToPromptHistoryIntent extends Intent {
	constructor(public readonly direction: 'next' | 'previous') {
		super()
	}

	toString(): string {
		return `NavigateToPromptHistoryIntent(direction: ${this.direction})`
	}
}

/**
 * Intent to edit the currently selected user message.
 */
export class EditMessageIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to deselect the currently selected user message.
 */
export class DeselectUserMessageIntent extends Intent {
	constructor() {
		super()
	}
}

/**
 * Intent to show the command palette modal.
 */
export class ShowCommandPaletteIntent extends Intent {
	constructor() {
		super()
	}
}

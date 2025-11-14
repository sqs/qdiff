/**
 * Mouse cursor shape support
 * Uses W3C CSS cursor names
 */

/** Standard mouse cursor shapes supported by most terminals */
export const MouseCursor = {
	/** Default arrow cursor */
	DEFAULT: 'default',

	/** Pointer hand cursor (for links/buttons) */
	POINTER: 'pointer',

	/** Text selection I-beam cursor */
	TEXT: 'text',

	/** Wait/busy spinner cursor */
	WAIT: 'wait',

	/** Crosshair cursor */
	CROSSHAIR: 'crosshair',

	/** Help cursor */
	HELP: 'help',

	/** Move cursor (four arrows) */
	MOVE: 'move',

	/** Not allowed/forbidden cursor */
	NOT_ALLOWED: 'not-allowed',

	/** Progress cursor */
	PROGRESS: 'progress',

	/** Cell selection cursor */
	CELL: 'cell',

	/** Context menu cursor */
	CONTEXT_MENU: 'context-menu',

	/** Copy cursor */
	COPY: 'copy',

	/** Alias cursor */
	ALIAS: 'alias',

	/** Zoom in cursor */
	ZOOM_IN: 'zoom-in',

	/** Zoom out cursor */
	ZOOM_OUT: 'zoom-out',

	/** Grab cursor (open hand) */
	GRAB: 'grab',

	/** Grabbing cursor (closed hand) */
	GRABBING: 'grabbing',

	// Resize cursors
	/** North resize cursor */
	N_RESIZE: 'n-resize',

	/** South resize cursor */
	S_RESIZE: 's-resize',

	/** East resize cursor */
	E_RESIZE: 'e-resize',

	/** West resize cursor */
	W_RESIZE: 'w-resize',

	/** Northeast resize cursor */
	NE_RESIZE: 'ne-resize',

	/** Northwest resize cursor */
	NW_RESIZE: 'nw-resize',

	/** Southeast resize cursor */
	SE_RESIZE: 'se-resize',

	/** Southwest resize cursor */
	SW_RESIZE: 'sw-resize',

	/** North-South resize cursor */
	NS_RESIZE: 'ns-resize',

	/** East-West resize cursor */
	EW_RESIZE: 'ew-resize',

	/** Column resize cursor */
	COL_RESIZE: 'col-resize',

	/** Row resize cursor */
	ROW_RESIZE: 'row-resize',
} as const

/** Type for mouse cursor shape values */
export type MouseCursorShape = (typeof MouseCursor)[keyof typeof MouseCursor]

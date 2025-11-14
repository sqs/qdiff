/**
 * VT Parser Types
 * Based on Paul Williams' VT100 state machine
 */

/** States in the VT100 parser state machine */
export enum ParserState {
	Ground = 'ground',
	Escape = 'escape',
	EscapeIntermediate = 'escape_intermediate',
	CsiEntry = 'csi_entry',
	CsiParam = 'csi_param',
	CsiIntermediate = 'csi_intermediate',
	CsiIgnore = 'csi_ignore',
	DcsEntry = 'dcs_entry',
	DcsParam = 'dcs_param',
	DcsIntermediate = 'dcs_intermediate',
	DcsPassthrough = 'dcs_passthrough',
	DcsIgnore = 'dcs_ignore',
	OscString = 'osc_string',
	SosPmApcString = 'sos_pm_apc_string',
}

/** Actions performed by the parser */
export enum ParserAction {
	Ignore = 'ignore',
	Print = 'print',
	Execute = 'execute',
	Clear = 'clear',
	Collect = 'collect',
	Param = 'param',
	EscDispatch = 'esc_dispatch',
	CsiDispatch = 'csi_dispatch',
	Hook = 'hook',
	Put = 'put',
	Unhook = 'unhook',
	OscStart = 'osc_start',
	OscPut = 'osc_put',
	OscEnd = 'osc_end',
	ApcStart = 'apc_start',
	ApcPut = 'apc_put',
	ApcEnd = 'apc_end',
}

/** Lexical event types */
export interface PrintEvent {
	type: 'print'
	grapheme: string
}

export interface ExecuteEvent {
	type: 'execute'
	code: number
}

export interface EscapeEvent {
	type: 'escape'
	intermediates: string
	final: string
}

/** CSI parameter with optional subparameters */
export interface CsiParam {
	value: number
	subparams?: number[]
}

export interface CsiEvent {
	type: 'csi'
	private: string
	intermediates: string
	final: string
	params: CsiParam[]
}

export interface DcsEvent {
	type: 'dcs'
	private: string
	intermediates: string
	final: string
	params: CsiParam[]
	data: string
}

export interface OscEvent {
	type: 'osc'
	data: string
}

export interface ApcEvent {
	type: 'apc'
	data: string
}

/** Union type for all lexical events */
export type LexicalEvent =
	| PrintEvent
	| ExecuteEvent
	| EscapeEvent
	| CsiEvent
	| DcsEvent
	| OscEvent
	| ApcEvent

export interface ColorPaletteChangeEvent {
	type: 'colorPaletteChange'
	colorIndex: number
	value: string
}

export interface CursorPositionReportEvent {
	type: 'cursor_position_report'
	row: number
	col: number
}

// Keep ParserEvent as an alias for backward compatibility
export type ParserEvent =
	| LexicalEvent
	| KeyboardEvent
	| DeviceAttributesPrimaryEvent
	| DecrqssResponseEvent
	| PasteEvent
	| SgrMouseEvent
	| FocusEvent
	| ColorPaletteChangeEvent
	| CursorPositionReportEvent

/** Semantic input events */
export interface KeyboardEvent {
	type: 'key'
	key: string
	shiftKey: boolean
	ctrlKey: boolean
	altKey: boolean
	metaKey: boolean
}

/** Device Attributes Primary (DA1) event */
export interface DeviceAttributesPrimaryEvent {
	type: 'device_attributes_primary'
	primary: number
	secondary: number[]
}

/** DECRQSS (Device Control Request Status String) response event */
export interface DecrqssResponseEvent {
	type: 'decrqss_response'
	request: string
	response: string
}

/** Paste event from bracketed paste mode */
export interface PasteEvent {
	type: 'paste'
	text: string
}

/** SGR Mouse event */
export interface SgrMouseEvent {
	type: 'sgr_mouse'
	button: number // Raw SGR button code
	x: number // Column (1-based from terminal)
	y: number // Row (1-based from terminal)
	pressed: boolean // true for press, false for release
}

/** Focus event */
export interface FocusEvent {
	type: 'focus'
	focused: boolean // true for focus in, false for focus out
}

/** Internal parser state */
export interface ParserContext {
	state: ParserState
	private: string[]
	intermediates: string[]
	final: string
	params: CsiParam[]
	paramBuffer: string[]
	subparamBuffer: string[]
	currentSubparams: number[]
	oscData: string[]
	dcsData: string[]
	apcData: string[]
	printBuffer: number[]
	textBuffer: string // Accumulate decoded text for grapheme segmentation
	oscEscSeen: boolean // Track if we've seen ESC in OSC state for two-byte ST
	apcEscSeen: boolean // Track if we've seen ESC in APC state for two-byte ST
	dcsEscSeen: boolean // Track if we just terminated DCS with ESC (ignore next \)
	flushTimeout?: NodeJS.Timeout // Timeout for interactive input flushing
}

/** State transition definition */
export interface StateTransition {
	nextState: ParserState
	action: ParserAction
}

/** Character classification */
export const enum CharClass {
	C0 = 0, // 0x00-0x1F
	Print = 1, // 0x20-0x7E
	DEL = 2, // 0x7F
	C1 = 3, // 0x80-0x9F
	GR = 4, // 0xA0-0xFF
}

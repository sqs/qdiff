/**
 * VT State Machine Implementation
 * Based on Paul Williams' VT100 state machine
 */

import type { StateTransition } from './types.js'
import { CharClass, ParserAction, ParserState } from './types.js'

/** Get character class for a given byte */
export function getCharClass(code: number): CharClass {
	if (code >= 0x00 && code <= 0x1f) return CharClass.C0
	if (code >= 0x20 && code <= 0x7e) return CharClass.Print
	if (code === 0x7f) return CharClass.DEL
	if (code >= 0x80 && code <= 0x9f) return CharClass.C1
	if (code >= 0xa0 && code <= 0xff) return CharClass.GR
	return CharClass.Print // fallback
}

/** Check if character is a parameter character (0-9, ;) */
export function isParamChar(code: number): boolean {
	return (code >= 0x30 && code <= 0x39) || code === 0x3b
}

/** Check if character is an intermediate character */
export function isIntermediate(code: number): boolean {
	return code >= 0x20 && code <= 0x2f
}

/** Check if character is a final character */
export function isFinal(code: number): boolean {
	return code >= 0x40 && code <= 0x7e
}

/** Check if character is a private marker */
export function isPrivate(code: number): boolean {
	return code >= 0x3c && code <= 0x3f
}

/** State machine transition table */
export const transitionTable: Record<ParserState, Record<number, StateTransition>> = {
	[ParserState.Ground]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.Ground, action: ParserAction.Execute },
			]),
		),
		// Printable characters
		...Object.fromEntries(
			Array.from({ length: 0x5f }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.Ground, action: ParserAction.Print },
			]),
		),
		// DEL
		0x7f: { nextState: ParserState.Ground, action: ParserAction.Execute },
		// UTF-8 bytes 0x80-0xFF - treat as print characters for UTF-8 support
		...Object.fromEntries(
			Array.from({ length: 0x80 }, (_, i) => [
				i + 0x80,
				{ nextState: ParserState.Ground, action: ParserAction.Print },
			]),
		),
		// ESC is the only control we need - modern terminals use 7-bit sequences
		0x1b: { nextState: ParserState.Escape, action: ParserAction.Clear }, // ESC
	},

	[ParserState.Escape]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.Escape, action: ParserAction.Execute },
			]),
		),
		// Intermediate characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.EscapeIntermediate, action: ParserAction.Collect },
			]),
		),
		// Final characters
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.Ground, action: ParserAction.EscDispatch },
			]),
		),
		// Special escape sequences
		0x5b: { nextState: ParserState.CsiEntry, action: ParserAction.Clear }, // [
		0x50: { nextState: ParserState.DcsEntry, action: ParserAction.Clear }, // P
		0x5d: { nextState: ParserState.OscString, action: ParserAction.OscStart }, // ]
		0x58: { nextState: ParserState.SosPmApcString, action: ParserAction.Ignore }, // X (SOS)
		0x5e: { nextState: ParserState.SosPmApcString, action: ParserAction.Ignore }, // ^ (PM)
		0x5f: { nextState: ParserState.SosPmApcString, action: ParserAction.ApcStart }, // _ (APC)
		// SS3 sequence (ESC O)
		0x4f: { nextState: ParserState.EscapeIntermediate, action: ParserAction.Collect }, // O
		// DEL
		0x7f: { nextState: ParserState.Ground, action: ParserAction.EscDispatch },
	},

	[ParserState.EscapeIntermediate]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.EscapeIntermediate, action: ParserAction.Execute },
			]),
		),
		// Intermediate characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.EscapeIntermediate, action: ParserAction.Collect },
			]),
		),
		// Final characters
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.Ground, action: ParserAction.EscDispatch },
			]),
		),
		// DEL
		0x7f: { nextState: ParserState.EscapeIntermediate, action: ParserAction.Ignore },
	},

	[ParserState.CsiEntry]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.CsiEntry, action: ParserAction.Execute },
			]),
		),
		// Intermediate characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.CsiIntermediate, action: ParserAction.Collect },
			]),
		),
		// Parameter characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x30,
				{ nextState: ParserState.CsiParam, action: ParserAction.Param },
			]),
		),
		// Private markers
		...Object.fromEntries(
			Array.from({ length: 0x04 }, (_, i) => [
				i + 0x3c,
				{ nextState: ParserState.CsiParam, action: ParserAction.Collect },
			]),
		),
		// Final characters
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.Ground, action: ParserAction.CsiDispatch },
			]),
		),
		// DEL
		0x7f: { nextState: ParserState.CsiEntry, action: ParserAction.Ignore },
	},

	[ParserState.CsiParam]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.CsiParam, action: ParserAction.Execute },
			]),
		),
		// Intermediate characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.CsiIntermediate, action: ParserAction.Collect },
			]),
		),
		// Parameter characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x30,
				{ nextState: ParserState.CsiParam, action: ParserAction.Param },
			]),
		),
		// Colon (subparameter separator)
		0x3a: { nextState: ParserState.CsiParam, action: ParserAction.Param },
		// Private markers (error if not first)
		...Object.fromEntries(
			Array.from({ length: 0x04 }, (_, i) => [
				i + 0x3c,
				{ nextState: ParserState.CsiIgnore, action: ParserAction.Ignore },
			]),
		),
		// Final characters
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.Ground, action: ParserAction.CsiDispatch },
			]),
		),
		// DEL
		0x7f: { nextState: ParserState.CsiParam, action: ParserAction.Ignore },
	},

	[ParserState.CsiIntermediate]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.CsiIntermediate, action: ParserAction.Execute },
			]),
		),
		// Intermediate characters
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.CsiIntermediate, action: ParserAction.Collect },
			]),
		),
		// Parameter characters (error after intermediate)
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x30,
				{ nextState: ParserState.CsiIgnore, action: ParserAction.Ignore },
			]),
		),
		// Final characters
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.Ground, action: ParserAction.CsiDispatch },
			]),
		),
		// DEL
		0x7f: { nextState: ParserState.CsiIntermediate, action: ParserAction.Ignore },
	},

	[ParserState.CsiIgnore]: {
		// C0 controls
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.CsiIgnore, action: ParserAction.Execute },
			]),
		),
		// Ignore all characters until final
		...Object.fromEntries(
			Array.from({ length: 0x40 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.CsiIgnore, action: ParserAction.Ignore },
			]),
		),
		// Final characters
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.Ground, action: ParserAction.Ignore },
			]),
		),
		// DEL
		0x7f: { nextState: ParserState.CsiIgnore, action: ParserAction.Ignore },
	},

	// DCS states follow similar pattern to CSI
	[ParserState.DcsEntry]: {
		// Similar to CsiEntry but transitions to DCS states
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.DcsEntry, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.DcsIntermediate, action: ParserAction.Collect },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x30,
				{ nextState: ParserState.DcsParam, action: ParserAction.Param },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x04 }, (_, i) => [
				i + 0x3c,
				{ nextState: ParserState.DcsParam, action: ParserAction.Collect },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.DcsPassthrough, action: ParserAction.Hook },
			]),
		),
		0x7f: { nextState: ParserState.DcsEntry, action: ParserAction.Ignore },
	},

	[ParserState.DcsParam]: {
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.DcsParam, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.DcsIntermediate, action: ParserAction.Collect },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x30,
				{ nextState: ParserState.DcsParam, action: ParserAction.Param },
			]),
		),
		0x3a: { nextState: ParserState.DcsParam, action: ParserAction.Param },
		...Object.fromEntries(
			Array.from({ length: 0x04 }, (_, i) => [
				i + 0x3c,
				{ nextState: ParserState.DcsIgnore, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.DcsPassthrough, action: ParserAction.Hook },
			]),
		),
		0x7f: { nextState: ParserState.DcsParam, action: ParserAction.Ignore },
	},

	[ParserState.DcsIntermediate]: {
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.DcsIntermediate, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.DcsIntermediate, action: ParserAction.Collect },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x10 }, (_, i) => [
				i + 0x30,
				{ nextState: ParserState.DcsIgnore, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x3f }, (_, i) => [
				i + 0x40,
				{ nextState: ParserState.DcsPassthrough, action: ParserAction.Hook },
			]),
		),
		0x7f: { nextState: ParserState.DcsIntermediate, action: ParserAction.Ignore },
	},

	[ParserState.DcsPassthrough]: {
		// ST (String Terminator) - both 8-bit and 7-bit
		0x9c: { nextState: ParserState.Ground, action: ParserAction.Unhook },
		0x1b: { nextState: ParserState.Ground, action: ParserAction.Unhook },
		// Pass through all OTHER characters until ST
		...Object.fromEntries(
			Array.from({ length: 0x100 }, (_, i) => {
				if (i === 0x9c || i === 0x1b) return [i, undefined] // Skip overrides
				return [i, { nextState: ParserState.DcsPassthrough, action: ParserAction.Put }]
			}).filter(([, value]) => value !== undefined), // Remove undefined entries
		),
	},

	[ParserState.DcsIgnore]: {
		// Ignore all until ST
		...Object.fromEntries(
			Array.from({ length: 0x100 }, (_, i) => [
				i,
				{ nextState: ParserState.DcsIgnore, action: ParserAction.Ignore },
			]),
		),
		0x9c: { nextState: ParserState.Ground, action: ParserAction.Ignore },
		0x1b: { nextState: ParserState.Escape, action: ParserAction.Clear },
	},

	[ParserState.OscString]: {
		// Collect OSC string until ST or BEL
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.OscString, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x80 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.OscString, action: ParserAction.OscPut },
			]),
		),
		0x07: { nextState: ParserState.Ground, action: ParserAction.OscEnd }, // BEL
		0x9c: { nextState: ParserState.Ground, action: ParserAction.OscEnd }, // ST (single byte)
		0x1b: { nextState: ParserState.Escape, action: ParserAction.Clear }, // ESC - fall back to normal escape processing
	},

	[ParserState.SosPmApcString]: {
		// Collect APC string until ST (for SOS/PM, we still ignore)
		...Object.fromEntries(
			Array.from({ length: 0x20 }, (_, i) => [
				i,
				{ nextState: ParserState.SosPmApcString, action: ParserAction.Ignore },
			]),
		),
		...Object.fromEntries(
			Array.from({ length: 0x80 }, (_, i) => [
				i + 0x20,
				{ nextState: ParserState.SosPmApcString, action: ParserAction.ApcPut },
			]),
		),
		0x9c: { nextState: ParserState.Ground, action: ParserAction.ApcEnd }, // ST (single byte)
		0x1b: { nextState: ParserState.Escape, action: ParserAction.Clear },
	},
}

// Add "anywhere" transitions that can occur from any state
const anywhereTransitions = {
	// CAN and SUB
	0x18: { nextState: ParserState.Ground, action: ParserAction.Execute },
	0x1a: { nextState: ParserState.Ground, action: ParserAction.Execute },
	// ESC - modern terminals use 7-bit escape sequences
	0x1b: { nextState: ParserState.Escape, action: ParserAction.Clear },
}

// Apply anywhere transitions to all states except DcsPassthrough (which handles ESC specially)
Object.keys(transitionTable).forEach((state) => {
	const stateKey = state as ParserState
	if (stateKey === ParserState.DcsPassthrough) {
		// For DcsPassthrough, only apply CAN and SUB, not ESC
		const { 0x1b: _, ...otherAnywhereTransitions } = anywhereTransitions
		Object.assign(transitionTable[stateKey], otherAnywhereTransitions)
	} else {
		Object.assign(transitionTable[stateKey], anywhereTransitions)
	}
})

/**
 * VT Input Lexer
 * Based on Paul Williams' VT100 state machine
 *
 * Tokenizes terminal input into lexical events:
 * - Print events (graphemes)
 * - CSI sequences (escape codes with parameters)
 * - OSC sequences (operating system commands)
 * - Other control sequences
 *
 * Character Handling:
 * - Works at byte level (0-255)
 * - GL characters (0x20-0x7E) generate print events
 * - GR characters (0xA0-0xFF) generate print events (same as GL per ECMA-48)
 * - Multi-byte UTF-8 sequences are processed as separate bytes
 */

import { splitIntoGraphemes } from '../text-utils.js'
import { transitionTable } from './state-machine.js'
import type { CsiParam, ParserContext, ParserEvent } from './types.js'
import { ParserAction, ParserState } from './types.js'

export class VTLexer {
	private context: ParserContext
	private eventHandlers: ((event: ParserEvent) => void)[] = []

	constructor() {
		this.context = {
			state: ParserState.Ground,
			private: [],
			intermediates: [],
			final: '',
			params: [],
			paramBuffer: [],
			subparamBuffer: [],
			currentSubparams: [],
			oscData: [],
			dcsData: [],
			apcData: [],
			printBuffer: [],
			textBuffer: '',
			oscEscSeen: false, // Track if we've seen ESC in OSC state for two-byte ST
			apcEscSeen: false, // Track if we've seen ESC in APC state for two-byte ST
			dcsEscSeen: false, // Track if we just terminated DCS with ESC
		}
	}

	/** Add an event handler */
	onEvent(handler: (event: ParserEvent) => void): void {
		this.eventHandlers.push(handler)
	}

	/** Remove an event handler */
	offEvent(handler: (event: ParserEvent) => void): void {
		const index = this.eventHandlers.indexOf(handler)
		if (index !== -1) {
			this.eventHandlers.splice(index, 1)
		}
	}

	/** Parse input data */
	parse(data: Uint8Array | string): void {
		const bytes = typeof data === 'string' ? this.stringToBytes(data) : data

		for (const byte of bytes) {
			this.processByte(byte)
		}
	}

	/** Flush any pending print buffer (call when input is complete) */
	flush(): void {
		this.flushPrintBuffer()
		this.flushTextBuffer()
	}

	/** Convert string to UTF-8 bytes */
	private stringToBytes(str: string): Uint8Array {
		return new TextEncoder().encode(str)
	}

	/** Process a single byte */
	private processByte(byte: number): void {
		// Special handling for two-byte ST sequence (ESC \) in OSC state
		if (this.context.state === ParserState.OscString && byte === 0x1b) {
			// Set flag that we've seen ESC in OSC state
			this.context.oscEscSeen = true
			return // Don't process normal transition
		}

		if (this.context.oscEscSeen && byte === 0x5c) {
			// Complete two-byte ST sequence (ESC \)
			this.context.oscEscSeen = false
			this.performAction(ParserAction.OscEnd, byte)
			this.context.state = ParserState.Ground
			return
		}

		if (this.context.oscEscSeen) {
			// ESC followed by something other than \, treat as normal escape sequence
			this.context.oscEscSeen = false
			// Process the ESC as normal escape
		}

		// Special handling for two-byte ST sequence (ESC \) in APC state
		if (this.context.state === ParserState.SosPmApcString && byte === 0x1b) {
			// Set flag that we've seen ESC in APC state
			this.context.apcEscSeen = true
			return // Don't process normal transition
		}

		if (this.context.apcEscSeen && byte === 0x5c) {
			// Complete two-byte ST sequence (ESC \)
			this.context.apcEscSeen = false
			this.performAction(ParserAction.ApcEnd, byte)
			this.context.state = ParserState.Ground
			return
		}

		if (this.context.apcEscSeen) {
			// ESC followed by something other than \, treat as normal escape sequence
			this.context.apcEscSeen = false
			// Process the ESC as normal escape
			this.performAction(ParserAction.Clear, 0x1b)
			this.context.state = ParserState.Escape
			// Then process the current byte in escape state
			const escapeTransition = transitionTable[ParserState.Escape][byte]
			if (escapeTransition) {
				this.performAction(escapeTransition.action, byte)
				this.context.state = escapeTransition.nextState
			}
			return
		}

		const transition = transitionTable[this.context.state][byte]

		if (!transition) {
			// Default fallback for unhandled characters
			return
		}

		// Perform action
		this.performAction(transition.action, byte)

		// If we're leaving GROUND state, flush any accumulated text
		if (
			this.context.state === ParserState.Ground &&
			transition.nextState !== ParserState.Ground
		) {
			this.flushTextBuffer()
		}

		// Transition to next state
		this.context.state = transition.nextState
	}

	/** Perform the specified action */
	private performAction(action: ParserAction, byte: number): void {
		// Special handling: ignore backslash after DCS termination with ESC
		if (this.context.dcsEscSeen && byte === 0x5c) {
			this.context.dcsEscSeen = false // Clear the flag
			return // Ignore this backslash
		}

		// Clear the DCS ESC flag on any other character
		if (this.context.dcsEscSeen) {
			this.context.dcsEscSeen = false
		}

		switch (action) {
			case ParserAction.Ignore:
				break

			case ParserAction.Print:
				this.addToPrintBuffer(byte)
				break

			case ParserAction.Execute:
				this.flushTextBuffer()
				this.emitEvent({
					type: 'execute',
					code: byte,
				})
				break

			case ParserAction.Clear:
				this.flushTextBuffer()
				this.context.private.length = 0
				this.context.intermediates.length = 0
				this.context.final = ''
				this.context.params = []
				this.context.oscEscSeen = false
				this.context.paramBuffer.length = 0
				this.context.subparamBuffer.length = 0
				this.context.currentSubparams = []
				this.context.oscData.length = 0
				this.context.dcsData.length = 0
				break

			case ParserAction.Collect:
				if (byte >= 0x3c && byte <= 0x3f) {
					// Private marker
					this.context.private.push(String.fromCharCode(byte))
				} else {
					// Intermediate character
					this.context.intermediates.push(String.fromCharCode(byte))
				}
				break

			case ParserAction.Param:
				if (byte >= 0x30 && byte <= 0x39) {
					// Digit
					if (this.context.currentSubparams.length > 0) {
						this.context.subparamBuffer.push(String.fromCharCode(byte))
					} else {
						this.context.paramBuffer.push(String.fromCharCode(byte))
					}
				} else if (byte === 0x3b) {
					// Semicolon - end current parameter
					this.finishParameter()
				} else if (byte === 0x3a) {
					// Colon - start or continue subparameters
					this.finishSubparameter()
				}
				break

			case ParserAction.EscDispatch:
				this.emitEvent({
					type: 'escape',
					intermediates: this.context.intermediates.join(''),
					final: String.fromCharCode(byte),
				})
				break

			case ParserAction.CsiDispatch:
				this.finishParameter() // Finish any pending parameter
				this.emitEvent({
					type: 'csi',
					private: this.context.private.join(''),
					intermediates: this.context.intermediates.join(''),
					final: String.fromCharCode(byte),
					params: [...this.context.params],
				})
				break

			case ParserAction.Hook:
				this.finishParameter() // Finish any pending parameter
				// Hook is called at the start of DCS data, store the final char
				this.context.dcsData.length = 0
				// Store the final character that triggered the hook
				this.context.final = String.fromCharCode(byte)
				break

			case ParserAction.Put:
				this.context.dcsData.push(String.fromCharCode(byte))
				break

			case ParserAction.Unhook:
				this.emitEvent({
					type: 'dcs',
					private: this.context.private.join(''),
					intermediates: this.context.intermediates.join(''),
					final: this.context.final, // Set during hook
					params: [...this.context.params],
					data: this.context.dcsData.join(''),
				})
				// Set flag if we terminated with ESC (7-bit ST), so we can ignore the following \
				this.context.dcsEscSeen = byte === 0x1b
				break

			case ParserAction.OscStart:
				this.context.oscData.length = 0
				this.context.oscEscSeen = false
				break

			case ParserAction.OscPut:
				this.context.oscData.push(String.fromCharCode(byte))
				break

			case ParserAction.OscEnd:
				this.emitEvent({
					type: 'osc',
					data: this.context.oscData.join(''),
				})
				break

			case ParserAction.ApcStart:
				this.context.apcData.length = 0
				break

			case ParserAction.ApcPut:
				this.context.apcData.push(String.fromCharCode(byte))
				break

			case ParserAction.ApcEnd:
				this.emitEvent({
					type: 'apc',
					data: this.context.apcData.join(''),
				})
				break
		}
	}

	/** Finish current subparameter and add to currentSubparams array */
	private finishSubparameter(): void {
		if (this.context.currentSubparams.length === 0) {
			// First colon - move main parameter to subparameters
			if (this.context.paramBuffer.length > 0) {
				const value = parseInt(this.context.paramBuffer.join(''), 10)
				this.context.currentSubparams.push(isNaN(value) ? 0 : value)
				this.context.paramBuffer.length = 0
			} else {
				this.context.currentSubparams.push(0)
			}
		} else {
			// Subsequent colon - add subparameter
			if (this.context.subparamBuffer.length > 0) {
				const value = parseInt(this.context.subparamBuffer.join(''), 10)
				this.context.currentSubparams.push(isNaN(value) ? 0 : value)
				this.context.subparamBuffer.length = 0
			} else {
				this.context.currentSubparams.push(0)
			}
		}
	}

	/** Finish current parameter and add to params array */
	private finishParameter(): void {
		if (this.context.currentSubparams.length > 0) {
			// Has subparameters - finish last subparameter
			this.finishSubparameter()

			// Create parameter with subparameters
			const [mainParam, ...subparams] = this.context.currentSubparams
			const param: CsiParam = { value: mainParam ?? 0 }
			if (subparams.length > 0) {
				param.subparams = subparams
			}
			this.context.params.push(param)

			// Reset subparameter state
			this.context.currentSubparams = []
		} else {
			// No subparameters - simple parameter
			if (this.context.paramBuffer.length > 0) {
				const value = parseInt(this.context.paramBuffer.join(''), 10)
				this.context.params.push({ value: isNaN(value) ? 0 : value })
				this.context.paramBuffer.length = 0
			} else {
				// Empty parameter (default value)
				this.context.params.push({ value: 0 })
			}
		}
	}

	/** Add byte to print buffer and try to emit graphemes */
	private addToPrintBuffer(byte: number): void {
		this.context.printBuffer.push(byte)
		this.tryEmitGraphemes()
	}

	/** Try to emit accumulated graphemes at appropriate boundaries */
	private tryEmitAccumulatedGraphemes(): void {
		// Don't flush immediately - let text accumulate
		// Text will be flushed when:
		// 1. We encounter an escape sequence (state transition)
		// 2. flush() is called (end of input)
		// 3. Buffer gets too large (safety mechanism)
		// 4. Short timeout for interactive input (NEW)

		const MAX_TEXT_BUFFER = 1000 // Safety limit
		if (this.context.textBuffer.length > MAX_TEXT_BUFFER) {
			this.flushTextBuffer()
			return
		}

		// For interactive input, flush after a short delay to prevent buffering issues
		// Clear any existing timeout
		if (this.context.flushTimeout) {
			clearTimeout(this.context.flushTimeout)
		}

		// Set a new timeout to flush if no more input arrives
		this.context.flushTimeout = setTimeout(() => {
			if (this.context.textBuffer.length > 0) {
				this.flushTextBuffer()
			}
		}, 1) // 1ms delay - allows proper grapheme assembly while preventing noticeable lag
	}

	/** Try to decode and emit graphemes from print buffer */
	private tryEmitGraphemes(): void {
		if (this.context.printBuffer.length === 0) return

		// Check if we have complete UTF-8 sequences and decode them
		let validBytes = 0
		const buffer = this.context.printBuffer

		for (let i = 0; i < buffer.length; i++) {
			const byte = buffer[i]
			if (byte === undefined) continue

			if (byte < 0x80) {
				// ASCII character - complete
				validBytes = i + 1
			} else if ((byte & 0xe0) === 0xc0) {
				// 2-byte sequence start
				const nextByte = buffer[i + 1]
				if (i + 1 < buffer.length && nextByte !== undefined && (nextByte & 0xc0) === 0x80) {
					validBytes = i + 2
					i++ // Skip the continuation byte
				} else {
					break // Incomplete sequence
				}
			} else if ((byte & 0xf0) === 0xe0) {
				// 3-byte sequence start
				const byte1 = buffer[i + 1]
				const byte2 = buffer[i + 2]
				if (
					i + 2 < buffer.length &&
					byte1 !== undefined &&
					(byte1 & 0xc0) === 0x80 &&
					byte2 !== undefined &&
					(byte2 & 0xc0) === 0x80
				) {
					validBytes = i + 3
					i += 2 // Skip the continuation bytes
				} else {
					break // Incomplete sequence
				}
			} else if ((byte & 0xf8) === 0xf0) {
				// 4-byte sequence start
				const byte1 = buffer[i + 1]
				const byte2 = buffer[i + 2]
				const byte3 = buffer[i + 3]
				if (
					i + 3 < buffer.length &&
					byte1 !== undefined &&
					(byte1 & 0xc0) === 0x80 &&
					byte2 !== undefined &&
					(byte2 & 0xc0) === 0x80 &&
					byte3 !== undefined &&
					(byte3 & 0xc0) === 0x80
				) {
					validBytes = i + 4
					i += 3 // Skip the continuation bytes
				} else {
					break // Incomplete sequence
				}
			} else if ((byte & 0xc0) === 0x80) {
				// This is a continuation byte without a start byte - invalid
				this.emitEvent({
					type: 'print',
					grapheme: '�', // Unicode replacement character
				})
				this.context.printBuffer.splice(0, i + 1)
				this.tryEmitGraphemes() // Try again with remaining bytes
				return
			} else {
				// Invalid UTF-8 start byte - emit as replacement
				this.emitEvent({
					type: 'print',
					grapheme: '�', // Unicode replacement character
				})
				this.context.printBuffer.splice(0, i + 1)
				this.tryEmitGraphemes() // Try again with remaining bytes
				return
			}
		}

		if (validBytes > 0) {
			// We have complete UTF-8 sequences - decode and accumulate them
			const validByteArray = new Uint8Array(buffer.slice(0, validBytes))
			const decoder = new TextDecoder('utf-8', { fatal: false })
			const decoded = decoder.decode(validByteArray)

			// Accumulate decoded text for proper grapheme segmentation
			this.context.textBuffer += decoded

			// Check if we should emit graphemes now
			this.tryEmitAccumulatedGraphemes()

			// Remove the processed bytes from buffer
			this.context.printBuffer.splice(0, validBytes)

			// Try again with any remaining bytes
			if (this.context.printBuffer.length > 0) {
				this.tryEmitGraphemes()
			}
		}
		// If validBytes === 0, we have incomplete sequences, so keep accumulating
	}

	/** Flush any remaining bytes in print buffer */
	private flushPrintBuffer(): void {
		if (this.context.printBuffer.length > 0) {
			// Force decode any remaining bytes as a complete sequence
			const remainingBytes = new Uint8Array(this.context.printBuffer)
			const decoder = new TextDecoder('utf-8', { fatal: false })
			const decoded = decoder.decode(remainingBytes)

			if (decoded.length > 0) {
				// Accumulate with any existing text buffer
				this.context.textBuffer += decoded
			}
		}

		// Reset state
		this.context.printBuffer = []
	}

	/** Flush accumulated text buffer by emitting graphemes */
	private flushTextBuffer(): void {
		// Clear any pending flush timeout
		if (this.context.flushTimeout) {
			clearTimeout(this.context.flushTimeout)
			delete this.context.flushTimeout
		}

		if (this.context.textBuffer.length > 0) {
			const graphemes = splitIntoGraphemes(this.context.textBuffer)
			for (const grapheme of graphemes) {
				this.emitEvent({
					type: 'print',
					grapheme: grapheme,
				})
			}
			this.context.textBuffer = ''
		}
	}

	/** Emit an event to all handlers */
	private emitEvent(event: ParserEvent): void {
		for (const handler of this.eventHandlers) {
			handler(event)
		}
	}

	/** Reset parser to initial state */
	reset(): void {
		this.flushPrintBuffer()
		this.flushTextBuffer()
		this.context = {
			state: ParserState.Ground,
			private: [],
			intermediates: [],
			final: '',
			params: [],
			paramBuffer: [],
			subparamBuffer: [],
			currentSubparams: [],
			oscData: [],
			dcsData: [],
			apcData: [],
			printBuffer: [],
			textBuffer: '',
			oscEscSeen: false,
			apcEscSeen: false,
			dcsEscSeen: false,
		}
	}

	/** Get current parser state (for debugging) */
	getState(): ParserState {
		return this.context.state
	}
}

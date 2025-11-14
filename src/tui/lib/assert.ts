import logger from '../logger.js'

import { emergencyTerminalReset } from './emergency-reset.js'

/**
 * Assert function for TUI debugging.
 * Logs error and exits cleanly in debug mode, otherwise just logs.
 */
export function assert(condition: boolean, ...meta: any[]): asserts condition {
	if (!condition) {
		const message = meta.join(' ')
		const error = new Error(message)

		logger.error('TUI Assert failed', {
			assertion: message,
			stackTrace: error.stack,
			meta,
		})

		// Exit with clean terminal in development, test, or when AMP_DEBUG is set
		const isDevelopment = process.env.NODE_ENV === 'development' || process.env.AMP_DEBUG
		const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST
		if (isDevelopment || isTest) {
			// In test mode, throw the error so tests can catch it with expect().toThrow()
			if (isTest) {
				throw error
			}

			// In development, clean up terminal and exit
			emergencyTerminalReset()
			// eslint-disable-next-line no-console
			console.error('FATAL TUI ERROR:', message)
			// eslint-disable-next-line no-console
			console.error('Stack trace:', error.stack)
			// eslint-disable-next-line no-console
			console.error('Context:', { meta })

			process.exit(1)
		}
	}
}

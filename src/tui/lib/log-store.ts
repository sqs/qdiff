/* eslint-disable no-console */
export interface LogEntry {
	timestamp: Date
	level: 'error' | 'warn' | 'info' | 'debug'
	message: string
	args: unknown[]
}

export type LogChangeListener = (logs: readonly LogEntry[]) => void

/**
 * Singleton log store that captures and stores all console log messages
 * with timestamps for display in the console overlay.
 */
export class LogStore {
	private static instance: LogStore | null = null
	private logs: LogEntry[] = []
	private maxLogs = 1000 // Keep last 1000 logs to prevent memory issues
	private listeners: Set<LogChangeListener> = new Set()

	private constructor() {}

	static getInstance(): LogStore {
		if (!LogStore.instance) {
			LogStore.instance = new LogStore()
		}
		return LogStore.instance
	}

	addLog(level: LogEntry['level'], message: string, ...args: unknown[]): void {
		const entry: LogEntry = {
			timestamp: new Date(),
			level,
			message,
			args,
		}

		this.logs.push(entry)

		// Keep only the most recent logs
		if (this.logs.length > this.maxLogs) {
			this.logs.shift()
		}

		// Notify all listeners of the change
		this.notifyListeners()
	}

	private notifyListeners(): void {
		const logs = this.getLogs()
		for (const listener of this.listeners) {
			try {
				listener(logs)
			} catch (error) {
				// Don't let listener errors break the log store
				// Use the original console.error to avoid recursion
				const originalError = (this as any).originalConsole?.error
				if (originalError) {
					originalError('Error in log change listener:', error)
				}
			}
		}
	}

	getLogs(): readonly LogEntry[] {
		return [...this.logs]
	}

	clear(): void {
		this.logs = []
		this.notifyListeners()
	}

	addListener(listener: LogChangeListener): void {
		this.listeners.add(listener)
	}

	removeListener(listener: LogChangeListener): void {
		this.listeners.delete(listener)
	}

	/**
	 * Replace console methods to capture all console output
	 */
	interceptConsole(): void {
		const originalConsole = {
			error: console.error.bind(console),
			warn: console.warn.bind(console),
			info: console.info.bind(console),
			log: console.log.bind(console),
			debug: console.debug.bind(console),
		}

		console.error = (message: string, ...args: unknown[]) => {
			this.addLog('error', message, ...args)
			// Don't output to actual console - capture only
		}

		console.warn = (message: string, ...args: unknown[]) => {
			this.addLog('warn', message, ...args)
		}

		console.info = (message: string, ...args: unknown[]) => {
			this.addLog('info', message, ...args)
		}

		console.log = (message: string, ...args: unknown[]) => {
			this.addLog('info', message, ...args)
		}

		console.debug = (message: string, ...args: unknown[]) => {
			this.addLog('debug', message, ...args)
		}

		// Store original methods for restoration if needed
		;(this as any).originalConsole = originalConsole
	}

	/**
	 * Restore original console methods
	 */
	restoreConsole(): void {
		const originalConsole = (this as any).originalConsole
		if (originalConsole) {
			console.error = originalConsole.error
			console.warn = originalConsole.warn
			console.info = originalConsole.info
			console.log = originalConsole.log
			console.debug = originalConsole.debug
		}
	}
}

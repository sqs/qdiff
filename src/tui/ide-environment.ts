/**
 * Detects if the CLI is running in a JetBrains terminal
 */
export function isJetBrainsTerminal(): boolean {
	return process.env.TERMINAL_EMULATOR?.includes('JetBrains') ?? false
}

/**
 * Detects if the CLI is running in a VSCode terminal
 */
export function isVSCodeTerminal(): boolean {
	return process.env.TERM_PROGRAM !== undefined && process.env.TERM_PROGRAM === 'vscode'
}

/**
 * Detects if the CLI is running in an integrated Neovim terminal
 */
export function isNeovimTerminal(): boolean {
	return process.env.NVIM !== undefined
}

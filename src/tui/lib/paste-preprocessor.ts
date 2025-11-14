/**
 * Paste text preprocessor for TUI input
 * Normalizes line endings and strips problematic control characters
 */

/**
 * Normalize line endings to Unix format (\n)
 * Handles \r\n (Windows), \r (classic Mac), and \n (Unix) formats
 */
function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n|\r/g, '\n')
}

/**
 * Strip control characters that can break terminal rendering or cause security issues
 * Preserves: \n (newline), \t (tab), all Unicode characters
 * Removes: C0 controls (0x00-0x1F except \n, \t), DEL (0x7F), C1 controls (0x80-0x9F)
 */
function stripControlCharacters(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '')
}

/**
 * Preprocess pasted text for safe terminal input
 * 1. Normalizes line endings to Unix format
 * 2. Strips dangerous control characters (preserves Nerd Font icons in PUA)
 */
export function preprocessPasteText(text: string): string {
	let processed = text

	// Step 1: Normalize line endings
	processed = normalizeLineEndings(processed)

	// Step 2: Strip control characters (but preserve Private Use Area for font icons)
	processed = stripControlCharacters(processed)

	return processed
}

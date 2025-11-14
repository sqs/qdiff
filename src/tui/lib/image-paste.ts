/**
 * Image paste support for extracting images from system clipboard to temporary files
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import logger from '../logger.js'

const execFileAsync = promisify(execFile)

/**
 * Image format information
 */
interface ImageFormat {
	extension: string
	osascriptClass?: string
	mimeType?: string
}

const IMAGE_FORMATS: ImageFormat[] = [
	{ extension: 'png', osascriptClass: '«class PNGf»', mimeType: 'image/png' },
	{ extension: 'jpg', osascriptClass: '«class JPEG»', mimeType: 'image/jpeg' },
	{ extension: 'gif', osascriptClass: '«class GIFf»', mimeType: 'image/gif' },
	{ extension: 'webp', mimeType: 'image/webp' },
]

/**
 * Check if a command exists on the system
 */
async function commandExists(command: string): Promise<boolean> {
	try {
		await execFileAsync('which', [command])
		return true
	} catch {
		return false
	}
}

/**
 * Create a temporary file path for the pasted image
 */
function createTempFilePath(extension: string): string {
	const name = `amp-paste-${randomBytes(8).toString('hex')}.${extension}`
	return join(tmpdir(), name)
}

/**
 * Paste image from clipboard using osascript on macOS
 */
async function pasteImageMacOS(): Promise<string | null> {
	for (const format of IMAGE_FORMATS) {
		if (!format.osascriptClass) continue

		const tempFile = createTempFilePath(format.extension)

		const script = `
			try
				set theImage to the clipboard as ${format.osascriptClass}
				set theFile to open for access POSIX file "${tempFile}" with write permission
				write theImage to theFile
				close access theFile
				return "${tempFile}"
			on error
				return ""
			end try
		`

		try {
			const { stdout } = await execFileAsync('osascript', ['-e', script])
			const result = stdout.trim()

			if (result === tempFile) {
				// Verify the file exists and has content
				const { stat, unlink: unlinkFile } = await import('node:fs/promises')
				try {
					const stats = await stat(tempFile)
					if (stats.size > 0) {
						logger.debug(
							`Successfully pasted image from clipboard (${format.extension})`,
							{ tempFile, size: stats.size },
						)
						return tempFile
					}
					logger.debug(`Skipping empty file for ${format.extension}`)
					await unlinkFile(tempFile)
				} catch {
					logger.debug(`File not created for ${format.extension}`)
				}
			}
		} catch (error) {
			logger.debug(`Failed to paste ${format.extension} image with osascript`, { error })
		}
	}

	return null
}

/**
 * Paste image from clipboard using wl-paste on Wayland
 */
async function pasteImageWayland(): Promise<string | null> {
	for (const format of IMAGE_FORMATS) {
		if (!format.mimeType) continue

		try {
			const { stdout } = await execFileAsync(
				'wl-paste',
				['--type', format.mimeType, '--no-newline'],
				{ encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, timeout: 3000 },
			)

			if (stdout.length > 0) {
				const tempFile = createTempFilePath(format.extension)
				await writeFile(tempFile, stdout)
				logger.debug(`Successfully pasted image from clipboard (${format.extension})`, {
					tempFile,
				})
				return tempFile
			}
		} catch (error) {
			logger.debug(`Failed to paste ${format.extension} image with wl-paste`, { error })
		}
	}

	return null
}

/**
 * Paste image from clipboard using xclip on X11
 */
async function pasteImageX11(): Promise<string | null> {
	for (const format of IMAGE_FORMATS) {
		if (!format.mimeType) continue

		try {
			const { stdout } = await execFileAsync(
				'xclip',
				['-selection', 'clipboard', '-t', format.mimeType, '-o'],
				{ encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, timeout: 3000 },
			)

			if (stdout.length > 0) {
				const tempFile = createTempFilePath(format.extension)
				await writeFile(tempFile, stdout)
				logger.debug(`Successfully pasted image from clipboard (${format.extension})`, {
					tempFile,
				})
				return tempFile
			}
		} catch (error) {
			logger.debug(`Failed to paste ${format.extension} image with xclip`, { error })
		}
	}

	return null
}

/**
 * Paste image from clipboard to a temporary file
 *
 * @returns The path to the temporary file containing the pasted image, or null if no image in clipboard
 * @note The caller is responsible for deleting the temporary file after use
 */
export async function pasteImageFromClipboard(): Promise<string | null> {
	const currentPlatform = platform()

	if (currentPlatform === 'darwin') {
		// macOS: use osascript
		return pasteImageMacOS()
	}

	if (currentPlatform === 'win32') {
		logger.info('Image pasting from clipboard is not yet supported on Windows')
		return null
	}

	// Linux: detect display backend and try appropriate tool first
	const hasWayland = process.env.WAYLAND_DISPLAY && (await commandExists('wl-paste'))
	const hasX11 = process.env.DISPLAY && (await commandExists('xclip'))

	if (hasWayland) {
		const result = await pasteImageWayland()
		if (result !== null) {
			return result
		}
	}

	if (hasX11) {
		const result = await pasteImageX11()
		if (result !== null) {
			return result
		}
	}

	logger.info('No clipboard tools available for image pasting')
	return null
}

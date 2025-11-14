export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}

/**
 * Standard credit rate (1 credit = $0.01 USD)
 * This matches the backend's STANDARD_CREDIT_RATE for individual/team billing.
 *
 * NOTE: This uses the standard rate only. Enterprise billing uses a different rate ($0.015).
 * For CLI purposes, we show costs at the standard rate for simplicity.
 */
const STANDARD_CREDIT_RATE = 0.01

/**
 * Format credits as USD for display using standard billing rate
 * - Values ≥ $0.01: show 2 decimals (e.g., "$1.23" or "$0.12")
 * - Values < $0.01: show 3 decimals (e.g., "$0.003")
 */
export function formatCreditsAsUSD(credits: number | undefined): string {
	if (credits == null || credits === 0) return '$0.00'

	const usd = credits * STANDARD_CREDIT_RATE

	if (usd >= 0.01) return `$${usd.toFixed(2)}`
	return `$${usd.toFixed(3)}`
}

function formatTokenCount(tokens: number): string {
	if (tokens >= 1000000) return `${Math.round(tokens / 1000000)}M`
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
	return tokens.toString()
}

function formatModelName(model: string | undefined): string {
	if (!model) return ''
	const parts = model.split('-')
	if (parts.length >= 2) return parts.slice(0, 2).join('-')
	return model
}

/**
 * Format cost with tokens and model information
 * Examples:
 *   "$0.01 (5 in, 12k cache read, 80 out, sonnet-4)"
 *   "$0.01 (17k in, 80 out, sonnet-4)"
 */
export function formatCostWithDetails(usage: {
	credits?: number
	inputTokens?: number
	cacheCreationInputTokens?: number | null
	cacheReadInputTokens?: number | null
	outputTokens?: number
	model?: string
}): string {
	const cost = usage.credits == null ? 'calculating...' : formatCreditsAsUSD(usage.credits)
	const details: string[] = []

	// Show detailed cache breakdown if caching is used
	const newTokens = (usage.inputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0)
	const cacheRead = usage.cacheReadInputTokens ?? 0

	// Show breakdown: new, cached, cache read
	if (newTokens > 0) {
		details.push(`${formatTokenCount(newTokens)} in`)
	}

	if (cacheRead > 0) {
		details.push(`${formatTokenCount(cacheRead)} cache read`)
	}

	if (usage.outputTokens) details.push(`${formatTokenCount(usage.outputTokens)} out`)
	if (usage.model) details.push(formatModelName(usage.model))

	if (details.length > 0) {
		return `${cost} (${details.join(', ')})`
	}
	return cost
}

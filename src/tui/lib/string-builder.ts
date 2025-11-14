/**
 * StringBuilder utility for efficient string concatenation
 * Avoids O(n²) complexity of repeated string += operations
 */
export class StringBuilder {
	private parts: string[] = []

	/**
	 * Append one or more strings to the builder
	 */
	append(...strings: string[]): void {
		this.parts.push(...strings)
	}

	/**
	 * Build the final string by joining all parts
	 */
	toString(): string {
		return this.parts.join('')
	}

	/**
	 * Reset the builder to empty state
	 */
	reset(): void {
		this.parts.length = 0
	}

	/**
	 * Get the current length (number of parts, not character count)
	 */
	get length(): number {
		return this.parts.length
	}

	/**
	 * Check if the builder is empty
	 */
	get isEmpty(): boolean {
		return this.parts.length === 0
	}
}

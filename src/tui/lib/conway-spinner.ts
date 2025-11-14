/**
 * Conway's Game of Life braille spinner for terminal animations.
 * Simulates the HighLife rule (B36/S23) on an 8-dot braille grid
 * and outputs the pattern as a braille character.
 */
export class ConwaySpinner {
	private state: boolean[] = [true, false, true, false, true, false, true, false]
	private previousState: boolean[] = []
	private generation = 0
	private readonly maxGenerations = 15

	// Conway's Game of Life on 8-dot braille grid (toroidal/wrap-around)
	// Grid layout (2 columns, 4 rows):
	//   Col 0  Col 1
	//   [0]    [4]     Row 0
	//   [1]    [5]     Row 1
	//   [2]    [6]     Row 2
	//   [3]    [7]     Row 3
	// Edges wrap around (toroidal topology)
	private readonly neighborMap = [
		[1, 3, 4, 5, 7], // 0: wraps up to 3, right to 4
		[0, 2, 4, 5, 6], // 1: normal middle position
		[1, 3, 5, 6, 7], // 2: wraps down to 3
		[0, 2, 4, 6, 7], // 3: wraps down to 0, right to 7
		[0, 1, 3, 5, 7], // 4: wraps up to 7, left to 0
		[0, 1, 2, 4, 6], // 5: normal middle position
		[1, 2, 3, 5, 7], // 6: wraps down to 7
		[0, 2, 3, 4, 6], // 7: wraps down to 4, left to 3
	]

	/**
	 * Advance the simulation by one generation using HighLife rules (B36/S23)
	 */
	step(): void {
		const newState = this.state.map((alive, i) => {
			const liveNeighbors = this.neighborMap[i]!.filter((n) => this.state[n]).length
			if (alive) {
				// Survival on 2 or 3 neighbors
				return liveNeighbors === 2 || liveNeighbors === 3
			}
			// Birth on 3 or 6 neighbors
			return liveNeighbors === 3 || liveNeighbors === 6
		})

		// Check if pattern is stable (no change) or oscillating (same as 2 steps ago)
		const isStable = newState.every((cell, i) => cell === this.state[i])
		const isOscillating =
			this.previousState.length > 0 &&
			newState.every((cell, i) => cell === this.previousState[i])

		this.previousState = [...this.state]
		this.state = newState
		this.generation++

		// Reset if stable, oscillating, too long, or everything died
		const allDead = newState.every((c) => !c)
		const liveCount = newState.filter((c) => c).length
		if (
			isStable ||
			isOscillating ||
			this.generation >= this.maxGenerations ||
			allDead ||
			liveCount < 2
		) {
			// Reset with a random pattern with at least 3 cells
			let newPattern: boolean[]
			do {
				newPattern = Array.from({ length: 8 }, () => Math.random() > 0.6)
			} while (newPattern.filter((c) => c).length < 3)
			this.state = newPattern
			this.previousState = []
			this.generation = 0
		}
	}

	/**
	 * Get the current state as a braille character
	 */
	toBraille(): string {
		// Convert state array to braille character
		// Braille dots: 1,2,3,7,4,5,6,8 map to bits: 0,1,2,6,3,4,5,7
		const bitMap = [0, 1, 2, 6, 3, 4, 5, 7]
		let code = 0x2800 // Braille base
		for (let i = 0; i < 8; i++) {
			if (this.state[i]) {
				code |= 1 << bitMap[i]!
			}
		}
		return String.fromCharCode(code)
	}
}

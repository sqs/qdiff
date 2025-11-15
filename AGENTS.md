# QDiff Developer Guide

## Commands
- **Build**: `bun run build` (outputs to `dist/qdiff`)
- **Run**: `bun src/index.ts`
- **Test**: `bun test`

## Architecture
- **Type**: TUI Git client (Magit clone).
- **Entry**: `src/index.ts` bootstraps the TUI.
- **Git**: `src/git.ts` and `src/git-status.ts` handle git operations.
- **TUI**: `src/tui/` contains the UI logic.
  - `src/tui/framework/`: Custom TUI framework implementation.

## Code Style
- **Runtime**: Bun.
- **Language**: TypeScript (ESM).
- **Imports**: Use `.js` extension for local file imports (e.g., `import ... from './file.js'`).
- **Formatting**: Maintain consistency with existing code.
- **Dependencies**: `chalk`, `execa`.

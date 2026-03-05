import { GitStatusViewModel } from './git-status-vm.js';

export interface KeyBindingHelpers {
    quit: () => void;
    scrollPageUp: () => void;
    scrollPageDown: () => void;
    scrollToTop: () => void;
    scrollToBottom: () => void;
}

export interface KeyBinding {
    keys: string[]; // sequence of keys, e.g. ['c', 'c']
    description: string;
    action: (vm: GitStatusViewModel, helpers: KeyBindingHelpers) => void | Promise<void>;
    label: string; // Display string for the keys
    category: string;
}

export class KeyBindingRegistry {
    private bindings: KeyBinding[] = [];

    register(binding: KeyBinding) {
        this.bindings.push(binding);
    }

    getBindings(): KeyBinding[] {
        return this.bindings;
    }

    // Returns possible next keys for a given prefix
    getNextOptions(prefix: string[]): { key: string; binding: KeyBinding }[] {
        const matches: { key: string; binding: KeyBinding }[] = [];
        
        for (const binding of this.bindings) {
            if (binding.keys.length <= prefix.length) continue;

            let match = true;
            for (let i = 0; i < prefix.length; i++) {
                if (binding.keys[i] !== prefix[i]) {
                    match = false;
                    break;
                }
            }

            if (match) {
                // Avoid duplicates
                const key = binding.keys[prefix.length];
                if (!matches.some(m => m.key === key)) {
                    matches.push({
                        key: key,
                        binding: binding
                    });
                }
            }
        }
        
        return matches;
    }

    findMatch(keys: string[]): KeyBinding | null {
        return this.bindings.find(b => 
            b.keys.length === keys.length && 
            b.keys.every((k, i) => k === keys[i])
        ) || null;
    }

    isPrefix(keys: string[]): boolean {
        return this.bindings.some(b => {
            if (b.keys.length <= keys.length) return false;
            return keys.every((k, i) => k === b.keys[i]);
        });
    }
}

export const globalRegistry = new KeyBindingRegistry();

// Register default bindings
export function registerDefaultBindings() {
    globalRegistry.register({
        keys: ['c', 'c'],
        label: 'c c',
        description: 'Commit staged changes',
        category: 'Commit',
        action: (vm) => vm.commit(false)
    });

    globalRegistry.register({
        keys: ['c', '-', 'a', 'c'],
        label: 'c -a c',
        description: 'Commit all changes (including unstaged)',
        category: 'Commit',
        action: (vm) => vm.commit(true)
    });

    globalRegistry.register({
        keys: ['c', 'F'],
        label: 'c F',
        description: 'Instant Fixup',
        category: 'Commit',
        action: async (vm) => {
            vm.isFixupMode = true;
            vm.fixupSelectedIndex = 0;
            await vm.loadRecentCommits();
        }
    });

    globalRegistry.register({
        keys: ['s'],
        label: 's',
        description: 'Stage file/hunk/line',
        category: 'Actions',
        action: (vm) => vm.stageSelection()
    });

    globalRegistry.register({
        keys: ['u'],
        label: 'u',
        description: 'Unstage file/hunk/line',
        category: 'Actions',
        action: (vm) => vm.unstageSelection()
    });

    globalRegistry.register({
        keys: ['k'],
        label: 'k',
        description: 'Discard unstaged changes (kill)',
        category: 'Actions',
        action: (vm) => vm.discardSelection()
    });

    globalRegistry.register({
        keys: ['Tab'],
        label: 'Tab',
        description: 'Toggle expand/collapse',
        category: 'Navigation',
        action: (vm) => vm.toggleExpand()
    });

    globalRegistry.register({
        keys: ['g'],
        label: 'g',
        description: 'Refresh',
        category: 'Actions',
        action: (vm) => vm.refresh()
    });
    
    globalRegistry.register({
        keys: ['ArrowDown'],
        label: '↓',
        description: 'Move selection down',
        category: 'Navigation',
        action: (vm) => vm.moveSelection(1)
    });

    globalRegistry.register({
        keys: ['ArrowUp'],
        label: '↑',
        description: 'Move selection up',
        category: 'Navigation',
        action: (vm) => vm.moveSelection(-1)
    });
    
    globalRegistry.register({
        keys: ['PageUp'],
        label: 'PgUp',
        description: 'Scroll up',
        category: 'Scrolling',
        action: (_, helpers) => helpers.scrollPageUp()
    });

    globalRegistry.register({
        keys: ['PageDown'],
        label: 'PgDn',
        description: 'Scroll down',
        category: 'Scrolling',
        action: (_, helpers) => helpers.scrollPageDown()
    });

    globalRegistry.register({
        keys: ['Cmd+Shift+<'],
        label: 'Cmd+Shift+<',
        description: 'Jump to top',
        category: 'Scrolling',
        action: (_, helpers) => helpers.scrollToTop()
    });

    globalRegistry.register({
        keys: ['Cmd+Shift+>'],
        label: 'Cmd+Shift+>',
        description: 'Jump to bottom',
        category: 'Scrolling',
        action: (_, helpers) => helpers.scrollToBottom()
    });

    globalRegistry.register({
        keys: [' '],
        label: 'Space',
        description: 'Toggle line selection mode',
        category: 'Selection',
        action: (vm) => vm.toggleLineSelectionMode()
    });

    globalRegistry.register({
        keys: ['q'],
        label: 'q',
        description: 'Quit',
        category: 'System',
        action: (_, helpers) => helpers.quit()
    });

    globalRegistry.register({
        keys: ['?'],
        label: '?',
        description: 'Show help',
        category: 'System',
        action: (vm) => { vm.showHelp = !vm.showHelp; }
    });
}

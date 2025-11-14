import { runApp } from './tui/framework/index.js';
import { GitStatusWidget } from './git-status.js';

async function main() {
    try {
        await runApp(new GitStatusWidget());
    } catch (e) {
        console.error('Error in main:', e);
    }
}

main().catch(console.error);

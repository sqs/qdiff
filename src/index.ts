import { runApp } from './tui/framework/index.js';
import { GitStatusWidget } from './git-status.js';

async function main() {
    try {
        await runApp(new GitStatusWidget());
        process.exit(0);
    } catch (e) {
        console.error('Error in main:', e);
        process.exit(1);
    }
}

main().catch(console.error);

import { execa } from 'execa';
import { spawn } from 'node:child_process';
import chalk from 'chalk';

export interface FileEntry {
    path: string;
    status: string;
    staged: boolean;
    key: string;
}

export async function getStatus(): Promise<{ staged: FileEntry[], unstaged: FileEntry[] }> {
    const { stdout } = await execa('git', ['status', '--porcelain', '-u']);
    const lines = stdout.split('\n').filter(Boolean);
    const staged: FileEntry[] = [];
    const unstaged: FileEntry[] = [];

    for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const path = line.slice(3);

        if (x !== ' ' && x !== '?') {
            staged.push({ path, status: x, staged: true, key: `staged:${path}` });
        }
        if (y !== ' ' && y !== '?') {
            unstaged.push({ path, status: y, staged: false, key: `unstaged:${path}` });
        }
        if (x === '?' && y === '?') {
             unstaged.push({ path, status: '?', staged: false, key: `unstaged:${path}` });
        }
    }
    return { staged, unstaged };
}

export async function stageFile(path: string) {
    await execa('git', ['add', path]);
}

export async function unstageFile(path: string) {
    await execa('git', ['restore', '--staged', path]);
}

export async function getDiff(path: string, staged: boolean): Promise<string> {
    const args = ['diff'];
    if (staged) {
        args.push('--cached');
    }
    // For untracked files, normally we can't diff.
    // We'll assume they are not expanded for now or handle error.
    
    args.push(path);
    try {
        const { stdout } = await execa('git', args);
    return processDiff(stdout);
} catch (e) {
    return "Error getting diff (maybe untracked file?)";
}
}

export async function getRawDiff(path: string, staged: boolean, isUntracked: boolean = false): Promise<string> {
    if (isUntracked) {
        try {
             // Use --no-index to compare /dev/null with the new file to generate a creation diff
             const { stdout } = await execa('git', ['diff', '--no-index', '--', '/dev/null', path]);
             return stdout;
        } catch (e: any) {
             // git diff --no-index returns exit code 1 if there are differences, which is expected
             if (e.stdout) return e.stdout;
             console.error('Error getting untracked diff:', e);
             return "";
        }
    }

    const args = ['diff', '--no-color']; // Ensure no color codes for parsing
    if (staged) {
        args.push('--cached');
    }
    args.push(path);
    try {
        const { stdout } = await execa('git', args);
        return stdout;
    } catch (e) {
        console.error('Error getting raw diff:', e);
        return "";
    }
}

export async function applyPatch(patch: string, reverse: boolean = false) {
    const args = ['apply', '--cached'];
    if (reverse) {
        args.push('--reverse');
    }
    // Use input from stdin
    const child = execa('git', args, { input: patch });
    await child;
}

export async function getBranchName(): Promise<string> {
    try {
        const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
        return stdout.trim();
    } catch (e) {
        return 'HEAD';
    }
}

export interface CommitInfo {
    sha: string;
    message: string;
    committer: string;
}

export async function getLastCommit(): Promise<CommitInfo | null> {
    try {
        const { stdout } = await execa('git', ['log', '-1', '--format=%h%n%s%n%cn']);
        const [sha, message, committer] = stdout.split('\n');
        return { sha, message, committer };
    } catch (e) {
        return null;
    }
}

export async function getRecentCommits(limit: number = 25): Promise<CommitInfo[]> {
    try {
        const { stdout } = await execa('git', ['log', `-${limit}`, '--format=%H%n%s%n%cn%n%cr']);
        const lines = stdout.split('\n');
        const commits: CommitInfo[] = [];
        for (let i = 0; i < lines.length; i += 4) {
             const sha = lines[i];
             const message = lines[i+1];
             const committer = lines[i+2];
             // we can add relative date if needed, but interface CommitInfo might need update
             // let's keep it simple for now and match CommitInfo
             if (sha && message) {
                 commits.push({ sha, message, committer });
             }
        }
        return commits;
    } catch (e) {
        return [];
    }
}

export async function fixupCommit(sha: string) {
     await execa('git', ['commit', '--fixup', sha]);
}

export async function commit(all: boolean = false) {
    const args = ['commit'];
    if (all) {
        args.push('-a');
    }
    
    // Use spawn directly with stdio: 'inherit' to ensure proper terminal interaction
    // This mimics how the interactive_shell tool works in Amp CLI
    await new Promise<void>((resolve, reject) => {
        const child = spawn('git', args, {
            stdio: 'inherit'
        });

        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Git commit failed with exit code ${code}`));
            }
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}

function processDiff(diff: string): string {
    const lines = diff.split('\n');
    // Filter out header lines
    const bodyLines = lines.filter(line => {
        return !line.startsWith('diff --git') &&
               !line.startsWith('index ') &&
               !line.startsWith('--- ') &&
               !line.startsWith('+++ ');
    });

    return bodyLines.map(line => {
        if (line.startsWith('@@')) {
            const newLine = line.replace(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/, '@@ -$1 +$2 @@');
            return chalk.cyan(newLine); 
        }
        if (line.startsWith('+')) {
            // Use ANSI 256 color for darker green background (22 is dark green)
            return chalk.bgAnsi256(22)(line);
        }
        if (line.startsWith('-')) {
            // Use ANSI 256 color for darker red background (52 is dark red)
            return chalk.bgAnsi256(52)(line);
        }
        return chalk.dim(line);
    }).join('\n');
}

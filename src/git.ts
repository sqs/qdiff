import { execa } from 'execa';
import chalk from 'chalk';

export interface FileEntry {
    path: string;
    status: string;
    staged: boolean;
    key: string;
}

export async function getStatus(): Promise<{ staged: FileEntry[], unstaged: FileEntry[] }> {
    const { stdout } = await execa('git', ['status', '--porcelain']);
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
    const args = ['diff', '--word-diff=plain'];
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
            return chalk.cyan(line); 
        }
        
        const hasDiff = line.includes('[-') || line.includes('{+');
        if (!hasDiff) {
             return line; 
        }
        
        let parts: { type: 'text' | 'del' | 'add', content: string }[] = [];
        let lastIndex = 0;
        const re = /(?:\[-(.*?)-\])|(?:{\+(.*?)\+})/g;
        let match;
        
        let hasText = false;
        let hasDel = false;
        let hasAdd = false;

        // Helper to check if string is more than just whitespace
        const isContent = (s: string) => s.trim().length > 0;

        while ((match = re.exec(line)) !== null) {
             if (match.index > lastIndex) {
                 const text = line.substring(lastIndex, match.index);
                 parts.push({ type: 'text', content: text });
                 if (isContent(text)) hasText = true;
             }
             
             if (match[1] !== undefined) { // Deletion
                 parts.push({ type: 'del', content: match[1] });
                 hasDel = true;
             } else if (match[2] !== undefined) { // Addition
                 parts.push({ type: 'add', content: match[2] });
                 hasAdd = true;
             }
             
             lastIndex = re.lastIndex;
        }
        
        if (lastIndex < line.length) {
            const text = line.substring(lastIndex);
            parts.push({ type: 'text', content: text });
             if (isContent(text)) hasText = true;
        }
        
        // Determine default color (for 'text' parts)
        // Pure addition: hasAdd && !hasDel && !hasText -> Green
        // Pure deletion: hasDel && !hasAdd && !hasText -> Red
        // Changed: Else -> Yellow
        
        let defaultColor;
        if (hasAdd && !hasDel && !hasText) {
            defaultColor = chalk.green;
        } else if (hasDel && !hasAdd && !hasText) {
            defaultColor = chalk.red;
        } else {
            defaultColor = chalk.yellow;
        }
                             
        return parts.map(part => {
            if (part.type === 'del') return chalk.red(part.content);
            if (part.type === 'add') return chalk.green(part.content);
            return defaultColor(part.content);
        }).join('');
        
    }).join('\n');
}

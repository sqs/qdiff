
export interface DiffLine {
    content: string;
    type: 'context' | 'add' | 'remove' | 'header';
    // Line numbers in the new file (for staging context)
    // We might need more info for creating patch
    originalIndex: number; // Index in the raw diff lines
}

export interface Hunk {
    header: string;
    lines: DiffLine[];
    // Metadata for patch creation
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
}

export interface FileDiff {
    headerLines: string[];
    hunks: Hunk[];
}

export function parseDiff(diff: string): FileDiff {
    const lines = diff.split('\n');
    const hunks: Hunk[] = [];
    const headerLines: string[] = [];
    let currentHunk: Hunk | null = null;
    let inHeader = true;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('@@')) {
            inHeader = false;
            // Parse hunk header
            // @@ -1,5 +1,5 @@
            const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            if (match) {
                if (currentHunk) {
                    hunks.push(currentHunk);
                }
                
                currentHunk = {
                    header: line,
                    lines: [],
                    oldStart: parseInt(match[1], 10),
                    oldLines: match[2] ? parseInt(match[2], 10) : 1,
                    newStart: parseInt(match[3], 10),
                    newLines: match[4] ? parseInt(match[4], 10) : 1,
                };
                continue;
            }
        }

        if (inHeader) {
            headerLines.push(line);
            continue;
        }

        if (currentHunk) {
            if (line.startsWith('+')) {
                currentHunk.lines.push({ content: line, type: 'add', originalIndex: i });
            } else if (line.startsWith('-')) {
                currentHunk.lines.push({ content: line, type: 'remove', originalIndex: i });
            } else if (line.startsWith(' ')) {
                currentHunk.lines.push({ content: line, type: 'context', originalIndex: i });
            } else if (line.startsWith('\\')) {
                 currentHunk.lines.push({ content: line, type: 'context', originalIndex: i });
            }
        }
    }

    if (currentHunk) {
        hunks.push(currentHunk);
    }

    return { headerLines, hunks };
}

export function invertDiff(diff: FileDiff): FileDiff {
    return {
        // Keep file headers unchanged. For discard we only invert tracked-file hunks,
        // and preserving headers avoids malformed ---/+++ ordering.
        headerLines: [...diff.headerLines],
        hunks: diff.hunks.map(hunk => ({
            header: `@@ -${hunk.newStart},${hunk.newLines} +${hunk.oldStart},${hunk.oldLines} @@`,
            lines: hunk.lines.map(line => {
                if (line.type === 'add') {
                    return {
                        ...line,
                        type: 'remove' as const,
                        content: '-' + line.content.substring(1)
                    };
                }

                if (line.type === 'remove') {
                    return {
                        ...line,
                        type: 'add' as const,
                        content: '+' + line.content.substring(1)
                    };
                }

                return { ...line };
            }),
            oldStart: hunk.newStart,
            oldLines: hunk.newLines,
            newStart: hunk.oldStart,
            newLines: hunk.oldLines,
        }))
    };
}

export function generatePatch(diff: FileDiff, selectedHunks: Set<number>, selectedLines: Set<string>): string {
    // selectedHunks: Set of indices of hunks that are FULLY selected
    // selectedLines: Set of "hunkIndex:lineIndex" strings for partially selected hunks

    let patch = diff.headerLines.join('\n') + '\n';

    diff.hunks.forEach((hunk, hunkIndex) => {
        const isHunkSelected = selectedHunks.has(hunkIndex);
        const hunkHasSelectedLines = diff.hunks[hunkIndex].lines.some((_, lineIndex) => 
            selectedLines.has(`${hunkIndex}:${lineIndex}`)
        );

        if (!isHunkSelected && !hunkHasSelectedLines) {
            return;
        }

        if (isHunkSelected) {
            // Include hunk as is
            patch += hunk.header + '\n';
            hunk.lines.forEach(line => {
                patch += line.content + '\n';
            });
            return;
        }

        // Partial hunk
        const newLines: string[] = [];
        let currentOldLines = hunk.oldLines;
        let currentNewLines = hunk.newLines;

        // We need to recalculate the header
        // Iterate lines and decide whether to keep, drop, or convert
        const processedLines: string[] = [];
        
        let processedOldLines = 0;
        let processedNewLines = 0;

        hunk.lines.forEach((line, lineIndex) => {
            const isSelected = selectedLines.has(`${hunkIndex}:${lineIndex}`);
            
            if (line.type === 'context') {
                processedLines.push(line.content);
                processedOldLines++;
                processedNewLines++;
            } else if (line.type === 'add') {
                if (isSelected) {
                    processedLines.push(line.content);
                    processedNewLines++;
                } else {
                    // Drop it
                    // Doesn't affect old lines
                    // Decrements new lines count (relative to original hunk)
                }
            } else if (line.type === 'remove') {
                if (isSelected) {
                    processedLines.push(line.content);
                    processedOldLines++;
                } else {
                    // Convert to context
                    const contextContent = ' ' + line.content.substring(1);
                    processedLines.push(contextContent);
                    processedOldLines++;
                    processedNewLines++;
                }
            }
        });

        // Reconstruct header
        // @@ -oldStart,processedOldLines +newStart,processedNewLines @@
        const newHeader = `@@ -${hunk.oldStart},${processedOldLines} +${hunk.newStart},${processedNewLines} @@`;
        
        patch += newHeader + '\n';
        patch += processedLines.join('\n') + '\n';
    });

    return patch;
}

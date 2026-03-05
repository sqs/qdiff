import { appendFile, readFile } from 'node:fs/promises';
import { execa } from 'execa';
import { DiffLine, FileDiff, generatePatch, Hunk, parseDiff } from './diff-parser.js';
import type { CommitInfo, FileEntry } from './git.js';

export interface DiffStat {
    added: number;
    modified: number;
    removed: number;
}

export interface GitAdapter {
    getStatus(): Promise<{ staged: FileEntry[], unstaged: FileEntry[], untracked: FileEntry[] }>;
    getBranchName(): Promise<string>;
    getLastCommit(): Promise<CommitInfo | null>;
    getRecentCommits(limit: number): Promise<CommitInfo[]>;
    getRawDiff(path: string, staged: boolean, isUntracked?: boolean): Promise<string>;
    stageFile(path: string): Promise<void>;
    unstageFile(path: string): Promise<void>;
    discardFile(path: string): Promise<void>;
    applyPatch(patch: string, reverse: boolean, index: boolean): Promise<void>;
    commit(all: boolean): Promise<void>;
    fixupCommit(sha: string): Promise<void>;
}

export interface VisibleItem {
    id: string;
    type: 'header' | 'file' | 'hunk' | 'line' | 'message';
    text?: string;
    entry?: FileEntry;
    hunkIndex?: number;
    lineIndex?: number;
    hunk?: Hunk;
    line?: DiffLine;
    selectable: boolean;
}

export class GitStatusViewModel {
    public items: VisibleItem[] = [];
    public staged: FileEntry[] = [];
    public unstaged: FileEntry[] = [];
    public untracked: FileEntry[] = [];
    public branchName: string = '';
    public lastCommit: CommitInfo | null = null;
    public selectedIndex = 0;
    public expandedFiles = new Set<string>(); 
    public diffCache = new Map<string, FileDiff>();
    public diffStats = new Map<string, DiffStat>();
    public diffStatWidth = 0;
    public loading = false;
    
    public lineSelectionMode = false;
    public selectionAnchor = -1;

    public recentCommits: CommitInfo[] = [];
    public isFixupMode = false;
    public fixupSelectedIndex = 0;
    public showHelp = false;
    public errorMessage: string | null = null;
    private errorTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private git: GitAdapter, private onStateChange: () => void) {}

    setError(e: unknown) {
        let message = 'Unknown error';
        if (e instanceof Error) {
            // execa errors have `stderr` property with the git error message
            const stderr = (e as any).stderr;
            if (typeof stderr === 'string' && stderr.trim()) {
                message = stderr.trim().split('\n')[0];
            } else {
                message = e.message;
            }
        }
        this.errorMessage = message;
        if (this.errorTimer) clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => {
            this.errorMessage = null;
            this.notify();
        }, 5000);
        this.notify();
    }

    clearError() {
        this.errorMessage = null;
        if (this.errorTimer) {
            clearTimeout(this.errorTimer);
            this.errorTimer = null;
        }
    }

    private notify() {
        this.onStateChange();
    }

    updateItems() {
        const items: VisibleItem[] = [];

        const PADDED_MESSAGE_PREFIX='\n  '

        if (this.untracked.length > 0) {
            items.push({ id: 'header-untracked', type: 'header', text: `Untracked Files (${this.untracked.length})`, selectable: true });
            this.untracked.forEach(entry => this.addFileItems(items, entry));
        }

        if (this.unstaged.length > 0) {
            items.push({ id: 'header-unstaged', type: 'header', text: `Unstaged Changes (${this.unstaged.length})`, selectable: true });
            this.unstaged.forEach(entry => this.addFileItems(items, entry));
        }

        if (this.staged.length > 0) {
            items.push({ id: 'header-staged', type: 'header', text: `Staged Changes (${this.staged.length})`, selectable: true });
            this.staged.forEach(entry => this.addFileItems(items, entry));
        }

        if (this.loading) items.push({ id: 'loading', type: 'message', text: PADDED_MESSAGE_PREFIX+'Loading...', selectable: false });

        if (!this.loading && this.untracked.length === 0 && this.unstaged.length === 0 && this.staged.length === 0) {
            items.push({id:'header-empty', type:'message',text:PADDED_MESSAGE_PREFIX+'No Changes',selectable:false})
        }
        
        this.items = items;
    }

    private addFileItems(items: VisibleItem[], entry: FileEntry) {
        items.push({ id: entry.key, type: 'file', entry, selectable: true });
        
        if (this.expandedFiles.has(entry.key)) {
            const diff = this.diffCache.get(entry.key);
            if (!diff) {
                items.push({ id: `${entry.key}-loading`, type: 'message', text: 'Loading diff...', selectable: false });
            } else {
                diff.hunks.forEach((hunk, hIndex) => {
                    items.push({ 
                        id: `${entry.key}-hunk-${hIndex}`, 
                        type: 'hunk', 
                        entry, 
                        hunkIndex: hIndex, 
                        hunk, 
                        selectable: true,
                        text: hunk.header 
                    });
                    
                    hunk.lines.forEach((line, lIndex) => {
                        items.push({
                            id: `${entry.key}-hunk-${hIndex}-line-${lIndex}`,
                            type: 'line',
                            entry,
                            hunkIndex: hIndex,
                            lineIndex: lIndex,
                            line,
                            selectable: true
                        });
                    });
                });
            }
        }
    }

    private calculateDiffStat(diff: FileDiff): DiffStat {
        let additions = 0;
        let removals = 0;

        for (const hunk of diff.hunks) {
            for (const line of hunk.lines) {
                if (line.type === 'add') additions++;
                if (line.type === 'remove') removals++;
            }
        }

        const modified = Math.min(additions, removals);
        return {
            added: additions - modified,
            modified,
            removed: removals - modified,
        };
    }

    private formatDiffStat(diffStat: DiffStat): string {
        return `+${diffStat.added}/~${diffStat.modified}/-${diffStat.removed}`;
    }

    async refresh() {
        // Save current selection ID to restore later
        let selectedId: string | undefined;
        let selectedHunkId: string | undefined;
        let selectedFileId: string | undefined;
        let previousHunkIndex: number | undefined;
        
        if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
            const item = this.items[this.selectedIndex];
            selectedId = item.id;
            if (item.entry) selectedFileId = item.entry.key;
            if (item.entry && item.hunkIndex !== undefined) {
                selectedHunkId = `${item.entry.key}-hunk-${item.hunkIndex}`;
                previousHunkIndex = item.hunkIndex;
            }
        }

        this.loading = true;
        this.updateItems();
        this.notify();
        
        try {
            const [status, branchName, lastCommit] = await Promise.all([
                this.git.getStatus(),
                this.git.getBranchName(),
                this.git.getLastCommit()
            ]);
            this.staged = status.staged;
            this.unstaged = status.unstaged;
            this.untracked = status.untracked;
            this.branchName = branchName;
            this.lastCommit = lastCommit;
            
            // Refresh diffs and keep cached entries in sync.
            const allEntries = [...this.staged, ...this.unstaged, ...this.untracked];
            const validKeys = new Set(allEntries.map(e => e.key));
            
            // Clean up expandedFiles
            for (const key of this.expandedFiles) {
                if (!validKeys.has(key)) {
                    this.expandedFiles.delete(key);
                    this.diffCache.delete(key);
                }
            }

            // Clean up stale cached diffs for files no longer in status.
            for (const key of this.diffCache.keys()) {
                if (!validKeys.has(key)) {
                    this.diffCache.delete(key);
                }
            }

            const promises = allEntries.map(async entry => {
                    try {
                        const rawDiff = await this.git.getRawDiff(entry.path, entry.staged, entry.status === '?');
                        const parsed = parseDiff(rawDiff);
                        return { key: entry.key, diff: parsed, loadFailed: false, entry };
                    } catch (e) {
                        // Return empty diff on error
                        return { key: entry.key, diff: { headerLines: [], hunks: [] } as FileDiff, loadFailed: true, entry };
                    }
                });
            
            const results = await Promise.all(promises);
            
            this.diffStats.clear();
            for (const { key, diff, loadFailed, entry } of results) {
                let stat = this.calculateDiffStat(diff);
                if (entry.status === '?' && stat.added === 0 && stat.modified === 0 && stat.removed === 0) {
                    try {
                        const content = await readFile(entry.path, 'utf-8');
                        const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
                        stat = { added: lineCount, modified: 0, removed: 0 };
                    } catch {}
                }
                if (entry.status === 'D' && stat.added === 0 && stat.modified === 0 && stat.removed === 0) {
                    try {
                        const ref = entry.staged ? 'HEAD' : '';
                        const { stdout } = await execa('git', ['show', `${ref}:${entry.path}`]);
                        const lineCount = stdout.split('\n').length - (stdout.endsWith('\n') ? 1 : 0);
                        stat = { added: 0, modified: 0, removed: lineCount };
                    } catch {}
                }
                this.diffStats.set(key, stat);
                // If a file already has cached diff content, refresh it even when collapsed.
                // Otherwise expanding after a refresh can still render stale hunks.
                if (this.expandedFiles.has(key) || this.diffCache.has(key) || loadFailed) {
                    this.diffCache.set(key, diff);
                }
            }

            this.diffStatWidth = 0;
            for (const entry of allEntries) {
                const diffStat = this.diffStats.get(entry.key);
                if (!diffStat) continue;

                const textLength = this.formatDiffStat(diffStat).length;
                if (textLength > this.diffStatWidth) {
                    this.diffStatWidth = textLength;
                }
            }
            
            this.updateItems();
            
            // Restore selection
            let newIndex = -1;
            
            if (selectedId) {
                // 1. Try exact match
                newIndex = this.items.findIndex(item => item.id === selectedId);
                
                // 2. If not found, try finding the hunk (if we were in a hunk/line)
                if (newIndex === -1 && selectedHunkId) {
                    newIndex = this.items.findIndex(item => 
                        item.id === selectedHunkId || 
                        (item.type === 'line' && item.entry?.key === selectedFileId && `${item.entry?.key}-hunk-${item.hunkIndex}` === selectedHunkId)
                    );
                }
                
                // 3. If not found, try finding the closest hunk in the same file
                if (newIndex === -1 && selectedFileId && previousHunkIndex !== undefined) {
                    // Find all hunks for this file
                    const fileHunks = this.items
                        .map((item, index) => ({ item, index }))
                        .filter(({ item }) => 
                            item.entry?.key === selectedFileId && 
                            item.type === 'hunk' && 
                            item.hunkIndex !== undefined
                        );
                    
                    if (fileHunks.length > 0) {
                        // Find the hunk with the largest index <= previousHunkIndex
                        let bestMatch = fileHunks[0];
                        for (const h of fileHunks) {
                             if (h.item.hunkIndex! <= previousHunkIndex) {
                                 bestMatch = h;
                             } else {
                                 break; // Hunks are sorted, so we can stop
                             }
                        }
                        newIndex = bestMatch.index;
                    }
                }

                // 4. If not found, try finding the file
                if (newIndex === -1 && selectedFileId) {
                    newIndex = this.items.findIndex(item => item.entry?.key === selectedFileId);
                }
            }
            
            if (newIndex !== -1) {
                this.selectedIndex = newIndex;
            } else {
                 // Fallback to clamping if we completely lost context
                 if (this.selectedIndex >= this.items.length) {
                    this.selectedIndex = Math.max(0, this.items.length - 1);
                 }

                 // If the item at the current index is not selectable (e.g. we landed on a header),
                 // try to find a selectable item nearby.
                 if (this.items.length > 0 && !this.items[this.selectedIndex].selectable) {
                     let foundIndex = -1;
                     
                     // Try searching backwards first (likely we are at the end or a section shrank)
                     for (let i = this.selectedIndex - 1; i >= 0; i--) {
                         if (this.items[i].selectable) {
                             foundIndex = i;
                             break;
                         }
                     }
                     
                     // If not found backwards, try forwards
                     if (foundIndex === -1) {
                         for (let i = this.selectedIndex + 1; i < this.items.length; i++) {
                             if (this.items[i].selectable) {
                                 foundIndex = i;
                                 break;
                             }
                         }
                     }
                     
                     if (foundIndex !== -1) {
                         this.selectedIndex = foundIndex;
                     }
                 }
            }
            
        } catch (e) {
            this.setError(e);
        } finally {
            this.loading = false;
            this.updateItems();
            this.notify();
        }
    }

    moveSelection(delta: number) {
        if (delta === 0) return;
        
        if (delta > 0) {
            let nextIndex = this.selectedIndex + 1;
            while (nextIndex < this.items.length && !this.items[nextIndex].selectable) {
                nextIndex++;
            }
            if (nextIndex < this.items.length) {
                this.selectedIndex = nextIndex;
                if (!this.lineSelectionMode) {
                    this.selectionAnchor = nextIndex;
                }
                this.notify();
            }
        } else {
            let prevIndex = this.selectedIndex - 1;
            while (prevIndex >= 0 && !this.items[prevIndex].selectable) {
                prevIndex--;
            }
            if (prevIndex >= 0) {
                this.selectedIndex = prevIndex;
                if (!this.lineSelectionMode) {
                    this.selectionAnchor = prevIndex;
                }
                this.notify();
            }
        }
    }

    moveSelectionBy(delta: number) {
        if (delta === 0 || this.items.length === 0) return;

        const direction = delta > 0 ? 1 : -1;
        let remaining = Math.abs(delta);
        let candidateIndex = this.selectedIndex;
        let lastValidIndex = this.selectedIndex;

        while (remaining > 0) {
            candidateIndex += direction;

            while (
                candidateIndex >= 0 &&
                candidateIndex < this.items.length &&
                !this.items[candidateIndex].selectable
            ) {
                candidateIndex += direction;
            }

            if (candidateIndex < 0 || candidateIndex >= this.items.length) {
                break;
            }

            lastValidIndex = candidateIndex;
            remaining--;
        }

        if (lastValidIndex === this.selectedIndex) {
            return;
        }

        this.selectedIndex = lastValidIndex;
        if (!this.lineSelectionMode) {
            this.selectionAnchor = lastValidIndex;
        }
        this.notify();
    }

    moveSelectionToTop() {
        const topSelectableIndex = this.items.findIndex((item) => item.selectable);
        if (topSelectableIndex === -1 || topSelectableIndex === this.selectedIndex) {
            return;
        }

        this.selectedIndex = topSelectableIndex;
        if (!this.lineSelectionMode) {
            this.selectionAnchor = topSelectableIndex;
        }
        this.notify();
    }

    moveSelectionToBottom() {
        let bottomSelectableIndex = -1;
        for (let i = this.items.length - 1; i >= 0; i--) {
            if (this.items[i].selectable) {
                bottomSelectableIndex = i;
                break;
            }
        }

        if (bottomSelectableIndex === -1 || bottomSelectableIndex === this.selectedIndex) {
            return;
        }

        this.selectedIndex = bottomSelectableIndex;
        if (!this.lineSelectionMode) {
            this.selectionAnchor = bottomSelectableIndex;
        }
        this.notify();
    }

    toggleLineSelectionMode() {
        this.lineSelectionMode = !this.lineSelectionMode;
        if (this.lineSelectionMode) {
            this.selectionAnchor = this.selectedIndex;
        } else {
            this.selectionAnchor = -1;
        }
        this.notify();
    }

    async stageSelection() {
        await this.processSelection(true);
    }
    
    async unstageSelection() {
        await this.processSelection(false);
    }

    async discardSelection() {
        // Identify selected items
        let start = this.selectedIndex;
        let end = this.selectedIndex;
        
        if (this.lineSelectionMode && this.selectionAnchor !== -1) {
            start = Math.min(this.selectedIndex, this.selectionAnchor);
            end = Math.max(this.selectedIndex, this.selectionAnchor);
        }
        
        const selectedItems = this.items.slice(start, end + 1).filter(i => i.selectable);
        if (selectedItems.length === 0) return;

        const filesToProcess = new Map<string, { 
            entry: FileEntry, 
            fullFile: boolean,
            hunks: Set<number>, 
            lines: Set<string> 
        }>();

        // First pass: group by file
        for (const item of selectedItems) {
            if (!item.entry) continue;
            
            let fileData = filesToProcess.get(item.entry.key);
            if (!fileData) {
                fileData = { 
                    entry: item.entry, 
                    fullFile: false, 
                    hunks: new Set(), 
                    lines: new Set() 
                };
                filesToProcess.set(item.entry.key, fileData);
            }

            if (item.type === 'file') {
                fileData.fullFile = true;
            } else if (item.type === 'hunk') {
                if (item.hunkIndex !== undefined) fileData.hunks.add(item.hunkIndex);
            } else if (item.type === 'line') {
                // If not in selection mode, line implies hunk
                if (!this.lineSelectionMode) {
                    if (item.hunkIndex !== undefined) fileData.hunks.add(item.hunkIndex);
                } else {
                    if (item.hunkIndex !== undefined && item.lineIndex !== undefined) {
                        fileData.lines.add(`${item.hunkIndex}:${item.lineIndex}`);
                    }
                }
            }
        }

        this.loading = true;
        this.notify();
        
        try {
            for (const [key, data] of filesToProcess) {
                // Only allow killing unstaged changes
                if (data.entry.staged) continue;

                // Log killed diffs
                let diffToKill = '';
                if (data.fullFile) {
                     // Get full diff for file
                     diffToKill = await this.git.getRawDiff(data.entry.path, false, data.entry.status === '?');
                } else {
                    const diff = this.diffCache.get(key);
                    if (diff) {
                        diffToKill = generatePatch(diff, data.hunks, data.lines);
                    }
                }

                if (diffToKill) {
                    await appendFile('/tmp/qdiff-killed.log', `--- Killed at ${new Date().toISOString()} ---\n${diffToKill}\n`);
                }
                
                if (data.fullFile) {
                    await this.git.discardFile(data.entry.path);
                } else {
                    const diff = this.diffCache.get(key);
                    if (diff) {
                        const patch = generatePatch(diff, data.hunks, data.lines);
                        // reverse=true to revert, index=false to apply to working directory
                        await this.git.applyPatch(patch, true, false); 
                    }
                }
            }
        } catch (e) {
            this.setError(e);
        } finally {
             // Determine the next item to select after refresh.
            // We want to select the next item after the current selection range
            // so that the cursor advances to the next actionable item.
            let nextSelectableIndex = -1;
            
            // Try to find next selectable item
            for (let i = end + 1; i < this.items.length; i++) {
                if (this.items[i].selectable) {
                    nextSelectableIndex = i;
                    break;
                }
            }
            
            // If not found (e.g. at end of list), try previous
            if (nextSelectableIndex === -1) {
                for (let i = start - 1; i >= 0; i--) {
                    if (this.items[i].selectable) {
                        nextSelectableIndex = i;
                        break;
                    }
                }
            }

            if (nextSelectableIndex !== -1) {
                this.selectedIndex = nextSelectableIndex;
            }

            this.lineSelectionMode = false;
            this.selectionAnchor = -1;
            await this.refresh();
        }
    }

    private async processSelection(stage: boolean) {
        // Identify selected items
        let start = this.selectedIndex;
        let end = this.selectedIndex;
        
        if (this.lineSelectionMode && this.selectionAnchor !== -1) {
            start = Math.min(this.selectedIndex, this.selectionAnchor);
            end = Math.max(this.selectedIndex, this.selectionAnchor);
        }
        
        const selectedItems = this.items.slice(start, end + 1).filter(i => i.selectable);
        if (selectedItems.length === 0) return;

        const filesToProcess = new Map<string, { 
            entry: FileEntry, 
            fullFile: boolean,
            hunks: Set<number>, 
            lines: Set<string> 
        }>();

        // First pass: group by file
        for (const item of selectedItems) {
            if (!item.entry) continue;
            
            let fileData = filesToProcess.get(item.entry.key);
            if (!fileData) {
                fileData = { 
                    entry: item.entry, 
                    fullFile: false, 
                    hunks: new Set(), 
                    lines: new Set() 
                };
                filesToProcess.set(item.entry.key, fileData);
            }

            if (item.type === 'file') {
                fileData.fullFile = true;
            } else if (item.type === 'hunk') {
                if (item.hunkIndex !== undefined) fileData.hunks.add(item.hunkIndex);
            } else if (item.type === 'line') {
                // If not in selection mode, line implies hunk
                if (!this.lineSelectionMode) {
                    if (item.hunkIndex !== undefined) fileData.hunks.add(item.hunkIndex);
                } else {
                    if (item.hunkIndex !== undefined && item.lineIndex !== undefined) {
                        fileData.lines.add(`${item.hunkIndex}:${item.lineIndex}`);
                    }
                }
            }
        }

        this.loading = true;
        this.notify();
        
        try {
            for (const [key, data] of filesToProcess) {
                // Check if operation is valid for file state
                if (stage && data.entry.staged) continue; // Already staged
                if (!stage && !data.entry.staged) continue; // Already unstaged
                
                if (data.fullFile) {
                    if (stage) await this.git.stageFile(data.entry.path);
                    else await this.git.unstageFile(data.entry.path);
                } else {
                    // Partial stage
                    const diff = this.diffCache.get(key);
                    if (diff) {
                        const patch = generatePatch(diff, data.hunks, data.lines);
                        await this.git.applyPatch(patch, !stage, true); // reverse if unstaging, index=true
                    }
                }
            }
        } catch (e) {
            this.setError(e);
        } finally {
            this.lineSelectionMode = false;
            this.selectionAnchor = -1;
            await this.refresh();
        }
    }

    async toggleExpand(targetEntry?: FileEntry) {
        let entry = targetEntry;
        if (!entry) {
            const item = this.items[this.selectedIndex];
            if (item && item.entry) {
                entry = item.entry;
            }
        }
        
        if (!entry) return;

        if (this.expandedFiles.has(entry.key)) {
            this.expandedFiles.delete(entry!.key);
            this.updateItems();
            this.notify();
        } else {
            if (!this.diffCache.has(entry.key)) {
                try {
                    const rawDiff = await this.git.getRawDiff(entry.path, entry.staged, entry.status === '?');
                    const parsed = parseDiff(rawDiff);
                    this.diffCache.set(entry.key, parsed);
                } catch (e) {
                    // Ignore
                }
            }
            this.expandedFiles.add(entry!.key);
            this.updateItems();
            this.notify();
        }
    }
    
    formatLastCommit(): string {
        if (!this.lastCommit) return '';
        const { sha, message, committer } = this.lastCommit;
        const shortSha = sha.substring(0, 6);
        const fullStr = `${shortSha} ${message} ${committer}`;
        
        if (fullStr.length > 80) {
            return fullStr.substring(0, 77) + '...';
        }
        return fullStr;
    }

    async commit(all: boolean) {
        this.loading = true;
        this.notify();
        try {
            await this.git.commit(all);
            await this.refresh();
        } catch (e) {
            this.setError(e);
        } finally {
            this.loading = false;
            this.notify();
        }
    }

    async loadRecentCommits() {
        this.loading = true;
        this.notify();
        try {
            this.recentCommits = await this.git.getRecentCommits(25);
        } catch (e) {
            this.setError(e);
        } finally {
            this.loading = false;
            this.notify();
        }
    }

    async fixup(sha: string) {
        this.loading = true;
        this.notify();
        try {
            await this.git.fixupCommit(sha);
            await this.refresh();
        } catch (e) {
            this.setError(e);
        } finally {
            this.loading = false;
            this.notify();
        }
    }
}

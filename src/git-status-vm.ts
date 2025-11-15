import type { FileEntry, CommitInfo } from './git.js';
import { parseDiff, generatePatch, FileDiff, Hunk, DiffLine } from './diff-parser.js';

export interface GitAdapter {
    getStatus(): Promise<{ staged: FileEntry[], unstaged: FileEntry[] }>;
    getBranchName(): Promise<string>;
    getLastCommit(): Promise<CommitInfo | null>;
    getRawDiff(path: string, staged: boolean, isUntracked?: boolean): Promise<string>;
    stageFile(path: string): Promise<void>;
    unstageFile(path: string): Promise<void>;
    applyPatch(patch: string, reverse: boolean): Promise<void>;
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
    public branchName: string = '';
    public lastCommit: CommitInfo | null = null;
    public selectedIndex = 0;
    public expandedFiles = new Set<string>(); 
    public diffCache = new Map<string, FileDiff>();
    public loading = false;
    
    public lineSelectionMode = false;
    public selectionAnchor = -1;

    constructor(private git: GitAdapter, private onStateChange: () => void) {}

    private notify() {
        this.onStateChange();
    }

    updateItems() {
        const items: VisibleItem[] = [];
        
        items.push({ id: 'header-staged', type: 'header', text: 'Staged Changes', selectable: false });
        this.staged.forEach(entry => this.addFileItems(items, entry));
        
        items.push({ id: 'header-unstaged', type: 'header', text: 'Unstaged Changes', selectable: false });
        this.unstaged.forEach(entry => this.addFileItems(items, entry));
        
        if (this.loading) items.push({ id: 'loading', type: 'message', text: 'Loading...', selectable: false });
        
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
            this.branchName = branchName;
            this.lastCommit = lastCommit;
            
            // Refresh diffs for expanded files
            const allEntries = [...this.staged, ...this.unstaged];
            const validKeys = new Set(allEntries.map(e => e.key));
            
            // Clean up expandedFiles
            for (const key of this.expandedFiles) {
                if (!validKeys.has(key)) {
                    this.expandedFiles.delete(key);
                    this.diffCache.delete(key);
                }
            }

            const promises = allEntries
                .filter(entry => this.expandedFiles.has(entry.key))
                .map(async entry => {
                    try {
                        const rawDiff = await this.git.getRawDiff(entry.path, entry.staged, entry.status === '?');
                        const parsed = parseDiff(rawDiff);
                        return { key: entry.key, diff: parsed };
                    } catch (e) {
                         // Return empty diff on error
                        return { key: entry.key, diff: { headerLines: [], hunks: [] } as FileDiff };
                    }
                });
            
            const results = await Promise.all(promises);
            
            for (const { key, diff } of results) {
                this.diffCache.set(key, diff);
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
            console.error(e);
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
                        await this.git.applyPatch(patch, !stage); // reverse if unstaging
                    }
                }
            }
        } catch (e) {
            console.error(e);
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
}

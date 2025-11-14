import {
    StatefulWidget,
    State,
    Widget,
    Column,
    TextSpan,
    RichText,
    TextStyle,
    Focus,
    FocusNode,
    KeyEventResult,
    SingleChildScrollView,
    AnsiText,
    SizedBox,
    Container,
    BoxDecoration,
    Colors,
    EdgeInsets,
    CrossAxisAlignment,
    ScrollController,
    Scrollbar,
    GlobalKey,
    WidgetsBinding,
    BuildContextImpl,
    RenderBox,
    MouseRegion,
    Expanded,
} from './tui/framework/index.js';
import { ensureVisible } from './tui/framework/scrolling/ensure-visible.js';
import type { KeyboardEvent } from './tui/lib/parser/types.js';
import * as git from './git.js';
import { parseDiff, generatePatch, FileDiff, Hunk, DiffLine } from './diff-parser.js';

interface VisibleItem {
    id: string;
    type: 'header' | 'file' | 'hunk' | 'line' | 'message';
    text?: string;
    entry?: git.FileEntry;
    hunkIndex?: number;
    lineIndex?: number;
    hunk?: Hunk;
    line?: DiffLine;
    selectable: boolean;
}

class GitStatusWidget extends StatefulWidget {
    // @ts-ignore
    createState(): State<GitStatusWidget> {
        return new GitStatusState();
    }
}

class GitStatusState extends State<GitStatusWidget> {
    private staged: git.FileEntry[] = [];
    private unstaged: git.FileEntry[] = [];
    private branchName: string = '';
    private lastCommit: git.CommitInfo | null = null;
    private selectedIndex = 0;
    private expandedFiles = new Set<string>(); 
    private diffCache = new Map<string, FileDiff>();
    private focusNode = new FocusNode();
    private scrollController = new ScrollController();
    private selectedItemKey = new GlobalKey();
    private loading = false;
    
    private items: VisibleItem[] = [];
    private lineSelectionMode = false;
    private selectionAnchor = -1;

    initState() {
        this.scrollController.followMode = false;
        this.refresh();
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

    addFileItems(items: VisibleItem[], entry: git.FileEntry) {
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
        
        if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
            const item = this.items[this.selectedIndex];
            selectedId = item.id;
            if (item.entry) selectedFileId = item.entry.key;
            if (item.entry && item.hunkIndex !== undefined) {
                selectedHunkId = `${item.entry.key}-hunk-${item.hunkIndex}`;
            }
        }

        this.loading = true;
        this.updateItems();
        this.setState(() => {});
        
        try {
            const [status, branchName, lastCommit] = await Promise.all([
                git.getStatus(),
                git.getBranchName(),
                git.getLastCommit()
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
                        const rawDiff = await git.getRawDiff(entry.path, entry.staged);
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
                
                // 3. If not found, try finding the file
                if (newIndex === -1 && selectedFileId) {
                    newIndex = this.items.findIndex(item => item.entry?.key === selectedFileId);
                }
            }
            
            if (newIndex !== -1) {
                this.selectedIndex = newIndex;
                // Ensure we scroll to the new position
                this.scrollToSelected();
            } else {
                 // Fallback to clamping if we completely lost context
                 if (this.selectedIndex >= this.items.length) {
                    this.selectedIndex = Math.max(0, this.items.length - 1);
                 }
            }
            
        } catch (e) {
            console.error(e);
        } finally {
            this.loading = false;
            this.updateItems();
            this.setState(() => {});
            // One last scroll check
            this.scrollToSelected();
        }
    }

    handleKey(event: KeyboardEvent): KeyEventResult {
        if (event.key === 'ArrowDown') {
            let nextIndex = this.selectedIndex + 1;
            while (nextIndex < this.items.length && !this.items[nextIndex].selectable) {
                nextIndex++;
            }
            if (nextIndex < this.items.length) {
                this.setState(() => {
                    this.selectedIndex = nextIndex;
                    if (!this.lineSelectionMode) {
                        this.selectionAnchor = nextIndex;
                    }
                });
                this.scrollToSelected();
            }
            return KeyEventResult.handled;
        }
        if (event.key === 'ArrowUp') {
            let prevIndex = this.selectedIndex - 1;
            while (prevIndex >= 0 && !this.items[prevIndex].selectable) {
                prevIndex--;
            }
            if (prevIndex >= 0) {
                this.setState(() => {
                    this.selectedIndex = prevIndex;
                    if (!this.lineSelectionMode) {
                        this.selectionAnchor = prevIndex;
                    }
                });
                this.scrollToSelected();
            }
            return KeyEventResult.handled;
        }
        if (event.key === ' ') {
            if (event.ctrlKey || true) { // Always allow Space for compat as requested
                 this.setState(() => {
                     this.lineSelectionMode = !this.lineSelectionMode;
                     if (this.lineSelectionMode) {
                         this.selectionAnchor = this.selectedIndex;
                     } else {
                         this.selectionAnchor = -1;
                     }
                 });
                 return KeyEventResult.handled;
            }
        }
        if (event.key === 's') {
            this.stageSelection();
            return KeyEventResult.handled;
        }
        if (event.key === 'u') {
            this.unstageSelection();
            return KeyEventResult.handled;
        }
        if (event.key === 'Tab') {
            this.toggleExpand();
            return KeyEventResult.handled;
        }
        if (event.key === 'g') {
            this.refresh();
            return KeyEventResult.handled;
        }
        if (event.key === 'q') {
            process.exit(0);
            return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
    }
    
    async stageSelection() {
        await this.processSelection(true);
    }
    
    async unstageSelection() {
        await this.processSelection(false);
    }

    async processSelection(stage: boolean) {
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
            entry: git.FileEntry, 
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
        this.setState(() => {});
        
        try {
            for (const [key, data] of filesToProcess) {
                // Check if operation is valid for file state
                if (stage && data.entry.staged) continue; // Already staged
                if (!stage && !data.entry.staged) continue; // Already unstaged
                
                if (data.fullFile) {
                    if (stage) await git.stageFile(data.entry.path);
                    else await git.unstageFile(data.entry.path);
                } else {
                    // Partial stage
                    const diff = this.diffCache.get(key);
                    if (diff) {
                        const patch = generatePatch(diff, data.hunks, data.lines);
                        await git.applyPatch(patch, !stage); // reverse if unstaging
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

    async toggleExpand(targetEntry?: git.FileEntry) {
        let entry = targetEntry;
        if (!entry) {
            const item = this.items[this.selectedIndex];
            if (item && item.entry) {
                entry = item.entry;
            }
        }
        
        if (!entry) return;

        if (this.expandedFiles.has(entry.key)) {
            this.setState(() => {
                this.expandedFiles.delete(entry!.key);
                this.updateItems();
                // Adjust selectedIndex if needed (if it was inside the collapsed file)
                // Ideally we find the file item index
            });
        } else {
            if (!this.diffCache.has(entry.key)) {
                try {
                    const rawDiff = await git.getRawDiff(entry.path, entry.staged);
                    const parsed = parseDiff(rawDiff);
                    this.diffCache.set(entry.key, parsed);
                } catch (e) {
                    // Ignore
                }
            }
            this.setState(() => {
                this.expandedFiles.add(entry!.key);
                this.updateItems();
            });
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

    scrollToSelected() {
        WidgetsBinding.instance.frameScheduler.addPostFrameCallback(() => {
            const element = this.selectedItemKey.currentElement;
            if (element && element.renderObject) {
                const renderBox = element.renderObject as RenderBox;
                const context = new BuildContextImpl(element, element.widget);
                
                ensureVisible(
                    context, 
                    { top: 0, bottom: renderBox.size.height },
                    { padding: 0 }
                );
            }
        });
    }

    build(context: any): Widget {
        const widgetItems: Widget[] = [];
        
        // Determine selection range for highlighting
        let selectStart = this.selectedIndex;
        let selectEnd = this.selectedIndex;
        
        if (this.lineSelectionMode && this.selectionAnchor !== -1) {
            selectStart = Math.min(this.selectedIndex, this.selectionAnchor);
            selectEnd = Math.max(this.selectedIndex, this.selectionAnchor);
        }

        this.items.forEach((item, index) => {
            widgetItems.push(this.buildItem(item, index, index >= selectStart && index <= selectEnd));
        });
        
        // ... rest of build logic (scrollbar, status bar) ...
        const mainContent = new Focus({
            focusNode: this.focusNode,
            autofocus: true,
            onKey: (event) => this.handleKey(event),
            child: new Scrollbar({
                controller: this.scrollController,
                // @ts-ignore
                getScrollInfo: () => {
                    try {
                        const viewportDimension = this.scrollController.viewportDimension;
                        const maxScrollExtent = this.scrollController.maxScrollExtent;
                        return {
                            totalContentHeight: maxScrollExtent + viewportDimension,
                            viewportHeight: viewportDimension,
                            scrollOffset: this.scrollController.offset
                        };
                    } catch (e) {
                        return { totalContentHeight: 0, viewportHeight: 0, scrollOffset: 0 };
                    }
                },
                thumbColor: Colors.white,
                trackColor: Colors.rgb(50, 50, 50),
                child: new SingleChildScrollView({
                    controller: this.scrollController,
                    autofocus: false,
                    child: new Column({
                        children: widgetItems,
                        crossAxisAlignment: CrossAxisAlignment.stretch
                    })
                })
            })
        });

        const statusText = ` ${this.branchName} | Unstaged: ${this.unstaged.length}, Staged: ${this.staged.length} | Last: ${this.formatLastCommit()}`;

        const statusBar = new Container({
            height: 1,
            decoration: new BoxDecoration(Colors.blue),
            child: new RichText({
                text: new TextSpan(
                    statusText,
                    new TextStyle({ color: Colors.white })
                )
            })
        });

        return new Column({
            children: [
                new Expanded({ child: mainContent }),
                statusBar
            ],
            crossAxisAlignment: CrossAxisAlignment.stretch
        });
    }

    buildItem(item: VisibleItem, index: number, isSelected: boolean): Widget {
        const isFocused = index === this.selectedIndex;
        
        let content: Widget;
        let backgroundColor: any = undefined;
        
        // Default hunk mode background logic
        if (!this.lineSelectionMode && this.selectedIndex >= 0 && this.selectedIndex < this.items.length) {
            const selectedItem = this.items[this.selectedIndex];
            
            // Check if we are in a hunk (hunk header or line)
            if ((selectedItem.type === 'hunk' || selectedItem.type === 'line') && selectedItem.hunkIndex !== undefined && selectedItem.entry) {
                const targetKey = selectedItem.entry.key;
                const targetHunkIndex = selectedItem.hunkIndex;
                
                // Check if current item belongs to the same hunk
                if (item.entry?.key === targetKey && item.hunkIndex === targetHunkIndex) {
                    backgroundColor = Colors.rgb(40, 40, 40); // Muted background for whole hunk
                    
                    if (isSelected) {
                        backgroundColor = Colors.rgb(60, 60, 60); // Slightly lighter for cursor
                    }
                }
            } else if (isSelected) {
                backgroundColor = Colors.white;
            }
        } else if (isSelected) {
            backgroundColor = Colors.white;
        }

        if (item.type === 'header') {
            content = new RichText({
                text: new TextSpan(
                    item.text || '',
                    new TextStyle({ color: item.id.includes('unstaged') ? Colors.red : Colors.green, bold: true })
                )
            });
        } else if (item.type === 'message') {
             content = new RichText({
                text: new TextSpan(item.text || '', new TextStyle({ color: Colors.white }))
            });
        } else if (item.type === 'file') {
             const entry = item.entry!;
             content = new RichText({
                 text: new TextSpan(
                     `  ${entry.status} ${entry.path}`,
                     new TextStyle({
                         color: isSelected ? Colors.black : Colors.rgb(200, 200, 200),
                         backgroundColor: isSelected ? Colors.white : undefined
                     })
                 )
             });
        } else if (item.type === 'hunk') {
            content = new RichText({
                text: new TextSpan(
                    item.text || '',
                    new TextStyle({
                        color: Colors.cyan,
                        backgroundColor: backgroundColor
                    })
                )
            });
        } else if (item.type === 'line') {
            const line = item.line!;
            let color = Colors.rgb(200, 200, 200);
            // Default background for added/removed lines if not selected/hunk-highlighted
            let bg = backgroundColor;
            
            // If no specific background set by selection logic, use diff colors
            // But we usually want the diff color to be visible?
            // Actually, usually we want the background to indicate add/remove
            
            // If we have a selection background, we probably want to keep it but maybe tint it?
            // Or just use the text color to indicate type.
            
            if (line.type === 'add') {
                color = Colors.green;
                if (!bg) {
                    // bg = Colors.rgb(0, 50, 0); 
                }
            } else if (line.type === 'remove') {
                color = Colors.red;
                 if (!bg) {
                    // bg = Colors.rgb(50, 0, 0);
                }
            }
            
            if (isSelected && (this.lineSelectionMode || !item.hunkIndex)) {
                // In line selection mode (or file selection), strict white background for cursor
                color = Colors.black;
                bg = Colors.white;
            } else if (isSelected && !this.lineSelectionMode) {
                 // In hunk mode, the selected line is lighter gray (already set in bg)
                 // Keep text color as green/red to show diff type
            }

            content = new RichText({
                text: new TextSpan(
                    ' ' + line.content, // Indent diff lines slightly
                    new TextStyle({ color, backgroundColor: bg })
                )
            });
        } else {
            content = new SizedBox({});
        }

        // @ts-ignore
        const row = new Container({
             key: isFocused ? this.selectedItemKey : undefined,
             // @ts-ignore
             child: content
        });
        
        if (item.type === 'file') {
             return new MouseRegion({
                cursor: 'pointer',
                onClick: () => this.toggleExpand(item.entry),
                child: row
            });
        }
        
        return row;
    }
}

export { GitStatusWidget };

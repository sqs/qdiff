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
import { GitStatusViewModel, GitAdapter, VisibleItem } from './git-status-vm.js';

const realGitAdapter: GitAdapter = {
    getStatus: git.getStatus,
    getBranchName: git.getBranchName,
    getLastCommit: git.getLastCommit,
    getRawDiff: git.getRawDiff,
    stageFile: git.stageFile,
    unstageFile: git.unstageFile,
    applyPatch: git.applyPatch,
    commit: async (all: boolean) => {
        const tui = WidgetsBinding.instance.tuiInstance;
        tui.suspend();
        try {
            await git.commit(all);
        } finally {
            tui.resume();
            WidgetsBinding.instance.frameScheduler.requestFrame();
        }
    }
};

class GitStatusWidget extends StatefulWidget {
    // @ts-ignore
    createState(): State<GitStatusWidget> {
        return new GitStatusState();
    }
}

class GitStatusState extends State<GitStatusWidget> {
    private vm!: GitStatusViewModel;
    private focusNode = new FocusNode();
    private scrollController = new ScrollController();
    private selectedItemKey = new GlobalKey();
    private pendingChord: string[] = [];
    private chordTimer: ReturnType<typeof setTimeout> | null = null;
    
    initState() {
        this.scrollController.followMode = false;
        this.vm = new GitStatusViewModel(realGitAdapter, () => {
            this.setState(() => {});
        });
        this.vm.refresh();
    }

    formatLastCommit(): string {
        return this.vm.formatLastCommit();
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
        let selectStart = this.vm.selectedIndex;
        let selectEnd = this.vm.selectedIndex;
        
        if (this.vm.lineSelectionMode && this.vm.selectionAnchor !== -1) {
            selectStart = Math.min(this.vm.selectedIndex, this.vm.selectionAnchor);
            selectEnd = Math.max(this.vm.selectedIndex, this.vm.selectionAnchor);
        }

        this.vm.items.forEach((item, index) => {
            widgetItems.push(this.buildItem(item, index, index >= selectStart && index <= selectEnd));
        });
        
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

        const statusText = ` ${this.vm.branchName} | Unstaged: ${this.vm.unstaged.length}, Staged: ${this.vm.staged.length} | Last: ${this.vm.formatLastCommit()}`;

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
        const isFocused = index === this.vm.selectedIndex;
        
        let content: Widget;
        let backgroundColor: any = undefined;
        
        // Default hunk mode background logic
        if (!this.vm.lineSelectionMode && this.vm.selectedIndex >= 0 && this.vm.selectedIndex < this.vm.items.length) {
            const selectedItem = this.vm.items[this.vm.selectedIndex];
            
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
            let bg = backgroundColor;
            
            if (line.type === 'add') {
                color = Colors.green;
            } else if (line.type === 'remove') {
                color = Colors.red;
            }
            
            if (isSelected && (this.vm.lineSelectionMode || !item.hunkIndex)) {
                color = Colors.black;
                bg = Colors.white;
            } else if (isSelected && !this.vm.lineSelectionMode) {
                 // Hunk mode logic
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
                onClick: () => this.vm.toggleExpand(item.entry),
                child: row
            });
        }
        
        return row;
    }

    handleKey(event: KeyboardEvent): KeyEventResult {
        if (this.pendingChord.length > 0 || event.key === 'c') {
            if (this.chordTimer) {
                clearTimeout(this.chordTimer);
                this.chordTimer = null;
            }

            this.pendingChord.push(event.key);
            const chord = this.pendingChord.join(' ');

            if (chord === 'c c') {
                this.vm.commit(false);
                this.pendingChord = [];
                return KeyEventResult.handled;
            }

            if (chord === 'c - a c') {
                this.vm.commit(true);
                this.pendingChord = [];
                return KeyEventResult.handled;
            }

            const validChords = ['c c', 'c - a c'];
            const isPrefix = validChords.some(c => c.startsWith(chord));

            if (isPrefix) {
                this.chordTimer = setTimeout(() => {
                    this.pendingChord = [];
                }, 750);
                return KeyEventResult.handled;
            } else {
                this.pendingChord = [];
            }
        }

        if (event.key === 'ArrowDown') {
            this.vm.moveSelection(1);
            this.scrollToSelected();
            return KeyEventResult.handled;
        }
        if (event.key === 'ArrowUp') {
            this.vm.moveSelection(-1);
            this.scrollToSelected();
            return KeyEventResult.handled;
        }
        if (event.key === ' ') {
            if (event.ctrlKey || true) { 
                 this.vm.toggleLineSelectionMode();
                 return KeyEventResult.handled;
            }
        }
        if (event.key === 's') {
            this.vm.stageSelection();
            return KeyEventResult.handled;
        }
        if (event.key === 'u') {
            this.vm.unstageSelection();
            return KeyEventResult.handled;
        }
        if (event.key === 'Tab') {
            this.vm.toggleExpand();
            return KeyEventResult.handled;
        }
        if (event.key === 'g') {
            this.vm.refresh();
            return KeyEventResult.handled;
        }
        if (event.key === 'q') {
            process.exit(0);
            return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
    }
}

export { GitStatusWidget };

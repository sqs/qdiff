import { GitAdapter, GitStatusViewModel, VisibleItem } from './git-status-vm.js';
import * as git from './git.js';
import {
    KeyBinding,
    KeyBindingHelpers,
    globalRegistry,
    registerDefaultBindings
} from './key-bindings.js';
import {
    Border,
    BorderSide,
    BoxDecoration,
    BuildContextImpl,
    Colors,
    Column,
    Container,
    CrossAxisAlignment,
    Expanded,
    Focus,
    FocusNode,
    GlobalKey,
    KeyEventResult,
    RenderBox,
    RichText,
    ScrollController,
    Scrollbar,
    SingleChildScrollView,
    SizedBox,
    State,
    StatefulWidget,
    TextSpan,
    TextStyle,
    Widget,
    WidgetsBinding
} from './tui/framework/index.js';
import { ensureVisible } from './tui/framework/scrolling/ensure-visible.js';
import type { KeyboardEvent } from './tui/lib/parser/types.js';

const realGitAdapter: GitAdapter = {
    getStatus: git.getStatus,
    getBranchName: git.getBranchName,
    getLastCommit: git.getLastCommit,
    getRecentCommits: git.getRecentCommits,
    getRawDiff: git.getRawDiff,
    stageFile: git.stageFile,
    unstageFile: git.unstageFile,
    discardFile: git.discardFile,
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
    },
    fixupCommit: async (sha: string) => {
        await git.fixupCommit(sha);
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
    private loadingInPreviousVmUpdate = false;
    private pendingLoadingKeyEvents: KeyboardEvent[] = [];
    private replayingPendingLoadingKeys = false;

    private getStatusColor(status: string) {
        if (status === 'M') return Colors.magenta;
        if (status === 'D') return Colors.red;
        if (status === 'A') return Colors.green;
        return Colors.rgb(130, 130, 130);
    }

    private formatDiffStatText(diffStat: { added: number; modified: number; removed: number }): string {
        return `+${diffStat.added}/~${diffStat.modified}/-${diffStat.removed}`;
    }

    initState() {
        registerDefaultBindings();
        this.scrollController.followMode = false;
        this.vm = new GitStatusViewModel(realGitAdapter, () => {
            const loadingJustFinished = this.loadingInPreviousVmUpdate && !this.vm.loading;
            this.loadingInPreviousVmUpdate = this.vm.loading;
            this.setState(() => {});

            if (loadingJustFinished) {
                setTimeout(() => this.flushPendingLoadingKeys(), 0);
            }
        });
        this.loadingInPreviousVmUpdate = this.vm.loading;
        this.vm.refresh();
    }

    scrollToSelected() {
        if (this.vm.isFixupMode) return; // Don't scroll main list in fixup mode
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
        if (this.vm.isFixupMode) {
            return this.buildFixupView(context);
        }

        if (this.vm.showHelp) {
            return this.buildHelpView(context);
        }

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
                interactive: false,
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
                    enableMouseScroll: false,
                    child: new Column({
                        children: widgetItems,
                        crossAxisAlignment: CrossAxisAlignment.stretch
                    })
                })
            })
        });
        
        let rootTextSpan: TextSpan;
        let statusBarColor: any = undefined;

        if (this.vm.errorMessage) {
            statusBarColor = Colors.rgb(180, 0, 0);
            rootTextSpan = new TextSpan(
                ` Error: ${this.vm.errorMessage}`,
                new TextStyle({ color: Colors.white, bold: true })
            );
        } else if (this.pendingChord.length > 0) {
            const options = globalRegistry.getNextOptions(this.pendingChord);
            const waitingFor = options.map(o => `${o.key} (${o.binding.description})`).join(' ');
            const statusText = ` Key ${this.pendingChord.join(' ')} pressed, waiting for: ${waitingFor}`;
            statusBarColor = Colors.rgb(100, 0, 0);
            rootTextSpan = new TextSpan(
                statusText,
                new TextStyle({ color: Colors.rgb(220, 220, 220) })
            );
        } else {
            const children: TextSpan[] = [];
            
            // Branch
            children.push(new TextSpan(` ${this.vm.branchName}  \u00B7  `, new TextStyle({ color: Colors.rgb(220, 220, 220) })));
            
            if (this.vm.lastCommit) {
                 const { sha, message, committer } = this.vm.lastCommit;
                 const shortSha = sha.substring(0, 6);
                 
                 // SHA (muted)
                 children.push(new TextSpan(shortSha, new TextStyle({ color: Colors.rgb(140, 140, 140) })));
                 
                 let rest = ` ${message} \u2014 ${committer}`;
                 if (rest.length > 74) {
                     rest = rest.substring(0, 71) + '...';
                 }
                 
                 children.push(new TextSpan(rest, new TextStyle({ color: Colors.rgb(220, 220, 220) })));
            }
            
            rootTextSpan = new TextSpan(undefined, undefined, children);
        }

        const statusBar = new Container({
            decoration: new BoxDecoration(
                statusBarColor,
                new Border(new BorderSide(Colors.rgb(80, 80, 80)))
            ),
            child: new RichText({
                text: rootTextSpan
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

    buildHelpView(context: any): Widget {
        const bindings = globalRegistry.getBindings();
        const categories = new Map<string, KeyBinding[]>();
        
        bindings.forEach(b => {
            const cat = b.category || 'Other';
            if (!categories.has(cat)) categories.set(cat, []);
            categories.get(cat)!.push(b);
        });

        const items: Widget[] = [];
        items.push(new Container({
             decoration: new BoxDecoration(Colors.blue),
             child: new RichText({
                 text: new TextSpan(" Help (Press ? to close)", new TextStyle({ color: Colors.white, bold: true }))
             })
        }));

        // Sort categories
        const sortedCategories = Array.from(categories.keys()).sort();

        sortedCategories.forEach((cat) => {
            const list = categories.get(cat)!;
            items.push(new Container({
                child: new RichText({
                    text: new TextSpan(`\n ${cat}`, new TextStyle({ color: Colors.yellow, bold: true }))
                })
            }));
            
            list.forEach(b => {
                items.push(new Container({
                    child: new RichText({
                        text: new TextSpan(`   ${b.label.padEnd(15)} ${b.description}`, new TextStyle({ color: Colors.white }))
                    })
                }));
            });
        });

        const content = new Focus({
            focusNode: this.focusNode,
            autofocus: true,
            onKey: (event) => {
                if (event.key === '?' || event.key === 'Escape' || event.key === 'q') {
                    this.vm.showHelp = false;
                    this.setState(() => {});
                    return KeyEventResult.handled;
                }
                return KeyEventResult.ignored;
            },
            child: new SingleChildScrollView({
                enableMouseScroll: false,
                child: new Column({
                    children: items,
                    crossAxisAlignment: CrossAxisAlignment.stretch
                })
            })
        });

        return new Column({
            children: [
                new Expanded({ child: content })
            ],
            crossAxisAlignment: CrossAxisAlignment.stretch
        });
    }



    buildFixupView(context: any): Widget {
        const items: Widget[] = [];
        
        items.push(new Container({
             decoration: new BoxDecoration(Colors.blue),
             child: new RichText({
                 text: new TextSpan(" Select commit for fixup (Enter to confirm, Esc to cancel)", new TextStyle({ color: Colors.white, bold: true }))
             })
        }));

        if (this.vm.loading && this.vm.recentCommits.length === 0) {
             items.push(new RichText({ text: new TextSpan(" Loading commits...", new TextStyle({ color: Colors.white })) }));
        } else {
            this.vm.recentCommits.forEach((commit, index) => {
                 const isSelected = index === this.vm.fixupSelectedIndex;
                 items.push(new Container({
                     decoration: isSelected ? new BoxDecoration(Colors.white) : undefined,
                     child: new RichText({
                         text: new TextSpan(
                             ` ${commit.sha.substring(0,7)} ${commit.message}`,
                             new TextStyle({ color: isSelected ? Colors.black : Colors.white })
                         )
                     })
                 }));
            });
        }

        const content = new Focus({
            focusNode: this.focusNode,
            autofocus: true,
            onKey: (event) => this.handleKey(event),
            child: new SingleChildScrollView({
                enableMouseScroll: false,
                child: new Column({
                    children: items,
                    crossAxisAlignment: CrossAxisAlignment.stretch
                })
            })
        });
        
        return new Column({
            children: [
                new Expanded({ child: content })
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
                    new TextStyle({ 
                        color: isSelected ? Colors.black : Colors.white, 
                        bold: true,
                        backgroundColor: isSelected ? Colors.white : undefined
                    })
                )
            });
        } else if (item.type === 'message') {
             content = new RichText({
                text: new TextSpan(item.text || '', new TextStyle({ color: Colors.white }))
            });
        } else if (item.type === 'file') {
             const entry = item.entry!;
             const diffStat = this.vm.diffStats.get(entry.key) || { added: 0, modified: 0, removed: 0 };
             const diffStatText = this.formatDiffStatText(diffStat);
             const diffStatPadding = ' '.repeat(Math.max(0, this.vm.diffStatWidth - diffStatText.length));
             const textColor = isSelected ? Colors.black : Colors.rgb(200, 200, 200);
             const children: TextSpan[] = [
                 new TextSpan('  ', new TextStyle({ color: textColor, backgroundColor: isSelected ? Colors.white : undefined })),
                 new TextSpan(entry.status, new TextStyle({
                     color: isSelected ? Colors.black : this.getStatusColor(entry.status),
                     backgroundColor: isSelected ? Colors.white : undefined
                 })),
                 new TextSpan(' ', new TextStyle({ color: textColor, backgroundColor: isSelected ? Colors.white : undefined })),
                 new TextSpan(`+${diffStat.added}`, new TextStyle({
                     color: isSelected ? Colors.black : Colors.green,
                     backgroundColor: isSelected ? Colors.white : undefined
                 })),
                 new TextSpan('/', new TextStyle({ color: textColor, backgroundColor: isSelected ? Colors.white : undefined })),
                 new TextSpan(`~${diffStat.modified}`, new TextStyle({
                     color: isSelected ? Colors.black : Colors.yellow,
                     backgroundColor: isSelected ? Colors.white : undefined
                 })),
                 new TextSpan('/', new TextStyle({ color: textColor, backgroundColor: isSelected ? Colors.white : undefined })),
                 new TextSpan(`-${diffStat.removed}`, new TextStyle({
                     color: isSelected ? Colors.black : Colors.red,
                     backgroundColor: isSelected ? Colors.white : undefined
                 })),
                 new TextSpan(`${diffStatPadding} ${entry.path}`, new TextStyle({
                     color: textColor,
                     backgroundColor: isSelected ? Colors.white : undefined
                 }))
             ];
             content = new RichText({
                 text: new TextSpan(undefined, undefined, children)
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

            const indicator = line.content.charAt(0); // +, -, or space
            const rest = line.content.substring(1);
            const gutterBg = isSelected && (this.vm.lineSelectionMode || !item.hunkIndex)
                ? bg
                : Colors.rgb(30, 30, 30);
            content = new RichText({
                text: new TextSpan(undefined, undefined, [
                    new TextSpan(
                        ' ' + indicator,
                        new TextStyle({ color, backgroundColor: gutterBg })
                    ),
                    new TextSpan(
                        rest,
                        new TextStyle({ color, backgroundColor: bg })
                    ),
                ])
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
        return row;
    }

    private bufferKeyForLoadingReplay(event: KeyboardEvent): void {
        this.pendingLoadingKeyEvents.push({
            type: 'key',
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            metaKey: event.metaKey
        });
    }

    private flushPendingLoadingKeys(): void {
        if (this.vm.loading || this.pendingLoadingKeyEvents.length === 0) {
            return;
        }

        const eventsToReplay = this.pendingLoadingKeyEvents;
        this.pendingLoadingKeyEvents = [];
        this.replayingPendingLoadingKeys = true;

        try {
            for (let i = 0; i < eventsToReplay.length; i++) {
                this.handleKey(eventsToReplay[i]);

                if (this.vm.loading) {
                    this.pendingLoadingKeyEvents.unshift(...eventsToReplay.slice(i + 1));
                    break;
                }
            }
        } finally {
            this.replayingPendingLoadingKeys = false;
        }
    }

    handleKey(event: KeyboardEvent): KeyEventResult {
        if (this.vm.isFixupMode) {
             if (event.key === 'ArrowUp') {
                  this.vm.fixupSelectedIndex = Math.max(0, this.vm.fixupSelectedIndex - 1);
                  this.setState(() => {});
                  return KeyEventResult.handled;
             }
             if (event.key === 'ArrowDown') {
                  this.vm.fixupSelectedIndex = Math.min(this.vm.recentCommits.length - 1, this.vm.fixupSelectedIndex + 1);
                  this.setState(() => {});
                  return KeyEventResult.handled;
             }
             if (event.key === 'Enter') {
                  const commit = this.vm.recentCommits[this.vm.fixupSelectedIndex];
                  if (commit) {
                      this.vm.isFixupMode = false;
                      this.vm.fixup(commit.sha);
                  }
                  return KeyEventResult.handled;
             }
             if (event.key === 'Escape' || event.key === 'q' || (event.key === 'g' && event.ctrlKey)) {
                  this.vm.isFixupMode = false;
                  this.setState(() => {});
                  return KeyEventResult.handled;
             }
             return KeyEventResult.handled;
        }

        if (this.vm.loading && !this.replayingPendingLoadingKeys) {
            this.bufferKeyForLoadingReplay(event);
            return KeyEventResult.handled;
        }

        // Reset timer if it exists
        if (this.chordTimer) {
            clearTimeout(this.chordTimer);
            this.chordTimer = null;
        }

        const nextChord = [...this.pendingChord, this.getBindingKey(event)];
        
        // 1. Check for exact match
        const match = globalRegistry.findMatch(nextChord);
        if (match) {
            const helpers: KeyBindingHelpers = {
                quit: () => process.exit(0),
                scrollPageUp: () => this.scrollPageUpAndMoveSelection(),
                scrollPageDown: () => this.scrollPageDownAndMoveSelection(),
                scrollToTop: () => this.scrollToTopAndMoveSelection(),
                scrollToBottom: () => this.scrollToBottomAndMoveSelection()
            };

            match.action(this.vm, helpers);
            this.pendingChord = [];
            if (match.category === 'Navigation') {
                this.scrollToSelected();
            }
            this.setState(() => {}); // Ensure UI updates
            return KeyEventResult.handled;
        }

        // 2. Check for prefix
        if (globalRegistry.isPrefix(nextChord)) {
            this.pendingChord = nextChord;
            this.chordTimer = setTimeout(() => {
                this.pendingChord = [];
                this.setState(() => {});
            }, 1000);
            this.setState(() => {});
            return KeyEventResult.handled;
        }

        // 3. If we had a pending chord but this key broke it, try the key alone
        if (this.pendingChord.length > 0) {
            this.pendingChord = [];
            // Recursively handle the key as if no chord was pending
            return this.handleKey(event);
        }

        return KeyEventResult.ignored;
    }

    private getBindingKey(event: KeyboardEvent): string {
        if (event.metaKey) {
            if (event.key === '<' || (event.key === ',' && event.shiftKey)) {
                return 'Cmd+Shift+<';
            }

            if (event.key === '>' || (event.key === '.' && event.shiftKey)) {
                return 'Cmd+Shift+>';
            }
        }

        return event.key;
    }

    private getPageSize(): number {
        const viewportHeight = Math.floor(this.scrollController.viewportDimension);
        return viewportHeight > 0 ? viewportHeight : 10;
    }

    private scrollPageUp(): void {
        this.scrollController.scrollPageUp(this.getPageSize());
    }

    private scrollPageDown(): void {
        this.scrollController.scrollPageDown(this.getPageSize());
    }

    private scrollPageUpAndMoveSelection(): void {
        const pageSize = this.getPageSize();
        this.scrollController.scrollPageUp(pageSize);
        this.vm.moveSelectionBy(-pageSize);
    }

    private scrollPageDownAndMoveSelection(): void {
        const pageSize = this.getPageSize();
        this.scrollController.scrollPageDown(pageSize);
        this.vm.moveSelectionBy(pageSize);
    }

    private scrollToTop(): void {
        this.scrollController.jumpTo(0);
    }

    private scrollToBottom(): void {
        this.scrollController.jumpTo(this.scrollController.maxScrollExtent);
    }

    private scrollToTopAndMoveSelection(): void {
        this.scrollController.jumpTo(0);
        this.vm.moveSelectionToTop();
    }

    private scrollToBottomAndMoveSelection(): void {
        this.scrollController.jumpTo(this.scrollController.maxScrollExtent);
        this.vm.moveSelectionToBottom();
    }
}

export { GitStatusWidget };

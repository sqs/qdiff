import { GitAdapter, GitStatusViewModel, VisibleItem } from './git-status-vm.js';
import * as git from './git.js';
import { KeyBinding, globalRegistry, registerDefaultBindings } from './key-bindings.js';
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
    MouseRegion,
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

    initState() {
        registerDefaultBindings();
        this.scrollController.followMode = false;
        this.vm = new GitStatusViewModel(realGitAdapter, () => {
            this.setState(() => {});
        });
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
        
        let rootTextSpan: TextSpan;
        let statusBarColor: any = undefined;

        if (this.pendingChord.length > 0) {
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
             key: (item.type === 'file' || !isFocused) ? undefined : this.selectedItemKey,
             // @ts-ignore
             child: content
        });
        
        if (item.type === 'file') {
             return new MouseRegion({
                key: isFocused ? this.selectedItemKey : undefined,
                cursor: 'pointer',
                onClick: () => this.vm.toggleExpand(item.entry),
                child: row
            });
        }
        
        return row;
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

        // Reset timer if it exists
        if (this.chordTimer) {
            clearTimeout(this.chordTimer);
            this.chordTimer = null;
        }

        const nextChord = [...this.pendingChord, event.key];
        
        // 1. Check for exact match
        const match = globalRegistry.findMatch(nextChord);
        if (match) {
            match.action(this.vm, { quit: () => process.exit(0) });
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
}

export { GitStatusWidget };

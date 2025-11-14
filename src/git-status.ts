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
} from './tui/framework/index.js';
import { ensureVisible } from './tui/framework/scrolling/ensure-visible.js';
import type { KeyboardEvent } from './tui/lib/parser/types.js';
import * as git from './git.js';

class GitStatusWidget extends StatefulWidget {
    // @ts-ignore
    createState(): State<GitStatusWidget> {
        return new GitStatusState();
    }
}

class GitStatusState extends State<GitStatusWidget> {
    private staged: git.FileEntry[] = [];
    private unstaged: git.FileEntry[] = [];
    private selectedIndex = 0;
    private expandedFiles = new Set<string>(); 
    private diffCache = new Map<string, string>();
    private focusNode = new FocusNode();
    private scrollController = new ScrollController();
    private selectedItemKey = new GlobalKey();
    private loading = false;

    initState() {
        this.scrollController.followMode = false;
        this.refresh();
    }

    async refresh() {
        this.loading = true;
        this.setState(() => {});
        
        try {
            const status = await git.getStatus();
            this.staged = status.staged;
            this.unstaged = status.unstaged;
            
            const total = this.staged.length + this.unstaged.length;
            if (this.selectedIndex >= total && total > 0) {
                this.selectedIndex = Math.max(0, total - 1);
            }
        } catch (e) {
            console.error(e);
        } finally {
            this.loading = false;
            this.setState(() => {});
        }
    }

    handleKey(event: KeyboardEvent): KeyEventResult {
        const total = this.staged.length + this.unstaged.length;
        
        if (event.key === 'ArrowDown') {
            if (this.selectedIndex < total - 1) {
                this.setState(() => {
                    this.selectedIndex++;
                });
                this.scrollToSelected();
            }
            return KeyEventResult.handled;
        }
        if (event.key === 'ArrowUp') {
            if (this.selectedIndex > 0) {
                this.setState(() => {
                    this.selectedIndex--;
                });
                this.scrollToSelected();
            }
            return KeyEventResult.handled;
        }
        if (event.key === 's') {
            this.toggleStage();
            return KeyEventResult.handled;
        }
        if (event.key === 'u') {
            this.toggleUnstage();
            return KeyEventResult.handled;
        }
        if (event.key === 'Tab') {
            this.toggleExpand();
            return KeyEventResult.handled;
        }
        if (event.key === 'q') {
            process.exit(0);
            return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
    }

    getSelectedEntry(): git.FileEntry | undefined {
        if (this.staged.length + this.unstaged.length === 0) return undefined;
        
        if (this.selectedIndex < this.staged.length) {
            return this.staged[this.selectedIndex];
        }
        return this.unstaged[this.selectedIndex - this.staged.length];
    }

    async toggleStage() {
        const entry = this.getSelectedEntry();
        if (!entry) return;
        if (entry.staged) return; 

        await git.stageFile(entry.path);
        await this.refresh();
    }

    async toggleUnstage() {
        const entry = this.getSelectedEntry();
        if (!entry) return;
        if (!entry.staged) return; 

        await git.unstageFile(entry.path);
        await this.refresh();
    }

    async toggleExpand(targetEntry?: git.FileEntry) {
        const entry = targetEntry ?? this.getSelectedEntry();
        if (!entry) return;

        if (this.expandedFiles.has(entry.key)) {
            this.setState(() => {
                this.expandedFiles.delete(entry.key);
            });
        } else {
            if (!this.diffCache.has(entry.key)) {
                const diff = await git.getDiff(entry.path, entry.staged);
                this.diffCache.set(entry.key, diff);
            }
            this.setState(() => {
                this.expandedFiles.add(entry.key);
            });
        }
    }

    scrollToSelected() {
        WidgetsBinding.instance.frameScheduler.addPostFrameCallback(() => {
            const element = this.selectedItemKey.currentElement;
            if (element && element.renderObject) {
                const renderBox = element.renderObject as RenderBox;
                // Create a temporary context for the ensureVisible function
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
        const items: Widget[] = [];

        items.push(new RichText({
            text: new TextSpan(
                'Staged Changes',
                new TextStyle({ color: Colors.green, bold: true })
            )
        }));

        this.staged.forEach((entry, index) => {
            items.push(this.buildEntry(entry, index));
        });

        items.push(new SizedBox({ height: 1 }));

        items.push(new RichText({
            text: new TextSpan(
                'Unstaged Changes',
                new TextStyle({ color: Colors.red, bold: true })
            )
        }));

        this.unstaged.forEach((entry, index) => {
            items.push(this.buildEntry(entry, index + this.staged.length));
        });
        
        if (this.loading) {
             items.push(new RichText({
                 text: new TextSpan('Loading...', new TextStyle({ color: Colors.white }))
             }));
        }

        return new Focus({
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
                        children: items,
                        crossAxisAlignment: CrossAxisAlignment.stretch
                    })
                })
            })
        });
    }

    buildEntry(entry: git.FileEntry, globalIndex: number): Widget {
        const isSelected = globalIndex === this.selectedIndex;
        const isExpanded = this.expandedFiles.has(entry.key);

        // @ts-ignore
        const row = new Container({
             key: isSelected ? this.selectedItemKey : undefined,
             // decoration: isSelected ? new BoxDecoration(Colors.rgb(50, 50, 50)) : undefined,
             // @ts-ignore
             child: new RichText({
                 text: new TextSpan(
                     `  ${entry.status} ${entry.path}`,
                     new TextStyle({
                         color: isSelected ? Colors.black : Colors.rgb(200, 200, 200),
                         backgroundColor: isSelected ? Colors.white : undefined
                     })
                 )
             })
        });
        
        const clickableRow = new MouseRegion({
            cursor: 'pointer',
            onClick: () => this.toggleExpand(entry),
            child: row
        });
        
        const children: Widget[] = [clickableRow];

        if (isExpanded) {
             const diff = this.diffCache.get(entry.key) || 'Loading...';
             // @ts-ignore
             children.push(new Container({
                 // @ts-ignore
                 padding: EdgeInsets.only({ left: 2 }),
                 // @ts-ignore
                 child: new AnsiText({ text: diff })
             }));
        }

        return new Column({ children, crossAxisAlignment: CrossAxisAlignment.stretch });
    }
}

export { GitStatusWidget };

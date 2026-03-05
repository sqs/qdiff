import { describe, it, expect, beforeEach, mock } from "bun:test";
import { GitStatusViewModel, GitAdapter, VisibleItem } from "../src/git-status-vm.js";
import type { FileEntry, CommitInfo } from "../src/git.js";

class MockGitAdapter implements GitAdapter {
    statusResult: { staged: FileEntry[], unstaged: FileEntry[], untracked: FileEntry[] } = { staged: [], unstaged: [], untracked: [] };
    branchName = "main";
    lastCommit = { sha: "123456", message: "test", committer: "me" };
    rawDiffs = new Map<string, string>();

    // Spies
    stageFile = mock(async (path: string) => {});
    unstageFile = mock(async (path: string) => {});
    applyPatch = mock(async (patch: string, reverse: boolean) => {});
    commit = mock(async (all: boolean) => {});

    async getStatus() { return this.statusResult; }
    async getBranchName() { return this.branchName; }
    async getLastCommit() { return this.lastCommit; }
    async getRawDiff(path: string, staged: boolean) {
        const stagedKey = `${staged ? "staged" : "unstaged"}:${path}`;
        return this.rawDiffs.get(stagedKey) || this.rawDiffs.get(path) || "";
    }
}

describe("GitStatusViewModel", () => {
    let vm: GitStatusViewModel;
    let git: MockGitAdapter;
    let stateChangedCount = 0;

    beforeEach(() => {
        git = new MockGitAdapter();
        stateChangedCount = 0;
        vm = new GitStatusViewModel(git, () => {
            stateChangedCount++;
        });
    });

    it("initializes and loads data", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }],
            untracked: []
        };

        await vm.refresh();

        expect(vm.items.length).toBeGreaterThan(0);
        // Order: Unstaged Header -> File2 -> Staged Header -> File1
        // Index 0: Unstaged header
        // Index 1: File2 (unstaged)
        // Index 2: Staged header
        // Index 3: File1 (staged)
        expect(vm.items[3].entry?.path).toBe("file1.ts");
        expect(vm.items[1].entry?.path).toBe("file2.ts");
    });

    it("navigates selection including headers", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }],
            untracked: []
        };
        await vm.refresh();

        // Order: Unstaged Hdr (0), File2 (1), Staged Hdr (2), File1 (3)
        
        // First selectable is Unstaged Header at index 0
        expect(vm.selectedIndex).toBe(0); 
        expect(vm.items[vm.selectedIndex].id).toBe("header-unstaged");

        // Move down -> File2
        vm.moveSelection(1);
        expect(vm.selectedIndex).toBe(1);
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");

        // Move down -> Staged Header
        vm.moveSelection(1);
        expect(vm.selectedIndex).toBe(2);
        expect(vm.items[vm.selectedIndex].id).toBe("header-staged");

        // Move down -> File1
        vm.moveSelection(1);
        expect(vm.selectedIndex).toBe(3);
        expect(vm.items[vm.selectedIndex].id).toBe("staged:file1.ts");

        // Move up -> Staged Header
        vm.moveSelection(-1);
        expect(vm.selectedIndex).toBe(2);
    });

    it("moves selection by page-sized deltas", async () => {
        git.statusResult = {
            staged: [
                { path: "file3.ts", status: "M", staged: true, key: "staged:file3.ts" },
                { path: "file4.ts", status: "M", staged: true, key: "staged:file4.ts" }
            ],
            unstaged: [
                { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" },
                { path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }
            ],
            untracked: []
        };
        await vm.refresh();

        // Order: Unstaged Hdr(0), File1(1), File2(2), Staged Hdr(3), File3(4), File4(5)
        vm.moveSelectionBy(2);
        expect(vm.selectedIndex).toBe(2);

        vm.moveSelectionBy(100);
        expect(vm.selectedIndex).toBe(5);

        vm.moveSelectionBy(-3);
        expect(vm.selectedIndex).toBe(2);

        vm.moveSelectionBy(-100);
        expect(vm.selectedIndex).toBe(0);
    });

    it("jumps selection to top and bottom", async () => {
        git.statusResult = {
            staged: [
                { path: "file3.ts", status: "M", staged: true, key: "staged:file3.ts" }
            ],
            unstaged: [
                { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" }
            ],
            untracked: []
        };
        await vm.refresh();

        vm.moveSelectionToBottom();
        expect(vm.selectedIndex).toBe(vm.items.length - 1);

        vm.moveSelectionToTop();
        expect(vm.selectedIndex).toBe(0);
    });

    it("persists selection across refreshes", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }],
            untracked: []
        };
        await vm.refresh();

        // Select file1 (staged) at index 3
        // 0: Unstaged Hdr, 1: File2, 2: Staged Hdr, 3: File1
        vm.selectedIndex = 3;
        expect(vm.items[vm.selectedIndex].id).toBe("staged:file1.ts");

        // Refresh again with same data
        await vm.refresh();
        expect(vm.items[vm.selectedIndex].id).toBe("staged:file1.ts");
    });

    it("restores selection to nearest hunk if exact hunk disappears", async () => {
        // Setup: File with 2 hunks. Expand it. Select 2nd hunk.
        const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry], untracked: [] };
        
        const diffWith2Hunks = `diff --git a/file1.ts b/file1.ts
index 1..2 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-a
+b
@@ -10,1 +10,1 @@
-x
+y
`;
        git.rawDiffs.set("file1.ts", diffWith2Hunks);
        
        await vm.refresh();
        // Expand file
        await vm.toggleExpand(fileEntry);
        
        // Order: Unstaged Hdr(0), File(1), Hunk0(2), Line(3), Line(4), Hunk1(5), Line(6), Line(7)
        
        vm.selectedIndex = vm.items.findIndex(i => i.id.includes("hunk-1") && i.type === 'hunk'); // Select Hunk 1
        expect(vm.items[vm.selectedIndex].id).toContain("hunk-1");
        
        // Simulate staging Hunk 1. Now file has only Hunk 0.
        const diffWith1Hunk = `diff --git a/file1.ts b/file1.ts
index 1..2 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-a
+b
`;
        git.rawDiffs.set("file1.ts", diffWith1Hunk);
        
        await vm.refresh();
        
        // Should select Hunk 0 because Hunk 1 is gone and Hunk 0 is the nearest preceding.
        expect(vm.items[vm.selectedIndex].id).toContain("hunk-0");
    });

    it("restores selection to nearest selectable item if file disappears", async () => {
        // Setup: 2 files. Select 2nd file.
        git.statusResult = {
            staged: [],
            unstaged: [
                { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" },
                { path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }
            ],
            untracked: []
        };
        await vm.refresh();
        
        // Order: Unstaged Hdr(0), File1(1), File2(2)
        
        vm.selectedIndex = 2;
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");
        
        // File 2 disappears (e.g. staged fully or reverted)
        git.statusResult = {
            staged: [],
            unstaged: [
                { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" }
            ],
            untracked: []
        };
        
        await vm.refresh();
        
        // Should select File 1 (Index 1)
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file1.ts");
    });
    
    it("handles expansion of files", async () => {
         const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry], untracked: [] };
        
        const diff = `diff --git a/file1.ts b/file1.ts
index 1..2 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-a
+b
`;
        git.rawDiffs.set("file1.ts", diff);
        
        await vm.refresh();
        expect(vm.expandedFiles.has("unstaged:file1.ts")).toBe(false);
        // Unstaged Hdr, File
        expect(vm.items.length).toBe(2); 
        
        // Select File (Index 1)
        vm.selectedIndex = 1;

        await vm.toggleExpand();
        expect(vm.expandedFiles.has("unstaged:file1.ts")).toBe(true);
        
        expect(vm.items.length).toBeGreaterThan(2);
    });

    it("refresh updates cached unstaged diff when file exists in staged and unstaged", async () => {
        const stagedEntry = { path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" };
        const unstagedEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [stagedEntry], unstaged: [unstagedEntry], untracked: [] };

        const stagedDiff = `diff --git a/file1.ts b/file1.ts
index 1..2 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-head
+staged-v1
`;
        const unstagedDiffV1 = `diff --git a/file1.ts b/file1.ts
index 1..2 100644
--- a/file1.ts
+++ b/file1.ts
@@ -10,1 +10,1 @@
-index
+unstaged-v1
`;
        const unstagedDiffV2 = `diff --git a/file1.ts b/file1.ts
index 1..2 100644
--- a/file1.ts
+++ b/file1.ts
@@ -10,1 +10,1 @@
-index
+unstaged-v2
`;

        git.rawDiffs.set("staged:file1.ts", stagedDiff);
        git.rawDiffs.set("unstaged:file1.ts", unstagedDiffV1);

        await vm.refresh();
        await vm.toggleExpand(unstagedEntry);

        const linesV1 = vm.items
            .filter(item => item.type === "line" && item.entry?.key === "unstaged:file1.ts")
            .map(item => item.line?.content);
        expect(linesV1).toContain("+unstaged-v1");

        // Collapse so expansion relies on cached content.
        await vm.toggleExpand(unstagedEntry);

        git.rawDiffs.set("unstaged:file1.ts", unstagedDiffV2);
        await vm.refresh();

        await vm.toggleExpand(unstagedEntry);
        const linesV2 = vm.items
            .filter(item => item.type === "line" && item.entry?.key === "unstaged:file1.ts")
            .map(item => item.line?.content);

        expect(linesV2).toContain("+unstaged-v2");
        expect(linesV2).not.toContain("+unstaged-v1");
    });

    it("stages full file", async () => {
        const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry], untracked: [] };
        await vm.refresh();
        
        // Order: Unstaged Hdr(0), File1(1)
        vm.selectedIndex = 1;
        
        await vm.stageSelection();
        
        expect(git.stageFile).toHaveBeenCalledWith("file1.ts");
    });
});

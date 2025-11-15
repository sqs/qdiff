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
        return this.rawDiffs.get(path) || ""; 
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
        // Header(untracked) -> Header(unstaged) -> File2 -> Header(staged) -> File1
        // Index 0: Untracked header
        // Index 1: Unstaged header
        // Index 2: File2 (unstaged)
        // Index 3: Staged header
        // Index 4: File1 (staged)
        expect(vm.items[4].entry?.path).toBe("file1.ts");
        expect(vm.items[2].entry?.path).toBe("file2.ts");
    });

    it("navigates selection skipping non-selectable items", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }],
            untracked: []
        };
        await vm.refresh();

        // Order: Untracked Hdr (0), Unstaged Hdr (1), File2 (2), Staged Hdr (3), File1 (4)
        
        // First selectable is File2 at index 2
        expect(vm.selectedIndex).toBe(2); 
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");

        // Move down -> Skip Staged Header -> File1
        vm.moveSelection(1);
        expect(vm.selectedIndex).toBe(4);
        expect(vm.items[vm.selectedIndex].id).toBe("staged:file1.ts");

        // Move up -> Back to file2
        vm.moveSelection(-1);
        expect(vm.selectedIndex).toBe(2);
    });

    it("persists selection across refreshes", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }],
            untracked: []
        };
        await vm.refresh();

        // Select file1 (staged) at index 4
        vm.moveSelection(1); 
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
        
        // Order: Untracked Hdr(0), Unstaged Hdr(1), File(2), Hunk0(3), Line(4), Line(5), Hunk1(6), Line(7), Line(8), Staged Hdr(9)
        
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
        
        // Order: Untracked Hdr(0), Unstaged Hdr(1), File1(2), File2(3), Staged Hdr(4)
        
        vm.selectedIndex = 3;
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
        
        // Should select File 1 (Index 2)
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
        // Untracked Hdr, Unstaged Hdr, File, Staged Hdr
        expect(vm.items.length).toBe(4); 
        
        await vm.toggleExpand();
        expect(vm.expandedFiles.has("unstaged:file1.ts")).toBe(true);
        
        expect(vm.items.length).toBeGreaterThan(4);
    });

    it("stages full file", async () => {
        const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry], untracked: [] };
        await vm.refresh();
        
        // Order: Untracked Hdr(0), Unstaged Hdr(1), File1(2), Staged Hdr(3)
        vm.selectedIndex = 2;
        
        await vm.stageSelection();
        
        expect(git.stageFile).toHaveBeenCalledWith("file1.ts");
    });
});

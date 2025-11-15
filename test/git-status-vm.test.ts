import { describe, it, expect, beforeEach, mock } from "bun:test";
import { GitStatusViewModel, GitAdapter, VisibleItem } from "../src/git-status-vm.js";
import type { FileEntry, CommitInfo } from "../src/git.js";

class MockGitAdapter implements GitAdapter {
    statusResult: { staged: FileEntry[], unstaged: FileEntry[] } = { staged: [], unstaged: [] };
    branchName = "main";
    lastCommit = { sha: "123456", message: "test", committer: "me" };
    rawDiffs = new Map<string, string>();

    // Spies
    stageFile = mock(async (path: string) => {});
    unstageFile = mock(async (path: string) => {});
    applyPatch = mock(async (patch: string, reverse: boolean) => {});

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
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }]
        };

        await vm.refresh();

        expect(vm.items.length).toBeGreaterThan(0);
        // Header(staged) -> File1 -> Header(unstaged) -> File2
        expect(vm.items[1].entry?.path).toBe("file1.ts");
        expect(vm.items[3].entry?.path).toBe("file2.ts");
    });

    it("navigates selection skipping non-selectable items", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }]
        };
        await vm.refresh();

        // Initial selection is 0? Wait, 0 is header "Staged Changes" which is not selectable.
        // Does refresh set selection to first selectable?
        // In refresh(): if selectedIndex >= items.length (0 >= 4), no.
        // Then checks if items[selectedIndex] is selectable.
        // Index 0 is "Staged Changes" header (selectable=false).
        // Logic should move it to index 1 (file1.ts).

        expect(vm.selectedIndex).toBe(1); 
        expect(vm.items[vm.selectedIndex].id).toBe("staged:file1.ts");

        // Move down -> Skip unstaged header
        vm.moveSelection(1);
        // Index 2 is "Unstaged Changes" header (selectable=false).
        // Should jump to index 3 (file2.ts).
        expect(vm.selectedIndex).toBe(3);
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");

        // Move up -> Back to file1
        vm.moveSelection(-1);
        expect(vm.selectedIndex).toBe(1);
    });

    it("persists selection across refreshes", async () => {
        git.statusResult = {
            staged: [{ path: "file1.ts", status: "M", staged: true, key: "staged:file1.ts" }],
            unstaged: [{ path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }]
        };
        await vm.refresh();

        // Select file2
        vm.moveSelection(1); 
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");

        // Refresh again with same data
        await vm.refresh();
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");
    });

    it("restores selection to nearest hunk if exact hunk disappears", async () => {
        // Setup: File with 2 hunks. Expand it. Select 2nd hunk.
        const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry] };
        
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
        
        // Items: Header, File, Hunk0, Line0-0, Line0-1, Hunk1, Line1-0, Line1-1
        // Indices: 0 (Header), 1 (File), 2 (Hunk0), 3, 4, 5 (Hunk1)
        
        vm.selectedIndex = vm.items.findIndex(i => i.id.includes("hunk-1") && i.type === 'hunk'); // Select Hunk 1
        expect(vm.items[vm.selectedIndex].id).toContain("hunk-1");
        
        // Simulate staging Hunk 1. Now file has only Hunk 0.
        // But in reality, if we stage hunk 1, it moves to staged.
        // The unstaged version now only has hunk 0 (if they were independent).
        // Let's say we staged it and now we refresh.
        // The new diff for unstaged file only has the first hunk.
        
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
        
        // Should select Hunk 0 (index 2) because Hunk 1 is gone and Hunk 0 is the nearest preceding.
        expect(vm.items[vm.selectedIndex].id).toContain("hunk-0");
    });

    it("restores selection to nearest selectable item if file disappears", async () => {
        // Setup: 2 files. Select 2nd file.
        git.statusResult = {
            staged: [],
            unstaged: [
                { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" },
                { path: "file2.ts", status: "M", staged: false, key: "unstaged:file2.ts" }
            ]
        };
        await vm.refresh();
        
        // Select file2 (Index 3: Header, File1, Header, File2 -> wait logic: Header, File1 (staged?), wait.)
        // Header Staged (0), Header Unstaged (1), File1 (2), File2 (3)? No.
        // Logic: Header Staged, Staged Items, Header Unstaged, Unstaged Items.
        // If staged is empty: Header Staged (0), Header Unstaged (1), File1 (2), File2 (3).
        
        vm.selectedIndex = 3;
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file2.ts");
        
        // File 2 disappears (e.g. staged fully or reverted)
        git.statusResult = {
            staged: [],
            unstaged: [
                { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" }
            ]
        };
        
        await vm.refresh();
        
        // Should select File 1 (Index 2)
        expect(vm.items[vm.selectedIndex].id).toBe("unstaged:file1.ts");
    });
    
    it("handles expansion of files", async () => {
         const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry] };
        
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
        expect(vm.items.length).toBe(3); // Header, Header, File
        
        await vm.toggleExpand();
        expect(vm.expandedFiles.has("unstaged:file1.ts")).toBe(true);
        
        // Items should now include Hunk and Lines
        // Header, Header, File, Hunk, Line(cntx), Line(-), Line(+)
        // Actually parser output: -a +b. Context? diff-parser logic.
        // @@ -1,1 +1,1 @@ -> header
        // -a
        // +b
        expect(vm.items.length).toBeGreaterThan(3);
    });

    it("stages full file", async () => {
        const fileEntry = { path: "file1.ts", status: "M", staged: false, key: "unstaged:file1.ts" };
        git.statusResult = { staged: [], unstaged: [fileEntry] };
        await vm.refresh();
        
        // Select file1
        vm.selectedIndex = 2;
        
        await vm.stageSelection();
        
        expect(git.stageFile).toHaveBeenCalledWith("file1.ts");
        // refresh called implicitly
    });
});

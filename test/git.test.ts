import { describe, expect, it } from 'bun:test';
import { parseStatus } from '../src/git.js';

describe('parseStatus', () => {
    it('uses the new path for unstaged edits after a staged rename', () => {
        const status = parseStatus('RM new.txt\0old.txt\0');

        expect(status.staged).toEqual([
            {
                path: 'new.txt',
                displayPath: 'old.txt -> new.txt',
                originalPath: 'old.txt',
                status: 'R',
                staged: true,
                key: 'staged:new.txt'
            }
        ]);
        expect(status.unstaged).toEqual([
            {
                path: 'new.txt',
                displayPath: undefined,
                originalPath: undefined,
                status: 'M',
                staged: false,
                key: 'unstaged:new.txt'
            }
        ]);
    });

    it('parses paths with spaces without relying on quoted porcelain output', () => {
        const status = parseStatus('R  new name.txt\0old name.txt\0?? scratch file.txt\0');

        expect(status.staged[0]?.displayPath).toBe('old name.txt -> new name.txt');
        expect(status.staged[0]?.path).toBe('new name.txt');
        expect(status.untracked[0]?.path).toBe('scratch file.txt');
    });
});

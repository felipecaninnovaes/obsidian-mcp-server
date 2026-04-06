import { describe, it, expect } from "vitest";
import { execRegexSearch } from "../server/searchLogic";

describe("execRegexSearch()", () => {
	// ── basic matching ────────────────────────────────────────────────────────

	it("returns null when the pattern does not match", () => {
		const re = /unicorn/gi;
		expect(execRegexSearch("hello world", re, 100)).toBeNull();
	});

	it("returns a result when the pattern matches", () => {
		const re = /hello/gi;
		const result = execRegexSearch("hello world", re, 100);
		expect(result).not.toBeNull();
		expect(result!.matchCount).toBe(1);
		expect(result!.firstMatchIdx).toBe(0);
		expect(result!.firstMatchLen).toBe(5);
	});

	it("counts multiple matches", () => {
		const re = /foo/gi;
		const result = execRegexSearch("foo bar foo baz foo", re, 100);
		expect(result!.matchCount).toBe(3);
	});

	it("reports the position of the first match, not the last", () => {
		const re = /\d+/g;
		const result = execRegexSearch("abc 42 def 99", re, 100);
		expect(result!.firstMatchIdx).toBe(4); // "42" starts at index 4
		expect(result!.firstMatchLen).toBe(2);
	});

	// ── case sensitivity ──────────────────────────────────────────────────────

	it("matches case-insensitively with /gi flags", () => {
		const re = /typescript/gi;
		const result = execRegexSearch("TypeScript is great", re, 100);
		expect(result).not.toBeNull();
		expect(result!.matchCount).toBe(1);
	});

	it("does not match case-insensitively with /g only", () => {
		const re = /typescript/g;
		const result = execRegexSearch("TypeScript is great", re, 100);
		expect(result).toBeNull();
	});

	// ── match limit ───────────────────────────────────────────────────────────

	it("stops when matchLimit is reached and sets limitReached = true", () => {
		const re = /x/gi;
		const content = "x x x x x"; // 5 matches
		const result = execRegexSearch(content, re, 3);
		expect(result!.matchCount).toBe(3);
		expect(result!.limitReached).toBe(true);
	});

	it("sets limitReached = false when under the limit", () => {
		const re = /x/gi;
		const content = "x x x";
		const result = execRegexSearch(content, re, 10);
		expect(result!.matchCount).toBe(3);
		expect(result!.limitReached).toBe(false);
	});

	it("returns the first match even when limit is 1", () => {
		const re = /cat/gi;
		const content = "cat sat on mat cat";
		const result = execRegexSearch(content, re, 1);
		expect(result!.firstMatchIdx).toBe(0);
		expect(result!.limitReached).toBe(true);
	});

	// ── zero-length match guard ───────────────────────────────────────────────

	it("does not hang on zero-length matches (advances lastIndex)", () => {
		const re = /a*/gi; // matches zero-length between every char
		// Should complete without infinite loop
		const result = execRegexSearch("bcd", re, 20);
		// zero-length matches are still matches, result should exist
		expect(result).not.toBeNull();
	});

	// ── regex reuse across calls ──────────────────────────────────────────────

	it("resets lastIndex on each call so regex can be reused across files", () => {
		const re = /hello/gi;

		const r1 = execRegexSearch("hello world", re, 100);
		expect(r1!.matchCount).toBe(1);

		// Without lastIndex reset, re.lastIndex would be 5 and miss the next match
		const r2 = execRegexSearch("say hello again", re, 100);
		expect(r2!.matchCount).toBe(1);
	});

	// ── complex patterns ──────────────────────────────────────────────────────

	it("supports anchors and character classes", () => {
		const re = /^\d{4}-\d{2}-\d{2}/gm; // ISO date at start of a line
		const content = "intro\n2026-04-01 note\nnot-a-date\n2025-12-31 another";
		const result = execRegexSearch(content, re, 100);
		expect(result!.matchCount).toBe(2);
	});

	it("supports capturing groups (match length reflects full match, not group)", () => {
		const re = /(foo)(bar)/gi;
		const result = execRegexSearch("foobar baz foobar", re, 100);
		expect(result!.matchCount).toBe(2);
		expect(result!.firstMatchLen).toBe(6); // "foobar"
	});

	// ── edge cases ────────────────────────────────────────────────────────────

	it("returns null for empty content", () => {
		const re = /hello/gi;
		expect(execRegexSearch("", re, 100)).toBeNull();
	});

	it("returns a result when the entire content is one match", () => {
		const re = /^hello$/gi;
		const result = execRegexSearch("hello", re, 100);
		expect(result!.matchCount).toBe(1);
		expect(result!.firstMatchIdx).toBe(0);
		expect(result!.firstMatchLen).toBe(5);
	});
});

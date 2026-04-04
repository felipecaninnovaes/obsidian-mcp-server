import { describe, it, expect } from "vitest";
import { extractTokens } from "../server/textUtils";

describe("extractTokens", () => {
	describe("basic tokenization", () => {
		it("splits on whitespace", () => {
			const tokens = extractTokens("hello world");
			expect(tokens).toContain("hello");
			expect(tokens).toContain("world");
		});

		it("splits on punctuation", () => {
			const tokens = extractTokens("hello, world.");
			expect(tokens).toContain("hello");
			expect(tokens).toContain("world");
		});

		it("splits on mixed whitespace and punctuation", () => {
			const tokens = extractTokens("foo: bar; baz!");
			expect(tokens).toContain("foo");
			expect(tokens).toContain("bar");
			expect(tokens).toContain("baz");
		});

		it("handles newlines and tabs", () => {
			const tokens = extractTokens("line1\nline2\ttab");
			expect(tokens).toContain("line1");
			expect(tokens).toContain("line2");
			expect(tokens).toContain("tab");
		});
	});

	describe("minimum length filter", () => {
		it("excludes single-character tokens", () => {
			const tokens = extractTokens("a b c hello");
			expect(tokens).not.toContain("a");
			expect(tokens).not.toContain("b");
			expect(tokens).not.toContain("c");
			expect(tokens).toContain("hello");
		});

		it("includes tokens of exactly 2 characters", () => {
			const tokens = extractTokens("ab cd");
			expect(tokens).toContain("ab");
			expect(tokens).toContain("cd");
		});

		it("returns empty array for all single-char input", () => {
			expect(extractTokens("a b c")).toEqual([]);
		});

		it("returns empty array for empty string", () => {
			expect(extractTokens("")).toEqual([]);
		});
	});

	describe("case normalization", () => {
		it("lowercases all tokens", () => {
			const tokens = extractTokens("Hello WORLD TypeScript");
			expect(tokens).toContain("hello");
			expect(tokens).toContain("world");
			expect(tokens).toContain("typescript");
			expect(tokens).not.toContain("Hello");
			expect(tokens).not.toContain("WORLD");
		});

		it("lowercases before deduplication", () => {
			const tokens = extractTokens("Foo foo FOO");
			expect(tokens.filter((t) => t === "foo")).toHaveLength(1);
		});
	});

	describe("deduplication", () => {
		it("removes duplicate tokens", () => {
			const tokens = extractTokens("apple banana apple cherry banana");
			expect(tokens.filter((t) => t === "apple")).toHaveLength(1);
			expect(tokens.filter((t) => t === "banana")).toHaveLength(1);
		});

		it("returns unique tokens only", () => {
			const tokens = extractTokens("test test test");
			expect(tokens).toEqual(["test"]);
		});
	});

	describe("unicode and special content", () => {
		it("handles markdown headings", () => {
			const tokens = extractTokens("## My Heading");
			expect(tokens).toContain("my");
			expect(tokens).toContain("heading");
		});

		it("handles wikilinks", () => {
			const tokens = extractTokens("[[Some Note]] and more text");
			expect(tokens).toContain("some");
			expect(tokens).toContain("note");
			expect(tokens).toContain("and");
			expect(tokens).toContain("more");
			expect(tokens).toContain("text");
		});

		it("handles numbers as tokens", () => {
			const tokens = extractTokens("version 42 release");
			expect(tokens).toContain("42");
			expect(tokens).toContain("version");
			expect(tokens).toContain("release");
		});

		it("is consistent: calling twice on same input produces same tokens", () => {
			const input = "The quick brown fox jumps over the lazy dog";
			const first = extractTokens(input).sort();
			const second = extractTokens(input).sort();
			expect(first).toEqual(second);
		});
	});
});

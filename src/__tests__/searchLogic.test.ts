import { describe, it, expect } from "vitest";
import { computeScore, buildSmartExcerpt, paginate } from "../server/searchLogic";

// ── computeScore ──────────────────────────────────────────────────────────────

describe("computeScore", () => {
	const BASE = {
		content: "word ".repeat(100), // 100 tokens
		queryLower: "word",
		matchCount: 1,
		totalDocs: 100,
		docsWithTerm: 10,
		mtime: Date.now(), // very recent → max recency bonus
	};

	it("returns a positive number for any valid input", () => {
		expect(computeScore(BASE)).toBeGreaterThan(0);
	});

	it("higher matchCount → higher score", () => {
		const low = computeScore({ ...BASE, matchCount: 1 });
		const high = computeScore({ ...BASE, matchCount: 10 });
		expect(high).toBeGreaterThan(low);
	});

	it("lower docsWithTerm → higher IDF → higher score", () => {
		const rare = computeScore({ ...BASE, docsWithTerm: 1 });
		const common = computeScore({ ...BASE, docsWithTerm: 90 });
		expect(rare).toBeGreaterThan(common);
	});

	it("adds position bonus when query appears on the first line", () => {
		// Same token distribution; only difference is whether "word" is on line 1
		const rest = "other ".repeat(50);
		const contentWithMatch = `word is here\n${rest}`;
		const contentWithout = `nothing here\n${rest} word`;
		const withBonus = computeScore({ ...BASE, content: contentWithMatch, queryLower: "word", matchCount: 1 });
		const withoutBonus = computeScore({ ...BASE, content: contentWithout, queryLower: "word", matchCount: 1 });
		// Bonus is +2.0 but TF differs slightly; assert at least +1.5 advantage
		expect(withBonus).toBeGreaterThan(withoutBonus + 1.5);
	});

	it("position bonus is case-insensitive", () => {
		const content = `WORD in the first line\n${"other ".repeat(20)}`;
		const score = computeScore({ ...BASE, content, queryLower: "word" });
		const scoreWithout = computeScore({ ...BASE, content: `nothing\n${"word ".repeat(20)}`, queryLower: "word" });
		expect(score).toBeGreaterThan(scoreWithout);
	});

	it("recent file gets higher recency bonus than old file", () => {
		const recent = computeScore({ ...BASE, mtime: Date.now() });
		const old = computeScore({ ...BASE, mtime: Date.now() - 120 * 86_400_000 }); // 120 days ago
		expect(recent).toBeGreaterThan(old);
	});

	it("recency bonus is at most ~0.3 (very recent file)", () => {
		const scoreNow = computeScore({ ...BASE, mtime: Date.now() });
		const scoreNoRecency = computeScore({ ...BASE, mtime: Date.now() - 120 * 86_400_000 });
		expect(scoreNow - scoreNoRecency).toBeLessThanOrEqual(0.35);
	});

	it("falls back gracefully when totalDocs or docsWithTerm is 0 (IDF = 1)", () => {
		const score = computeScore({ ...BASE, totalDocs: 0, docsWithTerm: 0 });
		expect(score).toBeGreaterThan(0);
		expect(Number.isFinite(score)).toBe(true);
	});

	it("empty content does not throw", () => {
		expect(() => computeScore({ ...BASE, content: "" })).not.toThrow();
	});
});

// ── buildSmartExcerpt ─────────────────────────────────────────────────────────

describe("buildSmartExcerpt", () => {
	it("returns the paragraph containing the match", () => {
		const content = "First paragraph here.\n\nSecond paragraph with target word inside.\n\nThird paragraph.";
		const idx = content.indexOf("target");
		const excerpt = buildSmartExcerpt(content, idx, "target".length);
		expect(excerpt).toContain("target");
		expect(excerpt).not.toContain("First paragraph");
		expect(excerpt).not.toContain("Third paragraph");
	});

	it("replaces newlines with spaces (single line output)", () => {
		const content = "line one\nline two with match\nline three";
		const idx = content.indexOf("match");
		const excerpt = buildSmartExcerpt(content, idx, "match".length);
		expect(excerpt).not.toContain("\n");
	});

	it("truncates paragraphs longer than 500 chars", () => {
		// Build a paragraph > 500 chars with match in the middle
		const before = "x".repeat(300);
		const after = "y".repeat(300);
		const content = `${before}TARGET${after}`;
		const idx = content.indexOf("TARGET");
		const excerpt = buildSmartExcerpt(content, idx, "TARGET".length);
		expect(excerpt.length).toBeLessThan(content.length);
		expect(excerpt).toContain("TARGET");
		expect(excerpt).toContain("...");
	});

	it("includes the nearest heading above the match as prefix", () => {
		const content = "## My Heading\n\nSome paragraph with the match word here.\n\nAnother paragraph.";
		const idx = content.indexOf("match");
		const excerpt = buildSmartExcerpt(content, idx, "match".length);
		expect(excerpt).toMatch(/^## My Heading >/);
		expect(excerpt).toContain("match");
	});

	it("uses the closest heading, not the first one", () => {
		const content =
			"# First Heading\n\nIntro text.\n\n## Closer Heading\n\nParagraph with match here.";
		const idx = content.indexOf("match");
		const excerpt = buildSmartExcerpt(content, idx, "match".length);
		expect(excerpt).toMatch(/^## Closer Heading >/);
	});

	it("returns excerpt without heading prefix when there is no heading above", () => {
		const content = "Just a plain note with a match word somewhere.";
		const idx = content.indexOf("match");
		const excerpt = buildSmartExcerpt(content, idx, "match".length);
		expect(excerpt).not.toContain(">");
		expect(excerpt).toContain("match");
	});

	it("works when match is at position 0", () => {
		const content = "match is the very first word\n\nAnother paragraph.";
		const excerpt = buildSmartExcerpt(content, 0, "match".length);
		expect(excerpt).toContain("match");
	});

	it("works when match is in the last paragraph", () => {
		const content = "First paragraph.\n\nLast paragraph with match.";
		const idx = content.indexOf("match");
		const excerpt = buildSmartExcerpt(content, idx, "match".length);
		expect(excerpt).toContain("match");
		expect(excerpt).not.toContain("First paragraph");
	});

	it("does not add ellipsis for short paragraphs", () => {
		const content = "Short paragraph with match inside.";
		const idx = content.indexOf("match");
		const excerpt = buildSmartExcerpt(content, idx, "match".length);
		expect(excerpt).not.toContain("...");
	});
});

// ── paginate ──────────────────────────────────────────────────────────────────

describe("paginate", () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

	it("returns the correct page slice", () => {
		const { page } = paginate(items, 0, 3);
		expect(page).toEqual([1, 2, 3]);
	});

	it("returns the correct page with offset", () => {
		const { page } = paginate(items, 3, 3);
		expect(page).toEqual([4, 5, 6]);
	});

	it("always returns total_results as the full array length", () => {
		const { total_results } = paginate(items, 5, 3);
		expect(total_results).toBe(10);
	});

	it("returns empty page when offset exceeds length", () => {
		const { page, total_results } = paginate(items, 20, 5);
		expect(page).toEqual([]);
		expect(total_results).toBe(10);
	});

	it("last page returns remaining items only", () => {
		const { page } = paginate(items, 8, 5);
		expect(page).toEqual([9, 10]);
	});

	it("returns all items when limit >= length and offset is 0", () => {
		const { page, total_results } = paginate(items, 0, 100);
		expect(page).toEqual(items);
		expect(total_results).toBe(10);
	});

	it("works with empty array", () => {
		const { page, total_results } = paginate([], 0, 10);
		expect(page).toEqual([]);
		expect(total_results).toBe(0);
	});
});

// ── VaultIndex integration: getTokenDocCount / getTotalDocs ───────────────────

describe("VaultIndex TF-IDF helpers", () => {
	// These are covered indirectly through computeScore integration;
	// the unit tests live in VaultIndex.test.ts.
	// Here we just verify the contract expected by computeScore.

	it("computeScore with realistic VaultIndex values produces ordered results", () => {
		// Simulate: doc A has 3 matches in 50 tokens; doc B has 1 match in 200 tokens
		const common = { queryLower: "rust", totalDocs: 100, docsWithTerm: 5, mtime: Date.now() - 86_400_000 };

		const scoreA = computeScore({ ...common, content: "rust ".repeat(50), matchCount: 3 });
		const scoreB = computeScore({ ...common, content: ("other ".repeat(199) + " rust"), matchCount: 1 });

		// A has higher TF AND same IDF → should rank higher
		expect(scoreA).toBeGreaterThan(scoreB);
	});
});

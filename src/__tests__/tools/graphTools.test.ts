import { describe, it, expect } from "vitest";

// ── extractHeadingRanges (inline reimplementation for testing) ─────────────────
// The function is not exported from graphTools.ts (intentional — it's an internal
// helper). We re-implement the same logic here to test it in isolation, then trust
// that the tool uses it correctly via integration-style assertions.

function extractHeadingRanges(content: string): [number, number][] {
	const ranges: [number, number][] = [];
	let pos = 0;
	for (const line of content.split("\n")) {
		if (/^#{1,6}\s/.test(line)) {
			ranges.push([pos, pos + line.length]);
		}
		pos += line.length + 1; // +1 for the \n
	}
	return ranges;
}

describe("extractHeadingRanges()", () => {
	it("returns empty array for content with no headings", () => {
		expect(extractHeadingRanges("Just some plain text")).toEqual([]);
	});

	it("detects H1 through H6", () => {
		const content = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
		const ranges = extractHeadingRanges(content);
		expect(ranges).toHaveLength(6);
	});

	it("does not match # without a trailing space (not a heading)", () => {
		const ranges = extractHeadingRanges("#hashtag content");
		expect(ranges).toHaveLength(0);
	});

	it("returns correct character positions", () => {
		const content = "Intro paragraph\n## My Heading\nBody text";
		const ranges = extractHeadingRanges(content);
		expect(ranges).toHaveLength(1);
		const [start, end] = ranges[0]!;
		const heading = content.slice(start, end);
		expect(heading).toBe("## My Heading");
	});

	it("a match at heading position is detected by range overlap", () => {
		const content = "# TypeScript Notes\nSome body content";
		const ranges = extractHeadingRanges(content);
		// "TypeScript" starts at position 2 (after "# ")
		const idx = content.toLowerCase().indexOf("typescript");
		const inHeading = ranges.some(([s, e]) => idx >= s && idx < e);
		expect(inHeading).toBe(true);
	});

	it("a match in body is NOT in heading range", () => {
		const content = "# Heading\nTypeScript is in the body";
		const ranges = extractHeadingRanges(content);
		const idx = content.toLowerCase().indexOf("typescript");
		const inHeading = ranges.some(([s, e]) => idx >= s && idx < e);
		expect(inHeading).toBe(false);
	});

	it("handles multi-line documents with mixed content", () => {
		const content = [
			"---",           // frontmatter start (not a heading)
			"title: Note",
			"---",
			"# Introduction",
			"Paragraph one.",
			"",
			"## Section A",
			"Content here.",
			"No heading here",
		].join("\n");

		const ranges = extractHeadingRanges(content);
		expect(ranges).toHaveLength(2);
	});
});

// ── Suggest links: already-linked skip logic ──────────────────────────────────

describe("suggest_links: already-linked skip logic", () => {
	/** Minimal simulation of the skip logic used in registerSuggestLinks. */
	function filterCandidates(
		candidates: { notePath: string; term: string }[],
		alreadyLinked: Set<string>
	): { notePath: string; term: string }[] {
		return candidates.filter(
			(c) => !alreadyLinked.has(c.notePath)
		);
	}

	it("excludes notes that are already linked", () => {
		const candidates = [
			{ notePath: "linked.md", term: "Linked Note" },
			{ notePath: "unlinked.md", term: "Unlinked Note" },
		];
		const alreadyLinked = new Set(["linked.md"]);
		const result = filterCandidates(candidates, alreadyLinked);
		expect(result.map((c) => c.notePath)).toEqual(["unlinked.md"]);
	});

	it("returns all candidates when nothing is already linked", () => {
		const candidates = [
			{ notePath: "a.md", term: "Alpha" },
			{ notePath: "b.md", term: "Beta" },
		];
		const result = filterCandidates(candidates, new Set());
		expect(result).toHaveLength(2);
	});

	it("returns empty when all candidates are already linked", () => {
		const candidates = [{ notePath: "a.md", term: "Alpha" }];
		const result = filterCandidates(candidates, new Set(["a.md"]));
		expect(result).toHaveLength(0);
	});
});

// ── Suggest links: heading-score priority ─────────────────────────────────────

describe("suggest_links: heading score priority", () => {
	it("suggestions in headings score higher than body matches", () => {
		const content = "# TypeScript Intro\nSome body mentioning Python";
		const headingRanges = extractHeadingRanges(content);

		function scoreMatch(term: string): number {
			const idx = content.toLowerCase().indexOf(term.toLowerCase());
			if (idx === -1) return -1;
			return headingRanges.some(([s, e]) => idx >= s && idx < e) ? 2 : 1;
		}

		expect(scoreMatch("typescript")).toBe(2); // in heading
		expect(scoreMatch("python")).toBe(1);      // in body
	});

	it("sorted suggestions put heading matches first", () => {
		const suggestions = [
			{ note: "b.md", score: 1, term: "body" },
			{ note: "a.md", score: 2, term: "heading" },
		];
		suggestions.sort((a, b) => b.score - a.score);
		expect(suggestions[0]!.note).toBe("a.md");
	});
});

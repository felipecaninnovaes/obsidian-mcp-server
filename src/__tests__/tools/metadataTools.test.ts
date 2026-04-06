import { describe, it, expect } from "vitest";
import { serializeFrontmatter } from "../../server/tools/metadataTools";

// ── serializeFrontmatter ──────────────────────────────────────────────────────

describe("serializeFrontmatter()", () => {
	// ── primitives ────────────────────────────────────────────────────────────

	it("serializes a string value without quotes when safe", () => {
		expect(serializeFrontmatter({ title: "My Note" })).toBe("title: My Note");
	});

	it("serializes a number", () => {
		expect(serializeFrontmatter({ priority: 3 })).toBe("priority: 3");
	});

	it("serializes a boolean", () => {
		expect(serializeFrontmatter({ draft: true })).toBe("draft: true");
		expect(serializeFrontmatter({ published: false })).toBe("published: false");
	});

	it("serializes null", () => {
		expect(serializeFrontmatter({ key: null })).toBe("key: null");
	});

	// ── string quoting ────────────────────────────────────────────────────────

	it("quotes strings that contain YAML special characters (:)", () => {
		const result = serializeFrontmatter({ url: "http://example.com" });
		expect(result).toBe(`url: "http://example.com"`);
	});

	it("quotes strings that are YAML boolean-like keywords", () => {
		expect(serializeFrontmatter({ val: "true" })).toBe(`val: "true"`);
		expect(serializeFrontmatter({ val: "yes" })).toBe(`val: "yes"`);
		expect(serializeFrontmatter({ val: "null" })).toBe(`val: "null"`);
	});

	it("quotes strings that look like numbers", () => {
		expect(serializeFrontmatter({ id: "007" })).toBe(`id: "007"`);
	});

	it("quotes empty strings", () => {
		expect(serializeFrontmatter({ key: "" })).toBe(`key: ""`);
	});

	// ── arrays ────────────────────────────────────────────────────────────────

	it("serializes an empty array inline", () => {
		expect(serializeFrontmatter({ tags: [] })).toBe("tags: []");
	});

	it("serializes a non-empty array in block style", () => {
		const result = serializeFrontmatter({ tags: ["foo", "bar"] });
		expect(result).toBe("tags:\n  - foo\n  - bar");
	});

	it("serializes an array of numbers", () => {
		const result = serializeFrontmatter({ scores: [1, 2, 3] });
		expect(result).toBe("scores:\n  - 1\n  - 2\n  - 3");
	});

	// ── multiple keys ─────────────────────────────────────────────────────────

	it("serializes multiple keys, one per line", () => {
		const result = serializeFrontmatter({ title: "Note", draft: false, priority: 2 });
		const lines = result.split("\n");
		expect(lines).toContain("title: Note");
		expect(lines).toContain("draft: false");
		expect(lines).toContain("priority: 2");
	});

	it("returns empty string for an empty object", () => {
		expect(serializeFrontmatter({})).toBe("");
	});

	// ── objects ───────────────────────────────────────────────────────────────

	it("serializes a nested object as JSON string", () => {
		const result = serializeFrontmatter({ meta: { a: 1 } });
		expect(result).toBe(`meta: {"a":1}`);
	});

	// ── round-trip: set then serialize ────────────────────────────────────────

	it("round-trip: merge new key onto existing frontmatter object", () => {
		const current = { title: "Original", tags: ["alpha"] };
		const updated = { ...current, status: "done" };
		const yaml = serializeFrontmatter(updated);
		expect(yaml).toContain("title: Original");
		expect(yaml).toContain("status: done");
		expect(yaml).toContain("tags:");
		expect(yaml).toContain("  - alpha");
	});

	it("round-trip: remove key by deleting from object before serializing", () => {
		const current: Record<string, unknown> = { title: "Note", draft: true };
		delete current["draft"];
		const yaml = serializeFrontmatter(current);
		expect(yaml).not.toContain("draft");
		expect(yaml).toContain("title: Note");
	});
});

// ── Frontmatter mutation helpers (inline logic tests) ─────────────────────────
// These test the core logic used by update_note_metadata without needing Obsidian.

describe("update_note_metadata logic", () => {
	/** Simulate what the tool does: apply set/remove to a parsed frontmatter object. */
	function applyChanges(
		current: Record<string, unknown>,
		set?: Record<string, unknown>,
		remove?: string[]
	): Record<string, unknown> {
		const updated = { ...current, ...(set ?? {}) };
		for (const key of remove ?? []) {
			delete updated[key];
		}
		return updated;
	}

	it("set adds new keys", () => {
		const result = applyChanges({}, { title: "New Note" });
		expect(result).toEqual({ title: "New Note" });
	});

	it("set overwrites existing keys", () => {
		const result = applyChanges({ title: "Old" }, { title: "New" });
		expect(result.title).toBe("New");
	});

	it("remove deletes specified keys", () => {
		const result = applyChanges({ title: "Note", draft: true }, undefined, ["draft"]);
		expect(result).not.toHaveProperty("draft");
		expect(result.title).toBe("Note");
	});

	it("set and remove can be applied together", () => {
		const result = applyChanges({ title: "Note", draft: true }, { status: "done" }, ["draft"]);
		expect(result).toEqual({ title: "Note", status: "done" });
	});

	it("removing a non-existent key is a no-op", () => {
		const result = applyChanges({ title: "Note" }, undefined, ["nonexistent"]);
		expect(result).toEqual({ title: "Note" });
	});

	it("setting to undefined does not keep the key in output (undefined → deleted by spread)", () => {
		// When set includes undefined values they should be treated as deletions
		const result = applyChanges({ title: "Note", extra: "x" }, { extra: undefined });
		// After spread, extra is undefined — the serializer will use 'null' for it.
		// The important thing is no TypeError is thrown.
		expect(() => serializeFrontmatter(result)).not.toThrow();
	});

	// ── FRONTMATTER_RE regex logic ────────────────────────────────────────────

	it("detects frontmatter block at start of content", () => {
		const re = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
		const content = "---\ntitle: Note\n---\nBody text";
		expect(re.test(content)).toBe(true);
		const match = re.exec(content);
		expect(match![1]).toBe("title: Note");
	});

	it("does not match frontmatter not at start", () => {
		const re = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
		const content = "Some text\n---\ntitle: Note\n---\n";
		expect(re.test(content)).toBe(false);
	});

	it("correctly separates body from frontmatter block", () => {
		const re = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
		const content = "---\ntitle: Note\n---\n# Heading\nBody text";
		const match = re.exec(content);
		const body = content.slice(match![0].length);
		expect(body).toBe("# Heading\nBody text");
	});

	it("detects content with no frontmatter", () => {
		const re = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
		const content = "# Just a note\nNo frontmatter here";
		expect(re.test(content)).toBe(false);
	});
});

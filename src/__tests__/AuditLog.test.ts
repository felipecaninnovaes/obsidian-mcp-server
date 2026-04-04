import { describe, it, expect, beforeEach } from "vitest";
import { AuditLog, summarizeParams } from "../server/AuditLog";
import type { AuditEntry } from "../server/AuditLog";

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	return {
		timestamp: Date.now(),
		sessionId: "session-abc",
		tool: "create_note",
		params_summary: '{"path":"notes/test.md"}',
		result: "ok",
		...overrides,
	};
}

describe("AuditLog", () => {
	let log: AuditLog;

	beforeEach(() => {
		log = new AuditLog();
	});

	// ── record ────────────────────────────────────────────────────────────────

	it("starts empty", () => {
		expect(log.size).toBe(0);
	});

	it("stores an entry", () => {
		log.record(makeEntry());
		expect(log.size).toBe(1);
	});

	it("evicts oldest entries when exceeding 500", () => {
		for (let i = 0; i < 502; i++) {
			log.record(makeEntry({ tool: `tool-${i}` }));
		}
		expect(log.size).toBe(500);
	});

	// ── getRecent ─────────────────────────────────────────────────────────────

	it("returns entries newest-first", () => {
		log.record(makeEntry({ tool: "first" }));
		log.record(makeEntry({ tool: "second" }));
		log.record(makeEntry({ tool: "third" }));
		const entries = log.getRecent(10);
		expect(entries[0]!.tool).toBe("third");
		expect(entries[1]!.tool).toBe("second");
		expect(entries[2]!.tool).toBe("first");
	});

	it("respects the limit parameter", () => {
		for (let i = 0; i < 10; i++) log.record(makeEntry());
		expect(log.getRecent(3)).toHaveLength(3);
	});

	it("returns all entries when limit exceeds total", () => {
		log.record(makeEntry());
		log.record(makeEntry());
		expect(log.getRecent(100)).toHaveLength(2);
	});

	it("filters by tool name", () => {
		log.record(makeEntry({ tool: "create_note" }));
		log.record(makeEntry({ tool: "delete_note" }));
		log.record(makeEntry({ tool: "create_note" }));

		const filtered = log.getRecent(50, "create_note");
		expect(filtered).toHaveLength(2);
		expect(filtered.every((e) => e.tool === "create_note")).toBe(true);
	});

	it("returns empty array when no entries match filter", () => {
		log.record(makeEntry({ tool: "create_note" }));
		expect(log.getRecent(50, "nonexistent_tool")).toHaveLength(0);
	});

	it("returns entries for all tools when tool filter is omitted", () => {
		log.record(makeEntry({ tool: "create_note" }));
		log.record(makeEntry({ tool: "delete_note" }));
		expect(log.getRecent(50)).toHaveLength(2);
	});

	// ── clear ─────────────────────────────────────────────────────────────────

	it("clear() resets the log", () => {
		log.record(makeEntry());
		log.record(makeEntry());
		log.clear();
		expect(log.size).toBe(0);
	});

	// ── result field ──────────────────────────────────────────────────────────

	it("stores result='ok' and result='error' entries", () => {
		log.record(makeEntry({ result: "ok" }));
		log.record(makeEntry({ result: "error", error: "Permission denied" }));
		const entries = log.getRecent(10);
		const errorEntry = entries.find((e) => e.result === "error");
		expect(errorEntry).toBeDefined();
		expect(errorEntry!.error).toBe("Permission denied");
	});
});

// ── summarizeParams ───────────────────────────────────────────────────────────

describe("summarizeParams()", () => {
	it("returns JSON for a simple object", () => {
		expect(summarizeParams({ path: "notes/test.md" })).toBe('{"path":"notes/test.md"}');
	});

	it("truncates at 200 characters with ellipsis", () => {
		const long = "x".repeat(300);
		const result = summarizeParams({ content: long });
		expect(result.length).toBe(200);
		expect(result.endsWith("...")).toBe(true);
	});

	it("does not truncate when exactly 200 chars", () => {
		// Build an object whose JSON is exactly 200 chars
		const key = "k";
		const val = "v".repeat(200 - `{"${key}":""}`.length);
		const result = summarizeParams({ [key]: val });
		expect(result.length).toBe(200);
		expect(result.endsWith("...")).toBe(false);
	});

	it("handles nested objects", () => {
		const result = summarizeParams({ set: { title: "Note" }, remove: ["draft"] });
		expect(result).toContain("title");
		expect(result).toContain("draft");
	});

	it("returns empty object JSON for empty input", () => {
		expect(summarizeParams({})).toBe("{}");
	});
});

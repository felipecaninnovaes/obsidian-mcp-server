import { describe, it, expect, beforeEach } from "vitest";
import { DeleteLog } from "../server/DeleteLog";

describe("DeleteLog", () => {
	let log: DeleteLog;

	beforeEach(() => {
		log = new DeleteLog();
	});

	// ── record ────────────────────────────────────────────────────────────────

	describe("record()", () => {
		it("starts empty", () => {
			expect(log.size).toBe(0);
		});

		it("stores an entry", () => {
			log.record("notes/a.md");
			expect(log.size).toBe(1);
		});

		it("stores multiple entries", () => {
			log.record("a.md");
			log.record("b.md");
			log.record("c.md");
			expect(log.size).toBe(3);
		});

		it("evicts oldest entries when the buffer exceeds 1000", () => {
			// Fill beyond the max
			for (let i = 0; i < 1002; i++) {
				log.record(`note-${i}.md`);
			}
			expect(log.size).toBe(1000);
		});

		it("accepts a custom `now` timestamp for deterministic testing", () => {
			const t = 1_000_000;
			log.record("old.md", t);
			expect(log.getSince(0, t).length).toBe(1);
		});
	});

	// ── getSince ──────────────────────────────────────────────────────────────

	describe("getSince()", () => {
		it("returns entries at or after sinceMs", () => {
			const base = 1_000_000;
			log.record("before.md", base - 1000);
			log.record("exact.md",  base);
			log.record("after.md",  base + 1000);

			const results = log.getSince(base, base + 5000);
			const paths = results.map((e) => e.path);
			expect(paths).toContain("exact.md");
			expect(paths).toContain("after.md");
			expect(paths).not.toContain("before.md");
		});

		it("excludes entries older than 24 hours", () => {
			const ONE_DAY_MS = 24 * 60 * 60 * 1000;
			const now = 10_000_000;
			const tooOld = now - ONE_DAY_MS - 1; // just past the 24 h window

			log.record("old.md", tooOld);
			log.record("recent.md", now - 60_000);

			const results = log.getSince(0, now);
			const paths = results.map((e) => e.path);
			expect(paths).not.toContain("old.md");
			expect(paths).toContain("recent.md");
		});

		it("returns empty when no entries match since", () => {
			log.record("a.md", 1000);
			expect(log.getSince(9999, 10_000)).toHaveLength(0);
		});

		it("returns all entries when sinceMs is 0 and entries are within 24 h", () => {
			const now = 1_000_000;
			log.record("a.md", now - 100);
			log.record("b.md", now - 200);
			expect(log.getSince(0, now)).toHaveLength(2);
		});

		it("result includes path and timestamp fields", () => {
			const ts = 5_000_000;
			log.record("note.md", ts);
			const [entry] = log.getSince(0, ts + 1);
			expect(entry).toBeDefined();
			expect(entry!.path).toBe("note.md");
			expect(entry!.timestamp).toBe(ts);
		});
	});

	// ── prune ─────────────────────────────────────────────────────────────────

	describe("prune()", () => {
		it("removes entries outside the 24-hour window", () => {
			const ONE_DAY_MS = 24 * 60 * 60 * 1000;
			const now = 10_000_000;

			log.record("old.md", now - ONE_DAY_MS - 1);
			log.record("young.md", now - 60_000);
			expect(log.size).toBe(2);

			log.prune(now);
			expect(log.size).toBe(1);
		});

		it("keeps entries exactly at the boundary", () => {
			const ONE_DAY_MS = 24 * 60 * 60 * 1000;
			const now = 10_000_000;

			log.record("boundary.md", now - ONE_DAY_MS); // exactly 24 h ago
			log.prune(now);
			expect(log.size).toBe(1);
		});

		it("is a no-op on an empty log", () => {
			expect(() => log.prune()).not.toThrow();
		});
	});

	// ── record auto-prunes ────────────────────────────────────────────────────

	it("record() prunes stale entries before adding a new one", () => {
		const ONE_DAY_MS = 24 * 60 * 60 * 1000;
		const base = 10_000_000;

		log.record("stale.md", base - ONE_DAY_MS - 1);
		expect(log.size).toBe(1);

		// Record at 'base' — triggers prune, stale entry is removed
		log.record("fresh.md", base);
		expect(log.size).toBe(1); // only the fresh entry remains
	});
});

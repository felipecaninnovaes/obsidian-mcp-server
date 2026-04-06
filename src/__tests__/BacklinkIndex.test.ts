import { describe, it, expect, beforeEach } from "vitest";
import { BacklinkIndex } from "../server/BacklinkIndex";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal App-like object with resolvedLinks. */
function makeApp(resolvedLinks: Record<string, Record<string, number>>) {
	return {
		metadataCache: { resolvedLinks },
	} as never;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BacklinkIndex", () => {
	let index: BacklinkIndex;

	beforeEach(() => {
		index = new BacklinkIndex();
	});

	// ── isBuilt ───────────────────────────────────────────────────────────────

	describe("isBuilt()", () => {
		it("starts as false", () => {
			expect(index.isBuilt()).toBe(false);
		});

		it("is true after build()", () => {
			const app = makeApp({});
			index.build(app);
			expect(index.isBuilt()).toBe(true);
		});
	});

	// ── build ─────────────────────────────────────────────────────────────────

	describe("build()", () => {
		it("populates reverse links from resolvedLinks", () => {
			const app = makeApp({
				"a.md": { "b.md": 1, "c.md": 1 },
				"d.md": { "b.md": 1 },
			});
			index.build(app);

			const bl = index.getBacklinks("b.md");
			expect(bl.has("a.md")).toBe(true);
			expect(bl.has("d.md")).toBe(true);
			expect(bl.size).toBe(2);
		});

		it("getBacklinks returns empty set for a note with no backlinks", () => {
			const app = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app);
			expect(index.getBacklinks("a.md").size).toBe(0);
		});

		it("rebuilding clears previous data", () => {
			const app1 = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app1);
			expect(index.getBacklinks("b.md").has("a.md")).toBe(true);

			const app2 = makeApp({ "x.md": { "y.md": 1 } });
			index.build(app2);
			// Old data gone
			expect(index.getBacklinks("b.md").size).toBe(0);
			// New data present
			expect(index.getBacklinks("y.md").has("x.md")).toBe(true);
		});

		it("handles empty resolvedLinks", () => {
			index.build(makeApp({}));
			expect(index.getBacklinks("any.md").size).toBe(0);
		});
	});

	// ── getOutgoing ───────────────────────────────────────────────────────────

	describe("getOutgoing()", () => {
		it("returns the set of targets a source links to", () => {
			const app = makeApp({ "a.md": { "b.md": 1, "c.md": 1 } });
			index.build(app);
			const out = index.getOutgoing("a.md");
			expect(out.has("b.md")).toBe(true);
			expect(out.has("c.md")).toBe(true);
		});

		it("returns empty set for a source with no outgoing links", () => {
			const app = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app);
			expect(index.getOutgoing("b.md").size).toBe(0);
		});
	});

	// ── update ────────────────────────────────────────────────────────────────

	describe("update()", () => {
		it("adds new outgoing links for a source", () => {
			const app = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app);

			// Simulate a.md gaining a link to c.md
			const updatedApp = makeApp({ "a.md": { "b.md": 1, "c.md": 1 } });
			index.update("a.md", updatedApp);

			expect(index.getBacklinks("c.md").has("a.md")).toBe(true);
			expect(index.getBacklinks("b.md").has("a.md")).toBe(true);
		});

		it("removes stale outgoing links when a file is updated", () => {
			const app = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app);

			// Simulate a.md replacing the b.md link with c.md
			const updatedApp = makeApp({ "a.md": { "c.md": 1 } });
			index.update("a.md", updatedApp);

			expect(index.getBacklinks("b.md").has("a.md")).toBe(false);
			expect(index.getBacklinks("c.md").has("a.md")).toBe(true);
		});

		it("handles update for a file with no previous links", () => {
			const app = makeApp({});
			index.build(app);

			const updatedApp = makeApp({ "new.md": { "target.md": 1 } });
			index.update("new.md", updatedApp);

			expect(index.getBacklinks("target.md").has("new.md")).toBe(true);
		});
	});

	// ── removeFile ────────────────────────────────────────────────────────────

	describe("removeFile()", () => {
		it("removes a source file from all reverse indexes", () => {
			const app = makeApp({ "a.md": { "b.md": 1, "c.md": 1 } });
			index.build(app);

			index.removeFile("a.md");

			expect(index.getBacklinks("b.md").has("a.md")).toBe(false);
			expect(index.getBacklinks("c.md").has("a.md")).toBe(false);
		});

		it("removes a target file entry", () => {
			const app = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app);

			index.removeFile("b.md");

			// getBacklinks returns empty set for removed target
			expect(index.getBacklinks("b.md").size).toBe(0);
		});

		it("is a no-op for unknown paths", () => {
			index.build(makeApp({}));
			expect(() => index.removeFile("nonexistent.md")).not.toThrow();
		});

		it("does not affect other files when a source is removed", () => {
			const app = makeApp({
				"a.md": { "shared.md": 1 },
				"b.md": { "shared.md": 1 },
			});
			index.build(app);

			index.removeFile("a.md");

			// b.md still points to shared.md
			expect(index.getBacklinks("shared.md").has("b.md")).toBe(true);
			expect(index.getBacklinks("shared.md").size).toBe(1);
		});

		it("removing the same path twice is safe (no-op on second call)", () => {
			const app = makeApp({ "a.md": { "b.md": 1 } });
			index.build(app);

			index.removeFile("a.md");
			expect(() => index.removeFile("a.md")).not.toThrow();
		});
	});
});

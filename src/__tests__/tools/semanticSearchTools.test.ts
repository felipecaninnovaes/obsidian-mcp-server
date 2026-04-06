import { describe, it, expect, vi } from "vitest";
import { SemanticIndex } from "../../server/SemanticIndex";
import type { MinimalAdapter } from "../../server/SemanticIndex";

// We test the SemanticIndex integration points that the tool relies on,
// including the isConfigured guard and the search result shape.

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig() {
	return {
		endpoint: "https://api.example.com/v1/embeddings",
		apiKey: "sk-test",
		model: "text-embedding-3-small",
	};
}

function seedStore(idx: SemanticIndex, entries: Array<{ path: string; vector: number[]; preview: string }>) {
	// Load pre-built embeddings by invoking load() with a fake adapter
	const embeddings = Object.fromEntries(
		entries.map((e) => [e.path, { vector: e.vector, mtime: 1, preview: e.preview }])
	);
	const data = JSON.stringify({ model: "text-embedding-3-small", embeddings });
	const adapter: MinimalAdapter = {
		exists: async (_p: string) => true,
		read: async (_p: string) => data,
		write: async () => {},
		mkdir: async () => {},
	};
	return idx.load(adapter, "any/path");
}

// ── isConfigured guard ────────────────────────────────────────────────────────

describe("semantic_search tool — isConfigured guard", () => {
	it("search() rejects when the index is not configured", async () => {
		const idx = new SemanticIndex();
		await expect(idx.search("anything", 5)).rejects.toThrow("não configurada");
	});

	it("search() proceeds when the index is configured", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ embedding: [1, 0] }] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			// No stored entries → returns []
			const results = await idx.search("test", 5);
			expect(Array.isArray(results)).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ── Result shape ──────────────────────────────────────────────────────────────

describe("semantic_search tool — result shape", () => {
	it("each result contains path, score, and preview", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await seedStore(idx, [
			{ path: "notes/a.md", vector: [1, 0, 0], preview: "Note A content" },
		]);

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("a", 5);
			expect(results.length).toBe(1);
			const r = results[0]!;
			expect(typeof r.path).toBe("string");
			expect(typeof r.score).toBe("number");
			expect(typeof r.preview).toBe("string");
			expect(r.path).toBe("notes/a.md");
			expect(r.preview).toBe("Note A content");
			expect(r.score).toBeGreaterThan(0.99);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("results are sorted by score descending", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await seedStore(idx, [
			{ path: "best.md", vector: [1, 0], preview: "best" },
			{ path: "worst.md", vector: [0, 1], preview: "worst" },
			{ path: "middle.md", vector: [0.8, 0.6], preview: "middle" },
		]);

		// Query aligned with [1, 0]
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ embedding: [1, 0] }] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 3);
			expect(results[0]!.path).toBe("best.md");
			expect(results[1]!.path).toBe("middle.md");
			expect(results[2]!.path).toBe("worst.md");
			// Scores are descending
			for (let i = 0; i < results.length - 1; i++) {
				expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("limit caps the number of results", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await seedStore(
			idx,
			Array.from({ length: 20 }, (_, i) => ({
				path: `note${i}.md`,
				vector: [Math.random(), Math.random()],
				preview: `preview ${i}`,
			}))
		);

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ data: [{ embedding: [0.5, 0.5] }] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 7);
			expect(results.length).toBe(7);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ── API error propagation ─────────────────────────────────────────────────────

describe("semantic_search tool — API error propagation", () => {
	it("propagates HTTP errors from the embedding API", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			await expect(idx.search("query", 5)).rejects.toThrow("429");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("propagates network-level fetch errors", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await expect(idx.search("query", 5)).rejects.toThrow("Network error");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ── configure / reconfigure ───────────────────────────────────────────────────

describe("SemanticIndex.configure()", () => {
	it("allows reconfiguring with a different model", () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		expect(idx.isConfigured()).toBe(true);

		idx.configure({ ...makeConfig(), model: "text-embedding-ada-002" });
		expect(idx.isConfigured()).toBe(true);
	});

	it("empty apiKey is allowed — local providers (Ollama) have no key", () => {
		const idx = new SemanticIndex();
		idx.configure({ ...makeConfig(), apiKey: "" });
		expect(idx.isConfigured()).toBe(true);
	});

	it("can be disabled by removing the endpoint", () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		expect(idx.isConfigured()).toBe(true);

		idx.configure({ ...makeConfig(), endpoint: "" });
		expect(idx.isConfigured()).toBe(false);
	});
});

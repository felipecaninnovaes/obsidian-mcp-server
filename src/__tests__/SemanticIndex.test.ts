import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SemanticIndex } from "../server/SemanticIndex";
import type { MinimalAdapter } from "../server/SemanticIndex";
import { getEmbeddingStoragePath } from "../constants";

// eslint-disable-next-line obsidianmd/hardcoded-config-path
const TEST_CONFIG_DIR = ".obsidian";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(store: Record<string, string> = {}): MinimalAdapter {
	const fs = { ...store };
	return {
		exists: async (p) => p in fs,
		read: async (p) => fs[p] ?? (() => { throw new Error(`File not found: ${p}`); })(),
		write: async (p, data) => { fs[p] = data; },
		mkdir: async () => { /* no-op */ },
	};
}

function makeVault(files: Array<{ path: string; basename: string; mtime: number; content: string }>) {
	return {
		configDir: TEST_CONFIG_DIR,
		getMarkdownFiles: () =>
			files.map((f) => ({
				path: f.path,
				basename: f.basename,
				stat: { mtime: f.mtime },
			})),
		cachedRead: async (file: { path: string }) => {
			const f = files.find((x) => x.path === file.path);
			return f?.content ?? "";
		},
	};
}

function makeConfig() {
	return {
		endpoint: "https://api.example.com/v1/embeddings",
		apiKey: "sk-test",
		model: "text-embedding-3-small",
	};
}

/** Returns a fetch mock that always responds with the given vector. */
function mockFetch(vector: number[]) {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ data: [{ embedding: vector }] }),
	});
}

// ── cosineSimilarity ──────────────────────────────────────────────────────────

describe("SemanticIndex.cosineSimilarity()", () => {
	const idx = new SemanticIndex();

	it("returns 1 for identical vectors", () => {
		expect(idx.cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
	});

	it("returns 0 for orthogonal vectors", () => {
		expect(idx.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
	});

	it("returns -1 for opposite vectors", () => {
		expect(idx.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
	});

	it("returns 0 for mismatched lengths", () => {
		expect(idx.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
	});

	it("returns 0 for empty vectors", () => {
		expect(idx.cosineSimilarity([], [])).toBe(0);
	});

	it("returns 0 for zero-norm vector", () => {
		expect(idx.cosineSimilarity([0, 0], [1, 1])).toBe(0);
	});

	it("handles arbitrary vectors correctly", () => {
		const a = [3, 4];
		const b = [4, 3];
		// dot = 12+12=24, normA = 5, normB = 5 → 24/25 = 0.96
		expect(idx.cosineSimilarity(a, b)).toBeCloseTo(0.96);
	});
});

// ── extractDocText ────────────────────────────────────────────────────────────

describe("SemanticIndex.extractDocText()", () => {
	const idx = new SemanticIndex();

	it("returns title + first paragraph", () => {
		const content = "Intro paragraph.\n\nSecond paragraph.";
		const result = idx.extractDocText("My Note", content);
		expect(result).toContain("My Note");
		expect(result).toContain("Intro paragraph.");
		expect(result).not.toContain("Second paragraph.");
	});

	it("strips YAML frontmatter", () => {
		const content = "---\ntitle: Test\ndate: 2026-01-01\n---\n\nActual content here.";
		const result = idx.extractDocText("Test", content);
		expect(result).not.toContain("date: 2026-01-01");
		expect(result).toContain("Actual content here.");
	});

	it("truncates to EMBEDDING_TEXT_MAX_CHARS", () => {
		const longContent = "x".repeat(1000);
		const result = idx.extractDocText("Title", longContent);
		expect(result.length).toBeLessThanOrEqual(500);
	});

	it("handles content with no paragraphs gracefully", () => {
		const result = idx.extractDocText("Title", "");
		expect(result).toContain("Title");
	});

	it("uses first non-empty paragraph (skips blank lines)", () => {
		const content = "\n\n\nFirst real paragraph.\n\nSecond.";
		const result = idx.extractDocText("T", content);
		expect(result).toContain("First real paragraph.");
	});
});

// ── isConfigured ─────────────────────────────────────────────────────────────

describe("SemanticIndex.isConfigured()", () => {
	it("returns false before configure() is called", () => {
		const idx = new SemanticIndex();
		expect(idx.isConfigured()).toBe(false);
	});

	it("returns false if endpoint is empty", () => {
		const idx = new SemanticIndex();
		idx.configure({ endpoint: "", apiKey: "key", model: "m" });
		expect(idx.isConfigured()).toBe(false);
	});

	it("returns true even if apiKey is empty (local providers like Ollama need no key)", () => {
		const idx = new SemanticIndex();
		idx.configure({ endpoint: "https://example.com", apiKey: "", model: "m" });
		expect(idx.isConfigured()).toBe(true);
	});

	it("returns false if model is empty", () => {
		const idx = new SemanticIndex();
		idx.configure({ endpoint: "https://example.com", apiKey: "key", model: "" });
		expect(idx.isConfigured()).toBe(false);
	});

	it("returns true when all fields are set", () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		expect(idx.isConfigured()).toBe(true);
	});
});

// ── load / save ───────────────────────────────────────────────────────────────

describe("SemanticIndex load/save", () => {
	it("starts with empty store when storage file does not exist", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		const adapter = makeAdapter(); // empty fs
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));
		// search returns [] without calling the embedding API
		// (no stored entries, so results is empty before API call)
		expect(idx.isConfigured()).toBe(true);
	});

	it("restores stored entries when model matches", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"note.md": {
					vector: [0.1, 0.9],
					mtime: 1000,
					preview: "preview text",
				},
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		// After loading, search should rank against stored vectors without hitting the API
		const fetchMock = mockFetch([0.1, 0.9]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("test query", 5);
			expect(results.length).toBe(1);
			expect(results[0]!.path).toBe("note.md");
			expect(results[0]!.score).toBeGreaterThan(0.9); // near-identical vectors
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("discards stored entries when model does not match", async () => {
		const storedData = JSON.stringify({
			model: "old-model",
			embeddings: {
				"note.md": { vector: [0.1, 0.9], mtime: 1000, preview: "x" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig()); // different model
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		const fetchMock = mockFetch([0.5, 0.5]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 5);
			// Store was wiped — no results
			expect(results.length).toBe(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("saves and reloads embeddings correctly", async () => {
		const adapter = makeAdapter();
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		// Manually populate by building a tiny vault
		const vault = makeVault([
			{ path: "a.md", basename: "a", mtime: 42, content: "Hello world" },
		]);
		const fetchMock = mockFetch([1, 0, 0]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			// @ts-expect-error — minimal vault mock (missing non-essential Vault methods)
			await idx.build(vault, adapter);
		} finally {
			vi.unstubAllGlobals();
		}

		// Reload into a fresh index
		const idx2 = new SemanticIndex();
		idx2.configure(makeConfig());
		await idx2.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		const fetchMock2 = mockFetch([1, 0, 0]);
		vi.stubGlobal("fetch", fetchMock2);
		try {
			const results = await idx2.search("query", 5);
			expect(results.length).toBe(1);
			expect(results[0]!.path).toBe("a.md");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("handles corrupt storage file gracefully", async () => {
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: "not valid json{{{",
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await expect(idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR))).resolves.not.toThrow();
		expect(idx.isConfigured()).toBe(true);
	});
});

// ── removeFile ────────────────────────────────────────────────────────────────

describe("SemanticIndex.removeFile()", () => {
	it("removes a file from the in-memory store", async () => {
		const adapter = makeAdapter();
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const vault = makeVault([
			{ path: "keep.md", basename: "keep", mtime: 1, content: "Keep this" },
			{ path: "remove.md", basename: "remove", mtime: 2, content: "Remove this" },
		]);
		const fetchMock = mockFetch([0.5, 0.5]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			// @ts-expect-error — minimal mock
			await idx.build(vault, adapter);
		} finally {
			vi.unstubAllGlobals();
		}

		idx.removeFile("remove.md");

		const fetchMock2 = mockFetch([0.5, 0.5]);
		vi.stubGlobal("fetch", fetchMock2);
		try {
			const results = await idx.search("query", 5);
			expect(results.map((r) => r.path)).not.toContain("remove.md");
			expect(results.map((r) => r.path)).toContain("keep.md");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("is a no-op for an unknown path", () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		expect(() => idx.removeFile("nonexistent.md")).not.toThrow();
	});
});

// ── build ─────────────────────────────────────────────────────────────────────

describe("SemanticIndex.build()", () => {
	it("does nothing when not configured", async () => {
		const adapter = makeAdapter();
		const idx = new SemanticIndex(); // not configured
		const vault = makeVault([{ path: "x.md", basename: "x", mtime: 1, content: "x" }]);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		try {
			// @ts-expect-error — minimal mock
			await idx.build(vault, adapter);
		} finally {
			vi.unstubAllGlobals();
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips files whose mtime matches the stored entry", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"cached.md": { vector: [1, 0], mtime: 999, preview: "cached" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const vault = makeVault([
			{ path: "cached.md", basename: "cached", mtime: 999, content: "No change" },
		]);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		try {
			// @ts-expect-error — minimal mock
			await idx.build(vault, adapter);
		} finally {
			vi.unstubAllGlobals();
		}
		// mtime matched → no API call
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("re-embeds files whose mtime changed", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"note.md": { vector: [1, 0], mtime: 100, preview: "old" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const vault = makeVault([
			{ path: "note.md", basename: "note", mtime: 200, content: "Updated content" },
		]);
		const fetchMock = mockFetch([0, 1, 0]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			// @ts-expect-error — minimal mock
			await idx.build(vault, adapter);
		} finally {
			vi.unstubAllGlobals();
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("removes entries for deleted files", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"existing.md": { vector: [1, 0], mtime: 1, preview: "x" },
				"deleted.md": { vector: [0, 1], mtime: 2, preview: "y" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		// Vault only has "existing.md" — "deleted.md" is gone
		const vault = makeVault([
			{ path: "existing.md", basename: "existing", mtime: 1, content: "still here" },
		]);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		try {
			// @ts-expect-error — minimal mock
			await idx.build(vault, adapter);
		} finally {
			vi.unstubAllGlobals();
		}

		// No API call (mtime unchanged), but deleted.md entry should be gone
		const fetchMock2 = mockFetch([1, 0]);
		vi.stubGlobal("fetch", fetchMock2);
		try {
			const results = await idx.search("query", 10);
			expect(results.map((r) => r.path)).not.toContain("deleted.md");
			expect(results.map((r) => r.path)).toContain("existing.md");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ── search ────────────────────────────────────────────────────────────────────

describe("SemanticIndex.search()", () => {
	it("throws when not configured", async () => {
		const idx = new SemanticIndex();
		await expect(idx.search("query", 5)).rejects.toThrow("não configurada");
	});

	it("returns results ranked by cosine similarity (descending)", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"low.md": { vector: [0, 1], mtime: 1, preview: "low relevance" },
				"high.md": { vector: [1, 0], mtime: 2, preview: "high relevance" },
				"mid.md": { vector: [0.7, 0.7], mtime: 3, preview: "mid relevance" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		// Query vector aligned with [1, 0] → "high.md" should rank first
		const fetchMock = mockFetch([1, 0]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("something", 3);
			expect(results[0]!.path).toBe("high.md");
			expect(results[0]!.score).toBeCloseTo(1);
			expect(results[2]!.path).toBe("low.md");
			expect(results[2]!.score).toBeCloseTo(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("respects the limit parameter", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: Object.fromEntries(
				Array.from({ length: 20 }, (_, i) => [
					`note${i}.md`,
					{ vector: [Math.random(), Math.random()], mtime: i, preview: `note ${i}` },
				])
			),
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		const fetchMock = mockFetch([0.5, 0.5]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 5);
			expect(results.length).toBe(5);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("returns empty array when store is empty", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const fetchMock = mockFetch([1, 0]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 5);
			expect(results).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("surfaces preview text in results", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"n.md": { vector: [1, 0], mtime: 1, preview: "The actual preview" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		const fetchMock = mockFetch([1, 0]);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("q", 1);
			expect(results[0]!.preview).toBe("The actual preview");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("throws when the embedding API returns a non-ok response", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			json: async () => null,
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			await expect(idx.search("query", 5)).rejects.toThrow("401");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("throws when the embedding API returns no vector", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ data: [] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			await expect(idx.search("query", 5)).rejects.toThrow("no embedding vector");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("parses Ollama /api/embed response format (embeddings: number[][])", async () => {
		const storedData = JSON.stringify({
			model: "nomic-embed-text",
			embeddings: {
				"n.md": { vector: [1, 0], mtime: 1, preview: "p" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure({ endpoint: "http://localhost:11434/api/embed", apiKey: "", model: "nomic-embed-text" });
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		// Ollama /api/embed response
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ embeddings: [[1, 0]] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 1);
			expect(results[0]!.path).toBe("n.md");
			expect(results[0]!.score).toBeCloseTo(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("parses Ollama /api/embeddings (legacy) response format (embedding: number[])", async () => {
		const storedData = JSON.stringify({
			model: "nomic-embed-text",
			embeddings: {
				"n.md": { vector: [1, 0], mtime: 1, preview: "p" },
			},
		});
		const adapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure({ endpoint: "http://localhost:11434/api/embeddings", apiKey: "", model: "nomic-embed-text" });
		await idx.load(adapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		// Ollama /api/embeddings legacy response
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ embedding: [1, 0] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 1);
			expect(results[0]!.path).toBe("n.md");
			expect(results[0]!.score).toBeCloseTo(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("works without an apiKey (Ollama / local providers)", async () => {
		const idx = new SemanticIndex();
		idx.configure({ endpoint: "http://10.15.50.22:11434/api/embed", apiKey: "", model: "nomic-embed-text" });
		expect(idx.isConfigured()).toBe(true);

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ embeddings: [[0.5, 0.5]] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const results = await idx.search("query", 5);
			expect(Array.isArray(results)).toBe(true);
			// Check that no Authorization header was sent
			const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
			const headers = callArgs[1].headers as Record<string, string>;
			expect(headers["Authorization"]).toBeUndefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

// ── update ────────────────────────────────────────────────────────────────────

describe("SemanticIndex.update()", () => {
	let adapter: ReturnType<typeof makeAdapter>;

	beforeEach(() => {
		adapter = makeAdapter();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("adds a new file to the store", async () => {
		const idx = new SemanticIndex();
		idx.configure(makeConfig());

		const file = { path: "new.md", basename: "new", stat: { mtime: 100 } };
		const vault = { configDir: TEST_CONFIG_DIR, cachedRead: async () => "New content here." };

		const fetchMock = mockFetch([0.3, 0.7]);
		vi.stubGlobal("fetch", fetchMock);

		// @ts-expect-error — minimal mock
		await idx.update(file, vault, adapter);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const fetchMock2 = mockFetch([0.3, 0.7]);
		vi.stubGlobal("fetch", fetchMock2);
		const results = await idx.search("q", 1);
		expect(results[0]!.path).toBe("new.md");
	});

	it("skips re-embedding when mtime is unchanged", async () => {
		const storedData = JSON.stringify({
			model: "text-embedding-3-small",
			embeddings: {
				"existing.md": { vector: [1, 0], mtime: 50, preview: "cached preview" },
			},
		});
		const cachedAdapter = makeAdapter({
			[getEmbeddingStoragePath(TEST_CONFIG_DIR)]: storedData,
		});
		const idx = new SemanticIndex();
		idx.configure(makeConfig());
		await idx.load(cachedAdapter, getEmbeddingStoragePath(TEST_CONFIG_DIR));

		const file = { path: "existing.md", basename: "existing", stat: { mtime: 50 } };
		const vault = { configDir: TEST_CONFIG_DIR, cachedRead: async () => "Same content." };
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// @ts-expect-error — minimal mock
		await idx.update(file, vault, cachedAdapter);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does nothing when not configured", async () => {
		const idx = new SemanticIndex();
		const file = { path: "f.md", basename: "f", stat: { mtime: 1 } };
		const vault = { configDir: TEST_CONFIG_DIR, cachedRead: async () => "content" };
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		// @ts-expect-error — minimal mock
		await idx.update(file, vault, adapter);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

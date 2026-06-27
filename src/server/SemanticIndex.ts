import { requestUrl } from "obsidian";
import { TFile, Vault } from "obsidian";
import {
	BATCH_SIZE,
	getEmbeddingStorageDir,
	EMBEDDING_TEXT_MAX_CHARS,
} from "../constants";

/**
 * Minimal subset of Obsidian's MinimalAdapter used by SemanticIndex.
 * Defined locally so tests can pass lightweight mocks without
 * satisfying the full MinimalAdapter interface.
 */
export interface MinimalAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface EmbeddingConfig {
	endpoint: string;
	apiKey: string;
	model: string;
}

export interface EmbeddingEntry {
	vector: number[];
	mtime: number;
	/** Short content preview returned in search results. */
	preview: string;
}

export interface SemanticSearchResult {
	path: string;
	score: number;
	preview: string;
}

// ── Internal storage format ───────────────────────────────────────────────────

interface MetadataFormat {
	model: string;
}

// ── Embedding API response types ─────────────────────────────────────────────
// Three formats are supported:
//   OpenAI / v1/embeddings  → { data: [{ embedding: number[] }] }
//   Ollama /api/embed       → { embeddings: number[][] }
//   Ollama /api/embeddings  → { embedding: number[] }

interface OpenAiEmbeddingResponse {
	data: Array<{ embedding: number[] }>;
}

interface OllamaEmbedResponse {
	embeddings: number[][];
}

interface OllamaEmbeddingsResponse {
	embedding: number[];
}

type EmbeddingApiResponse = OpenAiEmbeddingResponse | OllamaEmbedResponse | OllamaEmbeddingsResponse;

/**
 * Manages a local cache of vector embeddings for every markdown note in the vault.
 *
 * Embeddings are generated via any OpenAI-compatible `/embeddings` endpoint
 * (OpenAI, Azure OpenAI, Ollama, etc.) and persisted to
 * `<configDir>/plugins/obsidian-mcp-server/embeddings` (sharded JSON files).
 *
 * Incremental updates: only re-embeds files whose `mtime` changed since the
 * last build, making repeated startups cheap after the initial indexing.
 */
export class SemanticIndex {
	private store: Record<string, EmbeddingEntry> = {};
	private dirtyShards = new Set<string>();
	private config: EmbeddingConfig | null = null;

	// ── Configuration ─────────────────────────────────────────────────────────

	configure(config: EmbeddingConfig): void {
		this.config = config;
	}

	isConfigured(): boolean {
		// apiKey is intentionally not required — local providers (e.g. Ollama) have no key.
		return (
			this.config !== null &&
			this.config.endpoint.length > 0 &&
			this.config.model.length > 0
		);
	}

	private getShardId(path: string): string {
		let hash = 5381;
		for (let i = 0; i < path.length; i++) {
			hash = (hash * 33) ^ path.charCodeAt(i);
		}
		return ((hash >>> 0) % 256).toString(16).padStart(2, "0");
	}

	// ── Persistence ───────────────────────────────────────────────────────────

	async load(adapter: MinimalAdapter, storageDir: string): Promise<void> {
		this.store = {};
		this.dirtyShards.clear();

		try {
			if (!(await adapter.exists(storageDir))) return;

			const metadataPath = `${storageDir}/metadata.json`;
			if (!(await adapter.exists(metadataPath))) {
				// No metadata, consider stale
				return;
			}

			const rawMetadata = await adapter.read(metadataPath);
			const metadata = JSON.parse(rawMetadata) as MetadataFormat;

			if (metadata.model !== this.config?.model) {
				// Model changed — discard stale vectors
				const listed = await adapter.list(storageDir);
				for (const file of listed.files) {
					await adapter.remove(file).catch(() => {});
				}
				return;
			}

			const listed = await adapter.list(storageDir);
			for (const file of listed.files) {
				if (file.endsWith("metadata.json")) continue;
				try {
					const raw = await adapter.read(file);
					const shardData = JSON.parse(raw) as Record<string, EmbeddingEntry>;
					Object.assign(this.store, shardData);
				} catch {
					// Ignore corrupted shard
				}
			}
		} catch {
			this.store = {};
		}
	}

	async save(adapter: MinimalAdapter, storageDir: string): Promise<void> {
		if (!(await adapter.exists(storageDir))) {
			await adapter.mkdir(storageDir);
		}

		const metadataPath = `${storageDir}/metadata.json`;
		if (!(await adapter.exists(metadataPath))) {
			await adapter.write(metadataPath, JSON.stringify({ model: this.config?.model ?? "" }));
		}

		if (this.dirtyShards.size === 0) return;

		// Group store entries by shard to write
		const shardContents: Record<string, Record<string, EmbeddingEntry>> = {};
		for (const shard of this.dirtyShards) {
			shardContents[shard] = {};
		}

		for (const [path, entry] of Object.entries(this.store)) {
			const shard = this.getShardId(path);
			if (this.dirtyShards.has(shard)) {
				shardContents[shard]![path] = entry;
			}
		}

		for (const shard of this.dirtyShards) {
			const shardPath = `${storageDir}/${shard}.json`;
			const entries = shardContents[shard]!;
			if (Object.keys(entries).length === 0) {
				if (await adapter.exists(shardPath)) {
					await adapter.remove(shardPath);
				}
			} else {
				await adapter.write(shardPath, JSON.stringify(entries));
			}
		}

		this.dirtyShards.clear();
	}

	// ── Index management ──────────────────────────────────────────────────────

	/**
	 * Builds (or refreshes) the full index.
	 * Skips files whose `mtime` matches the stored entry (incremental).
	 * Removes entries for deleted files.
	 * Saves to disk when done.
	 */
	async build(vault: Vault, adapter: MinimalAdapter): Promise<void> {
		if (!this.isConfigured()) return;
		const storageDir = getEmbeddingStorageDir(vault.configDir);
		await this.load(adapter, storageDir);

		const files = vault.getMarkdownFiles();
		for (let i = 0; i < files.length; i += BATCH_SIZE) {
			const batch = files.slice(i, i + BATCH_SIZE);
			await Promise.all(
				batch.map(async (file) => {
					const existing = this.store[file.path];
					if (existing && existing.mtime === file.stat.mtime) return;
					await this.indexFile(file, vault);
				})
			);
		}

		// Remove entries for files that no longer exist in the vault
		const filePaths = new Set(files.map((f) => f.path));
		for (const path of Object.keys(this.store)) {
			if (!filePaths.has(path)) {
				this.removeFile(path);
			}
		}

		await this.save(adapter, storageDir);
	}

	/**
	 * Updates the index for a single file (called from vault `modify`/`create` events,
	 * debounced by the caller). Saves to disk after updating.
	 */
	async update(file: TFile, vault: Vault, adapter: MinimalAdapter): Promise<void> {
		if (!this.isConfigured()) return;
		const existing = this.store[file.path];
		if (existing && existing.mtime === file.stat.mtime) return;
		await this.indexFile(file, vault);
		await this.save(adapter, getEmbeddingStorageDir(vault.configDir));
	}

	/** Removes a file's entry from the in-memory store (no disk write; batched via build). */
	removeFile(path: string): void {
		if (this.store[path]) {
			delete this.store[path];
			this.dirtyShards.add(this.getShardId(path));
		}
	}

	// ── Search ────────────────────────────────────────────────────────────────

	/**
	 * Embeds the query and returns the top-`limit` notes ranked by cosine similarity.
	 * Throws if the index is not configured.
	 */
	async search(query: string, limit: number): Promise<SemanticSearchResult[]> {
		if (!this.isConfigured()) {
			throw new Error(
				"Busca semântica não configurada. " +
				"Ative e configure o endpoint de embeddings nas configurações do plugin MCP Server."
			);
		}

		const queryVector = await this.embed(query);

		const results: SemanticSearchResult[] = Object.entries(this.store).map(
			([path, entry]) => ({
				path,
				score: this.cosineSimilarity(queryVector, entry.vector),
				preview: entry.preview,
			})
		);

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
	}

	// ── Pure helpers (exported for testability) ───────────────────────────────

	/**
	 * Extracts a short representative text for a note:
	 * title + first non-empty paragraph after frontmatter, truncated to
	 * EMBEDDING_TEXT_MAX_CHARS.
	 */
	extractDocText(title: string, content: string): string {
		// Strip YAML frontmatter block
		const withoutFm = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
		// Find first non-empty paragraph
		const firstParagraph =
			withoutFm.split(/\n\n+/).find((p) => p.trim().length > 0) ?? "";
		const combined = `${title}\n\n${firstParagraph}`;
		return combined.slice(0, EMBEDDING_TEXT_MAX_CHARS);
	}

	/**
	 * Computes the cosine similarity between two vectors.
	 * Returns 0 for mismatched lengths or zero-norm vectors.
	 */
	cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length || a.length === 0) return 0;
		let dot = 0, normA = 0, normB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i]! * b[i]!;
			normA += a[i]! * a[i]!;
			normB += b[i]! * b[i]!;
		}
		const denom = Math.sqrt(normA) * Math.sqrt(normB);
		return denom === 0 ? 0 : dot / denom;
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private async indexFile(file: TFile, vault: Vault): Promise<void> {
		const content = await vault.cachedRead(file);
		const text = this.extractDocText(file.basename, content);
		const preview = content.slice(0, 160).replace(/\n/g, " ");
		try {
			const vector = await this.embed(text);
			this.store[file.path] = { vector, mtime: file.stat.mtime, preview };
			this.dirtyShards.add(this.getShardId(file.path));
		} catch {
			// Skip files that fail to embed (transient API errors, etc.)
		}
	}

	private async embed(text: string): Promise<number[]> {
		if (!this.config) throw new Error("SemanticIndex not configured");

		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.config.apiKey) {
			headers["Authorization"] = `Bearer ${this.config.apiKey}`;
		}

		const response = await requestUrl({
			url: this.config.endpoint,
			method: "POST",
			headers,
			body: JSON.stringify({ model: this.config.model, input: text }),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Embedding API error: ${response.status}`);
		}

		const data = response.json as EmbeddingApiResponse;

		// OpenAI / v1/embeddings format
		if ("data" in data && Array.isArray(data.data)) {
			const embedding = data.data[0]?.embedding;
			if (embedding && embedding.length > 0) return embedding;
		}

		// Ollama /api/embed format
		if ("embeddings" in data && Array.isArray(data.embeddings)) {
			const embedding = data.embeddings[0];
			if (embedding && embedding.length > 0) return embedding;
		}

		// Ollama /api/embeddings (legacy) format
		if ("embedding" in data && Array.isArray(data.embedding)) {
			const embedding = data.embedding;
			if (embedding.length > 0) return embedding;
		}

		throw new Error("Embedding API returned no embedding vector");
	}
}

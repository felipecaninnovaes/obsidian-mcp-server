import { TAbstractFile, TFile, Vault } from "obsidian";
import { extractTokens } from "./textUtils";
import { BATCH_SIZE } from "../constants";

/**
 * Token-based inverted index for full-text search pre-filtering.
 *
 * Maps lowercase word tokens → Set of vault-relative paths that contain them.
 * The index is built lazily on first search and kept up-to-date via vault events
 * registered in the plugin's onload().
 *
 * Usage pattern:
 *   const candidates = await vaultIndex.getCandidates(query, vault);
 *   // candidates is a Set of paths whose content likely contains all query tokens.
 *   // Verify exact phrase match within this smaller candidate set.
 */
export class VaultIndex {
	private readonly tokenIndex = new Map<string, Set<string>>();
	/** Reverse map: path → Set of tokens it contributes. Enables O(1) removeFile. */
	private readonly pathTokens = new Map<string, Set<string>>();
	private built = false;
	/** In-flight build promise — shared across concurrent getCandidates() callers. */
	private buildPromise: Promise<void> | null = null;

	isBuilt(): boolean {
		return this.built;
	}

	/** Number of documents (markdown files) currently indexed. */
	getTotalDocs(): number {
		return this.pathTokens.size;
	}

	/** Number of documents that contain the given token (for IDF calculation). */
	getTokenDocCount(token: string): number {
		return this.tokenIndex.get(token.toLowerCase())?.size ?? 0;
	}

	/**
	 * Starts a background build without blocking.
	 * Call from onload() so the index is ready before the first search request.
	 * Subsequent calls while a build is already running are no-ops.
	 */
	buildInBackground(vault: Vault): void {
		if (!this.built && !this.buildPromise) {
			this.buildPromise = this.build(vault).finally(() => {
				this.buildPromise = null;
			});
		}
	}

	/** Lazily builds the index if not already built, then returns candidate paths. */
	async getCandidates(query: string, vault: Vault): Promise<Set<string> | null> {
		await this.ensureBuilt(vault);
		return this.lookup(query);
	}

	/** Update a single file in the index (call on vault modify/create events). */
	async update(file: TAbstractFile, vault: Vault): Promise<void> {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.removeFile(file.path);
		const content = await vault.cachedRead(file);
		this.indexContent(file.path, content);
	}

	/**
	 * Remove a file from the index (call on vault delete/rename events).
	 * O(tokens_do_arquivo) instead of O(tokens_totais_do_vault).
	 */
	removeFile(path: string): void {
		const tokens = this.pathTokens.get(path);
		if (!tokens) return;
		for (const token of tokens) {
			this.tokenIndex.get(token)?.delete(path);
		}
		this.pathTokens.delete(path);
	}

	// ── Private ──────────────────────────────────────────────────────────────

	private async ensureBuilt(vault: Vault): Promise<void> {
		if (this.built) return;
		if (this.buildPromise) {
			await this.buildPromise;
			return;
		}
		await this.build(vault);
	}

	private async build(vault: Vault): Promise<void> {
		this.tokenIndex.clear();
		this.pathTokens.clear();
		const files = vault.getMarkdownFiles();
		for (let i = 0; i < files.length; i += BATCH_SIZE) {
			const batch = files.slice(i, i + BATCH_SIZE);
			const items = await Promise.all(
				batch.map(async (f) => ({ path: f.path, content: await vault.cachedRead(f) }))
			);
			for (const { path, content } of items) {
				this.indexContent(path, content);
			}
		}
		this.built = true;
	}

	private indexContent(path: string, content: string): void {
		const tokens = extractTokens(content);
		// Maintain reverse map for O(1) removeFile
		let pathSet = this.pathTokens.get(path);
		if (!pathSet) {
			pathSet = new Set();
			this.pathTokens.set(path, pathSet);
		}
		for (const token of tokens) {
			pathSet.add(token);
			let set = this.tokenIndex.get(token);
			if (!set) {
				set = new Set();
				this.tokenIndex.set(token, set);
			}
			set.add(path);
		}
	}

	/**
	 * Returns the intersection of token sets for all tokens in the query.
	 * Returns null if the index is not built or the query has no tokens.
	 * Returns an empty Set if any token has zero matches (guaranteed no results).
	 */
	private lookup(query: string): Set<string> | null {
		const tokens = extractTokens(query);
		if (tokens.length === 0) return null;

		const sets = tokens
			.map((t) => this.tokenIndex.get(t) ?? new Set<string>())
			.sort((a, b) => a.size - b.size); // smallest first for fast intersection

		const first = sets[0];
		if (!first || first.size === 0) return new Set(); // rarest token has zero matches

		const result = new Set(first);
		for (let i = 1; i < sets.length; i++) {
			const s = sets[i]!;
			for (const path of result) {
				if (!s.has(path)) result.delete(path);
			}
		}
		return result;
	}
}

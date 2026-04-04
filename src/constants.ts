/** Centralized constants — import from here instead of hardcoding values. */

export const MAX_SESSIONS = 10;
export const BATCH_SIZE = 50;
export const VAULT_DEBOUNCE_MS = 500;

export const MAX_CONTENT_LENGTH = 10_000_000; // 10 MB
export const MAX_QUERY_LENGTH = 1_000;
export const MAX_PATH_LENGTH = 512;

export const MAX_AUTH_FAILURES = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_CLEANUP_MS = 5 * 60_000;

export const MAX_BODY_SIZE = 11 * 1024 * 1024;

export const SEARCH_RESULTS_DEFAULT = 20;
export const QUERY_RESULTS_DEFAULT = 50;
export const QUERY_RESULTS_MAX = 200;

/** Maximum query length for regex mode (long patterns risk ReDoS). */
export const MAX_REGEX_QUERY_LENGTH = 200;
/** Maximum number of total regex matches before aborting a file scan. */
export const REGEX_MATCH_LIMIT = 1_000;

// ── Semantic search ───────────────────────────────────────────────────────────

/** Debounce delay before re-embedding a modified file (ms). */
export const EMBEDDING_DEBOUNCE_MS = 5_000;
/** Vault-relative path for the embeddings persistence file. */
export const EMBEDDING_STORAGE_PATH = ".obsidian/plugins/obsidian-mcp-server/embeddings.json";
/** Max characters of (title + first paragraph) sent to the embedding API. */
export const EMBEDDING_TEXT_MAX_CHARS = 500;
/** Default number of semantic search results. */
export const SEMANTIC_SEARCH_DEFAULT = 10;
/** Maximum number of semantic search results. */
export const SEMANTIC_SEARCH_MAX = 50;

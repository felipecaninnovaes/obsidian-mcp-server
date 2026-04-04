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

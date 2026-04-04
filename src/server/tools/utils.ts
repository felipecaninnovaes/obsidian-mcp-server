/**
 * Pure utility functions — no Obsidian dependency, fully testable.
 */

export const MAX_PATH_LENGTH = 512;

/**
 * Validates and normalizes a vault-relative path.
 * Rejects absolute paths, path traversal sequences, and paths that are too long.
 */
export function sanitizePath(path: string): string {
	if (path.length > MAX_PATH_LENGTH) {
		throw new Error("Path too long (max 512 characters)");
	}
	// Reject absolute paths and any traversal attempts
	if (path.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(path)) {
		throw new Error("Invalid path: absolute paths and directory traversal are not allowed");
	}
	// Normalize separators and collapse redundant segments
	const normalized = path
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== ".")
		.join("/");
	if (normalized.length === 0) {
		throw new Error("Invalid path: empty after normalization");
	}
	return normalized;
}

/**
 * Applies a find-and-replace edit to file content.
 * Throws if the text is not found or if the occurrence count doesn't match expectations.
 */
export function applyTextEdit(
	content: string,
	oldText: string,
	newText: string,
	expectedOccurrences: number
): { content: string; count: number } {
	let count = 0;
	let pos = 0;
	while ((pos = content.indexOf(oldText, pos)) !== -1) {
		count++;
		pos += oldText.length;
	}

	if (count === 0) {
		throw new Error("Texto não encontrado na nota");
	}
	if (count !== expectedOccurrences) {
		throw new Error(
			`Esperado ${expectedOccurrences} ocorrência(s), mas encontrado ${count}. ` +
			`Passe expected_occurrences: ${count} para confirmar a substituição.`
		);
	}

	return { content: content.split(oldText).join(newText), count };
}

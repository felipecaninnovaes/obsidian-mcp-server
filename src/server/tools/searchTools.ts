import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";
import { VaultIndex } from "../VaultIndex";
import {
	MAX_QUERY_LENGTH,
	BATCH_SIZE,
	SEARCH_RESULTS_DEFAULT,
	QUERY_RESULTS_DEFAULT,
	QUERY_RESULTS_MAX,
} from "../../constants";

export function registerSearchTools(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	registerSearchVault(server, app, vaultIndex);
	registerQueryVault(server, app);
}

function registerSearchVault(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	server.registerTool(
		"search_vault",
		{
			description:
				"Busca por texto em todas as notas do vault. " +
				"Modo 'phrase' (padrão): substring exata. " +
				"Modo 'tokens': todos os termos devem aparecer na nota, em qualquer ordem (útil quando a frase exata não é conhecida).",
			inputSchema: {
				query: z.string().min(1).max(MAX_QUERY_LENGTH),
				case_sensitive: z.boolean().optional().default(false),
				mode: z
					.enum(["phrase", "tokens"])
					.optional()
					.default("phrase")
					.describe(
						"'phrase': busca substring exata (default). " +
						"'tokens': busca notas que contenham TODOS os termos da query, em qualquer ordem."
					),
			},
		},
		async ({ query, case_sensitive, mode }) => {
			const allFiles = app.vault.getMarkdownFiles();
			const results: { path: string; matches: number; excerpt: string; match_type: string }[] = [];

			if (mode === "tokens") {
				// Token mode: use VaultIndex to find files containing all query tokens
				const candidates = await vaultIndex.getCandidates(query, app.vault);
				const filesToSearch =
					candidates === null
						? allFiles
						: allFiles.filter((f) => candidates.has(f.path));

				for (let i = 0; i < filesToSearch.length; i += BATCH_SIZE) {
					const batch = filesToSearch.slice(i, i + BATCH_SIZE);
					const items = await Promise.all(
						batch.map(async (file) => ({ file, content: await app.vault.cachedRead(file) }))
					);
					for (const { file, content } of items) {
						// Build a short excerpt showing the first token match
						const firstToken = query.split(/\s+/).find((t) => t.length >= 2) ?? query;
						const searchIn = case_sensitive ? content : content.toLowerCase();
						const idx = searchIn.indexOf(case_sensitive ? firstToken : firstToken.toLowerCase());
						const excerpt =
							idx !== -1
								? "..." + content.slice(Math.max(0, idx - 80), idx + firstToken.length + 80).replace(/\n/g, " ") + "..."
								: content.slice(0, 160).replace(/\n/g, " ");
						results.push({ path: file.path, matches: 1, excerpt, match_type: "tokens" });
					}
				}
			} else {
				// Phrase mode: exact substring search, with automatic token fallback if zero results
				const searchFor = case_sensitive ? query : query.toLowerCase();

				// Pre-filter with VaultIndex for case-insensitive queries
				const candidates = case_sensitive
					? null
					: await vaultIndex.getCandidates(query, app.vault);

				const filesToSearch =
					candidates === null
						? allFiles
						: allFiles.filter((f) => candidates.has(f.path));

				for (let i = 0; i < filesToSearch.length; i += BATCH_SIZE) {
					const batch = filesToSearch.slice(i, i + BATCH_SIZE);
					const items = await Promise.all(
						batch.map(async (file) => ({ file, content: await app.vault.cachedRead(file) }))
					);
					for (const { file, content } of items) {
						const searchIn = case_sensitive ? content : content.toLowerCase();
						if (!searchIn.includes(searchFor)) continue;
						const idx = searchIn.indexOf(searchFor);
						const excerpt =
							"..." +
							content.slice(Math.max(0, idx - 100), idx + query.length + 100).replace(/\n/g, " ") +
							"...";
						let matchCount = 0;
						let pos = 0;
						while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) { matchCount++; pos += searchFor.length; }
						results.push({ path: file.path, matches: matchCount, excerpt, match_type: "phrase" });
					}
				}

				// Auto-fallback to token search when phrase finds nothing
				if (results.length === 0) {
					const tokenCandidates = await vaultIndex.getCandidates(query, app.vault);
					if (tokenCandidates && tokenCandidates.size > 0) {
						const tokenFiles = allFiles.filter((f) => tokenCandidates.has(f.path));
						for (let i = 0; i < tokenFiles.length; i += BATCH_SIZE) {
							const batch = tokenFiles.slice(i, i + BATCH_SIZE);
							const items = await Promise.all(
								batch.map(async (file) => ({ file, content: await app.vault.cachedRead(file) }))
							);
							for (const { file, content } of items) {
								const firstToken = query.split(/\s+/).find((t) => t.length >= 2) ?? query;
								const searchIn = case_sensitive ? content : content.toLowerCase();
								const idx = searchIn.indexOf(case_sensitive ? firstToken : firstToken.toLowerCase());
								const excerpt =
									idx !== -1
										? "..." + content.slice(Math.max(0, idx - 80), idx + firstToken.length + 80).replace(/\n/g, " ") + "..."
										: content.slice(0, 160).replace(/\n/g, " ");
								results.push({ path: file.path, matches: 1, excerpt, match_type: "tokens_fallback" });
							}
						}
					}
				}
			}

			results.sort((a, b) => b.matches - a.matches);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ query, mode, total_files_matched: results.length, results: results.slice(0, SEARCH_RESULTS_DEFAULT) },
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerQueryVault(server: McpServer, app: App): void {
	server.registerTool(
		"query_vault",
		{
			description:
				"Busca notas por tags, propriedades de frontmatter ou links de saída, usando o cache do Obsidian " +
				"(sem ler arquivos do disco). Todos os filtros fornecidos são aplicados em conjunto (AND).",
			inputSchema: {
				tags: z
					.array(z.string().max(100))
					.max(20)
					.optional()
					.describe("Notas que contêm TODAS as tags listadas. Ex: [\"#projeto\", \"ativo\"]"),
				properties: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Pares chave/valor do frontmatter que devem corresponder. Ex: { \"status\": \"ativo\" }"),
				links_to: z
					.string()
					.max(MAX_PATH_LENGTH)
					.optional()
					.describe("Retorna notas que linkam para este caminho (ex: Pasta/Nota.md)"),
				has_frontmatter: z
					.boolean()
					.optional()
					.describe("Se true, retorna só notas COM frontmatter; se false, só notas SEM."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(QUERY_RESULTS_MAX)
					.optional()
					.default(QUERY_RESULTS_DEFAULT)
					.describe(`Máximo de resultados (default ${QUERY_RESULTS_DEFAULT}, max ${QUERY_RESULTS_MAX})`),
			},
		},
		async ({ tags, properties, links_to, has_frontmatter, limit }) => {
			// Resolve target path for links_to filter
			let targetPath: string | null = null;
			if (links_to) {
				const safeLinksTo = sanitizePath(links_to);
				const targetFile = resolveNoteFile(app, safeLinksTo);
				if (!targetFile) throw new Error(`Nota não encontrada: ${safeLinksTo}`);
				targetPath = targetFile.path;
			}

			// Normalize tags: ensure all start with '#'
			const normalizedFilterTags = tags?.map((t) => (t.startsWith("#") ? t : `#${t}`));

			const results: { path: string; tags: string[]; frontmatter: Record<string, unknown> | null }[] = [];

			for (const file of app.vault.getMarkdownFiles()) {
				const cache = app.metadataCache.getFileCache(file);

				// Filter: has_frontmatter
				if (has_frontmatter !== undefined) {
					if ((cache?.frontmatter != null) !== has_frontmatter) continue;
				}

				// Collect all tags (inline + frontmatter)
				const fileTags = new Set<string>();
				for (const { tag } of cache?.tags ?? []) fileTags.add(tag);
				const fmTags: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						if (typeof t === "string") fileTags.add(t.startsWith("#") ? t : `#${t}`);
					}
				}

				// Filter: tags (all must be present)
				if (normalizedFilterTags && normalizedFilterTags.length > 0) {
					if (!normalizedFilterTags.every((t) => fileTags.has(t))) continue;
				}

				// Filter: properties (all key/value pairs must match frontmatter)
				if (properties && Object.keys(properties).length > 0) {
					const fm = cache?.frontmatter;
					if (!fm) continue;
					const match = Object.entries(properties).every(
						([k, v]) => JSON.stringify(fm[k]) === JSON.stringify(v)
					);
					if (!match) continue;
				}

				// Filter: links_to (file must have a resolved link to targetPath)
				if (targetPath) {
					const resolved = app.metadataCache.resolvedLinks[file.path] ?? {};
					if (!resolved[targetPath]) continue;
				}

				// Build safe frontmatter (strip Obsidian internal 'position' key)
				let frontmatter: Record<string, unknown> | null = null;
				if (cache?.frontmatter) {
					frontmatter = Object.fromEntries(
						Object.entries(cache.frontmatter).filter(([k]) => k !== "position")
					);
				}

				results.push({ path: file.path, tags: Array.from(fileTags), frontmatter });
				if (results.length >= limit) break;
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ total: results.length, results }, null, 2),
					},
				],
			};
		}
	);
}

import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";
import { VaultIndex } from "../VaultIndex";
import { extractTokens } from "../textUtils";
import { computeScore, buildSmartExcerpt, paginate, execRegexSearch } from "../searchLogic";
import {
	MAX_QUERY_LENGTH,
	MAX_REGEX_QUERY_LENGTH,
	REGEX_MATCH_LIMIT,
	BATCH_SIZE,
	SEARCH_RESULTS_DEFAULT,
	QUERY_RESULTS_DEFAULT,
	QUERY_RESULTS_MAX,
} from "../../constants";

export function registerSearchTools(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	registerSearchVault(server, app, vaultIndex);
	registerQueryVault(server, app, vaultIndex);
}

// ── search_vault ──────────────────────────────────────────────────────────────

function registerSearchVault(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	server.registerTool(
		"search_vault",
		{
			description:
				"Busca por texto em todas as notas do vault. " +
				"Modo 'phrase' (padrão): substring exata, resultados ordenados por score TF-IDF. " +
				"Modo 'tokens': todos os termos devem aparecer na nota, em qualquer ordem. " +
				"Modo 'regex': expressão regular JavaScript (máx 200 chars na query). " +
				"Suporta paginação via offset/limit.",
			inputSchema: {
				query: z.string().min(1).max(MAX_QUERY_LENGTH),
				case_sensitive: z.boolean().optional().default(false),
				mode: z
					.enum(["phrase", "tokens", "regex"])
					.optional()
					.default("phrase")
					.describe(
						"'phrase': busca substring exata (default). " +
						"'tokens': busca notas que contenham TODOS os termos, em qualquer ordem. " +
						"'regex': expressão regular JavaScript (max 200 chars, aborta após 1000 matches)."
					),
				offset: z.number().int().min(0).optional().default(0)
					.describe("Índice do primeiro resultado a retornar (default 0)."),
				limit: z.number().int().min(1).max(200).optional().default(SEARCH_RESULTS_DEFAULT)
					.describe(`Máximo de resultados por página (default ${SEARCH_RESULTS_DEFAULT}, max 200).`),
			},
		},
		async ({ query, case_sensitive, mode, offset, limit }) => {
			const allFiles = app.vault.getMarkdownFiles();
			const queryLower = query.toLowerCase();

			// Pre-compute VaultIndex stats for TF-IDF (best-effort — may be 0 if not built)
			const totalDocs = vaultIndex.getTotalDocs();
			// Use the rarest query token as the IDF discriminator
			const queryTokens = extractTokens(query);
			const docsWithTerm = queryTokens.length > 0
				? Math.min(...queryTokens.map((t) => {
					const c = vaultIndex.getTokenDocCount(t);
					return c > 0 ? c : Infinity;
				  }).map((v) => (v === Infinity ? 0 : v)))
				: 0;

			type SearchResult = {
				path: string;
				score: number;
				excerpt: string;
				match_type: string;
			};
			const results: SearchResult[] = [];

			if (mode === "regex") {
				if (query.length > MAX_REGEX_QUERY_LENGTH) {
					throw new Error(
						`Query regex excede o limite de ${MAX_REGEX_QUERY_LENGTH} caracteres (recebeu ${query.length}).`
					);
				}

				// Compile the regex — surface syntax errors immediately
				let regex: RegExp;
				try {
					const flags = case_sensitive ? "g" : "gi";
					regex = new RegExp(query, flags);
				} catch (e) {
					throw new Error(`Regex inválido: ${e instanceof Error ? e.message : String(e)}`);
				}

				let totalMatchCount = 0;
				let aborted = false;

				for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
					if (aborted) break;
					const batch = allFiles.slice(i, i + BATCH_SIZE);
					const items = await Promise.all(
						batch.map(async (file) => ({ file, content: await app.vault.cachedRead(file) }))
					);
					for (const { file, content } of items) {
						const remaining = REGEX_MATCH_LIMIT - totalMatchCount;
						if (remaining <= 0) { aborted = true; break; }

						const hit = execRegexSearch(content, regex, remaining);
						if (!hit) continue;

						totalMatchCount += hit.matchCount;
						if (hit.limitReached) aborted = true;

						const excerpt = buildSmartExcerpt(content, hit.firstMatchIdx, hit.firstMatchLen);
						const score = computeScore({
							content,
							queryLower: query.toLowerCase(),
							matchCount: hit.matchCount,
							totalDocs,
							docsWithTerm,
							mtime: file.stat.mtime,
						});
						results.push({ path: file.path, score, excerpt, match_type: "regex" });
					}
				}

				if (aborted) {
					results.sort((a, b) => b.score - a.score);
					const { page, total_results } = paginate(results, offset, limit);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										query, mode, total_results, offset, limit,
										warning: `Limite de ${REGEX_MATCH_LIMIT} matches atingido — resultados parciais.`,
										results: page,
									},
									null, 2
								),
							},
						],
					};
				}
			} else if (mode === "tokens") {
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
						const firstToken = queryTokens.find((t) => t.length >= 2) ?? queryLower;
						const searchIn = case_sensitive ? content : content.toLowerCase();
						const idx = searchIn.indexOf(case_sensitive ? firstToken : firstToken.toLowerCase());
						const excerpt = idx !== -1
							? buildSmartExcerpt(content, idx, firstToken.length)
							: content.slice(0, 160).replace(/\n/g, " ");
						const score = computeScore({
							content,
							queryLower,
							matchCount: 1,
							totalDocs,
							docsWithTerm,
							mtime: file.stat.mtime,
						});
						results.push({ path: file.path, score, excerpt, match_type: "tokens" });
					}
				}
			} else {
				// Phrase mode — exact substring, TF-IDF scored
				const searchFor = case_sensitive ? query : queryLower;
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

						// Count occurrences
						let matchCount = 0;
						let pos = 0;
						while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) {
							matchCount++;
							pos += searchFor.length;
						}

						const idx = searchIn.indexOf(searchFor);
						const excerpt = buildSmartExcerpt(content, idx, query.length);
						const score = computeScore({
							content,
							queryLower,
							matchCount,
							totalDocs,
							docsWithTerm,
							mtime: file.stat.mtime,
						});
						results.push({ path: file.path, score, excerpt, match_type: "phrase" });
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
								const firstToken = queryTokens.find((t) => t.length >= 2) ?? queryLower;
								const searchIn = case_sensitive ? content : content.toLowerCase();
								const idx = searchIn.indexOf(firstToken);
								const excerpt = idx !== -1
									? buildSmartExcerpt(content, idx, firstToken.length)
									: content.slice(0, 160).replace(/\n/g, " ");
								const score = computeScore({
									content,
									queryLower,
									matchCount: 1,
									totalDocs,
									docsWithTerm,
									mtime: file.stat.mtime,
								});
								results.push({ path: file.path, score, excerpt, match_type: "tokens_fallback" });
							}
						}
					}
				}
			}

			// Sort by score descending (highest relevance first)
			results.sort((a, b) => b.score - a.score);

			const { page, total_results } = paginate(results, offset, limit);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ query, mode, total_results, offset, limit, results: page },
							null,
							2
						),
					},
				],
			};
		}
	);
}

// ── query_vault ───────────────────────────────────────────────────────────────

function registerQueryVault(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	server.registerTool(
		"query_vault",
		{
			description:
				"Busca notas por tags, frontmatter, links, data de modificação ou conteúdo, " +
				"usando o cache do Obsidian. Todos os filtros são aplicados em conjunto (AND). " +
				"Suporta paginação via offset/limit. " +
				"Nota: 'content_contains' requer leitura de arquivo e é mais lento que os demais filtros.",
			inputSchema: {
				tags: z
					.array(z.string().max(100))
					.max(20)
					.optional()
					.describe("Notas com TODAS as tags. Ex: [\"#projeto\", \"ativo\"]"),
				properties: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Pares chave/valor do frontmatter. Ex: { \"status\": \"ativo\" }"),
				links_to: z
					.string()
					.max(MAX_PATH_LENGTH)
					.optional()
					.describe("Notas que linkam para este caminho."),
				has_frontmatter: z
					.boolean()
					.optional()
					.describe("true = só notas COM frontmatter; false = só notas SEM."),
				content_contains: z
					.string()
					.min(1)
					.max(MAX_QUERY_LENGTH)
					.optional()
					.describe("Filtra notas cujo conteúdo contém esta substring (requer leitura de arquivo)."),
				path_prefix: z
					.string()
					.max(MAX_PATH_LENGTH)
					.optional()
					.describe("Retorna só notas dentro desta pasta. Ex: \"Projetos/2026\""),
				modified_after: z
					.string()
					.optional()
					.describe("Retorna notas modificadas após esta data ISO 8601. Ex: \"2026-01-01T00:00:00Z\""),
				modified_before: z
					.string()
					.optional()
					.describe("Retorna notas modificadas antes desta data ISO 8601."),
				offset: z.number().int().min(0).optional().default(0)
					.describe("Índice do primeiro resultado (default 0)."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(QUERY_RESULTS_MAX)
					.optional()
					.default(QUERY_RESULTS_DEFAULT)
					.describe(`Máximo de resultados por página (default ${QUERY_RESULTS_DEFAULT}, max ${QUERY_RESULTS_MAX})`),
			},
		},
		async ({ tags, properties, links_to, has_frontmatter, content_contains, path_prefix, modified_after, modified_before, offset, limit }) => {
			// Resolve links_to target
			let targetPath: string | null = null;
			if (links_to) {
				const safeLinksTo = sanitizePath(links_to);
				const targetFile = resolveNoteFile(app, safeLinksTo);
				if (!targetFile) throw new Error(`Nota não encontrada: ${safeLinksTo}`);
				targetPath = targetFile.path;
			}

			// Normalize tags
			const normalizedFilterTags = tags?.map((t) => (t.startsWith("#") ? t : `#${t}`));

			// Parse date filters
			const modifiedAfterMs = modified_after ? new Date(modified_after).getTime() : null;
			const modifiedBeforeMs = modified_before ? new Date(modified_before).getTime() : null;

			// Normalize path_prefix (strip trailing slash)
			const normalizedPrefix = path_prefix
				? sanitizePath(path_prefix).replace(/\/$/, "")
				: null;

			// Pre-filter candidates for content_contains via VaultIndex
			let contentCandidates: Set<string> | null = null;
			if (content_contains) {
				contentCandidates = await vaultIndex.getCandidates(content_contains, app.vault);
			}

			type QueryResult = {
				path: string;
				tags: string[];
				frontmatter: Record<string, unknown> | null;
				mtime?: number;
			};
			const results: QueryResult[] = [];

			for (const file of app.vault.getMarkdownFiles()) {
				// Filter: path_prefix
				if (normalizedPrefix) {
					if (!file.path.startsWith(normalizedPrefix + "/") && file.path !== normalizedPrefix) continue;
				}

				// Filter: modified_after / modified_before
				if (modifiedAfterMs !== null && file.stat.mtime < modifiedAfterMs) continue;
				if (modifiedBeforeMs !== null && file.stat.mtime > modifiedBeforeMs) continue;

				// Filter: content_contains pre-filter (exact confirmation happens below)
				if (contentCandidates !== null && !contentCandidates.has(file.path)) continue;

				const cache = app.metadataCache.getFileCache(file);

				// Filter: has_frontmatter
				if (has_frontmatter !== undefined) {
					if ((cache?.frontmatter != null) !== has_frontmatter) continue;
				}

				// Collect tags (inline + frontmatter)
				const fileTags = new Set<string>();
				for (const { tag } of cache?.tags ?? []) fileTags.add(tag);
				const fmTags: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						if (typeof t === "string") fileTags.add(t.startsWith("#") ? t : `#${t}`);
					}
				}

				// Filter: tags (AND)
				if (normalizedFilterTags && normalizedFilterTags.length > 0) {
					if (!normalizedFilterTags.every((t) => fileTags.has(t))) continue;
				}

				// Filter: properties (AND)
				if (properties && Object.keys(properties).length > 0) {
					const fm = cache?.frontmatter;
					if (!fm) continue;
					if (!Object.entries(properties).every(([k, v]) => JSON.stringify(fm[k]) === JSON.stringify(v))) continue;
				}

				// Filter: links_to
				if (targetPath) {
					const resolved = app.metadataCache.resolvedLinks[file.path] ?? {};
					if (!resolved[targetPath]) continue;
				}

				// Filter: content_contains (exact confirmation — reads file)
				if (content_contains) {
					const fileContent = await app.vault.cachedRead(file);
					if (!fileContent.toLowerCase().includes(content_contains.toLowerCase())) continue;
				}

				// Build safe frontmatter (strip 'position' key)
				let frontmatter: Record<string, unknown> | null = null;
				if (cache?.frontmatter) {
					frontmatter = Object.fromEntries(
						Object.entries(cache.frontmatter).filter(([k]) => k !== "position")
					);
				}

				results.push({
					path: file.path,
					tags: Array.from(fileTags),
					frontmatter,
					...(modified_after || modified_before ? { mtime: file.stat.mtime } : {}),
				});
			}

			const { page, total_results } = paginate(results, offset, limit);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ total_results, offset, limit, results: page }, null, 2),
					},
				],
			};
		}
	);
}

import { App, TFile, TFolder, moment } from "obsidian";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, applyTextEdit, MAX_PATH_LENGTH } from "./utils";
import { VaultIndex } from "../VaultIndex";
import { logger } from "../../logger";

const MAX_CONTENT_LENGTH = 10_000_000; // 10 MB
const MAX_QUERY_LENGTH = 1_000;

/**
 * Resolves a vault path to a TFile, auto-appending ".md" when the path has no
 * extension and the bare path is not found. LLMs commonly omit the extension.
 */
function resolveNoteFile(app: App, safePath: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(safePath);
	if (direct instanceof TFile) return direct;
	if (!/\.[^/]+$/.test(safePath)) {
		const withMd = app.vault.getAbstractFileByPath(safePath + ".md");
		if (withMd instanceof TFile) return withMd;
	}
	return null;
}

export function registerTools(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	registerListFiles(server, app);
	registerReadNote(server, app);
	registerCreateNote(server, app);
	registerUpdateNote(server, app);
	registerDeleteNote(server, app);
	registerSearchVault(server, app, vaultIndex);
	registerGetActiveNote(server, app);
	registerGetVaultInfo(server, app);
	registerCreateFolder(server, app);
	registerGetBacklinks(server, app);
	registerRenameNote(server, app);
	registerGetNoteMetadata(server, app);
	registerListTags(server, app);
	registerGetNoteLinks(server, app);
	registerEditNote(server, app);
	registerQueryVault(server, app);
	registerGetDailyNote(server, app);
	registerGetGraphNeighbors(server, app);
	registerSuggestLinks(server, app);
	registerVaultResources(server, app);
}

function registerListFiles(server: McpServer, app: App): void {
	server.registerTool(
		"list_files",
		{
			description: "Lista arquivos e pastas do vault Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).optional().describe("Pasta do vault para listar. Raiz se omitido."),
				recursive: z.boolean().optional().default(false),
			},
		},
		async ({ path: targetPath = "", recursive }) => {
			const safePath = targetPath === "" ? "" : sanitizePath(targetPath);
			const results: string[] = [];

			if (!recursive) {
				// Use folder.children for O(k) direct-child access instead of O(n) vault scan
				const folder =
					safePath === ""
						? app.vault.getRoot()
						: app.vault.getAbstractFileByPath(safePath);
				if (!(folder instanceof TFolder)) throw new Error("Pasta não encontrada");
				for (const child of folder.children) {
					if (child instanceof TFolder) results.push(child.path + "/");
					else if (child instanceof TFile) results.push(child.path);
				}
			} else {
				// Recursive — iterate the full vault
				const prefix = safePath === "" ? "" : safePath + "/";
				for (const f of app.vault.getAllLoadedFiles()) {
					if (prefix !== "" && !f.path.startsWith(prefix) && f.path !== safePath) continue;
					if (f instanceof TFolder) results.push(f.path + "/");
					else if (f instanceof TFile) results.push(f.path);
				}
			}

			return {
				content: [{ type: "text", text: JSON.stringify({ files: results.sort() }, null, 2) }],
			};
		}
	);
}

function registerReadNote(server: McpServer, app: App): void {
	server.registerTool(
		"read_note",
		{
			description: "Lê o conteúdo de uma nota pelo caminho.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const content = await app.vault.read(file);
			return { content: [{ type: "text", text: content }] };
		}
	);
}

function registerCreateNote(server: McpServer, app: App): void {
	server.registerTool(
		"create_note",
		{
			description: "Cria uma nova nota no vault.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH),
				content: z.string().max(MAX_CONTENT_LENGTH),
			},
		},
		async ({ path, content }) => {
			const safePath = sanitizePath(path);
			if (app.vault.getAbstractFileByPath(safePath)) throw new Error("Arquivo já existe");
			await app.vault.create(safePath, content);
			return { content: [{ type: "text", text: `Nota criada: ${safePath}` }] };
		}
	);
}

function registerUpdateNote(server: McpServer, app: App): void {
	server.registerTool(
		"update_note",
		{
			description: "Atualiza o conteúdo de uma nota existente.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH),
				content: z.string().max(MAX_CONTENT_LENGTH),
				mode: z.enum(["overwrite", "append", "prepend"]).default("overwrite"),
			},
		},
		async ({ path, content, mode }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			if (mode === "overwrite") {
				await app.vault.modify(file, content);
			} else if (mode === "append") {
				await app.vault.modify(file, (await app.vault.read(file)) + "\n" + content);
			} else {
				await app.vault.modify(file, content + "\n" + (await app.vault.read(file)));
			}
			return { content: [{ type: "text", text: `Nota atualizada (${mode})` }] };
		}
	);
}

function registerDeleteNote(server: McpServer, app: App): void {
	server.registerTool(
		"delete_note",
		{
			description: "Deleta um arquivo do vault.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			await app.vault.delete(file);
			return { content: [{ type: "text", text: "Arquivo deletado" }] };
		}
	);
}

function registerSearchVault(server: McpServer, app: App, vaultIndex: VaultIndex): void {
	server.registerTool(
		"search_vault",
		{
			description: "Busca por texto em todas as notas do vault.",
			inputSchema: {
				query: z.string().min(1).max(MAX_QUERY_LENGTH),
				case_sensitive: z.boolean().optional().default(false),
			},
		},
		async ({ query, case_sensitive }) => {
			const searchFor = case_sensitive ? query : query.toLowerCase();

			// Use inverted index to pre-filter candidate files (only for case-insensitive queries)
			const candidates = case_sensitive
				? null
				: await vaultIndex.getCandidates(query, app.vault);

			const allFiles = app.vault.getMarkdownFiles();
			// If candidates is null (index not ready or no tokens), search all files
			const filesToSearch =
				candidates === null
					? allFiles
					: allFiles.filter((f) => candidates.has(f.path));

			const results: { path: string; matches: number; excerpt: string }[] = [];
			const BATCH_SIZE = 50;

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
						content
							.slice(Math.max(0, idx - 100), idx + query.length + 100)
							.replace(/\n/g, " ") +
						"...";
					// Count matches with indexOf loop to avoid ReDoS
					let matchCount = 0;
					let pos = 0;
					while ((pos = searchIn.indexOf(searchFor, pos)) !== -1) {
						matchCount++;
						pos += searchFor.length;
					}
					results.push({ path: file.path, matches: matchCount, excerpt });
				}
			}
			results.sort((a, b) => b.matches - a.matches);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ query, total_files_matched: results.length, results: results.slice(0, 20) },
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerGetActiveNote(server: McpServer, app: App): void {
	server.registerTool(
		"get_active_note",
		{
			description: "Retorna a nota atualmente aberta no editor do Obsidian.",
		},
		async () => {
			const activeFile = app.workspace.getActiveFile();
			if (!activeFile) return { content: [{ type: "text", text: "Nenhuma nota ativa no momento." }] };
			const content = await app.vault.read(activeFile);
			return { content: [{ type: "text", text: JSON.stringify({ path: activeFile.path, content }, null, 2) }] };
		}
	);
}

function registerCreateFolder(server: McpServer, app: App): void {
	server.registerTool(
		"create_folder",
		{
			description: "Cria uma pasta no vault Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da pasta a criar (ex: Projetos/2026)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			if (app.vault.getAbstractFileByPath(safePath)) throw new Error("Pasta ou arquivo já existe nesse caminho");
			await app.vault.createFolder(safePath);
			return { content: [{ type: "text", text: `Pasta criada: ${safePath}` }] };
		}
	);
}

function registerGetBacklinks(server: McpServer, app: App): void {
	server.registerTool(
		"get_backlinks",
		{
			description: "Lista todas as notas que contêm links apontando para uma nota específica.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota alvo (ex: Termos/Glossário.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const target = resolveNoteFile(app, safePath);
			if (!target) throw new Error("Arquivo não encontrado");

			// Use metadataCache.resolvedLinks for O(n) index lookup instead of scanning file content
			const resolvedLinks = app.metadataCache.resolvedLinks;
			const backlinks: string[] = [];
			for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
				if (sourcePath === safePath) continue;
				if (links[safePath]) backlinks.push(sourcePath);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ target: safePath, total: backlinks.length, backlinks: backlinks.sort() }, null, 2),
					},
				],
			};
		}
	);
}

function registerRenameNote(server: McpServer, app: App): void {
	server.registerTool(
		"rename_note",
		{
			description: "Renomeia uma nota e atualiza todos os links [[...]] que apontam para ela no vault.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho atual da nota (ex: Termos/Antigo.md)"),
				new_path: z.string().max(MAX_PATH_LENGTH).describe("Novo caminho da nota (ex: Termos/Novo.md)"),
			},
		},
		async ({ path, new_path }) => {
			const safePath = sanitizePath(path);
			const safeNewPath = sanitizePath(new_path);

			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			if (app.vault.getAbstractFileByPath(safeNewPath)) throw new Error("Já existe um arquivo no novo caminho");

			const oldWithoutExt = safePath.replace(/\.md$/i, "");
			const oldBasename = oldWithoutExt.split("/").pop() as string;
			const newWithoutExt = safeNewPath.replace(/\.md$/i, "");
			const newBasename = newWithoutExt.split("/").pop() as string;

			// Compile regexes once before the loop
			const replacements: [RegExp, string][] = (
				[
					[oldWithoutExt, newWithoutExt],
					[oldBasename, newBasename],
				] as [string, string][]
			).map(([oldRef, newRef]) => {
				const escaped = oldRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				return [new RegExp(`\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`, "gi"), newRef] as [RegExp, string];
			});

			// Rename the file first so that if link updates fail, the file is still correctly renamed
			await app.vault.rename(file, safeNewPath);

			let updatedFiles = 0;
			try {
				for (const note of app.vault.getMarkdownFiles()) {
					if (note.path === safeNewPath) continue;
					const original = await app.vault.read(note);
					let updated = original;
					for (const [regex, newRef] of replacements) {
						updated = updated.replace(regex, (_, alias) => `[[${newRef}${alias ?? ""}]]`);
					}
					if (updated !== original) {
						await app.vault.modify(note, updated);
						updatedFiles++;
					}
				}
			} catch (e) {
				logger.error("Error updating links after rename:", e);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ renamed: { from: safePath, to: safeNewPath }, links_updated_in: updatedFiles }, null, 2),
					},
				],
			};
		}
	);
}

function registerEditNote(server: McpServer, app: App): void {
	server.registerTool(
		"edit_note",
		{
			description: "Substitui um trecho exato de texto em uma nota de forma atômica, evitando race conditions.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
				old_text: z.string().min(1).max(50_000).describe("Texto exato a localizar e substituir"),
				new_text: z.string().max(50_000).describe("Texto substituto"),
				expected_occurrences: z
					.number()
					.int()
					.min(1)
					.optional()
					.default(1)
					.describe("Número esperado de ocorrências (default 1). A operação falha se o count real for diferente."),
			},
		},
		async ({ path, old_text, new_text, expected_occurrences }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");

			let occurrencesReplaced = 0;

			await app.vault.process(file, (content) => {
				const result = applyTextEdit(content, old_text, new_text, expected_occurrences);
				occurrencesReplaced = result.count;
				return result.content;
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ path: safePath, occurrences_replaced: occurrencesReplaced }, null, 2),
					},
				],
			};
		}
	);
}

interface DailyNotesOptions {
	format?: string;
	folder?: string;
	template?: string;
}

// Typed interfaces for accessing undocumented Obsidian internal plugin APIs
interface DailyNotesPlugin {
	enabled: boolean;
	instance?: { options?: DailyNotesOptions };
}
interface AppInternals {
	internalPlugins?: { getPluginById(id: string): DailyNotesPlugin | undefined };
	plugins?: { getPlugin(id: string): { settings?: { daily?: DailyNotesOptions } } | null };
}

function getDailyNotesConfig(app: App): DailyNotesOptions {
	const appEx = app as unknown as AppInternals;
	const internal = appEx.internalPlugins?.getPluginById("daily-notes");
	if (internal?.enabled) return internal.instance?.options ?? {};
	const periodic = appEx.plugins?.getPlugin("periodic-notes");
	return periodic?.settings?.daily ?? {};
}

function registerGetDailyNote(server: McpServer, app: App): void {
	server.registerTool(
		"get_daily_note",
		{
			description:
				"Retorna a daily note de uma data, respeitando as configurações do plugin Daily Notes. " +
				"Pode criar a nota se ela não existir.",
			inputSchema: {
				date: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional()
					.describe("Data no formato YYYY-MM-DD. Default: hoje."),
				create: z
					.boolean()
					.optional()
					.default(false)
					.describe("Se true, cria a nota caso não exista."),
			},
		},
		async ({ date, create }) => {
			const config = getDailyNotesConfig(app);
			const fmt = config.format || "YYYY-MM-DD";
			const folder = config.folder ? config.folder.replace(/\/$/, "") : "";

			const targetDate = date ? moment(date, "YYYY-MM-DD", true) : moment();
			if (!targetDate.isValid()) throw new Error("Data inválida. Use o formato YYYY-MM-DD.");

			const fileName = targetDate.format(fmt) + ".md";
			const notePath = folder ? `${folder}/${fileName}` : fileName;

			const existing = app.vault.getAbstractFileByPath(notePath);
			if (existing instanceof TFile) {
				const content = await app.vault.read(existing);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ path: notePath, exists: true, content }, null, 2),
						},
					],
				};
			}

			if (!create) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ path: notePath, exists: false }, null, 2),
						},
					],
				};
			}

			// Create note, optionally from template
			let noteContent = "";
			if (config.template) {
				const templateFile = app.vault.getAbstractFileByPath(config.template);
				if (templateFile instanceof TFile) {
					noteContent = await app.vault.read(templateFile);
				}
			}

			await app.vault.create(notePath, noteContent);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ path: notePath, exists: false, created: true }, null, 2),
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
					.max(200)
					.optional()
					.default(50)
					.describe("Máximo de resultados (default 50, max 200)"),
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

function registerGetNoteMetadata(server: McpServer, app: App): void {
	server.registerTool(
		"get_note_metadata",
		{
			description: "Retorna o frontmatter (metadados YAML) de uma nota como JSON, usando o cache do Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const cache = app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;
			let metadata: Record<string, unknown> | null = null;
			if (frontmatter) {
				// Exclude Obsidian's internal 'position' key from the result
				metadata = Object.fromEntries(
					Object.entries(frontmatter).filter(([k]) => k !== "position")
				);
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ path: safePath, frontmatter: metadata }, null, 2) }],
			};
		}
	);
}

function registerListTags(server: McpServer, app: App): void {
	server.registerTool(
		"list_tags",
		{
			description: "Lista todas as tags do vault com contagem de ocorrências, usando o cache do Obsidian.",
		},
		async () => {
			const tagCounts = new Map<string, number>();
			for (const file of app.vault.getMarkdownFiles()) {
				const cache = app.metadataCache.getFileCache(file);
				// Inline tags (e.g. #tag in body)
				for (const { tag } of cache?.tags ?? []) {
					tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
				}
				// Frontmatter tags (e.g. tags: [foo, bar])
				const fmTags: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						if (typeof t === "string") {
							const normalized = t.startsWith("#") ? t : `#${t}`;
							tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
						}
					}
				}
			}
			const tags = Array.from(tagCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([tag, count]) => ({ tag, count }));
			return {
				content: [{ type: "text", text: JSON.stringify({ total_tags: tags.length, tags }, null, 2) }],
			};
		}
	);
}

function registerGetNoteLinks(server: McpServer, app: App): void {
	server.registerTool(
		"get_note_links",
		{
			description: "Retorna os links de saída (outgoing links) de uma nota, usando o cache do Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const cache = app.metadataCache.getFileCache(file);

			const links = (cache?.links ?? []).map((l) => ({
				link: l.link,
				display: l.displayText ?? l.link,
				resolved: app.metadataCache.getFirstLinkpathDest(l.link, safePath)?.path ?? null,
			}));

			const frontmatterLinks = (cache?.frontmatterLinks ?? []).map((l) => ({
				link: l.link,
				display: l.displayText ?? l.link,
				key: l.key,
				resolved: app.metadataCache.getFirstLinkpathDest(l.link, safePath)?.path ?? null,
			}));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ path: safePath, total: links.length + frontmatterLinks.length, links, frontmatter_links: frontmatterLinks },
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerGetVaultInfo(server: McpServer, app: App): void {
	server.registerTool(
		"get_vault_info",
		{
			description: "Retorna metadados do vault.",
		},
		async () => {
			const allFiles = app.vault.getAllLoadedFiles();
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								total_files: allFiles.length,
								markdown_files: app.vault.getMarkdownFiles().length,
								folders: allFiles.filter((f) => f instanceof TFolder).length,
							},
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerGetGraphNeighbors(server: McpServer, app: App): void {
	server.registerTool(
		"get_graph_neighbors",
		{
			description:
				"Retorna notas vizinhas no grafo de conhecimento via BFS até N graus de separação, " +
				"usando o índice de links resolvidos do Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota de origem (ex: Pasta/Nota.md)"),
				depth: z
					.number()
					.int()
					.min(1)
					.max(3)
					.optional()
					.default(1)
					.describe("Profundidade da busca BFS (1-3, default 1)"),
				direction: z
					.enum(["outgoing", "incoming", "both"])
					.optional()
					.default("both")
					.describe("Direção dos links a seguir"),
			},
		},
		async ({ path, depth, direction }) => {
			const safePath = sanitizePath(path);
			const target = resolveNoteFile(app, safePath);
			if (!target) throw new Error("Arquivo não encontrado");

			const resolvedLinks = app.metadataCache.resolvedLinks;

			// Build reverse index (incoming links) if needed
			const incomingLinks = new Map<string, Set<string>>();
			if (direction !== "outgoing") {
				for (const [src, targets] of Object.entries(resolvedLinks)) {
					for (const dest of Object.keys(targets)) {
						let set = incomingLinks.get(dest);
						if (!set) { set = new Set(); incomingLinks.set(dest, set); }
						set.add(src);
					}
				}
			}

			const nodes = new Set<string>();
			const edges: [string, string][] = [];
			const queue: { path: string; d: number }[] = [{ path: safePath, d: 0 }];
			nodes.add(safePath);

			while (queue.length > 0) {
				const item = queue.shift()!;
				if (item.d >= depth) continue;

				const neighbors = new Set<string>();
				if (direction !== "incoming") {
					for (const dest of Object.keys(resolvedLinks[item.path] ?? {})) neighbors.add(dest);
				}
				if (direction !== "outgoing") {
					for (const src of incomingLinks.get(item.path) ?? []) neighbors.add(src);
				}

				for (const neighbor of neighbors) {
					edges.push([item.path, neighbor]);
					if (!nodes.has(neighbor)) {
						nodes.add(neighbor);
						queue.push({ path: neighbor, d: item.d + 1 });
					}
				}
			}

			// Remove origin from nodes list; return neighbors only
			nodes.delete(safePath);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								origin: safePath,
								depth,
								direction,
								total_neighbors: nodes.size,
								nodes: Array.from(nodes).sort(),
								edges,
							},
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerSuggestLinks(server: McpServer, app: App): void {
	server.registerTool(
		"suggest_links",
		{
			description:
				"Sugere notas existentes que poderiam ser linkadas a partir do conteúdo de uma nota, " +
				"comparando títulos e aliases contra o texto sem [[links]] já existentes.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota a analisar (ex: Pasta/Nota.md)"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.default(10)
					.describe("Máximo de sugestões (default 10)"),
			},
		},
		async ({ path, limit }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");

			const rawContent = await app.vault.cachedRead(file);

			// Strip existing [[...]] links so we don't re-suggest what's already linked
			const strippedContent = rawContent.replace(/\[\[[^\]]*\]\]/g, "");

			// Collect all candidate titles and aliases from the vault
			interface Candidate { notePath: string; term: string }
			const candidates: Candidate[] = [];
			for (const note of app.vault.getMarkdownFiles()) {
				if (note.path === safePath) continue;
				candidates.push({ notePath: note.path, term: note.basename });
				const cache = app.metadataCache.getFileCache(note);
				const aliases: unknown = cache?.frontmatter?.["aliases"];
				if (Array.isArray(aliases)) {
					for (const alias of aliases) {
						if (typeof alias === "string" && alias.length >= 2) {
							candidates.push({ notePath: note.path, term: alias });
						}
					}
				}
			}

			// Sort by term length descending so longer matches take priority
			candidates.sort((a, b) => b.term.length - a.term.length);

			const suggestions: { note: string; term: string; excerpt: string }[] = [];
			const suggestedNotes = new Set<string>();

			for (const { notePath, term } of candidates) {
				if (suggestions.length >= limit) break;
				if (suggestedNotes.has(notePath)) continue;
				if (term.length < 2) continue;

				const idx = strippedContent.toLowerCase().indexOf(term.toLowerCase());
				if (idx === -1) continue;

				const excerpt =
					"..." +
					rawContent.slice(Math.max(0, idx - 60), idx + term.length + 60).replace(/\n/g, " ") +
					"...";
				suggestions.push({ note: notePath, term, excerpt });
				suggestedNotes.add(notePath);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ path: safePath, total: suggestions.length, suggestions }, null, 2),
					},
				],
			};
		}
	);
}

function registerVaultResources(server: McpServer, app: App): void {
	// Static resource: list of all notes with metadata
	server.registerResource(
		"vault-notes",
		"vault://notes",
		{ description: "Lista todas as notas do vault com path, tags e frontmatter." },
		async () => {
			const files = app.vault.getMarkdownFiles();
			const notes = files.map((f) => {
				const cache = app.metadataCache.getFileCache(f);
				const tags: string[] = [];
				for (const { tag } of cache?.tags ?? []) tags.push(tag);
				const fmTagsRaw: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTagsRaw)) {
					for (const t of fmTagsRaw) {
						if (typeof t === "string") tags.push(t.startsWith("#") ? t : `#${t}`);
					}
				}
				let frontmatter: Record<string, unknown> | null = null;
				if (cache?.frontmatter) {
					frontmatter = Object.fromEntries(
						Object.entries(cache.frontmatter).filter(([k]) => k !== "position")
					);
				}
				return { path: f.path, tags, frontmatter };
			});
			return {
				contents: [
					{
						uri: "vault://notes",
						mimeType: "application/json",
						text: JSON.stringify({ total: notes.length, notes }, null, 2),
					},
				],
			};
		}
	);

	// Static resource: all tags with counts
	server.registerResource(
		"vault-tags",
		"vault://tags",
		{ description: "Índice de todas as tags do vault com contagem de ocorrências." },
		async () => {
			const tagCounts = new Map<string, number>();
			for (const f of app.vault.getMarkdownFiles()) {
				const cache = app.metadataCache.getFileCache(f);
				for (const { tag } of cache?.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
				const fmTagsRaw: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTagsRaw)) {
					for (const t of fmTagsRaw) {
						if (typeof t === "string") {
							const normalized = t.startsWith("#") ? t : `#${t}`;
							tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
						}
					}
				}
			}
			const tags = Array.from(tagCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([tag, count]) => ({ tag, count }));
			return {
				contents: [
					{
						uri: "vault://tags",
						mimeType: "application/json",
						text: JSON.stringify({ total_tags: tags.length, tags }, null, 2),
					},
				],
			};
		}
	);

	// Template resource: individual note content at vault://note/{+path}
	const noteTemplate = new ResourceTemplate("vault://note/{+path}", {
		list: async () => {
			const files = app.vault.getMarkdownFiles();
			return {
				resources: files.map((f) => ({
					uri: `vault://note/${f.path}`,
					name: f.basename,
					mimeType: "text/markdown",
				})),
			};
		},
	});

	server.registerResource(
		"vault-note",
		noteTemplate,
		{ description: "Conteúdo completo de uma nota específica do vault." },
		async (uri, { path }) => {
			if (typeof path !== "string" || path.length === 0) {
				throw new Error("path é obrigatório");
			}
			// {+path} template may leave reserved chars unencoded, but clients may percent-encode spaces
			const decodedPath = decodeURIComponent(path);
			const safePath = sanitizePath(decodedPath);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const content = await app.vault.cachedRead(file);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "text/markdown",
						text: content,
					},
				],
			};
		}
	);
}

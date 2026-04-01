import { App, TFile, TFolder } from "obsidian";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const MAX_PATH_LENGTH = 512;
const MAX_CONTENT_LENGTH = 10_000_000; // 10 MB
const MAX_QUERY_LENGTH = 1_000;

/**
 * Validates and normalizes a vault-relative path.
 * Rejects absolute paths, path traversal sequences, and paths that are too long.
 */
function sanitizePath(path: string): string {
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

export function registerTools(server: McpServer, app: App): void {
	registerListFiles(server, app);
	registerReadNote(server, app);
	registerCreateNote(server, app);
	registerUpdateNote(server, app);
	registerDeleteNote(server, app);
	registerSearchVault(server, app);
	registerGetActiveNote(server, app);
	registerGetVaultInfo(server, app);
	registerCreateFolder(server, app);
	registerGetBacklinks(server, app);
	registerRenameNote(server, app);
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
			const file = app.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) throw new Error("Arquivo não encontrado");
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
			const file = app.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) throw new Error("Arquivo não encontrado");
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
			const file = app.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) throw new Error("Arquivo não encontrado");
			await app.vault.delete(file);
			return { content: [{ type: "text", text: "Arquivo deletado" }] };
		}
	);
}

function registerSearchVault(server: McpServer, app: App): void {
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
			const results: { path: string; matches: number; excerpt: string }[] = [];
			const mdFiles = app.vault.getMarkdownFiles();
			const BATCH_SIZE = 50;

			for (let i = 0; i < mdFiles.length; i += BATCH_SIZE) {
				const batch = mdFiles.slice(i, i + BATCH_SIZE);
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
			const target = app.vault.getAbstractFileByPath(safePath);
			if (!(target instanceof TFile)) throw new Error("Arquivo não encontrado");

			// Build the set of link patterns to look for:
			// 1. Full path without extension: "Termos/Glossário"
			// 2. Basename without extension: "Glossário"
			const withoutExt = safePath.replace(/\.md$/i, "");
			const basename = withoutExt.split("/").pop() as string;
			const patterns = Array.from(new Set([withoutExt, basename]));

			// Compile regexes once before the loop
			const regexes = patterns.map((p) => {
				const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				return new RegExp(`\\[\\[${escaped}(?:\\|[^\\]]*)?\\]\\]`, "i");
			});

			const backlinks: string[] = [];
			for (const file of app.vault.getMarkdownFiles()) {
				if (file.path === safePath) continue;
				const content = await app.vault.cachedRead(file);
				if (regexes.some((re) => re.test(content))) backlinks.push(file.path);
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

			const file = app.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) throw new Error("Arquivo não encontrado");
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
				console.error("[MCP Server] Error updating links after rename:", e);
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

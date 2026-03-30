import { App, TFile, TFolder } from "obsidian";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerTools(server: McpServer, app: App): void {
	registerListFiles(server, app);
	registerReadNote(server, app);
	registerCreateNote(server, app);
	registerUpdateNote(server, app);
	registerDeleteNote(server, app);
	registerSearchVault(server, app);
	registerGetActiveNote(server, app);
	registerGetVaultInfo(server, app);
}

function registerListFiles(server: McpServer, app: App): void {
	server.registerTool(
		"list_files",
		{
			description: "Lista arquivos e pastas do vault Obsidian.",
			inputSchema: {
				path: z.string().optional().describe("Pasta do vault para listar. Raiz se omitido."),
				recursive: z.boolean().optional().default(false),
			},
		},
		async ({ path: targetPath = "", recursive }) => {
			const allFiles = app.vault.getAllLoadedFiles();
			const results: string[] = [];

			for (const f of allFiles) {
				const isInPath = targetPath === "" || f.path.startsWith(targetPath);
				if (!isInPath) continue;
				if (!recursive && f instanceof TFolder) {
					results.push(f.path + "/");
				} else if (f instanceof TFile) {
					results.push(f.path);
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
				path: z.string().describe("Caminho da nota (ex: Pasta/Nota.md)"),
			},
		},
		async ({ path }) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);
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
				path: z.string(),
				content: z.string(),
			},
		},
		async ({ path, content }) => {
			if (app.vault.getAbstractFileByPath(path)) throw new Error(`Já existe: ${path}`);
			await app.vault.create(path, content);
			return { content: [{ type: "text", text: `Nota criada: ${path}` }] };
		}
	);
}

function registerUpdateNote(server: McpServer, app: App): void {
	server.registerTool(
		"update_note",
		{
			description: "Atualiza o conteúdo de uma nota existente.",
			inputSchema: {
				path: z.string(),
				content: z.string(),
				mode: z.enum(["overwrite", "append", "prepend"]).default("overwrite"),
			},
		},
		async ({ path, content, mode }) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);
			if (mode === "overwrite") {
				await app.vault.modify(file, content);
			} else if (mode === "append") {
				await app.vault.modify(file, (await app.vault.read(file)) + "\n" + content);
			} else {
				await app.vault.modify(file, content + "\n" + (await app.vault.read(file)));
			}
			return { content: [{ type: "text", text: `Nota atualizada (${mode}): ${path}` }] };
		}
	);
}

function registerDeleteNote(server: McpServer, app: App): void {
	server.registerTool(
		"delete_note",
		{
			description: "Deleta um arquivo do vault.",
			inputSchema: {
				path: z.string(),
			},
		},
		async ({ path }) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);
			await app.vault.delete(file);
			return { content: [{ type: "text", text: `Arquivo deletado: ${path}` }] };
		}
	);
}

function registerSearchVault(server: McpServer, app: App): void {
	server.registerTool(
		"search_vault",
		{
			description: "Busca por texto em todas as notas do vault.",
			inputSchema: {
				query: z.string(),
				case_sensitive: z.boolean().optional().default(false),
			},
		},
		async ({ query, case_sensitive }) => {
			const results: { path: string; matches: number; excerpt: string }[] = [];
			for (const file of app.vault.getMarkdownFiles()) {
				const content = await app.vault.cachedRead(file);
				const searchIn = case_sensitive ? content : content.toLowerCase();
				const searchFor = case_sensitive ? query : query.toLowerCase();
				if (!searchIn.includes(searchFor)) continue;
				const idx = searchIn.indexOf(searchFor);
				const excerpt = "..." + content.slice(Math.max(0, idx - 100), idx + query.length + 100).replace(/\n/g, " ") + "...";
				const matchCount = (searchIn.match(new RegExp(searchFor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
				results.push({ path: file.path, matches: matchCount, excerpt });
			}
			results.sort((a, b) => b.matches - a.matches);
			return {
				content: [{ type: "text", text: JSON.stringify({ query, total_files_matched: results.length, results: results.slice(0, 20) }, null, 2) }],
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

function registerGetVaultInfo(server: McpServer, app: App): void {
	server.registerTool(
		"get_vault_info",
		{
			description: "Retorna metadados do vault.",
		},
		async () => {
			const allFiles = app.vault.getAllLoadedFiles();
			return {
				content: [{
					type: "text",
					text: JSON.stringify({
						name: app.vault.getName(),
						total_files: allFiles.length,
						markdown_files: app.vault.getMarkdownFiles().length,
						folders: allFiles.filter((f) => f instanceof TFolder).length,
						adapter: (app.vault.adapter as { basePath?: string }).basePath ?? "unknown",
					}, null, 2),
				}],
			};
		}
	);
}

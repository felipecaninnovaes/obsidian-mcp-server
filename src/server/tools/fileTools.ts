import { App, TFile, TFolder } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, applyTextEdit, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";
import { logger } from "../../logger";
import { MAX_CONTENT_LENGTH } from "../../constants";

export function registerFileTools(server: McpServer, app: App): void {
	registerListFiles(server, app);
	registerReadNote(server, app);
	registerCreateNote(server, app);
	registerUpdateNote(server, app);
	registerDeleteNote(server, app);
	registerRenameNote(server, app);
	registerEditNote(server, app);
	registerCreateFolder(server, app);
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

import { App, TFile, TFolder } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, applyTextEdit, assertWritePermission, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";

import { MAX_CONTENT_LENGTH } from "../../constants";
import { summarizeParams } from "../AuditLog";
import { expandTemplate } from "./templateUtils";
import type { ToolDependencies } from "./index";

export function registerFileTools(server: McpServer, app: App, deps: ToolDependencies): void {
	const { permissions, auditLog, sessionId } = deps;
	registerListFiles(server, app);
	registerReadNote(server, app);
	registerCreateNote(server, app, permissions, auditLog, sessionId);
	registerUpdateNote(server, app, permissions, auditLog, sessionId);
	registerDeleteNote(server, app, permissions, auditLog, sessionId);
	registerRenameNote(server, app, permissions, auditLog, sessionId);
	registerEditNote(server, app, permissions, auditLog, sessionId);
	registerCreateFolder(server, app, permissions, auditLog, sessionId);
	registerBulkCreateNotes(server, app, permissions, auditLog, sessionId);
	registerBulkMoveNotes(server, app, permissions, auditLog, sessionId);
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
				path: z.string().max(MAX_PATH_LENGTH).describe(
					"Caminho vault-relativo da nota, incluindo extensão. " +
					"Preserve espaços e hífens exatamente como retornado por list_files. " +
					"Ex: 'PESSOAL/MINHA HISTORIA/01 - Quem foi Alex.md'"
				),
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

function registerCreateNote(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
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
			assertWritePermission(permissions);
			const safePath = sanitizePath(path);
			if (app.vault.getAbstractFileByPath(safePath)) throw new Error("Arquivo já existe");
			// Extract title from path (filename without .md extension)
			const title = safePath.split("/").pop()?.replace(/\.md$/i, "") || "";
			// Expand template variables in content
			const expandedContent = expandTemplate(content, { title });
			await app.vault.create(safePath, expandedContent);
			auditLog.record({ timestamp: Date.now(), sessionId, tool: "create_note", params_summary: summarizeParams({ path: safePath }), result: "ok" });
			return { content: [{ type: "text", text: `Nota criada: ${safePath}` }] };
		}
	);
}

function registerUpdateNote(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
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
			assertWritePermission(permissions);
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
			auditLog.record({ timestamp: Date.now(), sessionId, tool: "update_note", params_summary: summarizeParams({ path: safePath, mode }), result: "ok" });
			return { content: [{ type: "text", text: `Nota atualizada (${mode})` }] };
		}
	);
}

function registerDeleteNote(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
	server.registerTool(
		"delete_note",
		{
			description: "Deleta um arquivo do vault.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH),
			},
		},
		async ({ path }) => {
			assertWritePermission(permissions);
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			await app.fileManager.trashFile(file);
			auditLog.record({ timestamp: Date.now(), sessionId, tool: "delete_note", params_summary: summarizeParams({ path: safePath }), result: "ok" });
			return { content: [{ type: "text", text: "Arquivo deletado" }] };
		}
	);
}

function registerRenameNote(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
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
			assertWritePermission(permissions);
			const safePath = sanitizePath(path);
			const safeNewPath = sanitizePath(new_path);

			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			if (app.vault.getAbstractFileByPath(safeNewPath)) throw new Error("Já existe um arquivo no novo caminho");

			await app.fileManager.renameFile(file, safeNewPath);

			auditLog.record({ timestamp: Date.now(), sessionId, tool: "rename_note", params_summary: summarizeParams({ from: safePath, to: safeNewPath }), result: "ok" });
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ renamed: { from: safePath, to: safeNewPath }, links_updated_automatically: true }, null, 2),
					},
				],
			};
		}
	);
}

function registerEditNote(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
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
			assertWritePermission(permissions);
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");

			let occurrencesReplaced = 0;
			await app.vault.process(file, (content) => {
				const result = applyTextEdit(content, old_text, new_text, expected_occurrences);
				occurrencesReplaced = result.count;
				return result.content;
			});

			auditLog.record({ timestamp: Date.now(), sessionId, tool: "edit_note", params_summary: summarizeParams({ path: safePath, occurrences: occurrencesReplaced }), result: "ok" });
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

function registerCreateFolder(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
	server.registerTool(
		"create_folder",
		{
			description: "Cria uma pasta no vault Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da pasta a criar (ex: Projetos/2026)"),
			},
		},
		async ({ path }) => {
			assertWritePermission(permissions);
			const safePath = sanitizePath(path);
			if (app.vault.getAbstractFileByPath(safePath)) throw new Error("Pasta ou arquivo já existe nesse caminho");
			await app.vault.createFolder(safePath);
			auditLog.record({ timestamp: Date.now(), sessionId, tool: "create_folder", params_summary: summarizeParams({ path: safePath }), result: "ok" });
			return { content: [{ type: "text", text: `Pasta criada: ${safePath}` }] };
		}
	);
}

function registerBulkCreateNotes(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
	server.registerTool(
		"bulk_create_notes",
		{
			description: "Cria múltiplas notas no vault em uma única operação. Máximo 50 notas por chamada.",
			inputSchema: {
				notes: z
					.array(
						z.object({
							path: z.string().max(MAX_PATH_LENGTH),
							content: z.string().max(MAX_CONTENT_LENGTH),
						})
					)
					.min(1)
					.max(50)
					.describe("Array de notas a criar, cada uma com path e content"),
			},
		},
		async ({ notes }) => {
			assertWritePermission(permissions);
			const results: Array<{ path: string; success: boolean; error?: string }> = [];

			for (const note of notes) {
				try {
					const safePath = sanitizePath(note.path);
					if (app.vault.getAbstractFileByPath(safePath)) {
						results.push({
							path: safePath,
							success: false,
							error: "Arquivo já existe",
						});
						continue;
					}
					// Expand template variables in content
					const title = safePath.split("/").pop()?.replace(/\.md$/i, "") || "";
					const expandedContent = expandTemplate(note.content, { title });
					await app.vault.create(safePath, expandedContent);
					results.push({ path: safePath, success: true });
				} catch (err) {
					results.push({
						path: note.path,
						success: false,
						error: err instanceof Error ? err.message : "Erro desconhecido",
					});
				}
			}

			auditLog.record({
				timestamp: Date.now(),
				sessionId,
				tool: "bulk_create_notes",
				params_summary: summarizeParams({ count: notes.length }),
				result: "ok",
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								total: notes.length,
								successful: results.filter((r) => r.success).length,
								failed: results.filter((r) => !r.success).length,
								results,
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

function registerBulkMoveNotes(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
	server.registerTool(
		"bulk_move_notes",
		{
			description: "Move múltiplas notas no vault em uma única operação. Máximo 50 notas por chamada.",
			inputSchema: {
				moves: z
					.array(
						z.object({
							from: z.string().max(MAX_PATH_LENGTH),
							to: z.string().max(MAX_PATH_LENGTH),
						})
					)
					.min(1)
					.max(50)
					.describe("Array de movimentações, cada uma com from e to"),
			},
		},
		async ({ moves }) => {
			assertWritePermission(permissions);
			const results: Array<{ from: string; to: string; success: boolean; error?: string }> = [];

			for (const move of moves) {
				try {
					const safeFrom = sanitizePath(move.from);
					const safeTo = sanitizePath(move.to);

					const file = resolveNoteFile(app, safeFrom);
					if (!file) {
						results.push({
							from: safeFrom,
							to: safeTo,
							success: false,
							error: "Arquivo de origem não encontrado",
						});
						continue;
					}

					if (app.vault.getAbstractFileByPath(safeTo)) {
						results.push({
							from: safeFrom,
							to: safeTo,
							success: false,
							error: "Arquivo de destino já existe",
						});
						continue;
					}

					await app.fileManager.renameFile(file, safeTo);
					results.push({ from: safeFrom, to: safeTo, success: true });
				} catch (err) {
					results.push({
						from: move.from,
						to: move.to,
						success: false,
						error: err instanceof Error ? err.message : "Erro desconhecido",
					});
				}
			}

			auditLog.record({
				timestamp: Date.now(),
				sessionId,
				tool: "bulk_move_notes",
				params_summary: summarizeParams({ count: moves.length }),
				result: "ok",
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								total: moves.length,
								successful: results.filter((r) => r.success).length,
								failed: results.filter((r) => !r.success).length,
								results,
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

import { App, TFile, TFolder, moment } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerDailyNoteTools(server: McpServer, app: App): void {
	registerGetDailyNote(server, app);
	registerGetActiveNote(server, app);
	registerGetVaultInfo(server, app);
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

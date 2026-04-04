import { Plugin, Notice } from "obsidian";
import { randomBytes } from "crypto";
import { DEFAULT_SETTINGS, McpServerSettings } from "./types";
import { ObsidianMcpServer } from "./server/McpServer";
import { McpSettingsTab } from "./settings/SettingsTab";
import { VaultIndex } from "./server/VaultIndex";
import { BacklinkIndex } from "./server/BacklinkIndex";
import { DeleteLog } from "./server/DeleteLog";
import { SemanticIndex } from "./server/SemanticIndex";
import { EMBEDDING_DEBOUNCE_MS } from "./constants";

export default class McpServerPlugin extends Plugin {
	settings: McpServerSettings;
	mcpServer: ObsidianMcpServer | null = null;
	readonly vaultIndex = new VaultIndex();
	readonly backlinkIndex = new BacklinkIndex();
	readonly deleteLog = new DeleteLog();
	readonly semanticIndex = new SemanticIndex();

	/** Per-file debounce timers for re-embedding on vault modify/create. */
	private readonly embeddingTimers = new Map<string, ReturnType<typeof setTimeout>>();

	async onload() {
		await this.loadSettings();

		if (!this.settings.apiKey) {
			this.settings.apiKey = randomBytes(32).toString("hex");
			await this.saveSettings();
		}

		this.addSettingTab(new McpSettingsTab(this.app, this));

		// Configure semantic index from settings (only if enabled)
		if (this.settings.semanticSearch) {
			this.semanticIndex.configure({
				endpoint: this.settings.embeddingEndpoint,
				apiKey: this.settings.embeddingApiKey,
				model: this.settings.embeddingModel,
			});
		}

		// Keep VaultIndex in sync with vault changes
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				void this.vaultIndex.update(file, this.app.vault);
				this.backlinkIndex.update(file.path, this.app);
				this.scheduleSemanticUpdate(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				void this.vaultIndex.update(file, this.app.vault);
				this.backlinkIndex.update(file.path, this.app);
				this.scheduleSemanticUpdate(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.vaultIndex.removeFile(file.path);
				this.backlinkIndex.removeFile(file.path);
				this.deleteLog.record(file.path);
				this.semanticIndex.removeFile(file.path);
				const timer = this.embeddingTimers.get(file.path);
				if (timer) { clearTimeout(timer); this.embeddingTimers.delete(file.path); }
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.vaultIndex.removeFile(oldPath);
				void this.vaultIndex.update(file, this.app.vault);
				this.backlinkIndex.removeFile(oldPath);
				this.backlinkIndex.update(file.path, this.app);
				this.semanticIndex.removeFile(oldPath);
				this.scheduleSemanticUpdate(file.path);
			})
		);

		// Warm up indexes in the background so the first search is fast
		this.vaultIndex.buildInBackground(this.app.vault);
		this.backlinkIndex.build(this.app);
		if (this.settings.semanticSearch) {
			void this.semanticIndex.build(this.app.vault, this.app.vault.adapter);
		}

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		this.addRibbonIcon("plug", "MCP Server", () => {
			if (this.mcpServer?.isRunning()) {
				void this.stopServer();
			} else {
				void this.startServer();
			}
		});

		this.addCommand({
			id: "start-mcp-server",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Start MCP Server",
			callback: () => void this.startServer(),
		});

		this.addCommand({
			id: "stop-mcp-server",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Stop MCP Server",
			callback: () => void this.stopServer(),
		});

		this.addCommand({
			id: "copy-mcp-url",
			// eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case
			name: "Copy MCP Server URL",
			callback: () => {
				const url = `http://localhost:${this.settings.port}/mcp`;
				void navigator.clipboard.writeText(url);
				new Notice(`Copied: ${url}`);
			},
		});

		if (this.settings.autoStart) {
			await this.startServer();
		}
	}

	onunload() {
		void this.stopServer();
	}

	/** Debounces re-embedding a file by EMBEDDING_DEBOUNCE_MS after the last event. */
	private scheduleSemanticUpdate(path: string): void {
		if (!this.settings.semanticSearch) return;
		const existing = this.embeddingTimers.get(path);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.embeddingTimers.delete(path);
			const file = this.app.vault.getFileByPath(path);
			if (file) {
				void this.semanticIndex.update(file, this.app.vault, this.app.vault.adapter);
			}
		}, EMBEDDING_DEBOUNCE_MS);
		this.embeddingTimers.set(path, timer);
	}

	async startServer() {
		if (this.mcpServer?.isRunning()) return;
		this.mcpServer = new ObsidianMcpServer(this.app, this.settings, this.vaultIndex, this.backlinkIndex, this.deleteLog, this.semanticIndex);

		// Exponential backoff: 1 s → 2 s → 4 s (max 3 attempts)
		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await this.mcpServer.start();
				new Notice(`MCP server started on port ${this.settings.port}`);
				return;
			} catch (e) {
				if (attempt === maxAttempts) {
					new Notice(`MCP server failed to start: ${e instanceof Error ? e.message : String(e)}`);
					throw e;
				}
				await new Promise<void>((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
			}
		}
	}

	async stopServer() {
		if (!this.mcpServer?.isRunning()) return;
		await this.mcpServer.stop();
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Notice("MCP server stopped");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<McpServerSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

import { Plugin, Notice } from "obsidian";
import { randomBytes } from "crypto";
import { DEFAULT_SETTINGS, McpServerSettings } from "./types";
import { ObsidianMcpServer } from "./server/McpServer";
import { McpSettingsTab } from "./settings/SettingsTab";
import { VaultIndex } from "./server/VaultIndex";
import { BacklinkIndex } from "./server/BacklinkIndex";
import { DeleteLog } from "./server/DeleteLog";

export default class McpServerPlugin extends Plugin {
	settings: McpServerSettings;
	mcpServer: ObsidianMcpServer | null = null;
	readonly vaultIndex = new VaultIndex();
	readonly backlinkIndex = new BacklinkIndex();
	readonly deleteLog = new DeleteLog();

	async onload() {
		await this.loadSettings();

		if (!this.settings.apiKey) {
			this.settings.apiKey = randomBytes(32).toString("hex");
			await this.saveSettings();
		}

		this.addSettingTab(new McpSettingsTab(this.app, this));

		// Keep VaultIndex in sync with vault changes
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				void this.vaultIndex.update(file, this.app.vault);
				this.backlinkIndex.update(file.path, this.app);
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				void this.vaultIndex.update(file, this.app.vault);
				this.backlinkIndex.update(file.path, this.app);
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.vaultIndex.removeFile(file.path);
				this.backlinkIndex.removeFile(file.path);
				this.deleteLog.record(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.vaultIndex.removeFile(oldPath);
				void this.vaultIndex.update(file, this.app.vault);
				this.backlinkIndex.removeFile(oldPath);
				this.backlinkIndex.update(file.path, this.app);
			})
		);

		// Warm up indexes in the background so the first search is fast
		this.vaultIndex.buildInBackground(this.app.vault);
		this.backlinkIndex.build(this.app);

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

	async startServer() {
		if (this.mcpServer?.isRunning()) return;
		this.mcpServer = new ObsidianMcpServer(this.app, this.settings, this.vaultIndex, this.backlinkIndex, this.deleteLog);

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

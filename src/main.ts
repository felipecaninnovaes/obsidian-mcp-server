import { Plugin, Notice } from "obsidian";
import { randomBytes } from "crypto";
import { DEFAULT_SETTINGS, McpServerSettings } from "./types";
import { ObsidianMcpServer } from "./server/McpServer";
import { McpSettingsTab } from "./settings/SettingsTab";

export default class McpServerPlugin extends Plugin {
	settings: McpServerSettings;
	mcpServer: ObsidianMcpServer | null = null;

	async onload() {
		await this.loadSettings();

		if (!this.settings.apiKey) {
			this.settings.apiKey = randomBytes(32).toString("hex");
			await this.saveSettings();
		}

		this.addSettingTab(new McpSettingsTab(this.app, this));

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
		this.mcpServer = new ObsidianMcpServer(this.app, this.settings);
		await this.mcpServer.start();
		new Notice(`MCP server started on port ${this.settings.port}`);
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

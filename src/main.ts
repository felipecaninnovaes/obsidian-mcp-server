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

		this.addRibbonIcon("plug", "MCP Server", async () => {
			if (this.mcpServer?.isRunning()) {
				await this.stopServer();
			} else {
				await this.startServer();
			}
		});

		this.addCommand({
			id: "start-mcp-server",
			name: "Start MCP Server",
			callback: async () => await this.startServer(),
		});

		this.addCommand({
			id: "stop-mcp-server",
			name: "Stop MCP Server",
			callback: async () => await this.stopServer(),
		});

		this.addCommand({
			id: "copy-mcp-url",
			name: "Copy MCP Server URL",
			callback: () => {
				const url = `http://localhost:${this.settings.port}/mcp`;
				navigator.clipboard.writeText(url);
				new Notice(`Copied: ${url}`);
			},
		});

		if (this.settings.autoStart) {
			await this.startServer();
		}
	}

	async onunload() {
		await this.stopServer();
	}

	async startServer() {
		if (this.mcpServer?.isRunning()) return;
		this.mcpServer = new ObsidianMcpServer(this.app, this.settings);
		await this.mcpServer.start();
		new Notice(`MCP Server started on port ${this.settings.port}`);
	}

	async stopServer() {
		if (!this.mcpServer?.isRunning()) return;
		await this.mcpServer.stop();
		new Notice("MCP Server stopped");
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

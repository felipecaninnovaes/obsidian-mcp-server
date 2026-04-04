import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type McpServerPlugin from "../main";
import type { LogLevel, Permissions } from "../types";

export class McpSettingsTab extends PluginSettingTab {
	plugin: McpServerPlugin;

	constructor(app: App, plugin: McpServerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		// eslint-disable-next-line obsidianmd/settings-tab/no-manual-html-headings, obsidianmd/ui/sentence-case
		containerEl.createEl("h2", { text: "MCP Server Settings" });

		new Setting(containerEl)
			.setName("Port")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Port the MCP HTTP server listens on (default: 27123).")
			.addText((text) =>
				text
					.setPlaceholder("27123")
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.port = port;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("API Key")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Secret key required by MCP clients to authenticate.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("auto-generated")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
			})
			.addButton((btn) =>
				btn.setButtonText("Copy").onClick(() => {
					void navigator.clipboard.writeText(this.plugin.settings.apiKey);
					new Notice("API key copied!");
				})
			);

		new Setting(containerEl)
			.setName("Require authentication")
			.setDesc("Reject requests that do not include the API key.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableAuth)
					.onChange(async (value) => {
						this.plugin.settings.enableAuth = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-start on load")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Start the MCP server automatically when Obsidian opens.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStart)
					.onChange(async (value) => {
						this.plugin.settings.autoStart = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Network access")
			.setDesc(
				"Allow connections from other devices on your network (binds to 0.0.0.0 instead of 127.0.0.1). " +
				"Requires restarting the server. Enable authentication when using this option."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.networkAccess)
					.onChange(async (value) => {
						this.plugin.settings.networkAccess = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Log level")
			.setDesc("Controls verbosity of server logs in the developer console.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ debug: "Debug", info: "Info", warn: "Warn", error: "Error" })
					.setValue(this.plugin.settings.logLevel)
					.onChange(async (value) => {
						this.plugin.settings.logLevel = value as LogLevel;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Permissions")
			.setDesc(
				"'Read-write' allows all tools including note creation, editing, and deletion. " +
				"'Read-only' restricts clients to read and search operations only."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ "read-write": "Read-write", "read-only": "Read-only" })
					.setValue(this.plugin.settings.permissions)
					.onChange(async (value) => {
						this.plugin.settings.permissions = value as Permissions;
						await this.plugin.saveSettings();
					})
			);

		// ── Semantic search ───────────────────────────────────────────────────────

		// eslint-disable-next-line obsidianmd/settings-tab/no-manual-html-headings, obsidianmd/ui/sentence-case
		containerEl.createEl("h3", { text: "Semantic Search" });

		new Setting(containerEl)
			.setName("Enable semantic search")
			.setDesc(
				"Expose the semantic_search tool. " +
				"Requires a configured embedding endpoint and API key below."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.semanticSearch)
					.onChange(async (value) => {
						this.plugin.settings.semanticSearch = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.semanticIndex.configure({
								endpoint: this.plugin.settings.embeddingEndpoint,
								apiKey: this.plugin.settings.embeddingApiKey,
								model: this.plugin.settings.embeddingModel,
							});
						}
						this.display();
					})
			);

		if (this.plugin.settings.semanticSearch) {
			new Setting(containerEl)
				.setName("Embedding endpoint")
				.setDesc(
					"OpenAI-compatible embeddings URL. " +
					"Examples: https://api.openai.com/v1/embeddings (OpenAI), " +
					"http://localhost:11434/v1/embeddings (Ollama)."
				)
				.addText((text) =>
					text
						.setPlaceholder("https://api.openai.com/v1/embeddings")
						.setValue(this.plugin.settings.embeddingEndpoint)
						.onChange(async (value) => {
							this.plugin.settings.embeddingEndpoint = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Embedding API key")
				.setDesc("API key for the embedding provider.")
				.addText((text) => {
					text.inputEl.type = "password";
					text.inputEl.autocomplete = "off";
					text
						.setPlaceholder("sk-...")
						.setValue(this.plugin.settings.embeddingApiKey)
						.onChange(async (value) => {
							this.plugin.settings.embeddingApiKey = value;
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName("Embedding model")
				.setDesc("Model name to pass to the embedding API.")
				.addText((text) =>
					text
						.setPlaceholder("text-embedding-3-small")
						.setValue(this.plugin.settings.embeddingModel)
						.onChange(async (value) => {
							this.plugin.settings.embeddingModel = value;
							await this.plugin.saveSettings();
						})
				);
		}

		const bindHost = this.plugin.settings.networkAccess ? "0.0.0.0" : "localhost";
		const statusDesc = this.plugin.mcpServer?.isRunning()
			? `Running on http://${bindHost}:${this.plugin.settings.port}/mcp`
			: "Stopped";

		new Setting(containerEl)
			.setName("Server status")
			.setDesc(statusDesc)
			.addButton((btn) => {
				const running = this.plugin.mcpServer?.isRunning() ?? false;
				btn.setButtonText(running ? "Stop" : "Start").onClick(async () => {
					if (running) {
						await this.plugin.stopServer();
					} else {
						await this.plugin.startServer();
					}
					this.display();
				});
			});
	}
}

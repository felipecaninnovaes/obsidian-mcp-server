import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type McpServerPlugin from "../main";

export class McpSettingsTab extends PluginSettingTab {
	plugin: McpServerPlugin;

	constructor(app: App, plugin: McpServerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "MCP Server Settings" });

		new Setting(containerEl)
			.setName("Port")
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
			.setName("API Key")
			.setDesc("Secret key required by MCP clients to authenticate.")
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
				text
					.setPlaceholder("auto-generated")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
			})
			.addButton((btn) =>
				btn.setButtonText("Copy").onClick(() => {
					navigator.clipboard.writeText(this.plugin.settings.apiKey);
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

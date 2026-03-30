export interface McpServerSettings {
	port: number;
	apiKey: string;
	enableAuth: boolean;
	autoStart: boolean;
}

export const DEFAULT_SETTINGS: McpServerSettings = {
	port: 27123,
	apiKey: "",
	enableAuth: true,
	autoStart: true,
};

/**
 * Minimal Obsidian mock for unit tests.
 * Only exports what is actually used by the modules under test.
 */

export class TAbstractFile {
	path: string = "";
}

export class TFile extends TAbstractFile {
	extension: string = "";
	basename: string = "";
	stat = { mtime: 0, ctime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Vault {}
export class App {}
export class Plugin {}
export class Notice {
	constructor(_message: string) {}
}
export const moment = () => ({});

export class MetadataCache {}

export class DataAdapter {}

/**
 * Mock requestUrl that proxies to the global `fetch` so tests can stub it.
 * This preserves the existing `vi.stubGlobal("fetch", ...)` test pattern.
 */
export const requestUrl = async (params: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	throw?: boolean;
}): Promise<{ status: number; headers: Record<string, string>; json: unknown; text: string; arrayBuffer: ArrayBuffer }> => {
	// eslint-disable-next-line no-restricted-globals
	const response = await fetch(params.url, {
		method: params.method ?? "GET",
		headers: params.headers,
		body: params.body,
	});
	let json: unknown = null;
	try {
		json = await response.json();
	} catch {
		json = null;
	}
	return {
		status: response.status,
		headers: {},
		json,
		text: "",
		arrayBuffer: new ArrayBuffer(0),
	};
};

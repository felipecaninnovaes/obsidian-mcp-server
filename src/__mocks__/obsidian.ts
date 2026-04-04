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

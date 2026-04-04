import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultIndex } from "../server/VaultIndex";
import { TFile } from "obsidian";

// ── Minimal Vault mock ────────────────────────────────────────────────────────

interface FakeFile extends TFile {
	content: string;
}

function makeFakeFile(path: string, content: string): FakeFile {
	const file = new TFile() as FakeFile;
	file.path = path;
	file.extension = path.split(".").pop() ?? "";
	file.content = content;
	return file;
}

function makeVault(files: FakeFile[]) {
	return {
		getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
		cachedRead: async (file: FakeFile) => file.content,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("VaultIndex", () => {
	let index: VaultIndex;

	beforeEach(() => {
		index = new VaultIndex();
	});

	// ── isBuilt ───────────────────────────────────────────────────────────────

	describe("isBuilt()", () => {
		it("starts as false", () => {
			expect(index.isBuilt()).toBe(false);
		});

		it("is true after getCandidates triggers a build", async () => {
			const vault = makeVault([]);
			await index.getCandidates("anything", vault as never);
			expect(index.isBuilt()).toBe(true);
		});
	});

	// ── getCandidates ─────────────────────────────────────────────────────────

	describe("getCandidates()", () => {
		it("returns null for a query with no tokens (all single-char words)", async () => {
			const vault = makeVault([makeFakeFile("a.md", "hello world")]);
			const result = await index.getCandidates("a", vault as never);
			expect(result).toBeNull();
		});

		it("returns matching paths for a single-token query", async () => {
			const vault = makeVault([
				makeFakeFile("note1.md", "typescript is great"),
				makeFakeFile("note2.md", "python is also great"),
			]);
			const result = await index.getCandidates("typescript", vault as never);
			expect(result).not.toBeNull();
			expect(result!.has("note1.md")).toBe(true);
			expect(result!.has("note2.md")).toBe(false);
		});

		it("returns intersection for multi-token query (AND semantics)", async () => {
			const vault = makeVault([
				makeFakeFile("both.md", "alpha beta gamma"),
				makeFakeFile("alpha-only.md", "alpha delta"),
				makeFakeFile("beta-only.md", "beta epsilon"),
			]);
			const result = await index.getCandidates("alpha beta", vault as never);
			expect(result!.has("both.md")).toBe(true);
			expect(result!.has("alpha-only.md")).toBe(false);
			expect(result!.has("beta-only.md")).toBe(false);
		});

		it("returns empty Set when no file contains the query token", async () => {
			const vault = makeVault([makeFakeFile("note.md", "hello world")]);
			const result = await index.getCandidates("unicorn", vault as never);
			expect(result).not.toBeNull();
			expect(result!.size).toBe(0);
		});

		it("is case-insensitive (query and content)", async () => {
			const vault = makeVault([makeFakeFile("note.md", "TypeScript is GREAT")]);
			const lowerResult = await index.getCandidates("typescript", vault as never);
			expect(lowerResult!.has("note.md")).toBe(true);

			const index2 = new VaultIndex();
			const upperResult = await index2.getCandidates("TYPESCRIPT", vault as never);
			expect(upperResult!.has("note.md")).toBe(true);
		});

		it("ignores non-markdown files", async () => {
			const vault = makeVault([
				makeFakeFile("doc.md", "searchable content"),
				makeFakeFile("image.png", "searchable content"),
			]);
			// Only md files should be indexed; png should not appear
			const result = await index.getCandidates("searchable", vault as never);
			expect(result!.has("doc.md")).toBe(true);
			expect(result!.has("image.png")).toBe(false);
		});

		it("second call reuses built index without rebuilding", async () => {
			const vault = makeVault([makeFakeFile("note.md", "hello world")]);
			const cachedReadSpy = vi.spyOn(vault, "cachedRead");

			await index.getCandidates("hello", vault as never);
			const callsAfterFirst = cachedReadSpy.mock.calls.length;

			await index.getCandidates("world", vault as never);
			// No additional cachedRead calls on second query
			expect(cachedReadSpy.mock.calls.length).toBe(callsAfterFirst);
		});
	});

	// ── buildInBackground ─────────────────────────────────────────────────────

	describe("buildInBackground()", () => {
		it("starts a build without blocking", () => {
			const vault = makeVault([makeFakeFile("note.md", "hello")]);
			// Should not throw and returns void
			expect(() => index.buildInBackground(vault as never)).not.toThrow();
		});

		it("subsequent calls while building are no-ops (same promise)", async () => {
			const vault = makeVault([makeFakeFile("note.md", "hello world")]);
			const cachedReadSpy = vi.spyOn(vault, "cachedRead");

			index.buildInBackground(vault as never);
			index.buildInBackground(vault as never); // should be a no-op
			index.buildInBackground(vault as never); // should be a no-op

			// Wait for build to complete via getCandidates
			await index.getCandidates("hello", vault as never);

			// Only 1 file × 1 build = 1 cachedRead call total
			expect(cachedReadSpy.mock.calls.length).toBe(1);
		});

		it("getCandidates awaits in-flight background build instead of starting another", async () => {
			const vault = makeVault([
				makeFakeFile("a.md", "alpha content"),
				makeFakeFile("b.md", "beta content"),
			]);
			const cachedReadSpy = vi.spyOn(vault, "cachedRead");

			index.buildInBackground(vault as never);
			// Immediately call getCandidates — build is already in progress
			const result = await index.getCandidates("alpha", vault as never);

			expect(result!.has("a.md")).toBe(true);
			// Only 2 files — no duplicate reads
			expect(cachedReadSpy.mock.calls.length).toBe(2);
		});

		it("does nothing if index is already built", async () => {
			const vault = makeVault([makeFakeFile("note.md", "hello")]);
			await index.getCandidates("hello", vault as never); // builds the index

			const cachedReadSpy = vi.spyOn(vault, "cachedRead");
			index.buildInBackground(vault as never); // already built — should be no-op

			// Force another tick
			await Promise.resolve();
			expect(cachedReadSpy.mock.calls.length).toBe(0);
		});
	});

	// ── update ────────────────────────────────────────────────────────────────

	describe("update()", () => {
		it("adds new file content to the index", async () => {
			const vault = makeVault([]);
			await index.getCandidates("typescript", vault as never); // build empty index

			const newFile = makeFakeFile("new.md", "typescript rocks");
			// update() reads from vault, so we need to add the file to vault for cachedRead
			const vaultWithNew = makeVault([newFile]);
			await index.update(newFile as never, vaultWithNew as never);

			const result = await index.getCandidates("typescript", vault as never);
			expect(result!.has("new.md")).toBe(true);
		});

		it("replaces old content when file is updated", async () => {
			const original = makeFakeFile("doc.md", "original content here");
			const vault = makeVault([original]);
			await index.getCandidates("original", vault as never);

			// Update file with new content
			const updated = makeFakeFile("doc.md", "completely different text");
			const vaultWithUpdate = makeVault([updated]);
			await index.update(updated as never, vaultWithUpdate as never);

			const oldResult = await index.getCandidates("original", vault as never);
			expect(oldResult!.has("doc.md")).toBe(false);

			const newResult = await index.getCandidates("completely", vault as never);
			expect(newResult!.has("doc.md")).toBe(true);
		});

		it("ignores non-markdown files", async () => {
			const vault = makeVault([]);
			await index.getCandidates("test", vault as never);

			const imgFile = makeFakeFile("photo.png", "test content");
			await index.update(imgFile as never, vault as never);

			const result = await index.getCandidates("test", vault as never);
			expect(result!.has("photo.png")).toBe(false);
		});
	});

	// ── removeFile ────────────────────────────────────────────────────────────

	describe("removeFile()", () => {
		it("removes a file so its tokens no longer match", async () => {
			const files = [
				makeFakeFile("keep.md", "typescript javascript"),
				makeFakeFile("remove.md", "typescript python"),
			];
			const vault = makeVault(files);
			await index.getCandidates("typescript", vault as never);

			index.removeFile("remove.md");

			const result = await index.getCandidates("typescript", vault as never);
			expect(result!.has("keep.md")).toBe(true);
			expect(result!.has("remove.md")).toBe(false);
		});

		it("is a no-op for unknown paths", () => {
			expect(() => index.removeFile("nonexistent.md")).not.toThrow();
		});

		it("cleans up pathTokens reverse map (no stale entries)", async () => {
			const vault = makeVault([makeFakeFile("note.md", "hello world")]);
			await index.getCandidates("hello", vault as never);

			index.removeFile("note.md");

			// Re-removing should be a no-op (pathTokens entry is gone)
			expect(() => index.removeFile("note.md")).not.toThrow();

			const result = await index.getCandidates("hello", vault as never);
			expect(result!.has("note.md")).toBe(false);
		});

		it("does not remove other files that share the same token", async () => {
			const files = [
				makeFakeFile("a.md", "shared unique-a"),
				makeFakeFile("b.md", "shared unique-b"),
			];
			const vault = makeVault(files);
			await index.getCandidates("shared", vault as never);

			index.removeFile("a.md");

			const result = await index.getCandidates("shared", vault as never);
			expect(result!.has("a.md")).toBe(false);
			expect(result!.has("b.md")).toBe(true);
		});
	});

	// ── getTotalDocs / getTokenDocCount ───────────────────────────────────────

	describe("getTotalDocs()", () => {
		it("returns 0 before the index is built", () => {
			expect(index.getTotalDocs()).toBe(0);
		});

		it("returns the number of indexed markdown files", async () => {
			const files = [
				makeFakeFile("a.md", "hello"),
				makeFakeFile("b.md", "world"),
				makeFakeFile("c.md", "foo"),
			];
			const vault = makeVault(files);
			await index.getCandidates("hello", vault as never);
			expect(index.getTotalDocs()).toBe(3);
		});

		it("decreases after removeFile", async () => {
			const files = [makeFakeFile("a.md", "hello"), makeFakeFile("b.md", "world")];
			const vault = makeVault(files);
			await index.getCandidates("hello", vault as never);
			index.removeFile("a.md");
			expect(index.getTotalDocs()).toBe(1);
		});
	});

	describe("getTokenDocCount()", () => {
		it("returns 0 for a token not in the index", async () => {
			const vault = makeVault([makeFakeFile("a.md", "hello")]);
			await index.getCandidates("hello", vault as never);
			expect(index.getTokenDocCount("unicorn")).toBe(0);
		});

		it("returns the number of docs containing the token", async () => {
			const vault = makeVault([
				makeFakeFile("a.md", "shared token here"),
				makeFakeFile("b.md", "shared token also"),
				makeFakeFile("c.md", "only token"),
			]);
			await index.getCandidates("shared", vault as never);
			expect(index.getTokenDocCount("shared")).toBe(2);
			expect(index.getTokenDocCount("token")).toBe(3);
		});

		it("is case-insensitive", async () => {
			const vault = makeVault([makeFakeFile("a.md", "TypeScript is great")]);
			await index.getCandidates("typescript", vault as never);
			expect(index.getTokenDocCount("typescript")).toBe(1);
			expect(index.getTokenDocCount("TYPESCRIPT")).toBe(1);
		});

		it("decreases after removeFile removes the only file with that token", async () => {
			const vault = makeVault([
				makeFakeFile("a.md", "rare token"),
				makeFakeFile("b.md", "common word"),
			]);
			await index.getCandidates("rare", vault as never);
			expect(index.getTokenDocCount("rare")).toBe(1);
			index.removeFile("a.md");
			expect(index.getTokenDocCount("rare")).toBe(0);
		});
	});
});

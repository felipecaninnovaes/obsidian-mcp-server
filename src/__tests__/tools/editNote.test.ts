import { describe, it, expect } from "vitest";
import { applyTextEdit } from "../../server/tools/utils";

describe("applyTextEdit", () => {
	describe("successful replacements", () => {
		it("replaces a single occurrence", () => {
			const { content, count } = applyTextEdit(
				"hello world",
				"world",
				"vitest",
				1
			);
			expect(content).toBe("hello vitest");
			expect(count).toBe(1);
		});

		it("replaces all occurrences when expected_occurrences matches", () => {
			const { content, count } = applyTextEdit(
				"foo foo foo",
				"foo",
				"bar",
				3
			);
			expect(content).toBe("bar bar bar");
			expect(count).toBe(3);
		});

		it("replaces with empty string (deletion)", () => {
			const { content } = applyTextEdit("hello world", "world", "", 1);
			expect(content).toBe("hello ");
		});

		it("handles multiline content", () => {
			const input = "line 1\nold text\nline 3";
			const { content } = applyTextEdit(input, "old text", "new text", 1);
			expect(content).toBe("line 1\nnew text\nline 3");
		});

		it("handles special regex characters in old_text literally", () => {
			const { content } = applyTextEdit(
				"price: $10.00",
				"$10.00",
				"$20.00",
				1
			);
			expect(content).toBe("price: $20.00");
		});
	});

	describe("error: text not found", () => {
		it("throws when old_text is not in content", () => {
			expect(() => applyTextEdit("hello world", "missing", "new", 1)).toThrow(
				"Texto não encontrado na nota"
			);
		});

		it("throws even when expected_occurrences is > 1", () => {
			expect(() => applyTextEdit("hello world", "missing", "new", 3)).toThrow(
				"Texto não encontrado na nota"
			);
		});
	});

	describe("error: occurrence count mismatch", () => {
		it("throws when there are more occurrences than expected", () => {
			expect(() =>
				applyTextEdit("foo foo foo", "foo", "bar", 1)
			).toThrow("Esperado 1 ocorrência(s), mas encontrado 3");
		});

		it("throws when there are fewer occurrences than expected", () => {
			expect(() =>
				applyTextEdit("foo bar", "foo", "baz", 2)
			).toThrow("Esperado 2 ocorrência(s), mas encontrado 1");
		});

		it("error message includes the correct count for user to confirm", () => {
			let message = "";
			try {
				applyTextEdit("a a a a", "a", "b", 1);
			} catch (e) {
				message = (e as Error).message;
			}
			expect(message).toContain("expected_occurrences: 4");
		});
	});
});

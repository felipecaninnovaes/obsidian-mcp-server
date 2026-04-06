import { describe, it, expect } from "vitest";
import { assertWritePermission } from "../server/tools/utils";

describe("assertWritePermission()", () => {
	it("does not throw when permissions is 'read-write'", () => {
		expect(() => assertWritePermission("read-write")).not.toThrow();
	});

	it("throws when permissions is 'read-only'", () => {
		expect(() => assertWritePermission("read-only")).toThrow(
			"Operação não permitida: servidor em modo read-only"
		);
	});

	it("error message is descriptive", () => {
		let message = "";
		try {
			assertWritePermission("read-only");
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
		expect(message).toContain("read-only");
	});
});

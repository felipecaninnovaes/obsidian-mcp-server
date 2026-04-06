import { describe, it, expect } from "vitest";
import type { CanvasNode, CanvasEdge, CanvasData } from "../../server/tools/canvasTools";

// ── Type and structure validation tests ────────────────────────────────────

describe("Canvas data types", () => {
	// ── CanvasNode ────────────────────────────────────────────────────────

	it("validates CanvasNode with minimal fields", () => {
		const node: CanvasNode = {
			id: "node1",
			type: "text",
			text: "Hello",
			x: 0,
			y: 0,
		};
		expect(node.id).toBe("node1");
		expect(node.type).toBe("text");
	});

	it("validates CanvasNode with file type", () => {
		const node: CanvasNode = {
			id: "node2",
			type: "file",
			file: "MyNote.md",
			x: 100,
			y: 200,
		};
		expect(node.type).toBe("file");
		expect(node.file).toBe("MyNote.md");
	});

	it("validates CanvasNode with link type", () => {
		const node: CanvasNode = {
			id: "node3",
			type: "link",
			url: "https://example.com",
			x: 50,
			y: 50,
		};
		expect(node.type).toBe("link");
		expect(node.url).toBe("https://example.com");
	});

	it("validates CanvasNode with optional fields", () => {
		const node: CanvasNode = {
			id: "node4",
			type: "text",
			text: "Styled node",
			x: 0,
			y: 0,
			width: 200,
			height: 100,
			color: "#ff0000",
			label: "Important",
		};
		expect(node.width).toBe(200);
		expect(node.color).toBe("#ff0000");
	});

	// ── CanvasEdge ────────────────────────────────────────────────────────

	it("validates CanvasEdge with minimal fields", () => {
		const edge: CanvasEdge = {
			id: "edge1",
			fromNode: "node1",
			toNode: "node2",
		};
		expect(edge.id).toBe("edge1");
		expect(edge.fromNode).toBe("node1");
		expect(edge.toNode).toBe("node2");
	});

	it("validates CanvasEdge with optional fields", () => {
		const edge: CanvasEdge = {
			id: "edge2",
			fromNode: "node1",
			toNode: "node2",
			label: "related to",
			color: "#00ff00",
			fromSide: "right",
			toSide: "left",
		};
		expect(edge.label).toBe("related to");
		expect(edge.fromSide).toBe("right");
	});

	// ── CanvasData ────────────────────────────────────────────────────────

	it("validates CanvasData with empty arrays", () => {
		const canvas: CanvasData = {
			nodes: [],
			edges: [],
		};
		expect(canvas.nodes.length).toBe(0);
		expect(canvas.edges.length).toBe(0);
	});

	it("validates CanvasData with nodes and edges", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
			],
			edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
		};
		expect(canvas.nodes.length).toBe(2);
		expect(canvas.edges.length).toBe(1);
	});
});

// ── Canvas operations logic tests (without Obsidian mock) ──────────────────

describe("Canvas operations logic", () => {
	// ── Add nodes ──────────────────────────────────────────────────────────

	it("adds a single node to canvas", () => {
		const canvas: CanvasData = { nodes: [], edges: [] };
		const newNode: CanvasNode = {
			id: "n1",
			type: "text",
			text: "New",
			x: 0,
			y: 0,
		};
		canvas.nodes.push(newNode);

		expect(canvas.nodes.length).toBe(1);
		expect(canvas.nodes[0]!.id).toBe("n1");
	});

	it("adds multiple nodes to canvas", () => {
		const canvas: CanvasData = { nodes: [], edges: [] };
		const nodes: CanvasNode[] = [
			{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
			{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
			{ id: "n3", type: "file", file: "Note.md", x: 200, y: 0 },
		];
		canvas.nodes.push(...nodes);

		expect(canvas.nodes.length).toBe(3);
		expect(canvas.nodes[2]!.type).toBe("file");
	});

	// ── Add edges ──────────────────────────────────────────────────────────

	it("adds a single edge to canvas", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
			],
			edges: [],
		};
		const newEdge: CanvasEdge = {
			id: "e1",
			fromNode: "n1",
			toNode: "n2",
		};
		canvas.edges.push(newEdge);

		expect(canvas.edges.length).toBe(1);
		expect(canvas.edges[0]!.fromNode).toBe("n1");
	});

	it("adds multiple edges to canvas", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
				{ id: "n3", type: "text", text: "C", x: 200, y: 0 },
			],
			edges: [],
		};
		const edges: CanvasEdge[] = [
			{ id: "e1", fromNode: "n1", toNode: "n2" },
			{ id: "e2", fromNode: "n2", toNode: "n3" },
		];
		canvas.edges.push(...edges);

		expect(canvas.edges.length).toBe(2);
	});

	// ── Remove nodes (with edge cleanup) ───────────────────────────────────

	it("removes a node and its connected edges", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
				{ id: "n3", type: "text", text: "C", x: 200, y: 0 },
			],
			edges: [
				{ id: "e1", fromNode: "n1", toNode: "n2" },
				{ id: "e2", fromNode: "n2", toNode: "n3" },
			],
		};

		// Remove node n2
		const idsToRemove = new Set(["n2"]);
		canvas.nodes = canvas.nodes.filter((n) => !idsToRemove.has(n.id));
		canvas.edges = canvas.edges.filter(
			(e) => !idsToRemove.has(e.fromNode) && !idsToRemove.has(e.toNode)
		);

		expect(canvas.nodes.length).toBe(2);
		expect(canvas.edges.length).toBe(0); // Both edges connected to n2 are removed
	});

	it("removes multiple nodes and cleans up edges", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
				{ id: "n3", type: "text", text: "C", x: 200, y: 0 },
			],
			edges: [
				{ id: "e1", fromNode: "n1", toNode: "n2" },
				{ id: "e2", fromNode: "n2", toNode: "n3" },
				{ id: "e3", fromNode: "n1", toNode: "n3" },
			],
		};

		// Remove nodes n1 and n2
		const idsToRemove = new Set(["n1", "n2"]);
		canvas.nodes = canvas.nodes.filter((n) => !idsToRemove.has(n.id));
		canvas.edges = canvas.edges.filter(
			(e) => !idsToRemove.has(e.fromNode) && !idsToRemove.has(e.toNode)
		);

		expect(canvas.nodes.length).toBe(1);
		expect(canvas.edges.length).toBe(0); // All edges are removed
	});

	it("does not affect edges when removing non-connected node", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
				{ id: "n3", type: "text", text: "C", x: 200, y: 0 },
			],
			edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
		};

		// Remove node n3 (not connected)
		const idsToRemove = new Set(["n3"]);
		canvas.nodes = canvas.nodes.filter((n) => !idsToRemove.has(n.id));
		canvas.edges = canvas.edges.filter(
			(e) => !idsToRemove.has(e.fromNode) && !idsToRemove.has(e.toNode)
		);

		expect(canvas.nodes.length).toBe(2);
		expect(canvas.edges.length).toBe(1); // Edge unchanged
	});

	// ── Remove edges ───────────────────────────────────────────────────────

	it("removes a single edge by ID", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
			],
			edges: [
				{ id: "e1", fromNode: "n1", toNode: "n2" },
				{ id: "e2", fromNode: "n2", toNode: "n1" },
			],
		};

		// Remove edge e1
		const idsToRemove = new Set(["e1"]);
		canvas.edges = canvas.edges.filter((e) => !idsToRemove.has(e.id));

		expect(canvas.edges.length).toBe(1);
		expect(canvas.edges[0]!.id).toBe("e2");
	});

	it("removes multiple edges by ID", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
				{ id: "n3", type: "text", text: "C", x: 200, y: 0 },
			],
			edges: [
				{ id: "e1", fromNode: "n1", toNode: "n2" },
				{ id: "e2", fromNode: "n2", toNode: "n3" },
				{ id: "e3", fromNode: "n1", toNode: "n3" },
			],
		};

		// Remove edges e1 and e3
		const idsToRemove = new Set(["e1", "e3"]);
		canvas.edges = canvas.edges.filter((e) => !idsToRemove.has(e.id));

		expect(canvas.edges.length).toBe(1);
		expect(canvas.edges[0]!.id).toBe("e2");
	});

	// ── Combined operations ────────────────────────────────────────────────

	it("handles add and remove operations together", () => {
		const canvas: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "A", x: 0, y: 0 },
				{ id: "n2", type: "text", text: "B", x: 100, y: 0 },
			],
			edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
		};

		// Add a new node
		canvas.nodes.push({ id: "n3", type: "text", text: "C", x: 200, y: 0 });

		// Add an edge
		canvas.edges.push({ id: "e2", fromNode: "n2", toNode: "n3" });

		// Remove first node
		const nodesToRemove = new Set(["n1"]);
		canvas.nodes = canvas.nodes.filter((n) => !nodesToRemove.has(n.id));
		canvas.edges = canvas.edges.filter(
			(e) => !nodesToRemove.has(e.fromNode) && !nodesToRemove.has(e.toNode)
		);

		expect(canvas.nodes.length).toBe(2);
		expect(canvas.edges.length).toBe(1); // e1 removed (connected to n1)
		expect(canvas.edges[0]!.id).toBe("e2");
	});

	// ── Edge cases ─────────────────────────────────────────────────────────

	it("handles empty removal lists gracefully", () => {
		const canvas: CanvasData = {
			nodes: [{ id: "n1", type: "text", text: "A", x: 0, y: 0 }],
			edges: [],
		};

		const emptyNodeRemoval = new Set<string>();
		canvas.nodes = canvas.nodes.filter((n) => !emptyNodeRemoval.has(n.id));

		expect(canvas.nodes.length).toBe(1);
	});

	it("handles removal of non-existent IDs gracefully", () => {
		const canvas: CanvasData = {
			nodes: [{ id: "n1", type: "text", text: "A", x: 0, y: 0 }],
			edges: [],
		};

		const idsToRemove = new Set(["n999"]);
		canvas.nodes = canvas.nodes.filter((n) => !idsToRemove.has(n.id));

		expect(canvas.nodes.length).toBe(1);
	});

	// ── JSON serialization ─────────────────────────────────────────────────

	it("serializes and deserializes canvas data correctly", () => {
		const original: CanvasData = {
			nodes: [
				{ id: "n1", type: "text", text: "Hello", x: 0, y: 0, color: "#ff0000" },
				{ id: "n2", type: "file", file: "Note.md", x: 100, y: 100 },
			],
			edges: [{ id: "e1", fromNode: "n1", toNode: "n2", label: "links to" }],
		};

		const json = JSON.stringify(original);
		const restored = JSON.parse(json) as CanvasData;

		expect(restored.nodes.length).toBe(2);
		expect(restored.edges.length).toBe(1);
		expect(restored.nodes[0]!.color).toBe("#ff0000");
		expect(restored.edges[0]!.label).toBe("links to");
	});
});

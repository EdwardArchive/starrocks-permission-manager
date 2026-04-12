import { describe, it, expect } from "vitest";
import { applyDagreLayout } from "./dagLayout";
import type { Node, Edge } from "@xyflow/react";

function makeNode(id: string, nodeType: string, opts?: { nodeRole?: string; label?: string }): Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { label: opts?.label || id, nodeType, nodeRole: opts?.nodeRole },
  };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("applyDagreLayout", () => {
  it("returns positioned nodes and edges for a simple hierarchy", () => {
    const nodes = [
      makeNode("system", "system", { label: "SYSTEM" }),
      makeNode("cat1", "catalog", { label: "default_catalog" }),
    ];
    const edges = [makeEdge("system", "cat1")];

    const result = applyDagreLayout(nodes, edges, "TB");
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);

    // Each node should have a position
    for (const n of result.nodes) {
      expect(n.position).toBeDefined();
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
    }
  });

  it("assigns type=custom to regular nodes", () => {
    const nodes = [makeNode("n1", "table", { label: "orders" })];
    const result = applyDagreLayout(nodes, [], "TB");
    expect(result.nodes[0].type).toBe("custom");
  });

  it("handles empty graph", () => {
    const result = applyDagreLayout([], [], "TB");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("positions parent above child in TB layout", () => {
    const nodes = [
      makeNode("system", "system", { label: "SYSTEM" }),
      makeNode("cat1", "catalog", { label: "default_catalog" }),
      makeNode("db1", "database", { label: "mydb" }),
    ];
    const edges = [makeEdge("system", "cat1"), makeEdge("cat1", "db1")];

    const result = applyDagreLayout(nodes, edges, "TB");
    const sysNode = result.nodes.find((n) => n.id === "system")!;
    const catNode = result.nodes.find((n) => n.id === "cat1")!;
    const dbNode = result.nodes.find((n) => n.id === "db1")!;

    // In TB layout, parent Y should be less than child Y
    expect(sysNode.position.y).toBeLessThan(catNode.position.y);
    expect(catNode.position.y).toBeLessThan(dbNode.position.y);
  });

  it("handles group nodes with children", () => {
    const nodes = [
      makeNode("parent", "database", { label: "mydb" }),
      makeNode("group1", "table", { label: "Tables", nodeRole: "group" }),
      makeNode("t1", "table", { label: "orders" }),
      makeNode("t2", "table", { label: "users" }),
    ];
    const edges = [
      makeEdge("parent", "group1"),
      makeEdge("group1", "t1"),
      makeEdge("group1", "t2"),
    ];

    const result = applyDagreLayout(nodes, edges, "TB");
    // Should have 4 nodes total
    expect(result.nodes).toHaveLength(4);

    // Group node should have type "group"
    const groupNode = result.nodes.find((n) => n.id === "group1");
    expect(groupNode?.type).toBe("group");

    // Children should be parented to group
    const child1 = result.nodes.find((n) => n.id === "t1");
    const child2 = result.nodes.find((n) => n.id === "t2");
    expect(child1?.parentId).toBe("group1");
    expect(child2?.parentId).toBe("group1");
  });

  it("assigns container dimensions to group nodes", () => {
    const nodes = [
      makeNode("group1", "table", { label: "Tables", nodeRole: "group" }),
      makeNode("t1", "table", { label: "orders" }),
      makeNode("t2", "table", { label: "users" }),
      makeNode("t3", "table", { label: "products" }),
      makeNode("t4", "table", { label: "categories" }),
    ];
    const edges = [
      makeEdge("group1", "t1"),
      makeEdge("group1", "t2"),
      makeEdge("group1", "t3"),
      makeEdge("group1", "t4"),
    ];

    const result = applyDagreLayout(nodes, edges, "TB");
    const groupNode = result.nodes.find((n) => n.id === "group1");
    expect(groupNode).toBeDefined();
    // Group should have containerW and containerH in data
    const data = groupNode!.data as Record<string, unknown>;
    expect(data.containerW).toBeGreaterThan(0);
    expect(data.containerH).toBeGreaterThan(0);
    // Group should have width/height style
    expect(groupNode!.style?.width).toBeGreaterThan(0);
    expect(groupNode!.style?.height).toBeGreaterThan(0);
  });

  it("handles role map layout with role and user nodes", () => {
    const nodes = [
      makeNode("root", "role", { label: "root" }),
      makeNode("db_admin", "role", { label: "db_admin" }),
      makeNode("custom_role", "role", { label: "custom_role" }),
      makeNode("u1", "user", { label: "'admin'@'%'" }),
    ];
    const edges = [
      makeEdge("root", "db_admin"),
      makeEdge("db_admin", "custom_role"),
      makeEdge("custom_role", "u1"),
    ];

    const result = applyDagreLayout(nodes, edges, "TB");
    expect(result.nodes).toHaveLength(4);

    // All nodes should have positions
    for (const n of result.nodes) {
      expect(typeof n.position.x).toBe("number");
      expect(typeof n.position.y).toBe("number");
      expect(isFinite(n.position.x)).toBe(true);
      expect(isFinite(n.position.y)).toBe(true);
    }
  });

  it("handles multiple disconnected components in role map", () => {
    const nodes = [
      makeNode("r1", "role", { label: "role_a" }),
      makeNode("u1", "user", { label: "user_a" }),
      makeNode("r2", "role", { label: "role_b" }),
      makeNode("u2", "user", { label: "user_b" }),
    ];
    const edges = [
      makeEdge("r1", "u1"),
      makeEdge("r2", "u2"),
    ];

    const result = applyDagreLayout(nodes, edges, "TB");
    expect(result.nodes).toHaveLength(4);

    // Components should be placed side by side (different X ranges)
    const r1 = result.nodes.find((n) => n.id === "r1")!;
    const r2 = result.nodes.find((n) => n.id === "r2")!;
    // They should have different X positions since they're separate components
    expect(r1.position.x).not.toBe(r2.position.x);
  });

  it("preserves edge data in output", () => {
    const nodes = [
      makeNode("a", "catalog", { label: "a" }),
      makeNode("b", "database", { label: "b" }),
    ];
    const edges: Edge[] = [{ id: "a-b", source: "a", target: "b", data: { custom: true } }];

    const result = applyDagreLayout(nodes, edges, "TB");
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("a");
    expect(result.edges[0].target).toBe("b");
  });

  it("children have extent=parent", () => {
    const nodes = [
      makeNode("group1", "table", { label: "Tables", nodeRole: "group" }),
      makeNode("t1", "table", { label: "orders" }),
    ];
    const edges = [makeEdge("group1", "t1")];

    const result = applyDagreLayout(nodes, edges, "TB");
    const child = result.nodes.find((n) => n.id === "t1");
    expect(child?.extent).toBe("parent");
  });

  it("handles large number of nodes without error", () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const root = makeNode("root", "system", { label: "SYSTEM" });
    nodes.push(root);
    for (let i = 0; i < 100; i++) {
      const n = makeNode(`t${i}`, "table", { label: `table_${i}` });
      nodes.push(n);
      edges.push(makeEdge("root", n.id));
    }

    const result = applyDagreLayout(nodes, edges, "TB");
    expect(result.nodes).toHaveLength(101);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useDagStore } from "./dagStore";
import type { DAGGraph, DAGNode } from "../types";

const defaultVisibleTypes: Record<string, boolean> = {
  system: true, catalog: true, database: true, table: true,
  view: true, mv: true, function: true, user: true, role: true,
};

beforeEach(() => {
  window.location.hash = "";
  useDagStore.setState({
    activeTab: "obj",
    activeCatalog: "default_catalog",
    dagData: null,
    selectedNode: null,
    panelMode: null,
    groupChildren: [],
    searchQuery: "",
    visibleTypes: { ...defaultVisibleTypes },
    groupsOnly: false,
    hiddenNodes: new Set<string>(),
  });
});

describe("useDagStore", () => {
  describe("initial state (after reset)", () => {
    it("defaults activeTab to obj", () => {
      expect(useDagStore.getState().activeTab).toBe("obj");
    });

    it("defaults activeCatalog to default_catalog", () => {
      expect(useDagStore.getState().activeCatalog).toBe("default_catalog");
    });

    it("defaults dagData to null", () => {
      expect(useDagStore.getState().dagData).toBeNull();
    });

    it("defaults selectedNode to null", () => {
      expect(useDagStore.getState().selectedNode).toBeNull();
    });

    it("defaults panelMode to null", () => {
      expect(useDagStore.getState().panelMode).toBeNull();
    });

    it("defaults groupChildren to empty array", () => {
      expect(useDagStore.getState().groupChildren).toEqual([]);
    });

    it("defaults searchQuery to empty string", () => {
      expect(useDagStore.getState().searchQuery).toBe("");
    });

    it("defaults all visibleTypes to true", () => {
      const types = useDagStore.getState().visibleTypes;
      for (const [, value] of Object.entries(types)) {
        expect(value).toBe(true);
      }
    });

    it("defaults groupsOnly to false", () => {
      expect(useDagStore.getState().groupsOnly).toBe(false);
    });

    it("defaults hiddenNodes to empty Set", () => {
      expect(useDagStore.getState().hiddenNodes.size).toBe(0);
    });
  });

  describe("setActiveTab", () => {
    it("updates activeTab state", () => {
      useDagStore.getState().setActiveTab("role");
      expect(useDagStore.getState().activeTab).toBe("role");
    });

    it("writes tab to window.location.hash", () => {
      useDagStore.getState().setActiveTab("perm");
      expect(window.location.hash).toBe("#perm");
    });
  });

  describe("setActiveCatalog", () => {
    it("updates activeCatalog", () => {
      useDagStore.getState().setActiveCatalog("hive_catalog");
      expect(useDagStore.getState().activeCatalog).toBe("hive_catalog");
    });
  });

  describe("setDagData", () => {
    it("updates dagData", () => {
      const dag: DAGGraph = { nodes: [{ id: "n1", label: "Node1", type: "table" }], edges: [] };
      useDagStore.getState().setDagData(dag);
      expect(useDagStore.getState().dagData).toEqual(dag);
    });

    it("can be set to null", () => {
      useDagStore.getState().setDagData({ nodes: [], edges: [] });
      useDagStore.getState().setDagData(null);
      expect(useDagStore.getState().dagData).toBeNull();
    });
  });

  describe("setSelectedNode", () => {
    it("updates selectedNode", () => {
      const node: DAGNode = { id: "n1", label: "products", type: "table" };
      useDagStore.getState().setSelectedNode(node);
      expect(useDagStore.getState().selectedNode).toEqual(node);
    });

    it("can be set to null", () => {
      useDagStore.getState().setSelectedNode({ id: "n1", label: "x", type: "table" });
      useDagStore.getState().setSelectedNode(null);
      expect(useDagStore.getState().selectedNode).toBeNull();
    });
  });

  describe("setPanelMode", () => {
    it("updates panelMode", () => {
      useDagStore.getState().setPanelMode("object");
      expect(useDagStore.getState().panelMode).toBe("object");
    });

    it("can be set to null", () => {
      useDagStore.getState().setPanelMode("user");
      useDagStore.getState().setPanelMode(null);
      expect(useDagStore.getState().panelMode).toBeNull();
    });
  });

  describe("setGroupChildren", () => {
    it("updates groupChildren", () => {
      const children: DAGNode[] = [
        { id: "n1", label: "t1", type: "table" },
        { id: "n2", label: "t2", type: "table" },
      ];
      useDagStore.getState().setGroupChildren(children);
      expect(useDagStore.getState().groupChildren).toEqual(children);
    });
  });

  describe("setSearchQuery", () => {
    it("updates searchQuery", () => {
      useDagStore.getState().setSearchQuery("products");
      expect(useDagStore.getState().searchQuery).toBe("products");
    });
  });

  describe("toggleType", () => {
    it("toggles a visible type to false", () => {
      useDagStore.getState().toggleType("table");
      expect(useDagStore.getState().visibleTypes.table).toBe(false);
    });

    it("toggles a false type back to true", () => {
      useDagStore.getState().toggleType("table");
      useDagStore.getState().toggleType("table");
      expect(useDagStore.getState().visibleTypes.table).toBe(true);
    });
  });

  describe("setGroupsOnly", () => {
    it("updates groupsOnly", () => {
      useDagStore.getState().setGroupsOnly(true);
      expect(useDagStore.getState().groupsOnly).toBe(true);
    });
  });

  describe("toggleNodeVisibility", () => {
    it("adds node to hiddenNodes Set", () => {
      useDagStore.getState().toggleNodeVisibility("node_a");
      expect(useDagStore.getState().hiddenNodes.has("node_a")).toBe(true);
    });

    it("removes node from hiddenNodes if already hidden", () => {
      useDagStore.getState().toggleNodeVisibility("node_a");
      useDagStore.getState().toggleNodeVisibility("node_a");
      expect(useDagStore.getState().hiddenNodes.has("node_a")).toBe(false);
    });

    it("handles multiple nodes independently", () => {
      useDagStore.getState().toggleNodeVisibility("node_a");
      useDagStore.getState().toggleNodeVisibility("node_b");
      expect(useDagStore.getState().hiddenNodes.size).toBe(2);
      useDagStore.getState().toggleNodeVisibility("node_a");
      expect(useDagStore.getState().hiddenNodes.has("node_a")).toBe(false);
      expect(useDagStore.getState().hiddenNodes.has("node_b")).toBe(true);
    });
  });

  describe("clearHiddenNodes", () => {
    it("resets hiddenNodes to empty Set", () => {
      useDagStore.getState().toggleNodeVisibility("node_a");
      useDagStore.getState().toggleNodeVisibility("node_b");
      expect(useDagStore.getState().hiddenNodes.size).toBe(2);

      useDagStore.getState().clearHiddenNodes();
      expect(useDagStore.getState().hiddenNodes.size).toBe(0);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDagStore } from "./dagStore";
import type { DAGGraph, DAGNode } from "../types";

/** Manually-settled promise for in-flight fetch scenarios. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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
    dagCache: {},
    dagLoading: false,
    currentKey: null,
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

  describe("dag cache (loadDag / clearDagCache)", () => {
    const graphA: DAGGraph = { nodes: [{ id: "a", label: "A", type: "catalog" }], edges: [] };
    const graphB: DAGGraph = { nodes: [{ id: "b", label: "B", type: "role" }], edges: [] };

    it("defaults to an empty cache, not loading, no current key", () => {
      const s = useDagStore.getState();
      expect(s.dagCache).toEqual({});
      expect(s.dagLoading).toBe(false);
      expect(s.currentKey).toBeNull();
    });

    it("fetches on cache miss and stores the graph into cache + dagData", async () => {
      const fetchGraph = vi.fn(() => Promise.resolve(graphA));
      await useDagStore.getState().loadDag("obj_default_catalog", fetchGraph);

      expect(fetchGraph).toHaveBeenCalledTimes(1);
      const s = useDagStore.getState();
      expect(s.dagData).toEqual(graphA);
      expect(s.dagCache["obj_default_catalog"]).toEqual(graphA);
      expect(s.dagLoading).toBe(false);
      expect(s.currentKey).toBe("obj_default_catalog");
    });

    it("sets dagLoading and nulls dagData while a fetch is in flight", async () => {
      const d = deferred<DAGGraph>();
      useDagStore.setState({ dagData: graphB }); // a previous graph was showing

      const p = useDagStore.getState().loadDag("k1", () => d.promise);
      expect(useDagStore.getState().dagLoading).toBe(true);
      expect(useDagStore.getState().dagData).toBeNull();

      d.resolve(graphA);
      await p;
      expect(useDagStore.getState().dagLoading).toBe(false);
      expect(useDagStore.getState().dagData).toEqual(graphA);
    });

    it("serves a cached key without calling fetch (no refetch on revisit)", async () => {
      await useDagStore.getState().loadDag("k1", () => Promise.resolve(graphA));

      const fetchAgain = vi.fn(() => Promise.resolve(graphB));
      await useDagStore.getState().loadDag("k1", fetchAgain);

      expect(fetchAgain).not.toHaveBeenCalled();
      expect(useDagStore.getState().dagData).toEqual(graphA);
      expect(useDagStore.getState().dagLoading).toBe(false);
    });

    it("drops a stale resolve when the key changed while fetching", async () => {
      const slow = deferred<DAGGraph>();
      const p1 = useDagStore.getState().loadDag("k1", () => slow.promise);

      await useDagStore.getState().loadDag("k2", () => Promise.resolve(graphB));
      expect(useDagStore.getState().dagData).toEqual(graphB);

      slow.resolve(graphA); // k1 finally settles — must be dropped
      await p1;

      const s = useDagStore.getState();
      expect(s.dagData).toEqual(graphB); // never clobbered by the stale graph
      expect(s.dagCache["k1"]).toBeUndefined(); // stale result not cached either
      expect(s.dagLoading).toBe(false);
    });

    it("clears dagLoading on fetch failure for the current key", async () => {
      await useDagStore.getState().loadDag("k1", () => Promise.reject(new Error("boom")));

      const s = useDagStore.getState();
      expect(s.dagLoading).toBe(false);
      expect(s.dagData).toBeNull();
      expect(s.dagCache["k1"]).toBeUndefined();
    });

    it("ignores a stale rejection (e.g. abort) after a newer key started loading", async () => {
      const aborted = deferred<DAGGraph>();
      const p1 = useDagStore.getState().loadDag("k1", () => aborted.promise);

      const inFlight = deferred<DAGGraph>();
      const p2 = useDagStore.getState().loadDag("k2", () => inFlight.promise);

      aborted.reject(new Error("aborted"));
      await p1;
      expect(useDagStore.getState().dagLoading).toBe(true); // k2 still loading — untouched

      inFlight.resolve(graphB);
      await p2;
      expect(useDagStore.getState().dagData).toEqual(graphB);
      expect(useDagStore.getState().dagLoading).toBe(false);
    });

    it("cache hit marks the key current so an older in-flight fetch is dropped", async () => {
      await useDagStore.getState().loadDag("k2", () => Promise.resolve(graphB)); // seed cache

      const slow = deferred<DAGGraph>();
      const p1 = useDagStore.getState().loadDag("k1", () => slow.promise);

      const hitFetch = vi.fn(() => Promise.resolve(graphA));
      await useDagStore.getState().loadDag("k2", hitFetch); // hit — k2 becomes current
      expect(hitFetch).not.toHaveBeenCalled();
      expect(useDagStore.getState().dagData).toEqual(graphB);
      expect(useDagStore.getState().dagLoading).toBe(false);

      slow.resolve(graphA);
      await p1;
      expect(useDagStore.getState().dagData).toEqual(graphB);
      expect(useDagStore.getState().dagCache["k1"]).toBeUndefined();
    });

    it("clearDagCache resets cache, dagData, loading and current key", async () => {
      await useDagStore.getState().loadDag("k1", () => Promise.resolve(graphA));

      useDagStore.getState().clearDagCache();

      const s = useDagStore.getState();
      expect(s.dagCache).toEqual({});
      expect(s.dagData).toBeNull();
      expect(s.dagLoading).toBe(false);
      expect(s.currentKey).toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { useClusterStore } from "./clusterStore";

beforeEach(() => {
  useClusterStore.setState({
    isOpen: false,
    expandedNodes: new Set<string>(),
  });
});

describe("useClusterStore", () => {
  describe("initial state", () => {
    it("defaults isOpen to false", () => {
      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("defaults expandedNodes to empty Set", () => {
      expect(useClusterStore.getState().expandedNodes.size).toBe(0);
    });
  });

  describe("openDrawer", () => {
    it("sets isOpen to true", () => {
      useClusterStore.getState().openDrawer();
      expect(useClusterStore.getState().isOpen).toBe(true);
    });

    it("keeps isOpen true when called again", () => {
      useClusterStore.getState().openDrawer();
      useClusterStore.getState().openDrawer();
      expect(useClusterStore.getState().isOpen).toBe(true);
    });
  });

  describe("closeDrawer", () => {
    it("sets isOpen to false", () => {
      useClusterStore.getState().openDrawer();
      useClusterStore.getState().closeDrawer();
      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("keeps isOpen false when already closed", () => {
      useClusterStore.getState().closeDrawer();
      expect(useClusterStore.getState().isOpen).toBe(false);
    });
  });

  describe("toggleDrawer", () => {
    it("opens when closed", () => {
      useClusterStore.getState().toggleDrawer();
      expect(useClusterStore.getState().isOpen).toBe(true);
    });

    it("closes when open", () => {
      useClusterStore.getState().openDrawer();
      useClusterStore.getState().toggleDrawer();
      expect(useClusterStore.getState().isOpen).toBe(false);
    });

    it("toggles back and forth correctly", () => {
      useClusterStore.getState().toggleDrawer();
      expect(useClusterStore.getState().isOpen).toBe(true);
      useClusterStore.getState().toggleDrawer();
      expect(useClusterStore.getState().isOpen).toBe(false);
      useClusterStore.getState().toggleDrawer();
      expect(useClusterStore.getState().isOpen).toBe(true);
    });
  });

  describe("toggleNodeExpansion", () => {
    it("adds a node id to expandedNodes", () => {
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      expect(useClusterStore.getState().expandedNodes.has("fe-01")).toBe(true);
    });

    it("removes a node id if already expanded", () => {
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      expect(useClusterStore.getState().expandedNodes.has("fe-01")).toBe(false);
    });

    it("handles multiple nodes independently", () => {
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      useClusterStore.getState().toggleNodeExpansion("be-01");
      expect(useClusterStore.getState().expandedNodes.size).toBe(2);
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      expect(useClusterStore.getState().expandedNodes.has("fe-01")).toBe(false);
      expect(useClusterStore.getState().expandedNodes.has("be-01")).toBe(true);
    });

    it("can expand multiple distinct nodes", () => {
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      useClusterStore.getState().toggleNodeExpansion("fe-02");
      useClusterStore.getState().toggleNodeExpansion("be-01");
      expect(useClusterStore.getState().expandedNodes.size).toBe(3);
    });
  });

  describe("collapseAll", () => {
    it("resets expandedNodes to empty Set", () => {
      useClusterStore.getState().toggleNodeExpansion("fe-01");
      useClusterStore.getState().toggleNodeExpansion("be-01");
      expect(useClusterStore.getState().expandedNodes.size).toBe(2);

      useClusterStore.getState().collapseAll();
      expect(useClusterStore.getState().expandedNodes.size).toBe(0);
    });

    it("is a no-op when already empty", () => {
      useClusterStore.getState().collapseAll();
      expect(useClusterStore.getState().expandedNodes.size).toBe(0);
    });
  });
});

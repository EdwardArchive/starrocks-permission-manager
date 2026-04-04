import { create } from "zustand";
import type { DAGNode } from "../types";

export type TabId = "obj" | "role" | "full" | "perm" | "myperm";
export type PanelMode = "object" | "user" | "group" | null;

interface DagState {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;

  activeCatalog: string;
  setActiveCatalog: (catalog: string) => void;

  selectedNode: DAGNode | null;
  setSelectedNode: (node: DAGNode | null) => void;

  panelMode: PanelMode;
  setPanelMode: (mode: PanelMode) => void;

  // For group panel: child nodes
  groupChildren: DAGNode[];
  setGroupChildren: (children: DAGNode[]) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Type filters
  visibleTypes: Record<string, boolean>;
  toggleType: (type: string) => void;
  groupsOnly: boolean;
  setGroupsOnly: (v: boolean) => void;

  // Node visibility (hide/show individual nodes)
  hiddenNodes: Set<string>;
  toggleNodeVisibility: (nodeLabel: string) => void;
  clearHiddenNodes: () => void;
}

const defaultTypes: Record<string, boolean> = {
  system: true, catalog: true, database: true, table: true,
  view: true, mv: true, function: true, user: true, role: true,
};

export const useDagStore = create<DagState>((set) => ({
  activeTab: (window.location.hash.replace("#", "") as TabId) || "obj",
  setActiveTab: (tab) => { window.location.hash = tab; set({ activeTab: tab }); },

  activeCatalog: "default_catalog",
  setActiveCatalog: (catalog) => set({ activeCatalog: catalog }),

  selectedNode: null,
  setSelectedNode: (node) => set({ selectedNode: node }),

  panelMode: null,
  setPanelMode: (mode) => set({ panelMode: mode }),

  groupChildren: [],
  setGroupChildren: (children) => set({ groupChildren: children }),

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),

  visibleTypes: { ...defaultTypes },
  toggleType: (type) =>
    set((s) => ({
      visibleTypes: { ...s.visibleTypes, [type]: !s.visibleTypes[type] },
    })),
  groupsOnly: false,
  setGroupsOnly: (v) => set({ groupsOnly: v }),

  hiddenNodes: new Set<string>(),
  toggleNodeVisibility: (nodeLabel) =>
    set((s) => {
      const next = new Set(s.hiddenNodes);
      if (next.has(nodeLabel)) next.delete(nodeLabel);
      else next.add(nodeLabel);
      return { hiddenNodes: next };
    }),
  clearHiddenNodes: () => set({ hiddenNodes: new Set<string>() }),
}));

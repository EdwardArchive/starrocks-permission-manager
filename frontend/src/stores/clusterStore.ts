import { create } from "zustand";

// Where the Cluster Monitor tab should scroll/highlight when opened from the
// drawer. `nonce` makes repeat jumps to the same target re-fire the effect.
export type ClusterFocus =
  | { kind: "section"; id: "frontends" | "backends" | "queries"; nonce: number }
  | { kind: "node"; id: string; nonce: number }; // id = "fe:<name>" / "be:<name>" / "cn:<name>"

interface ClusterState {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  expandedNodes: Set<string>;
  toggleNodeExpansion: (id: string) => void;
  collapseAll: () => void;
  focus: ClusterFocus | null;
  requestFocus: (f: Omit<ClusterFocus, "nonce">) => void;
  clearFocus: () => void;
  reset: () => void;
}

export const useClusterStore = create<ClusterState>((set) => ({
  isOpen: false,
  openDrawer: () => set({ isOpen: true }),
  closeDrawer: () => set({ isOpen: false }),
  toggleDrawer: () => set((s) => ({ isOpen: !s.isOpen })),
  expandedNodes: new Set<string>(),
  toggleNodeExpansion: (id) =>
    set((s) => {
      const next = new Set(s.expandedNodes);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedNodes: next };
    }),
  collapseAll: () => set({ expandedNodes: new Set<string>() }),
  focus: null,
  requestFocus: (f) => set((s) => ({ focus: { ...f, nonce: (s.focus?.nonce ?? 0) + 1 } as ClusterFocus })),
  clearFocus: () => set({ focus: null }),
  reset: () => set({ isOpen: false, expandedNodes: new Set<string>(), focus: null }),
}));

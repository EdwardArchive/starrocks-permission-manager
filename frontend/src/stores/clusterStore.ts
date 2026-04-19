import { create } from "zustand";

interface ClusterState {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  expandedNodes: Set<string>;
  toggleNodeExpansion: (id: string) => void;
  collapseAll: () => void;
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
  reset: () => set({ isOpen: false, expandedNodes: new Set<string>() }),
}));

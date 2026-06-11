import { create } from "zustand";
import type { GranteeRef, GrantObjectRef } from "../types";

/** Prefill payload for opening the wizard from contextual entry points. */
export interface WizardPrefill {
  action?: "GRANT" | "REVOKE";
  grantee?: GranteeRef;
  object?: GrantObjectRef;
  privileges?: string[];
}

interface GrantState {
  wizardOpen: boolean;
  /** increments on every openWizard — used as a remount key for the wizard body */
  openId: number;
  prefill: WizardPrefill | null;
  /** bumped after every successful execute so open views (audit tab) can refetch */
  refreshTick: number;
  openWizard: (prefill?: WizardPrefill) => void;
  closeWizard: () => void;
  bumpRefresh: () => void;
}

export const useGrantStore = create<GrantState>((set) => ({
  wizardOpen: false,
  openId: 0,
  prefill: null,
  refreshTick: 0,
  openWizard: (prefill) => set((s) => ({ wizardOpen: true, openId: s.openId + 1, prefill: prefill ?? null })),
  closeWizard: () => set({ wizardOpen: false, prefill: null }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));

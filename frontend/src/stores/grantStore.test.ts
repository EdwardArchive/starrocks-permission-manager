import { describe, it, expect, beforeEach } from "vitest";
import { useGrantStore } from "./grantStore";

describe("grantStore", () => {
  beforeEach(() => {
    useGrantStore.setState({ wizardOpen: false, openId: 0, prefill: null, refreshTick: 0 });
  });

  it("opens the wizard and bumps openId for remounting", () => {
    useGrantStore.getState().openWizard();
    expect(useGrantStore.getState().wizardOpen).toBe(true);
    expect(useGrantStore.getState().openId).toBe(1);

    useGrantStore.getState().closeWizard();
    useGrantStore.getState().openWizard();
    expect(useGrantStore.getState().openId).toBe(2);
  });

  it("stores and clears the prefill payload", () => {
    useGrantStore.getState().openWizard({
      action: "REVOKE",
      grantee: { name: "alice", type: "USER" },
      privileges: ["SELECT"],
    });
    expect(useGrantStore.getState().prefill?.action).toBe("REVOKE");
    expect(useGrantStore.getState().prefill?.grantee?.name).toBe("alice");

    useGrantStore.getState().closeWizard();
    expect(useGrantStore.getState().wizardOpen).toBe(false);
    expect(useGrantStore.getState().prefill).toBeNull();
  });

  it("bumps refreshTick after executes", () => {
    useGrantStore.getState().bumpRefresh();
    useGrantStore.getState().bumpRefresh();
    expect(useGrantStore.getState().refreshTick).toBe(2);
  });
});

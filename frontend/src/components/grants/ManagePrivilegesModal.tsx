import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useGrantStore } from "../../stores/grantStore";
import {
  executeGrant,
  getGrantSpec,
  getRoles,
  getRolePrivileges,
  getUserPrivileges,
  previewGrant,
  searchUsersRoles,
} from "../../api/admin";
import { getCatalogs, getDatabases, getTables } from "../../api/user";
import { showToast } from "../../utils/toast";
import { C } from "../../utils/colors";
import ComboInput from "../common/ComboInput";
import InlineIcon from "../common/InlineIcon";
import type { GrantRequest, GrantSpec, PrivilegeGrant } from "../../types";

const OBJECT_TYPE_ORDER = ["CATALOG", "DATABASE", "TABLE", "VIEW", "MATERIALIZED VIEW", "FUNCTION"];

// object_type → InlineIcon key (mirrors nodeIcons NODE_SVG_RAW)
const OBJ_ICON: Record<string, string> = {
  CATALOG: "catalog",
  DATABASE: "database",
  TABLE: "table",
  VIEW: "view",
  "MATERIALIZED VIEW": "mv",
  FUNCTION: "function",
};

// StarRocks rejects any grant change on these ("role X is not mutable")
const BUILTIN_ROLES = new Set(["root", "cluster_admin", "db_admin", "user_admin", "security_admin", "public"]);

const RED = "#ef4444"; // REVOKE mode accent

/** A grant row is only revocable per-object when it carries a concrete object path.
 * Wildcard scope grants (e.g. root's ON ALL TABLES IN ALL DATABASES) come back with
 * null catalog/db/name and cannot be revoked through a single-object REVOKE. */
function isRevocableRow(g: PrivilegeGrant): boolean {
  if (!OBJECT_TYPE_ORDER.includes(g.object_type)) return false;
  if (g.object_type === "CATALOG") return !!g.object_catalog;
  if (g.object_type === "DATABASE") return !!g.object_database;
  return !!g.object_database && !!g.object_name;
}

// intent-level privilege presets (intersected with the object type's allowlist)
const PRESETS: { label: string; privs: string[] }[] = [
  { label: "Read-only", privs: ["SELECT", "USAGE"] },
  { label: "Read-write", privs: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  { label: "Full", privs: ["ALL"] },
];

const fieldLabel: React.CSSProperties = { fontSize: 11.5, color: C.text2, marginBottom: 5, display: "block", fontWeight: 500 };
const kStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase", color: C.text3 };

/** Segment of a themed toggle group. Keeps a real (hidden) radio input so
 * jest-dom toBeChecked() and Playwright .check() keep working on the testId. */
function Seg({
  active,
  label,
  onSelect,
  testId,
  activeColor,
}: {
  active: boolean;
  label: React.ReactNode;
  onSelect: () => void;
  testId: string;
  activeColor?: string;
}) {
  return (
    <label
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "6px 14px",
        fontSize: 12.5,
        fontWeight: active ? 600 : 400,
        borderRadius: 6,
        cursor: "pointer",
        whiteSpace: "nowrap",
        userSelect: "none",
        color: active ? "#fff" : C.text2,
        background: active ? (activeColor ?? C.accent) : "transparent",
        transition: "color .15s, background .15s",
      }}
    >
      <input
        type="radio"
        data-testid={testId}
        checked={active}
        onChange={onSelect}
        style={{ position: "absolute", inset: 0, opacity: 0, margin: 0, cursor: "pointer" }}
      />
      {label}
    </label>
  );
}

function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, background: C.bg, border: `1px solid ${C.borderLight}`, borderRadius: 8 }}>
      {children}
    </div>
  );
}

/** Section divider header: uppercase key + optional inline extra + rule line. */
function SectionH({ title, icon, extra }: { title: string; icon?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
      {icon}
      <span style={kStyle}>{title}</span>
      {extra}
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={C.text2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const WarnLine = ({ children, color = "#fde68a" }: { children: React.ReactNode; color?: string }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color }}>
    <span style={{ flexShrink: 0, marginTop: 1 }}>
      <InlineIcon type="warning" size={13} color={color} />
    </span>
    <span>{children}</span>
  </div>
);

// Lightweight SQL keyword highlighting (display only — preserves textContent).
const SQL_KW = new Set([
  "WITH GRANT OPTION", "MATERIALIZED VIEW", "CREATE DATABASE", "CREATE TABLE", "SET CATALOG",
  "GRANT", "REVOKE", "ON", "TO", "FROM", "ALL", "ROLE", "TABLE", "DATABASE", "CATALOG", "VIEW",
  "FUNCTION", "SYSTEM", "USER", "GLOBAL", "USAGE", "SELECT", "INSERT", "UPDATE", "DELETE", "ALTER",
  "DROP", "EXPORT", "REFRESH", "CREATE",
]);
const SQL_SPLIT = /(`[^`]*`|'[^']*'|\bWITH GRANT OPTION\b|\bMATERIALIZED VIEW\b|\bCREATE DATABASE\b|\bCREATE TABLE\b|\bSET CATALOG\b|\b[A-Z_]+\b)/gi;

function renderSqlLine(line: string): React.ReactNode[] {
  return line.split(SQL_SPLIT).map((seg, i) => {
    if (!seg) return null;
    if (/^[`'].*[`']$/.test(seg)) return <span key={i} style={{ color: "#fcd34d" }}>{seg}</span>; // identifier/literal
    if (SQL_KW.has(seg.toUpperCase())) return <span key={i} style={{ color: "#7dd3fc", fontWeight: 600 }}>{seg}</span>;
    return <span key={i}>{seg}</span>;
  });
}

/** Normalize 'alice'@'%' → alice for self-revoke comparison */
function bareUser(name: string): string {
  const m = name.match(/^'([^']+)'@/);
  return (m ? m[1] : name.split("@")[0]).trim();
}

/** Does a grant row target the given object reference exactly? */
function grantMatchesObject(
  g: PrivilegeGrant,
  objectType: string,
  catalog: string,
  database: string,
  name: string
): boolean {
  if (g.object_type !== objectType) return false;
  if ((g.object_catalog ?? "") !== catalog) return false;
  const needsDb = objectType !== "CATALOG";
  const needsName = !["CATALOG", "DATABASE"].includes(objectType);
  if (needsDb && (g.object_database ?? "") !== database) return false;
  if (needsName && (g.object_name ?? "") !== name) return false;
  return true;
}

interface ExecResult {
  label: string;
  ok: boolean;
  audit?: "ok" | "failed";
  error?: string;
}

export default function ManagePrivilegesModal() {
  const wizardOpen = useGrantStore((s) => s.wizardOpen);
  const openId = useGrantStore((s) => s.openId);
  if (!wizardOpen) return null;
  // remount per open — state initializers pick up the prefill, no reset effect needed
  return <WizardBody key={openId} />;
}

function WizardBody() {
  const { prefill, closeWizard, bumpRefresh } = useGrantStore();
  const currentUser = useAuthStore((s) => s.user?.username ?? "");

  // form state (initialized from the contextual prefill)
  const [action, setAction] = useState<"GRANT" | "REVOKE">(prefill?.action ?? "GRANT");
  const [grantType, setGrantType] = useState<"PRIVILEGE" | "ROLE">("PRIVILEGE");
  const [granteeName, setGranteeName] = useState(prefill?.grantee?.name ?? "");
  const [granteeType, setGranteeType] = useState<"USER" | "ROLE">(prefill?.grantee?.type ?? "USER");
  const [objectType, setObjectType] = useState(prefill?.object?.object_type ?? "TABLE");
  const [catalog, setCatalog] = useState(prefill?.object?.catalog ?? "default_catalog");
  const [database, setDatabase] = useState(prefill?.object?.database ?? "");
  const [objName, setObjName] = useState(prefill?.object?.name ?? "");
  const [privileges, setPrivileges] = useState<Set<string>>(new Set(prefill?.privileges ?? []));
  const [withGrantOption, setWithGrantOption] = useState(false);
  const [role, setRole] = useState("");
  const [keepOpen, setKeepOpen] = useState(false);

  // data sources
  const [spec, setSpec] = useState<GrantSpec | null>(null);
  const [granteeSuggestions, setGranteeSuggestions] = useState<{ name: string; type: string }[]>([]);
  const [catalogs, setCatalogs] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [objects, setObjects] = useState<{ name: string; object_type: string }[]>([]);
  const [allRoles, setAllRoles] = useState<string[]>([]);
  const [granteeGrants, setGranteeGrants] = useState<PrivilegeGrant[] | null>(null);
  const [grantsTick, setGrantsTick] = useState(0); // bump to refetch grantee grants

  // revoke multi-select (indices into directGrants)
  const [selectedRevoke, setSelectedRevoke] = useState<Set<number>>(new Set());

  // preview / execute state
  const [previewSql, setPreviewSql] = useState<string[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<ExecResult[]>([]);

  // initial data load (mount-only — the body remounts per open)
  useEffect(() => {
    getGrantSpec().then(setSpec).catch(() => {});
    getCatalogs().then((cs) => setCatalogs(cs.map((c) => c.name))).catch(() => {});
    getRoles().then((rs) => setAllRoles(rs.map((r) => r.name))).catch(() => {});
  }, []);

  // Esc closes the modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !executing) closeWizard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [executing, closeWizard]);

  // dependent pickers
  useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    getDatabases(catalog)
      .then((ds) => { if (!cancelled) setDatabases(ds.map((d) => d.name)); })
      .catch(() => { if (!cancelled) setDatabases([]); });
    return () => { cancelled = true; };
  }, [catalog]);

  useEffect(() => {
    if (!catalog || !database) return;
    let cancelled = false;
    getTables(catalog, database)
      .then((os) => { if (!cancelled) setObjects(os); })
      .catch(() => { if (!cancelled) setObjects([]); });
    return () => { cancelled = true; };
  }, [catalog, database]);

  // grantee suggestions (debounced, custom dropdown)
  useEffect(() => {
    const t = setTimeout(() => {
      if (granteeName.length < 1) { setGranteeSuggestions([]); return; }
      searchUsersRoles(granteeName, 12)
        .then((rs) => setGranteeSuggestions(rs.filter((r) => r.type === "user" || r.type === "role").map((r) => ({ name: r.name, type: r.type }))))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [granteeName]);

  // load the grantee's privileges — powers the revoke helper AND already-granted badges
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!granteeName) { setGranteeGrants(null); return; }
      const fetcher = granteeType === "USER" ? getUserPrivileges : getRolePrivileges;
      try {
        let grants = await fetcher(granteeName);
        // sys tables store user grantees as 'name'@'host' — retry bare names in that form
        if (grants.length === 0 && granteeType === "USER" && !granteeName.includes("@")) {
          grants = await fetcher(`'${granteeName}'@'%'`);
        }
        setGranteeGrants(grants);
        setSelectedRevoke(new Set());
      } catch {
        setGranteeGrants([]);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [granteeName, granteeType, grantsTick]);

  const allowedPrivs = useMemo(() => spec?.object_types[objectType] ?? [], [spec, objectType]);

  const directGrants = useMemo(
    () => (granteeGrants ?? []).filter((g) => g.source === "direct" && isRevocableRow(g)),
    [granteeGrants]
  );
  // direct but wildcard/scope grants — shown for context, not selectable
  const scopeGrants = useMemo(
    () =>
      (granteeGrants ?? []).filter(
        (g) => g.source === "direct" && OBJECT_TYPE_ORDER.includes(g.object_type) && !isRevocableRow(g)
      ),
    [granteeGrants]
  );
  const inheritedGrants = useMemo(
    () => (granteeGrants ?? []).filter((g) => g.source !== "direct" && OBJECT_TYPE_ORDER.includes(g.object_type)),
    [granteeGrants]
  );
  const builtinGrantee = granteeType === "ROLE" && BUILTIN_ROLES.has(granteeName.trim().toLowerCase());

  // privileges the grantee already holds on the currently selected object
  const alreadyGranted = useMemo(() => {
    const set = new Set<string>();
    for (const g of granteeGrants ?? []) {
      if (grantMatchesObject(g, objectType, catalog.trim(), database.trim(), objName.trim())) {
        set.add(g.privilege_type);
      }
    }
    return set;
  }, [granteeGrants, objectType, catalog, database, objName]);

  const presets = useMemo(
    () =>
      PRESETS.map((p) => ({ ...p, privs: p.privs.filter((x) => allowedPrivs.includes(x)) })).filter(
        (p) => p.privs.length > 0
      ),
    [allowedPrivs]
  );

  const buildRequest = useCallback((): GrantRequest | null => {
    if (!granteeName.trim()) return null;
    const grantee = { name: granteeName.trim(), type: granteeType };
    if (grantType === "ROLE") {
      if (!role.trim()) return null;
      return { action, type: "ROLE", grantee, role: role.trim() };
    }
    if (privileges.size === 0 || !catalog.trim()) return null;
    const needsDb = objectType !== "CATALOG";
    const needsName = !["CATALOG", "DATABASE"].includes(objectType);
    if (needsDb && !database.trim()) return null;
    if (needsName && !objName.trim()) return null;
    return {
      action,
      type: "PRIVILEGE",
      grantee,
      object: {
        object_type: objectType,
        catalog: catalog.trim(),
        database: needsDb ? database.trim() : null,
        name: needsName ? objName.trim() : null,
      },
      privileges: [...privileges],
      with_grant_option: withGrantOption,
    };
  }, [action, grantType, granteeName, granteeType, role, objectType, catalog, database, objName, privileges, withGrantOption]);

  // requests for the multi-select revoke path (one per selected direct grant)
  const multiRequests = useMemo((): GrantRequest[] => {
    if (action !== "REVOKE" || grantType !== "PRIVILEGE" || selectedRevoke.size === 0) return [];
    const grantee = { name: granteeName.trim(), type: granteeType };
    return [...selectedRevoke]
      .map((i) => directGrants[i])
      .filter(Boolean)
      .map((g) => ({
        action: "REVOKE" as const,
        type: "PRIVILEGE" as const,
        grantee,
        object: {
          object_type: g.object_type,
          // SHOW GRANTS-parsed rows may omit the catalog for the internal catalog
          catalog: g.object_catalog ?? "default_catalog",
          database: g.object_database,
          name: g.object_name,
        },
        privileges: [g.privilege_type],
        with_grant_option: false,
      }));
  }, [action, grantType, selectedRevoke, directGrants, granteeName, granteeType]);

  const multiMode = multiRequests.length > 0;

  // live SQL preview (debounced; multi-select previews all selected revokes)
  useEffect(() => {
    const t = setTimeout(() => {
      const reqs = multiMode ? multiRequests : (() => { const r = buildRequest(); return r ? [r] : []; })();
      if (reqs.length === 0) {
        setPreviewSql([]);
        setPreviewError("");
        setPreviewWarnings([]);
        return;
      }
      Promise.all(reqs.map((r) => previewGrant(r)))
        .then((res) => {
          setPreviewSql(res.flatMap((x) => x.sql));
          setPreviewWarnings([...new Set(res.flatMap((x) => x.warnings))]);
          setPreviewError("");
        })
        .catch((e: Error) => {
          setPreviewSql([]);
          setPreviewWarnings([]);
          setPreviewError(e.message);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [buildRequest, multiMode, multiRequests]);

  const selfRevoke = action === "REVOKE" && granteeType === "USER" && bareUser(granteeName) === currentUser;
  const dangerous = withGrantOption || privileges.has("ALL");
  const modeColor = action === "REVOKE" ? RED : C.accent;

  const runRequests = async (reqs: GrantRequest[]) => {
    setExecuting(true);
    const newResults: ExecResult[] = [];
    let anyOk = false;
    for (const req of reqs) {
      const label =
        req.type === "ROLE"
          ? `${req.action} role ${req.role} ${req.action === "GRANT" ? "to" : "from"} ${req.grantee.name}`
          : `${req.action} ${(req.privileges ?? []).join(", ")} on ${[req.object?.database, req.object?.name].filter(Boolean).join(".")}`;
      try {
        const res = await executeGrant(req);
        newResults.push({ label, ok: true, audit: res.audit });
        anyOk = true;
      } catch (e) {
        newResults.push({ label, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setExecuting(false);
    setConfirming(false);
    setResults((prev) => [...prev, ...newResults]);
    if (anyOk) bumpRefresh();
    if (newResults.some((r) => r.audit === "failed")) {
      showToast("Executed, but some audit records could not be written (check srpm_audit setup)", "warning", 8000);
    }
    const allOk = newResults.every((r) => r.ok);
    if (allOk && !keepOpen && !multiMode) {
      showToast(`${action} executed successfully`, "info", 4000);
      closeWizard();
      return;
    }
    // keep-open / multi mode: stay, refresh grantee grants, reset transient parts
    setSelectedRevoke(new Set());
    setPrivileges(new Set());
    setWithGrantOption(false);
    setGrantsTick((x) => x + 1);
  };

  const handleExecute = () => {
    const reqs = multiMode ? multiRequests : (() => { const r = buildRequest(); return r ? [r] : []; })();
    if (reqs.length === 0) return;
    void runRequests(reqs);
  };

  const copySql = () => {
    if (!previewSql.length) return;
    const text = previewSql.join(";\n") + ";";
    navigator.clipboard?.writeText(text).then(() => showToast("SQL copied to clipboard", "info", 2000)).catch(() => {});
  };

  const needsDb = objectType !== "CATALOG";
  const needsName = !["CATALOG", "DATABASE"].includes(objectType);
  const canExecute = multiMode || previewSql.length > 0;

  const toggleRevokeRow = (i: number) =>
    setSelectedRevoke((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  const jumpToSourceRole = (sourceRole: string) => {
    setGranteeType("ROLE");
    setGranteeName(sourceRole);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !executing) closeWizard(); }}
    >
      <div
        data-testid="mp-modal"
        style={{
          width: 880, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column",
          background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 14, overflow: "hidden",
          boxShadow: "0 28px 70px -20px rgba(0,0,0,0.7)",
        }}
      >
        {/* ── sticky header ── */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "15px 20px", borderBottom: `1px solid ${C.border}`, background: "#222f49" }}>
          <GearIcon />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>
            Manage Privileges
            {granteeName.trim() && (
              <span style={{ fontSize: 11.5, color: C.text3, fontWeight: 400 }}>
                {" · "}{action === "GRANT" ? "grant to" : "revoke from"} {granteeName.trim()}
              </span>
            )}
          </h3>
          <button
            onClick={closeWizard}
            disabled={executing}
            data-testid="mp-close"
            style={{ display: "inline-grid", placeItems: "center", width: 30, height: 30, border: "none", background: "transparent", borderRadius: 6, color: C.text2, cursor: "pointer" }}
          >
            <InlineIcon type="close" size={18} color={C.text2} />
          </button>
        </div>

        {/* ── two-pane body (left form / right rail) ── */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          {/* left: form */}
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", minWidth: 0 }}>
            {/* Action × Type */}
            <div style={{ display: "flex", gap: 26, marginBottom: 18, flexWrap: "wrap" }}>
              <div>
                <label style={fieldLabel}>Action</label>
                <SegGroup>
                  <Seg testId="mp-action-grant" label="Grant" active={action === "GRANT"} onSelect={() => setAction("GRANT")} activeColor={C.accent} />
                  <Seg testId="mp-action-revoke" label="Revoke" active={action === "REVOKE"} onSelect={() => setAction("REVOKE")} activeColor={RED} />
                </SegGroup>
              </div>
              <div>
                <label style={fieldLabel}>Type</label>
                <SegGroup>
                  <Seg testId="mp-type-privilege" label="Privilege on object" active={grantType === "PRIVILEGE"} onSelect={() => setGrantType("PRIVILEGE")} activeColor={C.card} />
                  <Seg testId="mp-type-role" label="Role assignment" active={grantType === "ROLE"} onSelect={() => setGrantType("ROLE")} activeColor={C.card} />
                </SegGroup>
              </div>
            </div>

            {/* Recipient */}
            <div style={{ marginBottom: 18 }}>
              <SectionH title="Recipient" icon={<InlineIcon type={granteeType === "ROLE" ? "role" : "user"} size={13} />} />
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={fieldLabel}>{grantType === "ROLE" ? "Grantee (recipient)" : "Grantee"}</label>
                  <ComboInput
                    testId="mp-grantee-name"
                    placeholder="user or role name (e.g. alice or 'alice'@'%')"
                    value={granteeName}
                    onChange={setGranteeName}
                    localFilter={false}
                    options={granteeSuggestions.map((s) => ({
                      value: s.name,
                      meta: s.type,
                      badge: {
                        text: s.type.toUpperCase(),
                        bg: s.type === "role" ? "#7c3aed33" : "#0ea5e933",
                        fg: s.type === "role" ? "#c4b5fd" : "#7dd3fc",
                      },
                    }))}
                    onSelect={(o) => {
                      setGranteeName(o.value);
                      setGranteeType(o.meta === "role" ? "ROLE" : "USER");
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>Grantee type</label>
                  <SegGroup>
                    <Seg testId="mp-grantee-type-user" label="User" active={granteeType === "USER"} onSelect={() => setGranteeType("USER")} activeColor="#0ea5e9" />
                    <Seg testId="mp-grantee-type-role" label="Role" active={granteeType === "ROLE"} onSelect={() => setGranteeType("ROLE")} activeColor="#f97316" />
                  </SegGroup>
                </div>
              </div>
            </div>

            {grantType === "ROLE" ? (
              <div style={{ marginBottom: 14 }}>
                <SectionH title={`Role to ${action.toLowerCase()}`} />
                <ComboInput testId="mp-role" placeholder="role name" value={role} onChange={setRole} options={allRoles.map((r) => ({ value: r }))} />
              </div>
            ) : (
              <>
                {/* Built-in roles cannot be modified at all */}
                {builtinGrantee && (
                  <div data-testid="mp-builtin-warning" style={{ marginBottom: 16, padding: "9px 11px", border: "1px solid #f59e0b", borderRadius: 8, background: "#f59e0b14" }}>
                    <WarnLine color="#fde68a">
                      <strong>{granteeName.trim()}</strong> is a built-in role — StarRocks rejects any grant change on it ("role is not mutable").
                    </WarnLine>
                  </div>
                )}

                {/* Revoke helper: existing direct grants (multi-select) + inherited (jump to source) */}
                {action === "REVOKE" && granteeGrants !== null && (
                  <div style={{ marginBottom: 16 }}>
                    <SectionH title="Existing grants" />
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 190, overflowY: "auto", background: C.bg }}>
                      {directGrants.length === 0 && inheritedGrants.length === 0 && scopeGrants.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 12, color: C.text3 }}>No grants found for this grantee.</div>
                      ) : (
                        <>
                          {directGrants.map((g, i) => (
                            <label
                              key={`d${i}`}
                              data-testid="mp-direct-grant"
                              style={{ padding: "8px 11px", fontSize: 12, color: C.text2, cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", background: selectedRevoke.has(i) ? "#ef444414" : "transparent" }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedRevoke.has(i)}
                                onChange={() => toggleRevokeRow(i)}
                                style={{ accentColor: RED, cursor: "pointer" }}
                              />
                              <strong style={{ color: action === "REVOKE" ? "#fca5a5" : C.accent }}>{g.privilege_type}</strong>
                              <span>{g.object_type}</span>
                              <span style={{ color: C.text3 }}>
                                {[g.object_catalog, g.object_database, g.object_name].filter(Boolean).join(".")}
                              </span>
                            </label>
                          ))}
                          {scopeGrants.map((g, i) => (
                            <div
                              key={`s${i}`}
                              data-testid="mp-scope-grant"
                              title="Wildcard scope grant (e.g. ON ALL TABLES IN ALL DATABASES) — cannot be revoked per-object"
                              style={{ padding: "8px 11px", fontSize: 12, color: C.text3, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", opacity: 0.6 }}
                            >
                              <span style={{ width: 13 }} />
                              <strong>{g.privilege_type}</strong>
                              <span>{g.object_type}</span>
                              <span style={{ fontStyle: "italic" }}>ALL (scope grant — not revocable per-object)</span>
                            </div>
                          ))}
                          {inheritedGrants.map((g, i) => (
                            <div
                              key={`i${i}`}
                              data-testid="mp-inherited-grant"
                              style={{ padding: "8px 11px", fontSize: 12, color: C.text3, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", opacity: 0.75 }}
                            >
                              <span style={{ width: 13 }} />
                              <strong>{g.privilege_type}</strong>
                              <span>{g.object_type}</span>
                              <span>{[g.object_catalog, g.object_database, g.object_name].filter(Boolean).join(".")}</span>
                              <button
                                onClick={() => jumpToSourceRole(g.source)}
                                style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.accent, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                                title={`Inherited — revoke at role ${g.source}`}
                              >
                                via {g.source} →
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {!multiMode && (
                  <>
                    {/* Object selector */}
                    <div style={{ marginBottom: 18 }}>
                      <SectionH title="Target object" icon={<InlineIcon type={OBJ_ICON[objectType] ?? "table"} size={13} />} />
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ width: 160 }}>
                          <label style={fieldLabel}>Object type</label>
                          <ComboInput
                            testId="mp-object-type"
                            selectOnly
                            value={objectType}
                            onChange={(v) => { setObjectType(v); setPrivileges(new Set()); }}
                            options={OBJECT_TYPE_ORDER.filter((t) => !spec || spec.object_types[t]).map((t) => ({ value: t }))}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 130 }}>
                          <label style={fieldLabel}>Catalog</label>
                          <ComboInput testId="mp-catalog" value={catalog} onChange={setCatalog} options={catalogs.map((c) => ({ value: c }))} />
                        </div>
                        {needsDb && (
                          <div style={{ flex: 1, minWidth: 130 }}>
                            <label style={fieldLabel}>Database</label>
                            <ComboInput testId="mp-database" value={database} onChange={setDatabase} options={databases.map((d) => ({ value: d }))} />
                          </div>
                        )}
                        {needsName && (
                          <div style={{ flex: 1, minWidth: 130 }}>
                            <label style={fieldLabel}>{objectType === "FUNCTION" ? "Function (signature)" : "Object"}</label>
                            <ComboInput
                              testId="mp-name"
                              placeholder={objectType === "FUNCTION" ? "my_udf(INT,INT)" : "name"}
                              value={objName}
                              onChange={setObjName}
                              options={objects
                                .filter((o) => objectType === "FUNCTION" || o.object_type.toUpperCase().includes(objectType === "TABLE" ? "TABLE" : objectType))
                                .map((o) => ({ value: o.name }))}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Privileges + presets */}
                    <div style={{ marginBottom: 14 }}>
                      <SectionH
                        title="Privileges"
                        extra={action === "GRANT" && presets.length > 0 ? (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            {presets.map((p) => (
                              <button
                                key={p.label}
                                data-testid={`mp-preset-${p.label.replace(/ /g, "-")}`}
                                onClick={() => setPrivileges(new Set(p.privs))}
                                style={{ fontSize: 11, padding: "2px 9px", borderRadius: 999, border: `1px solid ${C.borderLight}`, background: "transparent", color: C.text2, cursor: "pointer", fontFamily: "inherit" }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.text2; }}
                              >
                                {p.label}
                              </button>
                            ))}
                          </span>
                        ) : undefined}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))", gap: 9 }}>
                        {allowedPrivs.map((p) => {
                          const on = privileges.has(p);
                          return (
                            <label
                              key={p}
                              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: on ? C.text1 : C.text2, cursor: "pointer", padding: "8px 10px", border: `1px solid ${on ? C.accent : C.border}`, borderRadius: 6, background: on ? "#3b82f622" : C.bg }}
                            >
                              <input
                                type="checkbox"
                                data-testid={`mp-priv-${p.replace(/ /g, "_")}`}
                                checked={on}
                                onChange={() => setPrivileges((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(p)) next.delete(p); else next.add(p);
                                  return next;
                                })}
                                style={{ accentColor: C.accent, cursor: "pointer" }}
                              />
                              {p}
                              {alreadyGranted.has(p) && (
                                <span data-testid="mp-already-granted" style={{ marginLeft: "auto", fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4, background: "#16a34a33", color: "#86efac" }}>
                                  GRANTED
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {action === "GRANT" && (
                      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.text2, cursor: "pointer" }}>
                        <input type="checkbox" data-testid="mp-wgo" checked={withGrantOption} onChange={(e) => setWithGrantOption(e.target.checked)} style={{ accentColor: C.accent, cursor: "pointer" }} />
                        WITH GRANT OPTION
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* right: live SQL preview + results rail */}
          <div style={{ width: 312, flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: "#161f33", overflowY: "auto", padding: "16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={kStyle}>SQL preview</span>
                {dangerous && grantType === "PRIVILEGE" && action === "GRANT" && (
                  <span data-testid="mp-danger-badge" style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.4px", padding: "2px 6px", borderRadius: 4, background: "#dc262633", color: "#fca5a5" }}>
                    HIGH IMPACT
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button
                  onClick={copySql}
                  disabled={!previewSql.length}
                  title="Copy SQL"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "3px 9px", borderRadius: 5, border: `1px solid ${C.borderLight}`, background: "transparent", color: previewSql.length ? C.text2 : C.text3, cursor: previewSql.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}
                >
                  <CopyIcon /> Copy
                </button>
              </div>
              <div
                data-testid="mp-preview-sql"
                style={{ margin: 0, padding: "11px 13px", background: "#0b1120", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: C.text1, whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 44 }}
              >
                {previewError ? (
                  <span style={{ color: "#fca5a5" }}>{previewError}</span>
                ) : previewSql.length ? (
                  previewSql.map((l, i) => (
                    <div key={i}>{renderSqlLine(l)}<span style={{ color: C.text3 }}>;</span></div>
                  ))
                ) : (
                  <span style={{ color: C.text3 }}>— complete the form to preview —</span>
                )}
              </div>
              {previewWarnings.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {previewWarnings.map((w, i) => (<WarnLine key={i}>{w}</WarnLine>))}
                </div>
              )}
            </div>

            {/* Session results log */}
            {results.length > 0 && (
              <div>
                <div style={{ ...kStyle, marginBottom: 10 }}>Results</div>
                <div data-testid="mp-results" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {results.map((r, i) => (
                    <div key={i} style={{ fontSize: 12, color: r.ok ? "#86efac" : "#fca5a5", display: "flex", gap: 6, alignItems: "flex-start" }}>
                      <span style={{ flexShrink: 0 }}>{r.ok ? "✓" : "✗"}</span>
                      <span style={{ color: C.text2 }}>
                        {r.label}
                        {r.audit === "failed" && <span style={{ color: "#fde68a" }}> (audit failed)</span>}
                        {r.error && <span> — {r.error}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── sticky footer (confirm / execute) ── */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: "#1b2438", padding: confirming ? 14 : "13px 20px" }}>
          {confirming ? (
            <div>
              <div style={{ fontSize: 13, color: C.text1, marginBottom: 8 }}>
                Execute the SQL above against the cluster? StarRocks may still deny the operation based on your actual privileges.
              </div>
              {selfRevoke && (
                <div data-testid="mp-self-revoke-warning" style={{ marginBottom: 8 }}>
                  <WarnLine color="#fca5a5">
                    You are revoking from <strong>yourself</strong>. Removing your own user_admin role will lock you out of this feature.
                  </WarnLine>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setConfirming(false)} disabled={executing} style={{ padding: "7px 16px", background: "transparent", border: `1px solid ${C.borderLight}`, borderRadius: 6, color: C.text2, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Back</button>
                <button
                  data-testid="mp-confirm"
                  onClick={handleExecute}
                  disabled={executing}
                  style={{ padding: "7px 16px", background: modeColor, border: "none", borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 500, cursor: executing ? "wait" : "pointer", fontFamily: "inherit" }}
                >
                  {executing ? "Executing…" : `Confirm & ${action === "REVOKE" ? "Revoke" : "Grant"}`}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.text2, marginRight: "auto", cursor: "pointer" }}>
                <input type="checkbox" data-testid="mp-keep-open" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} style={{ accentColor: C.accent, cursor: "pointer" }} />
                Keep open after execute
              </label>
              <button data-testid="mp-cancel" onClick={closeWizard} style={{ padding: "8px 18px", background: "transparent", border: `1px solid ${C.borderLight}`, borderRadius: 6, color: C.text2, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button
                data-testid="mp-execute"
                onClick={() => setConfirming(true)}
                disabled={!canExecute}
                style={{
                  padding: "8px 18px", borderRadius: 6, fontSize: 13, fontWeight: 500, fontFamily: "inherit",
                  background: canExecute ? modeColor : C.borderLight, color: canExecute ? "#fff" : C.text3,
                  border: "none", cursor: canExecute ? "pointer" : "not-allowed",
                }}
              >
                {multiMode ? `Revoke ${multiRequests.length} selected` : "Execute"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { useGrantStore } from "../../stores/grantStore";
import { C } from "../../utils/colors";
import { BUILTIN_ROLES } from "../../utils/constants";
import ComboInput from "../common/ComboInput";
import InlineIcon from "../common/InlineIcon";
import { GearIcon, Seg, SegGroup, SectionH, WarnLine } from "./primitives";
import { fieldLabel } from "./styles";
import { useGrantForm } from "./useGrantForm";
import { useGrantDataSources } from "./useGrantDataSources";
import { useGranteeGrants } from "./useGranteeGrants";
import { useGrantPreview } from "./useGrantPreview";
import { useGrantExecutor } from "./useGrantExecutor";
import CurrentGrantsList from "./CurrentGrantsList";
import ObjectSelector from "./ObjectSelector";
import PrivilegeGrid from "./PrivilegeGrid";
import SqlPreviewRail from "./SqlPreviewRail";
import ModalFooter from "./ModalFooter";
import type { PrivilegeGrant } from "../../types";

const RED = "#ef4444"; // REVOKE mode accent

export default function ManagePrivilegesModal() {
  const wizardOpen = useGrantStore((s) => s.wizardOpen);
  const openId = useGrantStore((s) => s.openId);
  if (!wizardOpen) return null;
  // remount per open — state initializers pick up the prefill, no reset effect needed
  return <WizardBody key={openId} />;
}

function WizardBody() {
  const closeWizard = useGrantStore((s) => s.closeWizard);

  const {
    action, setAction,
    grantType, setGrantType,
    granteeName, setGranteeName,
    granteeType, setGranteeType,
    objectType, setObjectType,
    catalog, setCatalog,
    database, setDatabase,
    objName, setObjName,
    privileges, setPrivileges,
    withGrantOption, setWithGrantOption,
    role, setRole,
    keepOpen, setKeepOpen,
    needsDb, needsName,
    buildRequest,
    selfRevoke, dangerous,
  } = useGrantForm();

  const { spec, catalogs, databases, objects, allRoles, granteeSuggestions } = useGrantDataSources({ catalog, database, granteeName });

  const { granteeGrants, directGrants, scopeGrants, inheritedGrants, alreadyGranted, refetch } = useGranteeGrants({
    granteeName, granteeType, objectType, catalog, database, objName,
  });

  const { previewSql, previewWarnings, previewError, copySql } = useGrantPreview(buildRequest);

  const onKeepOpenReset = () => {
    setPrivileges(new Set());
    setWithGrantOption(false);
    refetch();
  };
  const { confirming, setConfirming, executing, results, handleExecute } = useGrantExecutor({
    buildRequest, action, keepOpen, onKeepOpenReset,
  });

  // Esc closes the modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !executing) closeWizard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [executing, closeWizard]);

  const builtinGrantee = granteeType === "ROLE" && BUILTIN_ROLES.has(granteeName.trim().toLowerCase());
  const modeColor = action === "REVOKE" ? RED : C.accent;
  const canExecute = previewSql.length > 0;

  // click a current grant → load its object + privilege into the form (revoke)
  const loadGrantIntoForm = (g: PrivilegeGrant) => {
    setObjectType(g.object_type);
    setCatalog(g.object_catalog ?? "default_catalog");
    setDatabase(g.object_database ?? "");
    setObjName(g.object_name ?? "");
    setPrivileges(new Set([g.privilege_type]));
  };

  const jumpToSourceRole = (sourceRole: string) => {
    setGranteeType("ROLE");
    setGranteeName(sourceRole);
  };

  const onChangeObjectType = (v: string) => { setObjectType(v); setPrivileges(new Set()); };

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
            aria-label="Close"
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

                {/* Revoke helper: click a current grant to load it into the form below */}
                {action === "REVOKE" && granteeGrants !== null && (
                  <CurrentGrantsList
                    directGrants={directGrants}
                    scopeGrants={scopeGrants}
                    inheritedGrants={inheritedGrants}
                    onLoad={loadGrantIntoForm}
                    onJump={jumpToSourceRole}
                  />
                )}

                <ObjectSelector
                  objectType={objectType}
                  onChangeObjectType={onChangeObjectType}
                  catalog={catalog}
                  setCatalog={setCatalog}
                  database={database}
                  setDatabase={setDatabase}
                  objName={objName}
                  setObjName={setObjName}
                  needsDb={needsDb}
                  needsName={needsName}
                  spec={spec}
                  catalogs={catalogs}
                  databases={databases}
                  objects={objects}
                />

                <PrivilegeGrid
                  spec={spec}
                  objectType={objectType}
                  privileges={privileges}
                  setPrivileges={setPrivileges}
                  alreadyGranted={alreadyGranted}
                  action={action}
                  modeColor={modeColor}
                  granteeName={granteeName}
                  withGrantOption={withGrantOption}
                  setWithGrantOption={setWithGrantOption}
                />
              </>
            )}
          </div>

          {/* right: live SQL preview + results rail */}
          <SqlPreviewRail
            previewSql={previewSql}
            previewWarnings={previewWarnings}
            previewError={previewError}
            dangerous={dangerous}
            grantType={grantType}
            action={action}
            copySql={copySql}
            results={results}
          />
        </div>

        {/* ── sticky footer (confirm / execute) ── */}
        <ModalFooter
          confirming={confirming}
          setConfirming={setConfirming}
          executing={executing}
          selfRevoke={selfRevoke}
          action={action}
          modeColor={modeColor}
          handleExecute={handleExecute}
          canExecute={canExecute}
          keepOpen={keepOpen}
          setKeepOpen={setKeepOpen}
          closeWizard={closeWizard}
        />
      </div>
    </div>
  );
}

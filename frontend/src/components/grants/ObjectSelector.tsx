/** Target-object picker: object type + catalog + (conditional) database + object/function name. */
import { OBJECT_TYPE_ORDER } from "../../utils/grantHelpers";
import { SCOPE_ICONS } from "../../utils/scopeConfig";
import ComboInput from "../common/ComboInput";
import InlineIcon from "../common/InlineIcon";
import { SectionH } from "./primitives";
import { fieldLabel } from "./styles";
import type { GrantSpec } from "../../types";

// object_type → InlineIcon key (grantable subset of the canonical SCOPE_ICONS)
const OBJ_ICON: Record<string, string> = Object.fromEntries(OBJECT_TYPE_ORDER.map((t) => [t, SCOPE_ICONS[t]]));

export default function ObjectSelector({
  objectType,
  onChangeObjectType,
  catalog,
  setCatalog,
  database,
  setDatabase,
  objName,
  setObjName,
  needsDb,
  needsName,
  spec,
  catalogs,
  databases,
  objects,
}: {
  objectType: string;
  onChangeObjectType: (v: string) => void;
  catalog: string;
  setCatalog: (v: string) => void;
  database: string;
  setDatabase: (v: string) => void;
  objName: string;
  setObjName: (v: string) => void;
  needsDb: boolean;
  needsName: boolean;
  spec: GrantSpec | null;
  catalogs: string[];
  databases: string[];
  objects: { name: string; object_type: string }[];
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <SectionH title="Target object" icon={<InlineIcon type={OBJ_ICON[objectType] ?? "table"} size={13} />} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ width: 160 }}>
          <label style={fieldLabel}>Object type</label>
          <ComboInput
            testId="mp-object-type"
            selectOnly
            value={objectType}
            onChange={onChangeObjectType}
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
  );
}

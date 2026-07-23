import { useMemo } from "react";
import { type MyPermissionsResponse, getDatabases, getTableDetail, getTables } from "../../../api/user";
import InlineIcon from "../../common/InlineIcon";
import { C, formatBytes, type SelectedItem } from "../../../utils/inventory-helpers";
import { SectionLabel, Loader, TH, TD, MetaItem } from "../inventory-ui";
import { useAsyncData } from "../../../hooks/useAsyncData";

/* ── Object Details ── */
export function ObjectDetailsPane({ catalog, database, name }: { catalog: string; database: string; name: string }) {
  const { data: d, loading } = useAsyncData(
    () => getTableDetail(catalog, database, name),
    [catalog, database, name],
    { keepPreviousData: true },
  );

  if (loading && d == null) return <Loader />;
  if (!d) return <div style={{ padding: 16, color: C.text3, fontSize: 12 }}>Unable to load details</div>;

  const distInfo = d.distribution_type
    ? `${d.distribution_type}(${(d.bucket_keys || []).join(", ")}) × ${d.bucket_count ?? "?"} buckets`
    : null;
  const partInfo = d.partition_method
    ? `${d.partition_method}(${d.partition_key || "?"}) — ${d.partition_count ?? "?"} partitions`
    : null;

  return (
    <div>
      {/* General Info */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>General</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", marginTop: 8, fontSize: 12 }}>
          {d.table_type && <MetaItem label="Type" value={d.table_type} />}
          {d.engine && <MetaItem label="Engine" value={d.engine} />}
          {d.key_type && <MetaItem label="Key Type" value={d.key_type} />}
          {d.comment && <MetaItem label="Comment" value={d.comment} />}
        </div>
      </div>

      {/* Statistics */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>Statistics</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", marginTop: 8, fontSize: 12 }}>
          {d.row_count != null && <MetaItem label="Row Count" value={d.row_count.toLocaleString()} />}
          {d.data_size != null && <MetaItem label="Data Size" value={formatBytes(d.data_size)} />}
          {d.create_time && <MetaItem label="Created" value={d.create_time} />}
          {d.update_time && <MetaItem label="Last Updated" value={d.update_time} />}
        </div>
      </div>

      {/* Storage (StarRocks internal only) */}
      {(distInfo || partInfo || d.replication_num != null || d.compression) && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Storage</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", marginTop: 8, fontSize: 12 }}>
            {distInfo && <MetaItem label="Distribution" value={distInfo} />}
            {partInfo && <MetaItem label="Partition" value={partInfo} />}
            {d.replication_num != null && <MetaItem label="Replicas" value={String(d.replication_num)} />}
            {d.storage_medium && <MetaItem label="Medium" value={d.storage_medium} />}
            {d.compression && <MetaItem label="Compression" value={d.compression} />}
          </div>
        </div>
      )}

      {/* Columns */}
      <div style={{ marginBottom: 20 }}>
        <SectionLabel>Columns ({d.columns.length})</SectionLabel>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 8 }}>
          <thead>
            <tr><TH>Name</TH><TH>Type</TH><TH>Key</TH><TH>Nullable</TH><TH>Default</TH></tr>
          </thead>
          <tbody>
            {d.columns.map((col) => (
              <tr key={col.name} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <TD><span style={{ color: C.text1, fontWeight: 500 }}>{col.name}</span></TD>
                <TD><span style={{ color: C.text1 }}>{col.column_type}</span></TD>
                <TD><span style={{ color: col.column_key ? C.accent : C.text3, fontWeight: 700 }}>{col.column_key || "-"}</span></TD>
                <TD><span style={{ color: col.is_nullable === "YES" ? C.text1 : "#f59e0b" }}>{col.is_nullable}</span></TD>
                <TD><span style={{ color: C.text2 }}>{col.column_default ?? "-"}</span></TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DDL */}
      {d.ddl && (
        <div>
          <SectionLabel>DDL</SectionLabel>
          <pre style={{ marginTop: 8, padding: 12, background: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11, color: C.text2, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 240, overflowY: "auto", lineHeight: 1.5 }}>
            {d.ddl}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Function Details ── */
export function FunctionDetailsPane({ item, myData }: { item: SelectedItem; myData: MyPermissionsResponse | null }) {
  const fn = useMemo(() => {
    if (!myData) return null;
    return myData.accessible_objects.find((o) => o.name === item.name && o.type === "FUNCTION" && o.database === item.database) || null;
  }, [myData, item.name, item.database]);

  if (!fn) return <div style={{ padding: 16, color: C.text3, fontSize: 12 }}>No detail available</div>;

  return (
    <div>
      <SectionLabel>Function Info</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "10px 10px", fontSize: 12, marginTop: 8 }}>
        <MetaItem label="Name" value={fn.name} />
        <MetaItem label="Database" value={fn.database} />
        {fn.signature && <MetaItem label="Signature" value={fn.signature} />}
        {fn.return_type && <MetaItem label="Return Type" value={fn.return_type} />}
        {fn.function_type && <MetaItem label="Function Type" value={fn.function_type} />}
        {fn.properties && <MetaItem label="Properties" value={fn.properties} />}
      </div>
    </div>
  );
}

/* ── Database Objects ── */
export function DatabaseObjectsPane({ catalog, database }: { catalog: string; database: string }) {
  const { data, loading } = useAsyncData(() => getTables(catalog, database), [catalog, database], { keepPreviousData: true });
  const objects = data ?? [];

  if (loading && data == null) return <Loader />;
  if (objects.length === 0) return <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No objects found</div>;

  return (
    <div>
      <SectionLabel>Objects ({objects.length})</SectionLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 8 }}>
        <thead>
          <tr><TH>Name</TH><TH>Type</TH></tr>
        </thead>
        <tbody>
          {objects.map((obj) => (
            <tr key={obj.name} style={{ borderBottom: `1px solid ${C.border}22` }}>
              <TD><span style={{ fontWeight: 500, color: C.text1 }}>{obj.name}</span></TD>
              <TD><span style={{ color: C.text2, fontSize: 10 }}>{obj.object_type}</span></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Catalog Databases ── */
export function CatalogDatabasesPane({ catalog }: { catalog: string }) {
  const { data, loading } = useAsyncData(() => getDatabases(catalog), [catalog], { keepPreviousData: true });
  const dbs = data ?? [];

  if (loading && data == null) return <Loader />;
  if (dbs.length === 0) return <div style={{ padding: 16, color: C.text3, fontSize: 12, textAlign: "center" }}>No databases found</div>;

  return (
    <div>
      <SectionLabel>Databases ({dbs.length})</SectionLabel>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 8 }}>
        <thead><tr><TH>Database</TH></tr></thead>
        <tbody>
          {dbs.map((db) => (
            <tr key={db.name} style={{ borderBottom: `1px solid ${C.border}22` }}>
              <TD><div style={{ display: "flex", alignItems: "center", gap: 6 }}><InlineIcon type="database" size={14} /><span style={{ fontWeight: 500, color: C.text1 }}>{db.name}</span></div></TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lightweight SQL keyword highlighting for the wizard's live preview (display only — preserves textContent). */

const SQL_KW = new Set([
  "WITH GRANT OPTION", "MATERIALIZED VIEW", "CREATE DATABASE", "CREATE TABLE", "SET CATALOG",
  "GRANT", "REVOKE", "ON", "TO", "FROM", "ALL", "ROLE", "TABLE", "DATABASE", "CATALOG", "VIEW",
  "FUNCTION", "SYSTEM", "USER", "GLOBAL", "USAGE", "SELECT", "INSERT", "UPDATE", "DELETE", "ALTER",
  "DROP", "EXPORT", "REFRESH", "CREATE",
]);
const SQL_SPLIT = /(`[^`]*`|'[^']*'|\bWITH GRANT OPTION\b|\bMATERIALIZED VIEW\b|\bCREATE DATABASE\b|\bCREATE TABLE\b|\bSET CATALOG\b|\b[A-Z_]+\b)/gi;

export function renderSqlLine(line: string): React.ReactNode[] {
  return line.split(SQL_SPLIT).map((seg, i) => {
    if (!seg) return null;
    if (/^[`'].*[`']$/.test(seg)) return <span key={i} style={{ color: "#fcd34d" }}>{seg}</span>; // identifier/literal
    if (SQL_KW.has(seg.toUpperCase())) return <span key={i} style={{ color: "#7dd3fc", fontWeight: 600 }}>{seg}</span>;
    return <span key={i}>{seg}</span>;
  });
}

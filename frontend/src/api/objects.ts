import { apiFetch } from "./client";
import type { CatalogItem, DatabaseItem, ObjectItem, TableDetail } from "../types";

export const getCatalogs = () =>
  apiFetch<CatalogItem[]>("/objects/catalogs");

export const getDatabases = (catalog: string) =>
  apiFetch<DatabaseItem[]>(`/objects/databases?catalog=${encodeURIComponent(catalog)}`);

export const getTables = (catalog: string, database: string) =>
  apiFetch<ObjectItem[]>(
    `/objects/tables?catalog=${encodeURIComponent(catalog)}&database=${encodeURIComponent(database)}`
  );

export const getTableDetail = (catalog: string, database: string, table: string) =>
  apiFetch<TableDetail>(
    `/objects/table-detail?catalog=${encodeURIComponent(catalog)}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
  );

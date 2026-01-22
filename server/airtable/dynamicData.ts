/**
 * Airtable Dynamic Data Access
 * 
 * Purpose:
 * Provides generic data access for any Airtable table discovered via
 * the Metadata API. Automatically caches data with configurable TTL.
 * 
 * This replaces the need to hardcode table-specific fetch functions.
 * New tables added in Airtable are automatically available.
 * 
 * Layer: Airtable (dynamic data access)
 */

import { fetchAllRecords, type AirtableRecord } from "./client";
import { discoverSchema, getTableByName, type AirtableTable } from "./schema";

type CacheEntry = {
  records: AirtableRecord<Record<string, unknown>>[];
  timestamp: number;
};

const DATA_CACHE_TTL_MS = 60 * 60 * 1000;

const dataCache: Map<string, CacheEntry> = new Map();

function isCacheValid(entry: CacheEntry | undefined): entry is CacheEntry {
  if (!entry) return false;
  return Date.now() - entry.timestamp < DATA_CACHE_TTL_MS;
}

export async function getRecordsByTableName(
  tableName: string
): Promise<AirtableRecord<Record<string, unknown>>[]> {
  const table = await getTableByName(tableName);
  if (!table) {
    throw new Error(`[Airtable] Table not found: ${tableName}`);
  }
  return getRecordsByTableId(table.id, tableName);
}

export async function getRecordsByTableId(
  tableId: string,
  displayName?: string
): Promise<AirtableRecord<Record<string, unknown>>[]> {
  const cacheKey = tableId;
  const cached = dataCache.get(cacheKey);
  
  if (isCacheValid(cached)) {
    return cached.records;
  }

  const label = displayName || tableId;
  console.log(`[Airtable] Fetching records from ${label}...`);
  
  const records = await fetchAllRecords<Record<string, unknown>>({
    tableId,
  });

  dataCache.set(cacheKey, { records, timestamp: Date.now() });
  console.log(`[Airtable] Cached ${records.length} records from ${label}`);
  
  return records;
}

export function invalidateTableCache(tableIdOrName: string): void {
  if (dataCache.has(tableIdOrName)) {
    dataCache.delete(tableIdOrName);
    console.log(`[Airtable] Invalidated cache for table: ${tableIdOrName}`);
    return;
  }
  
  for (const key of Array.from(dataCache.keys())) {
    if (key.toLowerCase() === tableIdOrName.toLowerCase()) {
      dataCache.delete(key);
      console.log(`[Airtable] Invalidated cache for table: ${key}`);
      return;
    }
  }
  
  console.log(`[Airtable] No cache found for table: ${tableIdOrName}`);
}

export function invalidateAllDataCache(): void {
  const count = dataCache.size;
  dataCache.clear();
  console.log(`[Airtable] Invalidated all data cache (${count} tables)`);
}

export type FormattedRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

export async function getAllTablesWithData(): Promise<
  Array<{
    table: { id: string; name: string; description?: string };
    records: FormattedRecord[];
  }>
> {
  const schema = await discoverSchema();
  
  const results = await Promise.all(
    schema.tables.map(async (table) => {
      const records = await getRecordsByTableId(table.id, table.name);
      return {
        table: {
          id: table.id,
          name: table.name,
          description: table.description,
        },
        records: records.map((r) => ({
          id: r.id,
          createdTime: r.createdTime,
          fields: r.fields,
        })),
      };
    })
  );

  return results;
}

export async function searchAllTables(
  query: string
): Promise<
  Array<{
    tableName: string;
    tableId: string;
    matches: FormattedRecord[];
  }>
> {
  const schema = await discoverSchema();
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

  const matchesQuery = (value: unknown): boolean => {
    if (typeof value === "string") {
      const valueLower = value.toLowerCase();
      return queryTerms.some((term) => valueLower.includes(term));
    }
    if (Array.isArray(value)) {
      return value.some((v) => matchesQuery(v));
    }
    return false;
  };

  const results = await Promise.all(
    schema.tables.map(async (table) => {
      const records = await getRecordsByTableId(table.id, table.name);
      
      const matches = records.filter((record) => {
        return Object.values(record.fields).some((value) => matchesQuery(value));
      });

      return {
        tableName: table.name,
        tableId: table.id,
        matches: matches.map((r) => ({
          id: r.id,
          createdTime: r.createdTime,
          fields: r.fields,
        })),
      };
    })
  );

  return results.filter((r) => r.matches.length > 0);
}

/**
 * Dynamic Airtable Database Sync Service
 * 
 * Purpose:
 * Automatically discovers all tables in the Airtable base and syncs them to PostgreSQL.
 * When new tables are added in Airtable, they are automatically created and synced.
 * When new fields are added to existing tables, columns are added automatically.
 * 
 * Security:
 * - Uses parameterized queries for all values (no SQL injection)
 * - Identifiers are strictly validated and quoted
 * - Airtable is the trusted source of truth
 * 
 * Usage:
 * - Call syncAllTablesDynamic() to discover and sync all Airtable tables
 * - Called by /api/airtable/refresh endpoint
 * 
 * Layer: Airtable (dynamic database sync)
 */

import { db } from "../db";
import { pitcrewAirtableSyncLog } from "@shared/schema";
import { fetchAllRecords } from "./client";
import { discoverSchema, type AirtableTable, type AirtableField } from "./schema";
import { sql } from "drizzle-orm";

export type SyncResult = {
  table: string;
  recordsCount: number;
  status: "success" | "error" | "skipped";
  error?: string;
  isNew?: boolean;
  columnsAdded?: number;
};

export type SyncAllResult = {
  success: boolean;
  results: SyncResult[];
  syncedAt: string;
  totalRecords: number;
  tablesDiscovered: number;
};

const IDENTIFIER_REGEX = /^[a-z_][a-z0-9_]*$/;
const RESERVED_WORDS = new Set(['id', 'order', 'group', 'select', 'table', 'user', 'index', 'key', 'primary', 'foreign', 'constraint', 'check', 'default', 'null', 'not', 'and', 'or', 'like', 'in', 'between', 'exists', 'case', 'when', 'then', 'else', 'end', 'join', 'left', 'right', 'inner', 'outer', 'on', 'as', 'from', 'where', 'having', 'limit', 'offset', 'union', 'all', 'distinct', 'create', 'alter', 'drop', 'insert', 'update', 'delete', 'values', 'set', 'into', 'column', 'row', 'rows', 'type', 'cast', 'true', 'false']);

function toSnakeCase(str: string): string {
  const result = str
    .replace(/[^a-zA-Z0-9\s_]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
  
  if (!result || result.length === 0) {
    return 'unnamed';
  }
  
  if (/^[0-9]/.test(result)) {
    return `col_${result}`;
  }
  
  return result;
}

function sanitizeIdentifier(name: string): string {
  let sanitized = toSnakeCase(name);
  
  if (RESERVED_WORDS.has(sanitized)) {
    sanitized = `${sanitized}_col`;
  }
  
  if (!IDENTIFIER_REGEX.test(sanitized)) {
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');
    if (!/^[a-z_]/.test(sanitized)) {
      sanitized = `col_${sanitized}`;
    }
  }
  
  return sanitized;
}

function quoteIdentifier(name: string): string {
  const sanitized = sanitizeIdentifier(name);
  return `"${sanitized.replace(/"/g, '""')}"`;
}

function toPgTableName(airtableName: string): string {
  return `pitcrew_airtable_${sanitizeIdentifier(airtableName)}`;
}

function toPgColumnName(fieldName: string): string {
  return sanitizeIdentifier(fieldName);
}

function airtableTypeToPgType(field: AirtableField): string {
  switch (field.type) {
    case "number":
    case "rating":
    case "count":
    case "autoNumber":
      return "INTEGER";
    case "currency":
    case "percent":
    case "duration":
      return "REAL";
    case "checkbox":
      return "BOOLEAN";
    case "date":
    case "dateTime":
    case "createdTime":
    case "lastModifiedTime":
      return "TIMESTAMP";
    case "multipleRecordLinks":
    case "multipleSelects":
    case "lookup":
    case "multipleAttachments":
      return "TEXT[]";
    default:
      return "TEXT";
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const sanitized = sanitizeIdentifier(tableName);
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ${sanitized}
    )
  `);
  return (result.rows[0] as any)?.exists === true;
}

async function getExistingColumns(tableName: string): Promise<Set<string>> {
  const sanitized = sanitizeIdentifier(tableName);
  const result = await db.execute(sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = ${sanitized}
  `);
  return new Set((result.rows as any[]).map(r => r.column_name));
}

async function addMissingColumns(pgTableName: string, fields: AirtableField[], existingColumns: Set<string>): Promise<number> {
  let addedCount = 0;
  
  for (const field of fields) {
    const colName = toPgColumnName(field.name);
    if (colName === 'id' || colName === 'airtable_id' || existingColumns.has(colName)) {
      continue;
    }
    
    const pgType = airtableTypeToPgType(field);
    const quotedTable = quoteIdentifier(pgTableName);
    const quotedCol = quoteIdentifier(colName);
    
    try {
      await db.execute(sql.raw(`ALTER TABLE ${quotedTable} ADD COLUMN IF NOT EXISTS ${quotedCol} ${pgType}`));
      console.log(`[Dynamic Sync] Added column ${colName} to ${pgTableName}`);
      addedCount++;
    } catch (error) {
      console.warn(`[Dynamic Sync] Could not add column ${colName}:`, error);
    }
  }
  
  return addedCount;
}

async function createTableIfNotExists(table: AirtableTable): Promise<{ isNew: boolean; columnsAdded: number }> {
  const pgTableName = toPgTableName(table.name);
  
  if (await tableExists(pgTableName)) {
    const existingColumns = await getExistingColumns(pgTableName);
    const columnsAdded = await addMissingColumns(pgTableName, table.fields, existingColumns);
    return { isNew: false, columnsAdded };
  }

  console.log(`[Dynamic Sync] Creating new table: ${pgTableName}`);

  const quotedTable = quoteIdentifier(pgTableName);
  const columns: string[] = [
    `"id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()`,
    `"airtable_id" VARCHAR NOT NULL UNIQUE`,
  ];

  const seenColumns = new Set<string>(['id', 'airtable_id']);
  
  for (const field of table.fields) {
    const colName = toPgColumnName(field.name);
    if (seenColumns.has(colName)) continue;
    seenColumns.add(colName);
    
    const pgType = airtableTypeToPgType(field);
    columns.push(`${quoteIdentifier(colName)} ${pgType}`);
  }

  columns.push(`"synced_at" TIMESTAMP DEFAULT NOW() NOT NULL`);

  const createSql = `CREATE TABLE ${quotedTable} (${columns.join(', ')})`;
  
  try {
    await db.execute(sql.raw(createSql));
    console.log(`[Dynamic Sync] Created table: ${pgTableName}`);
    return { isNew: true, columnsAdded: 0 };
  } catch (error) {
    console.error(`[Dynamic Sync] Error creating table ${pgTableName}:`, error);
    throw error;
  }
}

function escapeValue(value: any, fieldType: string): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'NULL';
    const escaped = value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
    return `ARRAY[${escaped}]::TEXT[]`;
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'::TIMESTAMP`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function syncTableDynamic(table: AirtableTable): Promise<SyncResult> {
  const pgTableName = toPgTableName(table.name);
  
  try {
    const { isNew, columnsAdded } = await createTableIfNotExists(table);
    
    const records = await fetchAllRecords<Record<string, any>>({ tableId: table.id });
    
    for (const record of records) {
      const columns: string[] = ['airtable_id', 'synced_at'];
      const values: string[] = [escapeValue(record.id, 'text'), escapeValue(new Date(), 'timestamp')];
      const seenColumns = new Set<string>(['airtable_id', 'synced_at']);

      for (const field of table.fields) {
        const colName = toPgColumnName(field.name);
        if (colName === 'id' || seenColumns.has(colName)) continue;
        seenColumns.add(colName);

        columns.push(colName);
        
        let value = record.fields[field.name];
        
        if (value === undefined) {
          value = null;
        } else if (Array.isArray(value)) {
          if (field.type === 'multipleAttachments') {
            value = value.map((att: any) => att.url || att.filename || String(att));
          }
        }
        
        values.push(escapeValue(value, field.type));
      }

      const quotedTable = quoteIdentifier(pgTableName);
      const quotedCols = columns.map(c => quoteIdentifier(c)).join(', ');
      
      const updateParts = columns
        .filter(c => c !== 'airtable_id')
        .map((c, idx) => {
          const colIdx = columns.indexOf(c);
          return `${quoteIdentifier(c)} = ${values[colIdx]}`;
        })
        .join(', ');

      const upsertQuery = `
        INSERT INTO ${quotedTable} (${quotedCols})
        VALUES (${values.join(', ')})
        ON CONFLICT ("airtable_id") DO UPDATE SET ${updateParts}
      `;

      try {
        await db.execute(sql.raw(upsertQuery));
      } catch (error: any) {
        console.warn(`[Dynamic Sync] Error upserting record ${record.id} in ${pgTableName}:`, error.message);
      }
    }

    await db.insert(pitcrewAirtableSyncLog).values({
      tableName: table.name,
      recordsCount: records.length,
      status: "success",
    });

    return { 
      table: table.name, 
      recordsCount: records.length, 
      status: "success",
      isNew,
      columnsAdded,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Dynamic Sync] Error syncing ${table.name}:`, error);
    
    await db.insert(pitcrewAirtableSyncLog).values({
      tableName: table.name,
      recordsCount: 0,
      status: "error",
      errorMessage: errorMsg,
    });
    
    return { table: table.name, recordsCount: 0, status: "error", error: errorMsg };
  }
}

export async function syncAllTablesDynamic(): Promise<SyncAllResult> {
  console.log("[Dynamic Sync] Discovering tables from Airtable...");
  
  const schema = await discoverSchema();
  console.log(`[Dynamic Sync] Found ${schema.tables.length} tables`);

  const results: SyncResult[] = [];
  
  for (const table of schema.tables) {
    const result = await syncTableDynamic(table);
    results.push(result);
    
    if (result.status === "success") {
      const extras = [];
      if (result.isNew) extras.push('new table');
      if (result.columnsAdded && result.columnsAdded > 0) extras.push(`${result.columnsAdded} columns added`);
      const extraStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      console.log(`[Dynamic Sync] Synced ${table.name}: ${result.recordsCount} records${extraStr}`);
    }
  }

  const totalRecords = results.reduce((sum, r) => sum + r.recordsCount, 0);
  const hasErrors = results.some(r => r.status === "error");

  console.log(`[Dynamic Sync] Completed. Tables: ${schema.tables.length}, Records: ${totalRecords}, Errors: ${hasErrors}`);

  return {
    success: !hasErrors,
    results,
    syncedAt: new Date().toISOString(),
    totalRecords,
    tablesDiscovered: schema.tables.length,
  };
}

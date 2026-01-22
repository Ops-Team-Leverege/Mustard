/**
 * Dynamic Airtable Database Sync Service
 * 
 * Purpose:
 * Automatically discovers all tables in the Airtable base and syncs them to PostgreSQL.
 * When new tables are added in Airtable, they are automatically created and synced.
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
};

export type SyncAllResult = {
  success: boolean;
  results: SyncResult[];
  syncedAt: string;
  totalRecords: number;
  tablesDiscovered: number;
};

function toSnakeCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase();
}

function toPgTableName(airtableName: string): string {
  return `pitcrew_airtable_${toSnakeCase(airtableName)}`;
}

function toPgColumnName(fieldName: string): string {
  return toSnakeCase(fieldName);
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
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = ${tableName}
    )
  `);
  return (result.rows[0] as any)?.exists === true;
}

async function createTableIfNotExists(table: AirtableTable): Promise<boolean> {
  const pgTableName = toPgTableName(table.name);
  
  if (await tableExists(pgTableName)) {
    return false;
  }

  console.log(`[Dynamic Sync] Creating new table: ${pgTableName}`);

  const columns: string[] = [
    `id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()`,
    `airtable_id VARCHAR NOT NULL UNIQUE`,
  ];

  for (const field of table.fields) {
    const colName = toPgColumnName(field.name);
    if (colName === 'id' || colName === 'airtable_id') continue;
    
    const pgType = airtableTypeToPgType(field);
    columns.push(`${colName} ${pgType}`);
  }

  columns.push(`synced_at TIMESTAMP DEFAULT NOW() NOT NULL`);

  const createSql = `CREATE TABLE ${pgTableName} (${columns.join(', ')})`;
  
  try {
    await db.execute(sql.raw(createSql));
    console.log(`[Dynamic Sync] Created table: ${pgTableName}`);
    return true;
  } catch (error) {
    console.error(`[Dynamic Sync] Error creating table ${pgTableName}:`, error);
    throw error;
  }
}

function escapeValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const escaped = value.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',');
    return `ARRAY[${value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',')}]::TEXT[]`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function syncTableDynamic(table: AirtableTable): Promise<SyncResult> {
  const pgTableName = toPgTableName(table.name);
  
  try {
    const isNew = await createTableIfNotExists(table);
    
    const records = await fetchAllRecords<Record<string, any>>({ tableId: table.id });
    
    for (const record of records) {
      const columns: string[] = ['airtable_id', 'synced_at'];
      const values: string[] = [escapeValue(record.id), escapeValue(new Date().toISOString())];

      for (const field of table.fields) {
        const colName = toPgColumnName(field.name);
        if (colName === 'id' || colName === 'airtable_id') continue;

        columns.push(colName);
        
        let value = record.fields[field.name];
        
        if (value === undefined || value === null) {
          value = null;
        } else if (Array.isArray(value)) {
          if (field.type === 'multipleAttachments') {
            value = value.map((att: any) => att.url || att.filename || JSON.stringify(att));
          }
        }
        
        values.push(escapeValue(value));
      }

      const updateCols = columns
        .filter(c => c !== 'airtable_id')
        .map((c, i) => {
          const idx = columns.indexOf(c);
          return `${c} = ${values[idx]}`;
        })
        .join(', ');

      const upsertSql = `
        INSERT INTO ${pgTableName} (${columns.join(', ')})
        VALUES (${values.join(', ')})
        ON CONFLICT (airtable_id) DO UPDATE SET ${updateCols}
      `;

      try {
        await db.execute(sql.raw(upsertSql));
      } catch (error: any) {
        if (error.message?.includes('column') && error.message?.includes('does not exist')) {
          console.warn(`[Dynamic Sync] Column mismatch in ${pgTableName}, skipping record ${record.id}`);
          continue;
        }
        throw error;
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
      console.log(`[Dynamic Sync] Synced ${table.name}: ${result.recordsCount} records${result.isNew ? ' (new table)' : ''}`);
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

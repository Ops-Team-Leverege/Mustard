/**
 * Airtable Dynamic Schema Discovery
 * 
 * Purpose:
 * Uses the Airtable Metadata API to automatically discover all tables
 * and their fields. This allows new tables to be added in Airtable
 * without requiring code changes.
 * 
 * Layer: Airtable (schema discovery)
 */

type FieldType = 
  | "singleLineText"
  | "multilineText"
  | "number"
  | "checkbox"
  | "singleSelect"
  | "multipleSelects"
  | "multipleRecordLinks"
  | "date"
  | "dateTime"
  | "rating"
  | "formula"
  | "rollup"
  | "count"
  | "lookup"
  | "currency"
  | "percent"
  | "duration"
  | "phoneNumber"
  | "email"
  | "url"
  | "createdTime"
  | "lastModifiedTime"
  | "createdBy"
  | "lastModifiedBy"
  | "autoNumber"
  | "barcode"
  | "button"
  | "richText"
  | "multipleAttachments";

export type AirtableField = {
  id: string;
  name: string;
  type: FieldType;
  description?: string;
  options?: Record<string, unknown>;
};

export type AirtableTable = {
  id: string;
  name: string;
  description?: string;
  fields: AirtableField[];
  primaryFieldId: string;
};

export type AirtableSchema = {
  tables: AirtableTable[];
  fetchedAt: number;
};

type CacheEntry = {
  schema: AirtableSchema;
  timestamp: number;
};

const SCHEMA_CACHE_TTL_MS = 60 * 60 * 1000;

let schemaCache: CacheEntry | null = null;

function getAirtableConfig() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  
  if (!apiKey) {
    throw new Error("[Airtable] AIRTABLE_API_KEY environment variable is not set");
  }
  if (!baseId) {
    throw new Error("[Airtable] AIRTABLE_BASE_ID environment variable is not set");
  }
  
  return { apiKey, baseId };
}

export async function discoverSchema(): Promise<AirtableSchema> {
  if (schemaCache && Date.now() - schemaCache.timestamp < SCHEMA_CACHE_TTL_MS) {
    return schemaCache.schema;
  }

  console.log("[Airtable Schema] Fetching schema from Metadata API...");
  const { apiKey, baseId } = getAirtableConfig();

  const response = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Airtable Metadata API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  
  const schema: AirtableSchema = {
    tables: data.tables.map((table: any) => ({
      id: table.id,
      name: table.name,
      description: table.description,
      primaryFieldId: table.primaryFieldId,
      fields: table.fields.map((field: any) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        description: field.description,
        options: field.options,
      })),
    })),
    fetchedAt: Date.now(),
  };

  schemaCache = { schema, timestamp: Date.now() };
  console.log(`[Airtable Schema] Discovered ${schema.tables.length} tables`);
  
  return schema;
}

export function invalidateSchemaCache(): void {
  schemaCache = null;
  console.log("[Airtable Schema] Schema cache invalidated");
}

export async function getTableByName(tableName: string): Promise<AirtableTable | null> {
  const schema = await discoverSchema();
  return schema.tables.find(t => t.name.toLowerCase() === tableName.toLowerCase()) ?? null;
}

export async function getTableById(tableId: string): Promise<AirtableTable | null> {
  const schema = await discoverSchema();
  return schema.tables.find(t => t.id === tableId) ?? null;
}

export async function listTables(): Promise<Array<{ id: string; name: string; description?: string }>> {
  const schema = await discoverSchema();
  return schema.tables.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));
}

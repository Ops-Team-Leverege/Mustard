/**
 * Airtable Integration Module
 * 
 * Purpose:
 * Exports for the Airtable integration that provides access to the
 * PitCrew Product Database (source of truth for product knowledge).
 * 
 * Now uses dynamic schema discovery - new tables added in Airtable
 * are automatically available without code changes.
 * 
 * Key Functions:
 * - discoverSchema: Get all tables and their fields
 * - listTables: Get list of all tables
 * - getRecordsByTableName: Fetch records from any table by name
 * - searchAllTables: Search across all tables
 * 
 * Layer: Airtable (module exports)
 */

export {
  discoverSchema,
  invalidateSchemaCache,
  getTableByName,
  getTableById,
  listTables,
  type AirtableSchema,
  type AirtableTable,
  type AirtableField,
} from "./schema";

export {
  getRecordsByTableName,
  getRecordsByTableId,
  invalidateTableCache,
  invalidateAllDataCache,
  getAllTablesWithData,
  searchAllTables,
  type FormattedRecord,
} from "./dynamicData";

export {
  handleAirtableWebhook,
  verifyAirtableWebhook,
} from "./webhook";

export { fetchAllRecords, fetchRecord, type AirtableRecord } from "./client";

export {
  AIRTABLE_TABLES,
  type ValuePropositionFields,
  type FeatureFields,
  type ValueThemeFields,
  type FeatureThemeFields,
  type CustomerSegmentFields,
} from "./types";

export {
  getFeatures,
  getValuePropositions,
  getValueThemes,
  getFeatureThemes,
  getCustomerSegments,
  getProductFeaturesFormatted,
  getProductValuePropositionsFormatted,
  searchProductKnowledge,
  invalidateCache,
  type ProductFeature,
  type ProductValueProposition,
} from "./productData";

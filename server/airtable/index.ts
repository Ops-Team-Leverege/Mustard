/**
 * Airtable Integration Module
 * 
 * Purpose:
 * Exports for the Airtable integration that provides access to the
 * PitCrew Product Database (source of truth for product knowledge).
 * 
 * Key Functions:
 * - getFeatures: Get all product features
 * - getValuePropositions: Get all value propositions
 * - searchProductKnowledge: Search across features and value props
 * - invalidateCache: Clear cache when Airtable updates
 * 
 * Layer: Airtable (module exports)
 */

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

export {
  handleAirtableWebhook,
  verifyAirtableWebhook,
} from "./webhook";

export {
  AIRTABLE_TABLES,
  type ValuePropositionFields,
  type FeatureFields,
  type ValueThemeFields,
  type FeatureThemeFields,
  type CustomerSegmentFields,
} from "./types";

export { fetchAllRecords, fetchRecord } from "./client";

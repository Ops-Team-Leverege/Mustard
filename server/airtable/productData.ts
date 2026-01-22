/**
 * Product Data Service
 * 
 * Purpose:
 * Provides access to PitCrew product data from Airtable.
 * Uses in-memory caching with configurable TTL for performance.
 * 
 * This is the main interface for accessing product knowledge:
 * - Features (WHAT PitCrew does)
 * - Value Propositions (WHY PitCrew matters)
 * - Tier availability (Pro/Advanced/Enterprise)
 * - Customer Segments
 * 
 * Layer: Airtable (data access)
 */

import { fetchAllRecords } from "./client";
import {
  AIRTABLE_TABLES,
  type AirtableRecord,
  type ValuePropositionFields,
  type ValueThemeFields,
  type FeatureFields,
  type FeatureThemeFields,
  type CustomerSegmentFields,
} from "./types";

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

const CACHE_TTL_MS = 60 * 60 * 1000;

const cache: {
  features?: CacheEntry<AirtableRecord<FeatureFields>[]>;
  valuePropositions?: CacheEntry<AirtableRecord<ValuePropositionFields>[]>;
  valueThemes?: CacheEntry<AirtableRecord<ValueThemeFields>[]>;
  featureThemes?: CacheEntry<AirtableRecord<FeatureThemeFields>[]>;
  customerSegments?: CacheEntry<AirtableRecord<CustomerSegmentFields>[]>;
} = {};

function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

export async function getFeatures(): Promise<AirtableRecord<FeatureFields>[]> {
  if (isCacheValid(cache.features)) {
    return cache.features.data;
  }

  console.log("[ProductData] Fetching features from Airtable...");
  const records = await fetchAllRecords<FeatureFields>({
    tableId: AIRTABLE_TABLES.features.tableId,
  });

  cache.features = { data: records, timestamp: Date.now() };
  console.log(`[ProductData] Cached ${records.length} features`);
  return records;
}

export async function getValuePropositions(): Promise<AirtableRecord<ValuePropositionFields>[]> {
  if (isCacheValid(cache.valuePropositions)) {
    return cache.valuePropositions.data;
  }

  console.log("[ProductData] Fetching value propositions from Airtable...");
  const records = await fetchAllRecords<ValuePropositionFields>({
    tableId: AIRTABLE_TABLES.valuePropositions.tableId,
  });

  cache.valuePropositions = { data: records, timestamp: Date.now() };
  console.log(`[ProductData] Cached ${records.length} value propositions`);
  return records;
}

export async function getValueThemes(): Promise<AirtableRecord<ValueThemeFields>[]> {
  if (isCacheValid(cache.valueThemes)) {
    return cache.valueThemes.data;
  }

  console.log("[ProductData] Fetching value themes from Airtable...");
  const records = await fetchAllRecords<ValueThemeFields>({
    tableId: AIRTABLE_TABLES.valueThemes.tableId,
  });

  cache.valueThemes = { data: records, timestamp: Date.now() };
  console.log(`[ProductData] Cached ${records.length} value themes`);
  return records;
}

export async function getFeatureThemes(): Promise<AirtableRecord<FeatureThemeFields>[]> {
  if (isCacheValid(cache.featureThemes)) {
    return cache.featureThemes.data;
  }

  console.log("[ProductData] Fetching feature themes from Airtable...");
  const records = await fetchAllRecords<FeatureThemeFields>({
    tableId: AIRTABLE_TABLES.featureThemes.tableId,
  });

  cache.featureThemes = { data: records, timestamp: Date.now() };
  console.log(`[ProductData] Cached ${records.length} feature themes`);
  return records;
}

export async function getCustomerSegments(): Promise<AirtableRecord<CustomerSegmentFields>[]> {
  if (isCacheValid(cache.customerSegments)) {
    return cache.customerSegments.data;
  }

  console.log("[ProductData] Fetching customer segments from Airtable...");
  const records = await fetchAllRecords<CustomerSegmentFields>({
    tableId: AIRTABLE_TABLES.customerSegments.tableId,
  });

  cache.customerSegments = { data: records, timestamp: Date.now() };
  console.log(`[ProductData] Cached ${records.length} customer segments`);
  return records;
}

export function invalidateCache(table?: keyof typeof cache): void {
  if (table) {
    delete cache[table];
    console.log(`[ProductData] Invalidated cache for ${table}`);
  } else {
    Object.keys(cache).forEach(key => {
      delete cache[key as keyof typeof cache];
    });
    console.log("[ProductData] Invalidated all cache");
  }
}

export type ProductFeature = {
  id: string;
  name: string;
  description: string | null;
  productStatus: string | null;
  proTier: string | null;
  advancedTier: string | null;
  enterpriseTier: string | null;
  type: "Feature" | "Add-On" | null;
  hideFromPricingList: boolean;
};

export type ProductValueProposition = {
  id: string;
  name: string;
  description: string | null;
  valueScore: number | null;
  requiresPosIntegration: boolean;
};

export async function getProductFeaturesFormatted(): Promise<ProductFeature[]> {
  const records = await getFeatures();
  return records.map(r => ({
    id: r.id,
    name: r.fields.Name,
    description: r.fields["Description (Pricing Guide - External Facing)"] ?? null,
    productStatus: r.fields["Product Status"] ?? null,
    proTier: r.fields["Pro Tier"] ?? null,
    advancedTier: r.fields["Advanced Tier"] ?? null,
    enterpriseTier: r.fields["Enterprise Tier"] ?? null,
    type: r.fields.Type ?? null,
    hideFromPricingList: r.fields["Hide from Pricing List"] ?? false,
  }));
}

export async function getProductValuePropositionsFormatted(): Promise<ProductValueProposition[]> {
  const records = await getValuePropositions();
  return records.map(r => ({
    id: r.id,
    name: r.fields.Name,
    description: r.fields.Description ?? null,
    valueScore: r.fields["Value to Customer"] ?? null,
    requiresPosIntegration: r.fields["Requires POS Integration?"] ?? false,
  }));
}

export async function searchProductKnowledge(query: string): Promise<{
  features: ProductFeature[];
  valuePropositions: ProductValueProposition[];
}> {
  const [features, valueProps] = await Promise.all([
    getProductFeaturesFormatted(),
    getProductValuePropositionsFormatted(),
  ]);

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  const matchesQuery = (text: string | null): boolean => {
    if (!text) return false;
    const textLower = text.toLowerCase();
    return queryTerms.some(term => textLower.includes(term));
  };

  const matchedFeatures = features.filter(f => 
    matchesQuery(f.name) || matchesQuery(f.description)
  );

  const matchedValueProps = valueProps.filter(vp =>
    matchesQuery(vp.name) || matchesQuery(vp.description)
  );

  return {
    features: matchedFeatures,
    valuePropositions: matchedValueProps,
  };
}

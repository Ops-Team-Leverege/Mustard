/**
 * Product Data Service
 * 
 * Purpose:
 * Provides access to PitCrew product data from the database.
 * Data is synced from Airtable via /api/airtable/refresh endpoint.
 * 
 * This is the main interface for accessing product knowledge:
 * - Features (WHAT PitCrew does)
 * - Value Propositions (WHY PitCrew matters)
 * - Tier availability (Pro/Advanced/Enterprise)
 * - Customer Segments
 * 
 * Layer: Airtable (data access - reads from database)
 */

import { db } from "../db";
import {
  airtableFeatures,
  airtableValuePropositions,
  airtableValueThemes,
  airtableFeatureThemes,
  airtableCustomerSegments,
  type AirtableFeature,
  type AirtableValueProposition,
  type AirtableValueTheme,
  type AirtableFeatureTheme,
  type AirtableCustomerSegment,
} from "@shared/schema";
import { ilike, or } from "drizzle-orm";

export async function getFeatures(): Promise<AirtableFeature[]> {
  return db.select().from(airtableFeatures);
}

export async function getValuePropositions(): Promise<AirtableValueProposition[]> {
  return db.select().from(airtableValuePropositions);
}

export async function getValueThemes(): Promise<AirtableValueTheme[]> {
  return db.select().from(airtableValueThemes);
}

export async function getFeatureThemes(): Promise<AirtableFeatureTheme[]> {
  return db.select().from(airtableFeatureThemes);
}

export async function getCustomerSegments(): Promise<AirtableCustomerSegment[]> {
  return db.select().from(airtableCustomerSegments);
}

export function invalidateCache(table?: string): void {
  console.log("[ProductData] Cache invalidation is no longer needed - data is stored in database");
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
    id: r.airtableId,
    name: r.name,
    description: r.description ?? null,
    productStatus: r.productStatus ?? null,
    proTier: r.proTier ?? null,
    advancedTier: r.advancedTier ?? null,
    enterpriseTier: r.enterpriseTier ?? null,
    type: (r.type as "Feature" | "Add-On") ?? null,
    hideFromPricingList: r.hideFromPricingList ?? false,
  }));
}

export async function getProductValuePropositionsFormatted(): Promise<ProductValueProposition[]> {
  const records = await getValuePropositions();
  return records.map(r => ({
    id: r.airtableId,
    name: r.name,
    description: r.description ?? null,
    valueScore: r.valueToCustomer ?? null,
    requiresPosIntegration: r.requiresPosIntegration ?? false,
  }));
}

export async function searchProductKnowledge(query: string): Promise<{
  features: ProductFeature[];
  valuePropositions: ProductValueProposition[];
}> {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  
  if (queryTerms.length === 0) {
    return { features: [], valuePropositions: [] };
  }

  const likePattern = `%${query}%`;

  const features = await db.select().from(airtableFeatures).where(
    or(
      ilike(airtableFeatures.name, likePattern),
      ilike(airtableFeatures.description, likePattern)
    )
  );

  const valueProps = await db.select().from(airtableValuePropositions).where(
    or(
      ilike(airtableValuePropositions.name, likePattern),
      ilike(airtableValuePropositions.description, likePattern)
    )
  );

  return {
    features: features.map(r => ({
      id: r.airtableId,
      name: r.name,
      description: r.description ?? null,
      productStatus: r.productStatus ?? null,
      proTier: r.proTier ?? null,
      advancedTier: r.advancedTier ?? null,
      enterpriseTier: r.enterpriseTier ?? null,
      type: (r.type as "Feature" | "Add-On") ?? null,
      hideFromPricingList: r.hideFromPricingList ?? false,
    })),
    valuePropositions: valueProps.map(r => ({
      id: r.airtableId,
      name: r.name,
      description: r.description ?? null,
      valueScore: r.valueToCustomer ?? null,
      requiresPosIntegration: r.requiresPosIntegration ?? false,
    })),
  };
}

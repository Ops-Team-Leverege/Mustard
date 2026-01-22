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
  pitcrewAirtableFeatures,
  pitcrewAirtableValuePropositions,
  pitcrewAirtableValueThemes,
  pitcrewAirtableFeatureThemes,
  pitcrewAirtableCustomerSegments,
  type PitcrewAirtableFeature,
  type PitcrewAirtableValueProposition,
  type PitcrewAirtableValueTheme,
  type PitcrewAirtableFeatureTheme,
  type PitcrewAirtableCustomerSegment,
} from "@shared/schema";
import { ilike, or } from "drizzle-orm";

export async function getFeatures(): Promise<PitcrewAirtableFeature[]> {
  return db.select().from(pitcrewAirtableFeatures);
}

export async function getValuePropositions(): Promise<PitcrewAirtableValueProposition[]> {
  return db.select().from(pitcrewAirtableValuePropositions);
}

export async function getValueThemes(): Promise<PitcrewAirtableValueTheme[]> {
  return db.select().from(pitcrewAirtableValueThemes);
}

export async function getFeatureThemes(): Promise<PitcrewAirtableFeatureTheme[]> {
  return db.select().from(pitcrewAirtableFeatureThemes);
}

export async function getCustomerSegments(): Promise<PitcrewAirtableCustomerSegment[]> {
  return db.select().from(pitcrewAirtableCustomerSegments);
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

  const features = await db.select().from(pitcrewAirtableFeatures).where(
    or(
      ilike(pitcrewAirtableFeatures.name, likePattern),
      ilike(pitcrewAirtableFeatures.description, likePattern)
    )
  );

  const valueProps = await db.select().from(pitcrewAirtableValuePropositions).where(
    or(
      ilike(pitcrewAirtableValuePropositions.name, likePattern),
      ilike(pitcrewAirtableValuePropositions.description, likePattern)
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

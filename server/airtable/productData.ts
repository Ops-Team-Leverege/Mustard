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
  pitcrewProductSnapshot,
  type PitcrewAirtableFeature,
  type PitcrewAirtableValueProposition,
  type PitcrewAirtableValueTheme,
  type PitcrewAirtableFeatureTheme,
  type PitcrewAirtableCustomerSegment,
} from "@shared/schema";
import { ilike, or, eq } from "drizzle-orm";

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

/**
 * Comprehensive Product Knowledge Result
 * 
 * Fetches from ALL product-related Airtable tables and returns
 * structured data with metadata about which sources were used.
 */
export type ProductKnowledgeResult = {
  features: ProductFeature[];
  valuePropositions: ProductValueProposition[];
  valueThemes: Array<{ id: string; name: string; description: string | null }>;
  featureThemes: Array<{ id: string; name: string; description: string | null; notes: string | null }>;
  customerSegments: Array<{ id: string; name: string }>;
  metadata: {
    tablesQueried: string[];
    tablesWithData: string[];
    totalRecords: number;
  };
};

/**
 * Fetch comprehensive product knowledge from all Airtable tables.
 * 
 * This is the authoritative source for PRODUCT_KNOWLEDGE intent.
 * Returns data from:
 * - pitcrew_airtable_features (WHAT PitCrew does)
 * - pitcrew_airtable_value_propositions (WHY PitCrew matters)
 * - pitcrew_airtable_value_themes (Grouped value themes)
 * - pitcrew_airtable_feature_themes (Grouped feature themes)
 * - pitcrew_airtable_customer_segments (WHO uses PitCrew)
 */
export async function getComprehensiveProductKnowledge(): Promise<ProductKnowledgeResult> {
  const tablesQueried = [
    "pitcrew_airtable_features",
    "pitcrew_airtable_value_propositions",
    "pitcrew_airtable_value_themes",
    "pitcrew_airtable_feature_themes",
    "pitcrew_airtable_customer_segments",
  ];
  const tablesWithData: string[] = [];
  
  const [features, valueProps, valueThemes, featureThemes, customerSegments] = await Promise.all([
    getFeatures(),
    getValuePropositions(),
    getValueThemes(),
    getFeatureThemes(),
    getCustomerSegments(),
  ]);
  
  const formattedFeatures = features.map(r => ({
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
  
  const formattedValueProps = valueProps.map(r => ({
    id: r.airtableId,
    name: r.name,
    description: r.description ?? null,
    valueScore: r.valueToCustomer ?? null,
    requiresPosIntegration: r.requiresPosIntegration ?? false,
  }));
  
  const formattedValueThemes = valueThemes.map(r => ({
    id: r.airtableId,
    name: r.name,
    description: r.description ?? null,
  }));
  
  const formattedFeatureThemes = featureThemes.map(r => ({
    id: r.airtableId,
    name: r.name,
    description: r.description ?? null,
    notes: r.notes ?? null,
  }));
  
  const formattedCustomerSegments = customerSegments.map(r => ({
    id: r.airtableId,
    name: r.name,
  }));
  
  if (formattedFeatures.length > 0) tablesWithData.push("pitcrew_airtable_features");
  if (formattedValueProps.length > 0) tablesWithData.push("pitcrew_airtable_value_propositions");
  if (formattedValueThemes.length > 0) tablesWithData.push("pitcrew_airtable_value_themes");
  if (formattedFeatureThemes.length > 0) tablesWithData.push("pitcrew_airtable_feature_themes");
  if (formattedCustomerSegments.length > 0) tablesWithData.push("pitcrew_airtable_customer_segments");
  
  const totalRecords = formattedFeatures.length + formattedValueProps.length + 
    formattedValueThemes.length + formattedFeatureThemes.length + formattedCustomerSegments.length;
  
  console.log(`[ProductData] Fetched ${totalRecords} records from ${tablesWithData.length}/${tablesQueried.length} tables`);
  
  return {
    features: formattedFeatures,
    valuePropositions: formattedValueProps,
    valueThemes: formattedValueThemes,
    featureThemes: formattedFeatureThemes,
    customerSegments: formattedCustomerSegments,
    metadata: {
      tablesQueried,
      tablesWithData,
      totalRecords,
    },
  };
}

/**
 * Format product knowledge into a prompt-friendly string.
 * 
 * This creates a structured text block that can be injected into LLM prompts
 * to provide authoritative product information.
 */
export function formatProductKnowledgeForPrompt(knowledge: ProductKnowledgeResult): string {
  const sections: string[] = [];
  
  if (knowledge.customerSegments.length > 0) {
    sections.push(`=== Customer Segments (WHO uses PitCrew) ===
${knowledge.customerSegments.map(s => `- ${s.name}`).join("\n")}`);
  }
  
  if (knowledge.valueThemes.length > 0) {
    sections.push(`=== Value Themes (High-Level Benefits) ===
${knowledge.valueThemes.map(t => `- ${t.name}${t.description ? `: ${t.description}` : ""}`).join("\n")}`);
  }
  
  if (knowledge.valuePropositions.length > 0) {
    const topValueProps = knowledge.valuePropositions
      .sort((a, b) => (b.valueScore || 0) - (a.valueScore || 0))
      .slice(0, 15);
    sections.push(`=== Key Value Propositions (WHY PitCrew matters) ===
${topValueProps.map(v => `- ${v.name}${v.description ? `\n  ${v.description}` : ""}`).join("\n")}`);
  }
  
  if (knowledge.featureThemes.length > 0) {
    sections.push(`=== Feature Themes (Capability Categories) ===
${knowledge.featureThemes.map(t => `- ${t.name}${t.description ? `: ${t.description}` : ""}`).join("\n")}`);
  }
  
  if (knowledge.features.length > 0) {
    const availableFeatures = knowledge.features.filter(f => 
      f.productStatus === "Available Now" || f.productStatus === "Live" || f.productStatus === "Beta"
    );
    const roadmapFeatures = knowledge.features.filter(f => 
      f.productStatus && !["Available Now", "Live", "Beta"].includes(f.productStatus)
    );
    
    if (availableFeatures.length > 0) {
      sections.push(`=== Current Product Features (Available Now) ===
${availableFeatures.map(f => `- ${f.name}${f.description ? `: ${f.description}` : ""}`).join("\n")}`);
    }
    
    if (roadmapFeatures.length > 0) {
      sections.push(`=== Roadmap Features (Planned/In Development) ===
${roadmapFeatures.map(f => `- ${f.name} [${f.productStatus}]${f.description ? `: ${f.description}` : ""}`).join("\n")}`);
    }
  }
  
  if (sections.length === 0) {
    return "No product knowledge data available in database.";
  }
  
  return sections.join("\n\n");
}

/**
 * Get the pre-computed product knowledge prompt from the snapshot.
 * This is the fast path - single query instead of 5.
 * Falls back to computing on-demand if snapshot doesn't exist.
 */
export type ProductSnapshotResult = {
  promptText: string;
  recordCount: number;
  tablesIncluded: string[];
  lastSyncedAt: Date | null;
  source: "snapshot" | "computed";
};

export async function getProductKnowledgePrompt(): Promise<ProductSnapshotResult> {
  // Try to get from snapshot first (fast path)
  const [snapshot] = await db.select()
    .from(pitcrewProductSnapshot)
    .where(eq(pitcrewProductSnapshot.id, "singleton"))
    .limit(1);
  
  if (snapshot) {
    console.log(`[ProductData] Using snapshot: ${snapshot.recordCount} records, synced ${snapshot.lastSyncedAt?.toISOString()}`);
    return {
      promptText: snapshot.promptText,
      recordCount: snapshot.recordCount,
      tablesIncluded: snapshot.tablesIncluded,
      lastSyncedAt: snapshot.lastSyncedAt,
      source: "snapshot",
    };
  }
  
  // Fallback: compute on-demand (slow path)
  console.log(`[ProductData] No snapshot found, computing on-demand...`);
  const knowledge = await getComprehensiveProductKnowledge();
  const promptText = formatProductKnowledgeForPrompt(knowledge);
  
  return {
    promptText,
    recordCount: knowledge.metadata.totalRecords,
    tablesIncluded: knowledge.metadata.tablesWithData,
    lastSyncedAt: null,
    source: "computed",
  };
}

/**
 * Rebuild the unified product snapshot from all Airtable tables.
 * Called after each successful sync to pre-compute the LLM prompt.
 */
export async function rebuildProductSnapshot(): Promise<void> {
  console.log("[ProductData] Rebuilding product snapshot...");
  
  try {
    const knowledge = await getComprehensiveProductKnowledge();
    const promptText = formatProductKnowledgeForPrompt(knowledge);
    
    await db.insert(pitcrewProductSnapshot)
      .values({
        id: "singleton",
        promptText,
        recordCount: knowledge.metadata.totalRecords,
        tablesIncluded: knowledge.metadata.tablesWithData,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pitcrewProductSnapshot.id,
        set: {
          promptText,
          recordCount: knowledge.metadata.totalRecords,
          tablesIncluded: knowledge.metadata.tablesWithData,
          lastSyncedAt: new Date(),
        },
      });
    
    console.log(`[ProductData] Product snapshot rebuilt: ${knowledge.metadata.totalRecords} records, ${promptText.length} chars`);
  } catch (error) {
    console.error("[ProductData] Failed to rebuild product snapshot:", error);
    throw error;
  }
}

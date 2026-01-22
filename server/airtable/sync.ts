/**
 * Airtable Database Sync Service
 * 
 * Purpose:
 * Syncs data from the PitCrew Product Database in Airtable to local PostgreSQL tables.
 * This provides faster queries and offline resilience compared to API-only access.
 * 
 * Usage:
 * - Call syncAllTables() to sync all Airtable tables to the database
 * - Called automatically by /api/airtable/refresh endpoint
 * 
 * Layer: Airtable (database sync)
 */

import { db } from "../db";
import { 
  airtableFeatures, 
  airtableValuePropositions, 
  airtableValueThemes,
  airtableFeatureThemes,
  airtableCustomerSegments,
  airtableSyncLog,
} from "@shared/schema";
import { fetchAllRecords, type AirtableRecord } from "./client";
import { AIRTABLE_TABLES, type FeatureFields, type ValuePropositionFields, type ValueThemeFields, type FeatureThemeFields, type CustomerSegmentFields } from "./types";
import { eq } from "drizzle-orm";

export type SyncResult = {
  table: string;
  recordsCount: number;
  status: "success" | "error";
  error?: string;
};

export type SyncAllResult = {
  success: boolean;
  results: SyncResult[];
  syncedAt: string;
  totalRecords: number;
};

async function syncFeatures(): Promise<SyncResult> {
  const tableName = "Features";
  try {
    const records = await fetchAllRecords<FeatureFields>({ tableId: AIRTABLE_TABLES.features.tableId });
    
    for (const record of records) {
      const data = {
        airtableId: record.id,
        name: record.fields.Name,
        description: record.fields["Description (Pricing Guide - External Facing)"] || null,
        productStatus: record.fields["Product Status"] || null,
        proTier: record.fields["Pro Tier"] || null,
        advancedTier: record.fields["Advanced Tier"] || null,
        enterpriseTier: record.fields["Enterprise Tier"] || null,
        listOrder: record.fields["List Order for Pricing Guide"] || null,
        hideFromPricingList: record.fields["Hide from Pricing List"] || false,
        type: record.fields.Type || null,
        internalNotes: record.fields["Internal Notes"] || null,
        valuePropositionIds: record.fields["Value Propositions"] || [],
        featureThemeIds: record.fields["Feature Themes"] || [],
        syncedAt: new Date(),
      };

      await db.insert(airtableFeatures)
        .values(data)
        .onConflictDoUpdate({
          target: airtableFeatures.airtableId,
          set: { ...data },
        });
    }

    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: records.length,
      status: "success",
    });

    return { table: tableName, recordsCount: records.length, status: "success" };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Airtable Sync] Error syncing ${tableName}:`, error);
    
    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: 0,
      status: "error",
      errorMessage: errorMsg,
    });
    
    return { table: tableName, recordsCount: 0, status: "error", error: errorMsg };
  }
}

async function syncValuePropositions(): Promise<SyncResult> {
  const tableName = "Value Propositions";
  try {
    const records = await fetchAllRecords<ValuePropositionFields>({ tableId: AIRTABLE_TABLES.valuePropositions.tableId });
    
    for (const record of records) {
      const data = {
        airtableId: record.id,
        name: record.fields.Name,
        description: record.fields.Description || null,
        valueToCustomer: record.fields["Value to Customer"] || null,
        internalNotes: record.fields["Internal Notes"] || null,
        requiresPosIntegration: record.fields["Requires POS Integration?"] || false,
        featureIds: record.fields.Features || [],
        segmentIds: record.fields["Most Applicable to These Segments"] || [],
        valueThemeIds: record.fields["Value Themes"] || [],
        syncedAt: new Date(),
      };

      await db.insert(airtableValuePropositions)
        .values(data)
        .onConflictDoUpdate({
          target: airtableValuePropositions.airtableId,
          set: { ...data },
        });
    }

    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: records.length,
      status: "success",
    });

    return { table: tableName, recordsCount: records.length, status: "success" };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Airtable Sync] Error syncing ${tableName}:`, error);
    
    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: 0,
      status: "error",
      errorMessage: errorMsg,
    });
    
    return { table: tableName, recordsCount: 0, status: "error", error: errorMsg };
  }
}

async function syncValueThemes(): Promise<SyncResult> {
  const tableName = "Value Themes";
  try {
    const records = await fetchAllRecords<ValueThemeFields>({ tableId: AIRTABLE_TABLES.valueThemes.tableId });
    
    for (const record of records) {
      const data = {
        airtableId: record.id,
        name: record.fields.Name,
        description: record.fields.Description || null,
        valuePropositionIds: record.fields["Value Propositions"] || [],
        syncedAt: new Date(),
      };

      await db.insert(airtableValueThemes)
        .values(data)
        .onConflictDoUpdate({
          target: airtableValueThemes.airtableId,
          set: { ...data },
        });
    }

    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: records.length,
      status: "success",
    });

    return { table: tableName, recordsCount: records.length, status: "success" };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Airtable Sync] Error syncing ${tableName}:`, error);
    
    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: 0,
      status: "error",
      errorMessage: errorMsg,
    });
    
    return { table: tableName, recordsCount: 0, status: "error", error: errorMsg };
  }
}

async function syncFeatureThemes(): Promise<SyncResult> {
  const tableName = "Feature Themes";
  try {
    const records = await fetchAllRecords<FeatureThemeFields>({ tableId: AIRTABLE_TABLES.featureThemes.tableId });
    
    for (const record of records) {
      const data = {
        airtableId: record.id,
        name: record.fields.Name,
        description: record.fields.Description || null,
        notes: record.fields.Notes || null,
        featureIds: record.fields.Features || [],
        syncedAt: new Date(),
      };

      await db.insert(airtableFeatureThemes)
        .values(data)
        .onConflictDoUpdate({
          target: airtableFeatureThemes.airtableId,
          set: { ...data },
        });
    }

    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: records.length,
      status: "success",
    });

    return { table: tableName, recordsCount: records.length, status: "success" };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Airtable Sync] Error syncing ${tableName}:`, error);
    
    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: 0,
      status: "error",
      errorMessage: errorMsg,
    });
    
    return { table: tableName, recordsCount: 0, status: "error", error: errorMsg };
  }
}

async function syncCustomerSegments(): Promise<SyncResult> {
  const tableName = "Customer Segments";
  try {
    const records = await fetchAllRecords<CustomerSegmentFields>({ tableId: AIRTABLE_TABLES.customerSegments.tableId });
    
    for (const record of records) {
      const data = {
        airtableId: record.id,
        name: record.fields.Name,
        valuePropositionIds: record.fields["Value Propositions"] || [],
        syncedAt: new Date(),
      };

      await db.insert(airtableCustomerSegments)
        .values(data)
        .onConflictDoUpdate({
          target: airtableCustomerSegments.airtableId,
          set: { ...data },
        });
    }

    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: records.length,
      status: "success",
    });

    return { table: tableName, recordsCount: records.length, status: "success" };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Airtable Sync] Error syncing ${tableName}:`, error);
    
    await db.insert(airtableSyncLog).values({
      tableName,
      recordsCount: 0,
      status: "error",
      errorMessage: errorMsg,
    });
    
    return { table: tableName, recordsCount: 0, status: "error", error: errorMsg };
  }
}

export async function syncAllTables(): Promise<SyncAllResult> {
  console.log("[Airtable Sync] Starting full sync...");
  
  const results = await Promise.all([
    syncFeatures(),
    syncValuePropositions(),
    syncValueThemes(),
    syncFeatureThemes(),
    syncCustomerSegments(),
  ]);

  const totalRecords = results.reduce((sum, r) => sum + r.recordsCount, 0);
  const hasErrors = results.some(r => r.status === "error");

  console.log(`[Airtable Sync] Completed. Total records: ${totalRecords}, Errors: ${hasErrors}`);

  return {
    success: !hasErrors,
    results,
    syncedAt: new Date().toISOString(),
    totalRecords,
  };
}

export async function getLastSyncTime(): Promise<Date | null> {
  const [lastSync] = await db.select()
    .from(airtableSyncLog)
    .where(eq(airtableSyncLog.status, "success"))
    .orderBy(airtableSyncLog.syncedAt)
    .limit(1);
  
  return lastSync?.syncedAt || null;
}

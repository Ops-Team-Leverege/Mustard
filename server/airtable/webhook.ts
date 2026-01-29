/**
 * Airtable Webhook Handler
 * 
 * Purpose:
 * Handles incoming webhooks from Airtable when records are updated.
 * Invalidates the local cache to ensure fresh data on next request.
 * 
 * Now works dynamically with any table - no hardcoded table mappings.
 * 
 * Airtable can send webhooks via:
 * 1. Airtable Automations (native, requires Pro plan)
 * 2. Make.com / Zapier (works with any plan)
 * 
 * Endpoint: POST /api/airtable/webhook
 * 
 * Layer: Airtable (webhook handling)
 */

import type { Request, Response } from "express";
import { invalidateAllDataCache } from "./dynamicData";
import { invalidateSchemaCache } from "./schema";
import { syncAllTablesDynamic } from "./dynamicSync";
import { rebuildProductSnapshot } from "./productData";

type WebhookPayload = {
  base?: { id: string };
  table?: { id: string; name: string };
  record?: { id: string };
  action?: "create" | "update" | "delete" | "schema_change";
  timestamp?: string;
  source?: string;
};

export async function handleAirtableWebhook(req: Request, res: Response): Promise<void> {
  console.log("[Airtable Webhook] Received webhook - triggering full sync");

  try {
    const payload = req.body as WebhookPayload;
    
    console.log(`[Airtable Webhook] Action: ${payload.action || "sync"}`);
    console.log(`[Airtable Webhook] Table: ${payload.table?.name || payload.table?.id || "all"}`);

    // Invalidate caches first
    invalidateSchemaCache();
    invalidateAllDataCache();
    
    // Run sync and wait for completion before responding
    // This ensures the sync finishes before Autoscale shuts down the container
    const syncResult = await syncAllTablesDynamic();
    
    console.log(`[Airtable Webhook] Sync completed. Tables: ${syncResult.tablesDiscovered}, Records: ${syncResult.totalRecords}`);
    
    // Rebuild product snapshot after successful sync
    if (syncResult.success) {
      await rebuildProductSnapshot();
    }

    res.status(200).json({ 
      ...syncResult,
      message: `Sync completed. Tables: ${syncResult.tablesDiscovered}, Records: ${syncResult.totalRecords}`,
    });
  } catch (error) {
    console.error("[Airtable Webhook] Error:", error);
    res.status(500).json({ success: false, error: "Webhook processing failed" });
  }
}

export function verifyAirtableWebhook(req: Request): boolean {
  const secret = process.env.AIRTABLE_WEBHOOK_SECRET;
  if (!secret) {
    console.log("[Airtable Webhook] No AIRTABLE_WEBHOOK_SECRET configured, accepting all webhooks");
    return true;
  }

  const providedSecret = req.headers["x-airtable-secret"] || req.query.secret;
  return providedSecret === secret;
}

/**
 * Endpoint to force a full sync of all Airtable data to the database.
 * Can be hit daily via cron, automation, or manually.
 * 
 * GET /api/airtable/refresh
 */
export async function handleAirtableRefresh(req: Request, res: Response): Promise<void> {
  console.log("[Airtable Refresh] Manual refresh triggered");

  try {
    invalidateSchemaCache();
    invalidateAllDataCache();
    
    const syncResult = await syncAllTablesDynamic();
    
    console.log(`[Airtable Refresh] Sync completed. Tables: ${syncResult.tablesDiscovered}, Records: ${syncResult.totalRecords}`);
    
    // Rebuild product snapshot after successful sync
    if (syncResult.success) {
      await rebuildProductSnapshot();
    }

    const message = syncResult.success 
      ? `Discovered ${syncResult.tablesDiscovered} tables, synced ${syncResult.totalRecords} records.`
      : "Sync completed with errors.";

    res.status(200).json({ 
      ...syncResult,
      message,
    });
  } catch (error) {
    console.error("[Airtable Refresh] Error:", error);
    res.status(500).json({ success: false, error: "Refresh failed" });
  }
}

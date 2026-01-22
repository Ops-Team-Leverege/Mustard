/**
 * Airtable Webhook Handler
 * 
 * Purpose:
 * Handles incoming webhooks from Airtable when records are updated.
 * Invalidates the local cache to ensure fresh data on next request.
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
import { invalidateCache } from "./productData";

type WebhookPayload = {
  base?: { id: string };
  table?: { id: string; name: string };
  record?: { id: string };
  action?: "create" | "update" | "delete";
  timestamp?: string;
  source?: string;
};

const TABLE_NAME_TO_CACHE_KEY: Record<string, string> = {
  "Value Propositions": "valuePropositions",
  "Value Themes": "valueThemes",
  "Features": "features",
  "Feature Themes": "featureThemes",
  "Customer Segments": "customerSegments",
};

export async function handleAirtableWebhook(req: Request, res: Response): Promise<void> {
  console.log("[Airtable Webhook] Received webhook");

  try {
    const payload = req.body as WebhookPayload;
    
    console.log(`[Airtable Webhook] Action: ${payload.action || "unknown"}`);
    console.log(`[Airtable Webhook] Table: ${payload.table?.name || "unknown"}`);
    console.log(`[Airtable Webhook] Record: ${payload.record?.id || "unknown"}`);

    if (payload.table?.name) {
      const cacheKey = TABLE_NAME_TO_CACHE_KEY[payload.table.name];
      if (cacheKey) {
        invalidateCache(cacheKey as any);
        console.log(`[Airtable Webhook] Invalidated cache for: ${cacheKey}`);
      } else {
        invalidateCache();
        console.log(`[Airtable Webhook] Unknown table, invalidated all cache`);
      }
    } else {
      invalidateCache();
      console.log(`[Airtable Webhook] No table specified, invalidated all cache`);
    }

    res.status(200).json({ 
      success: true, 
      message: "Cache invalidated",
      table: payload.table?.name,
      action: payload.action,
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

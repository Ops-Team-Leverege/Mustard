import type { Request, Response } from "express";
import { syncZendeskArticles } from "./zendeskSync";

export async function handleZendeskWebhook(req: Request, res: Response): Promise<void> {
  console.log("[Zendesk Webhook] Received webhook - triggering article sync");

  try {
    const payload = req.body;
    console.log(`[Zendesk Webhook] Payload:`, JSON.stringify(payload).slice(0, 200));

    const syncResult = await syncZendeskArticles();

    console.log(`[Zendesk Webhook] Sync completed. ${syncResult.synced} articles synced/updated out of ${syncResult.total} total`);

    res.status(200).json({
      success: true,
      synced: syncResult.synced,
      total: syncResult.total,
      message: `Sync completed. ${syncResult.synced} articles synced/updated out of ${syncResult.total} total`,
    });
  } catch (error) {
    console.error("[Zendesk Webhook] Error:", error);
    res.status(500).json({ success: false, error: "Webhook processing failed" });
  }
}

export function verifyZendeskWebhook(req: Request): boolean {
  const secret = process.env.ZENDESK_WEBHOOK_ZAPIER;
  if (!secret) {
    console.error("[Zendesk Webhook] ZENDESK_WEBHOOK_ZAPIER is not configured — rejecting request");
    return false;
  }

  const providedSecret = req.headers["x-zendesk-secret"] || req.query.secret;
  const match = providedSecret === secret;
  if (!match) {
    console.error(`[Zendesk Webhook] Secret mismatch. Header present: ${!!providedSecret}, Secret len: ${secret.length}, Provided len: ${String(providedSecret || '').length}`);
  }
  return match;
}

/**
 * Slack Signature Verification
 * 
 * Purpose:
 * Verifies that incoming webhooks are genuinely from Slack using HMAC-SHA256
 * signature validation. Prevents replay attacks with timestamp checking.
 * 
 * Security: Required for all Slack webhook endpoints.
 * 
 * Layer: Slack (security)
 */

import crypto from "crypto";
import type { Request } from "express";

export function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("Missing SLACK_SIGNING_SECRET");
  }

  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];

  if (typeof timestamp !== "string" || typeof signature !== "string") {
    return false;
  }

  // Prevent replay attacks (5 minutes)
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) {
    return false;
  }

  // Get raw body string for signature verification
  let body: string;
  if (Buffer.isBuffer(req.body)) {
    body = req.body.toString("utf8");
  } else if (typeof req.body === "object") {
    // If express.json already parsed it, stringify it back
    body = JSON.stringify(req.body);
  } else {
    body = String(req.body);
  }

  const baseString = `v0:${timestamp}:${body}`;

  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex");

  const expectedSignature = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

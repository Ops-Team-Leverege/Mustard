/**
 * Slack Routes Registration
 * 
 * Purpose:
 * Registers Slack webhook endpoints with the Express app.
 * Uses raw body parsing for signature verification.
 * 
 * Layer: Slack (route setup)
 */

import type { Express } from "express";
import express from "express";
import { slackEventsHandler } from "./events";

export function registerSlackRoutes(app: Express) {
  app.post(
    "/api/slack/events",  
    express.raw({ type: "application/json" }),
    slackEventsHandler
  );
}
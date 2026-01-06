import type { Express } from "express";
import express from "express";
import { slackEventsHandler } from "./events";

export function registerSlackRoutes(app: Express) {
  app.post(
    "/slack/events",
    express.raw({ type: "application/json" }),
    slackEventsHandler
  );
}

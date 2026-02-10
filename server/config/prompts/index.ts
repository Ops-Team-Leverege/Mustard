/**
 * Centralized Prompt Configuration
 * 
 * All LLM prompts are maintained in this single location for:
 * - Easy maintenance and updates
 * - Version tracking via git
 * - Consistent prompt patterns
 * - Reusable fragments (e.g., AMBIENT_PRODUCT_CONTEXT)
 * 
 * Structure:
 * - system.ts: Base system prompts, personas, shared context
 * - decisionLayer.ts: Intent classification, contract selection, clarification
 * - extraction.ts: Customer question extraction, Q&A resolution
 * - singleMeeting.ts: Single meeting handlers (extractive, aggregative, summary)
 * - multiMeeting.ts: Cross-meeting analysis, patterns, trends
 * - transcript.ts: Transcript analysis, insight extraction
 * - external.ts: External research, Gemini prompts, MCP routing
 * - generalHelp.ts: General assistance, product knowledge, strategy synthesis, style writing
 * - slackSearch.ts: Slack message search and synthesis
 * - utility.ts: Classifiers, semantic search, research prompts
 */

export * from "./system";
export * from "./decisionLayer";
export * from "./extraction";
export * from "./singleMeeting";
export * from "./multiMeeting";
export * from "./transcript";
export * from "./external";
export * from "./generalHelp";
export * from "./slackSearch";
export * from "./utility";

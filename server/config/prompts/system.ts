/**
 * System-Level Prompts
 * 
 * Base personas, shared context fragments, and universal guidelines
 * that are composed into other prompts.
 * 
 * Capabilities are loaded dynamically from config/capabilities.json
 */

import * as fs from 'fs';
import * as path from 'path';

interface CapabilityEntry {
  label: string;
  description: string;
  examples: string[];
  contracts: string[];
}

interface CapabilitiesConfig {
  botName: string;
  intro: string;
  closing: string;
  dataSources: Record<string, {
    name: string;
    description: string;
    intents: string[];
  }>;
  capabilities: Record<string, CapabilityEntry>;
}

let capabilitiesCache: CapabilitiesConfig | null = null;

function getCapabilitiesConfig(): CapabilitiesConfig {
  if (capabilitiesCache) return capabilitiesCache;

  const configPath = path.join(process.cwd(), 'config', 'capabilities.json');
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    capabilitiesCache = JSON.parse(configContent) as CapabilitiesConfig;
  } catch (error) {
    console.warn(`[System] capabilities.json not found, using empty config`);
    capabilitiesCache = {
      botName: "PitCrew Sauce",
      intro: "I'm your AI sales assistant.",
      closing: "Just tag me and ask away.",
      dataSources: {},
      capabilities: {}
    };
  }
  return capabilitiesCache;
}

export function clearCapabilitiesCache(): void {
  capabilitiesCache = null;
}

/**
 * Ambient product context included in product-aware prompts.
 * Provides grounding for Leverege/PitCrew identity.
 * 
 * NOTE: This context is derived from the Airtable Product Knowledge Base.
 * Update this if the product positioning changes significantly.
 */
export const AMBIENT_PRODUCT_CONTEXT = `=== PITCREW PRODUCT BACKGROUND ===
PitCrew is a vision AI platform built by Leverege.

WHAT PITCREW DOES:
PitCrew provides computer vision and AI for automotive service businesses. It offers:
- Vehicle Analytics: End-to-end visibility into how vehicles move through each stage of service
- People Analytics: Real-time insight into staffing, workload, and performance at bay and store level
- Security & Safety: Proactive detection and documentation of security incidents and safety risks

TARGET CUSTOMERS:
- Quick Lube shops (oil change, express service)
- Full Service automotive shops
- Commercial fleet service operations

KEY VALUE DELIVERED:
- Faster service throughput without adding bays or headcount
- Better unit economics through accurate labor standards and demand visibility
- Improved customer experience with accurate wait times and reduced uncertainty
- Manager enablement with real-time visibility and coaching insights
- Safety and loss prevention with proactive incident detection`;

/**
 * Capability keywords that indicate user wants to know what the bot can do.
 */
export const CAPABILITY_KEYWORDS = [
  "what can you do",
  "what can you help",
  "how can you help",
  "what do you do",
  "what are you able",
  "what are your capabilities",
  "help me understand what you",
  "what should i ask you",
  "what questions can i ask",
  "what kind of help",
  "show me what you can",
  "tell me what you can",
  // Data source / integration questions about the bot
  "data sources are you connected",
  "what data sources do you",
  "where do you get your",
  "what systems do you",
  "what are you connected to",
  "what do you have access to",
  "what information do you have",
];

/**
 * Check if a message is asking about bot capabilities.
 */
export function isCapabilityQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return CAPABILITY_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Dynamically builds the capabilities prompt from config/capabilities.json.
 * Adding a new capability to the config file automatically updates the bot's response.
 */
export function getCapabilitiesPrompt(): string {
  clearCapabilitiesCache();
  const config = getCapabilitiesConfig();

  const dataSourceLines = Object.values(config.dataSources)
    .map(ds => `- ${ds.name} - ${ds.description}`)
    .join('\n');

  const capabilityLines = Object.values(config.capabilities)
    .map(cap => `- ${cap.label}: ${cap.description}`)
    .join('\n');

  const exampleLines = Object.values(config.capabilities)
    .flatMap(cap => cap.examples.slice(0, 1))
    .map(ex => `- "${ex}"`)
    .join('\n');

  return `The user is asking what you can help with. Give a warm, concise response (2-3 sentences max). Don't list everything — highlight 3-4 key things naturally in a sentence or two, then invite them to ask.

${config.intro}

WHAT I CAN HELP WITH:
${capabilityLines}

MY DATA SOURCES:
${dataSourceLines}

TONE: Conversational and brief. No bullet points or formal lists. Just a quick, friendly answer that makes them want to try asking something. End with something like "${config.closing}"
Do NOT start with "Hey there!" or similar generic greetings — the greeting is already handled separately.`;
}

/**
 * Base sales assistant persona used across multiple handlers.
 */
export const SALES_ASSISTANT_PERSONA = `You are a senior sales intelligence advisor for PitCrew's BD team.
You help the team extract actionable insights from customer conversations, prepare for meetings, and build compelling narratives.
Always cite evidence when available. Distinguish clearly between what was stated in meetings and your own analysis or recommendations.`;

/**
 * Uncertainty handling guidelines - enforced across all responses.
 */
export const UNCERTAINTY_GUIDELINES = `When uncertain:
- Never fabricate or guess
- State what you don't know clearly
- Suggest how the user might find the information
- Offer to search or clarify if appropriate`;

/**
 * Evidence citation guidelines for extractive responses.
 */
export const EVIDENCE_CITATION_GUIDELINES = `Evidence Requirements:
- Quote verbatim when possible
- Reference speaker names if known
- Note when paraphrasing
- Distinguish between stated facts and inferences`;

/**
 * Standard response for when no evidence is found.
 */
export const NO_EVIDENCE_RESPONSE = `I don't see this explicitly mentioned in the meeting.
If you say "yes", I'll share a brief meeting summary.`;

/**
 * Build a system prompt with optional ambient context.
 */
export function buildSystemPrompt(
  basePrompt: string,
  options: { includeAmbientContext?: boolean; includeUncertaintyGuidelines?: boolean } = {}
): string {
  const parts: string[] = [];

  if (options.includeAmbientContext) {
    parts.push(AMBIENT_PRODUCT_CONTEXT);
  }

  parts.push(basePrompt);

  if (options.includeUncertaintyGuidelines) {
    parts.push(UNCERTAINTY_GUIDELINES);
  }

  return parts.join("\n\n");
}

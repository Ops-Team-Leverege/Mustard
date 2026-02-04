/**
 * Progress Messages
 * 
 * Sends a friendly progress message after a delay if the response
 * is taking longer than expected. Only ONE progress message is sent.
 * 
 * Config-driven via config/progress.json
 * 
 * Also provides personalized progress messages using gpt-4o-mini for
 * a more conversational feel based on the user's actual question.
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { MODEL_ASSIGNMENTS } from '../config/models';

const openai = new OpenAI();

interface ProgressConfig {
  delaySeconds: number;
  messages: string[];
}

let configCache: ProgressConfig | null = null;

function getProgressConfig(): ProgressConfig {
  if (configCache) return configCache;
  
  const configPath = path.join(process.cwd(), 'config', 'progress.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  configCache = JSON.parse(configContent) as ProgressConfig;
  return configCache;
}

export function clearProgressConfigCache(): void {
  configCache = null;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get a random progress message
 */
export function getProgressMessage(): string {
  const config = getProgressConfig();
  return pickRandom(config.messages);
}

/**
 * Get the delay in milliseconds before sending a progress message
 */
export function getProgressDelayMs(): number {
  const config = getProgressConfig();
  return config.delaySeconds * 1000;
}

export type ProgressIntentType = 
  | 'product' 
  | 'research' 
  | 'draft_email' 
  | 'draft_response' 
  | 'multi_meeting' 
  | 'single_meeting'
  | 'general';

const defaultMessages: Record<ProgressIntentType, string> = {
  product: "Checking our product database now...",
  research: "Researching that for you now...",
  draft_email: "Drafting your email now...",
  draft_response: "Drafting your response now...",
  multi_meeting: "Analyzing the relevant meetings now...",
  single_meeting: "Looking through this meeting's details...",
  general: "Working on that for you now...",
};

/**
 * Bot capabilities derived from actual contracts/intents.
 * Each capability describes what the bot can do for BD users.
 * The LLM will pick one and elaborate it into a natural tip.
 */
const BOT_CAPABILITIES: Array<{ capability: string; useCase: string }> = [
  // Meeting extraction capabilities
  { capability: "Meeting Summaries", useCase: "Summarize any customer meeting in seconds" },
  { capability: "Action Items", useCase: "Pull next steps and commitments from meetings" },
  { capability: "Customer Questions", useCase: "Find questions customers asked during calls" },
  { capability: "Attendee Lists", useCase: "Get who was in any meeting" },
  
  // Cross-meeting analysis
  { capability: "Pattern Analysis", useCase: "Find recurring themes across all customer meetings" },
  { capability: "Trend Tracking", useCase: "See how conversations change over time" },
  { capability: "Customer Comparisons", useCase: "Compare how different customers respond" },
  
  // Product knowledge
  { capability: "Product Knowledge", useCase: "Know everything about PitCrew features and capabilities" },
  { capability: "Value Propositions", useCase: "Help craft compelling value props for customers" },
  { capability: "Feature Verification", useCase: "Confirm what PitCrew can and can't do" },
  
  // Content drafting
  { capability: "Draft Emails", useCase: "Write follow-up emails with personalized value props" },
  { capability: "Draft Responses", useCase: "Help answer customer questions with confidence" },
  { capability: "Technical Emails", useCase: "Draft technical content with accurate product details" },
  { capability: "Presentation Content", useCase: "Write slide content and talking points" },
  
  // Research
  { capability: "Company Research", useCase: "Research prospects before meetings" },
  { capability: "Feature Descriptions", useCase: "Write feature descriptions in PitCrew's style" },
  { capability: "Competitive Intel", useCase: "Understand what competitors are doing" },
  
  // Data extraction
  { capability: "POS Detection", useCase: "Identify what POS systems prospects use" },
  { capability: "Pain Point Extraction", useCase: "Find what problems customers mention" },
  { capability: "Objection Tracking", useCase: "Track common objections across customers" },
  
  // General PitCrew help
  { capability: "General Help", useCase: "Answer any question about PitCrew" },
  { capability: "How It Works", useCase: "Explain how PitCrew's vision AI detects vehicles and services" },
  { capability: "Integration Questions", useCase: "Explain how PitCrew connects with POS systems" },
  { capability: "ROI Conversations", useCase: "Help you explain the business value of PitCrew" },
  { capability: "Technical Deep Dives", useCase: "Walk through camera placement, network requirements, or data flow" },
  { capability: "Use Case Examples", useCase: "Share real examples of how shops use PitCrew" },
];

/**
 * Get a random capability tip to append to progress messages.
 * Picks a random capability and formats it as a friendly tip.
 */
function getRandomCapabilityTip(): string {
  const capability = pickRandom(BOT_CAPABILITIES);
  // Make the use case lowercase for grammatical flow
  const useCase = capability.useCase.charAt(0).toLowerCase() + capability.useCase.slice(1);
  
  const templates = [
    `I can help you ${useCase}`,
    `I can also ${useCase}`,
    `I'm able to ${useCase}`,
    `Need to ${useCase}? I can help with that`,
    `Want to ${useCase}? Just ask`,
  ];
  
  return pickRandom(templates);
}

/**
 * Generate a personalized progress message using a quick LLM call.
 * Uses gpt-4o-mini for speed - this should complete in <500ms.
 * Falls back to a default message if LLM fails.
 * 
 * Includes a random capability tip to educate users about other features.
 * 
 * This is meant to be called EARLY in the pipeline (right after intent classification)
 * so users see a relevant message quickly instead of waiting for generic timer-based messages.
 */
export async function generatePersonalizedProgressMessage(
  userMessage: string,
  intentType: ProgressIntentType,
  includeCapabilityTip: boolean = true
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.PROGRESS_MESSAGES,
      messages: [
        {
          role: "system",
          content: `Generate a brief, professional progress message (10-20 words max) for a user who just asked a question. 
The message should:
- Be friendly but not overly enthusiastic (no "Great question!" or excessive praise)
- Reference what they're asking about specifically
- Be matter-of-fact and helpful
- NOT use emojis
- NOT start with "I'm" (vary the opener)
- NOT use words like "great", "awesome", "absolutely", "definitely"

Examples:
- "Checking our camera integration specs - one moment."
- "Pulling that info from our database."
- "Looking up the network requirements now."
- "Searching for that feature info."`
        },
        {
          role: "user",
          content: `Question type: ${intentType}\nUser's question: "${userMessage.substring(0, 150)}"`
        }
      ],
      max_tokens: 50,
      temperature: 0.7,
    });
    
    let progressMessage = response.choices[0]?.message?.content?.trim();
    if (!progressMessage || progressMessage.length < 10 || progressMessage.length > 150) {
      progressMessage = defaultMessages[intentType];
    }
    
    // Append a random capability tip to help users discover other features
    if (includeCapabilityTip) {
      const tip = getRandomCapabilityTip();
      return `${progressMessage}\n\n_Tip: ${tip}_`;
    }
    
    return progressMessage;
  } catch (error) {
    console.log(`[ProgressMessages] Personalized message generation failed, using default`);
    const fallback = defaultMessages[intentType];
    
    if (includeCapabilityTip) {
      const tip = getRandomCapabilityTip();
      return `${fallback}\n\n_Tip: ${tip}_`;
    }
    
    return fallback;
  }
}

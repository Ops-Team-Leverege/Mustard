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
 * Bot capability tips to educate users about other features.
 * These are appended to progress messages to increase discoverability.
 */
const CAPABILITY_TIPS: string[] = [
  "I can also help you draft emails with customized value propositions for customers.",
  "Did you know I can research companies and write feature descriptions in PitCrew's style?",
  "I can search across all your customer meetings to find patterns and trends.",
  "Need a meeting summary? Just ask me about any customer call.",
  "I can help you prepare for customer meetings by researching their business.",
  "Ask me about PitCrew features - I have the full product database at my fingertips.",
  "I can identify what POS systems your prospects are using from meeting notes.",
  "Need to follow up with a customer? I can draft personalized emails based on your conversations.",
  "I can find common questions customers ask across all your meetings.",
  "Looking for action items from a meeting? I can pull those up for you.",
];

/**
 * Get a random capability tip to append to progress messages.
 * Helps educate users about the bot's other capabilities while they wait.
 */
function getRandomCapabilityTip(): string {
  return pickRandom(CAPABILITY_TIPS);
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

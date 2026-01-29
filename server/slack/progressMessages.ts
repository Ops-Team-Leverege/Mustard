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
 * Generate a personalized progress message using a quick LLM call.
 * Uses gpt-4o-mini for speed - this should complete in <500ms.
 * Falls back to a default message if LLM fails.
 * 
 * This is meant to be called EARLY in the pipeline (right after intent classification)
 * so users see a relevant message quickly instead of waiting for generic timer-based messages.
 */
export async function generatePersonalizedProgressMessage(
  userMessage: string,
  intentType: ProgressIntentType
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.PROGRESS_MESSAGES,
      messages: [
        {
          role: "system",
          content: `Generate a brief, friendly progress message (15-25 words max) for a user who just asked a question. 
The message should:
- Be warm and conversational (not robotic)
- Reference what they're asking about specifically
- End with a brief reassurance you're working on it
- NOT use emojis
- NOT start with "I'm" (vary the opener)

Examples:
- "Let me dig into our camera integration specs for you - pulling that info now."
- "Good question about pricing! Gathering the latest details from our database."
- "Checking what we know about network requirements - one moment."
- "Looking into how that feature works - I'll have an answer shortly."`
        },
        {
          role: "user",
          content: `Question type: ${intentType}\nUser's question: "${userMessage.substring(0, 150)}"`
        }
      ],
      max_tokens: 50,
      temperature: 0.7,
    });
    
    const generated = response.choices[0]?.message?.content?.trim();
    if (generated && generated.length > 10 && generated.length < 150) {
      return generated;
    }
    return defaultMessages[intentType];
  } catch (error) {
    console.log(`[ProgressMessages] Personalized message generation failed, using default`);
    return defaultMessages[intentType];
  }
}

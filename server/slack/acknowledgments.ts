/**
 * Smart Acknowledgments
 * 
 * Generates context-aware, varied acknowledgment messages based on what the user is asking.
 * Uses simple keyword matching (no LLM needed) for instant response.
 * 
 * Config-driven via config/acknowledgments.json
 */

import * as fs from 'fs';
import * as path from 'path';

interface AckPattern {
  name: string;
  keywords: string[];
  messages: string[];
}

interface AckConfig {
  patterns: AckPattern[];
  fallback: string[];
}

let configCache: AckConfig | null = null;

function getAckConfig(): AckConfig {
  if (configCache) return configCache;
  
  const configPath = path.join(process.cwd(), 'config', 'acknowledgments.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  configCache = JSON.parse(configContent) as AckConfig;
  return configCache;
}

export function clearAckConfigCache(): void {
  configCache = null;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a context-aware acknowledgment message.
 * 
 * @param user - The user's display name or mention (e.g., "@Silvina")
 * @param message - The user's message to analyze
 * @returns A contextual acknowledgment string
 */
export function generateAck(user: string, message: string): string {
  const config = getAckConfig();
  const messageLower = message.toLowerCase();
  
  for (const pattern of config.patterns) {
    if (pattern.keywords.some(kw => messageLower.includes(kw))) {
      const template = pickRandom(pattern.messages);
      return template.replace('{user}', user);
    }
  }
  
  const template = pickRandom(config.fallback);
  return template.replace('{user}', user);
}

/**
 * Generate acknowledgment with @ mention format.
 * 
 * @param userId - The Slack user ID (e.g., "U12345")
 * @param message - The user's message to analyze
 * @returns A contextual acknowledgment string with Slack mention
 */
export function generateAckWithMention(userId: string, message: string): string {
  return generateAck(`<@${userId}>`, message);
}

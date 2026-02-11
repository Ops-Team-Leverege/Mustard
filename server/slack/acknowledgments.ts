/**
 * Smart Acknowledgments
 * 
 * Generates general, varied acknowledgment messages with friendly icons.
 * Simplified approach - no keyword matching needed, always accurate.
 * 
 * Config-driven via config/acknowledgments.json
 */

import * as fs from 'fs';
import * as path from 'path';

interface AckConfig {
  messages: string[];
  messagesNoUser: string[];
}

let configCache: AckConfig | null = null;

function getAckConfig(): AckConfig {
  if (configCache) return configCache;
  
  const configPath = path.join(process.cwd(), 'config', 'acknowledgments.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  configCache = JSON.parse(configContent) as AckConfig;
  return configCache;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a friendly acknowledgment message.
 * 
 * @param user - The user's display name or mention (e.g., "@Silvina"), or null for no mention
 * @returns A general acknowledgment string with icon
 */
export function generateAck(user: string | null): string {
  const config = getAckConfig();
  
  if (user) {
    const template = pickRandom(config.messages);
    return template.replace('{user}', user);
  } else {
    return pickRandom(config.messagesNoUser);
  }
}

/**
 * Generate acknowledgment with @ mention format.
 * 
 * @param userId - The Slack user ID (e.g., "U12345")
 * @returns A general acknowledgment string with Slack mention and icon
 */
export function generateAckWithMention(userId: string): string {
  return generateAck(`<@${userId}>`);
}

/**
 * Progress Messages
 * 
 * Sends a friendly progress message after a delay if the response
 * is taking longer than expected. Only ONE progress message is sent.
 * 
 * Config-driven via config/progress.json
 */

import * as fs from 'fs';
import * as path from 'path';

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

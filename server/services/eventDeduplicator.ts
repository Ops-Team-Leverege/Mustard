/**
 * Event Deduplication Service
 * 
 * Database-backed deduplication for Slack events.
 * Scales across multiple server instances.
 * 
 * Design:
 * - Uses PostgreSQL for persistence (works across instances)
 * - Atomic insert-on-conflict for race-condition safety
 * - Falls back to in-memory cache if DB unavailable
 * - Automatic cleanup of old entries
 */

import { db } from '../db';
import { slackEventDedupe } from '@shared/schema';
import { lt, sql } from 'drizzle-orm';

const DEDUPE_TTL_HOURS = 1;
const memoryFallback = new Map<string, number>();
const MAX_MEMORY_SIZE = 500;

/**
 * Check if an event has been processed before using atomic INSERT.
 * Uses INSERT ... ON CONFLICT to atomically detect and mark duplicates.
 * 
 * @returns true if duplicate (already processed), false if new
 */
export async function isDuplicate(eventId: string, clientMsgId?: string): Promise<boolean> {
  // Filter out empty/undefined keys
  const keys: string[] = [];
  if (eventId && eventId.trim()) keys.push(eventId.trim());
  if (clientMsgId && clientMsgId.trim()) keys.push(`msg:${clientMsgId.trim()}`);

  // No valid keys = can't dedupe, treat as new
  if (keys.length === 0) {
    console.log(`[Dedupe] No valid keys provided, allowing through`);
    return false;
  }

  try {
    // Atomic check: Try to insert, check if it was actually inserted
    // If insert succeeds = new event, if conflict = duplicate
    for (const key of keys) {
      const result = await db.execute(sql`
        INSERT INTO slack_event_dedupe (id, processed_at)
        VALUES (${key}, NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `);
      
      // If no row returned, the INSERT was skipped due to conflict = duplicate
      if (result.rows.length === 0) {
        console.log(`[Dedupe] Duplicate detected (DB atomic): ${key}`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.log(`[Dedupe] DB error, falling back to memory: ${error}`);
    return isDuplicateMemory(keys);
  }
}

function isDuplicateMemory(keys: string[]): boolean {
  if (memoryFallback.size > MAX_MEMORY_SIZE) {
    const cutoff = Date.now() - (DEDUPE_TTL_HOURS * 60 * 60 * 1000);
    memoryFallback.forEach((timestamp, key) => {
      if (timestamp < cutoff) memoryFallback.delete(key);
    });
  }

  for (const key of keys) {
    if (memoryFallback.has(key)) {
      console.log(`[Dedupe] Duplicate detected (memory): ${key}`);
      return true;
    }
  }

  const now = Date.now();
  keys.forEach(key => memoryFallback.set(key, now));
  return false;
}

/**
 * Cleanup old entries from the database.
 * Call this periodically (e.g., via cron or after N requests).
 */
export async function cleanupOldEntries(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - (DEDUPE_TTL_HOURS * 60 * 60 * 1000));
    const entriesToDelete = await db.select({ id: slackEventDedupe.id })
      .from(slackEventDedupe)
      .where(lt(slackEventDedupe.processedAt, cutoff));
    
    if (entriesToDelete.length > 0) {
      await db.delete(slackEventDedupe)
        .where(lt(slackEventDedupe.processedAt, cutoff));
      console.log(`[Dedupe] Cleaned up ${entriesToDelete.length} old entries`);
    }
    return entriesToDelete.length;
  } catch (error) {
    console.log(`[Dedupe] Cleanup error: ${error}`);
    return 0;
  }
}

let cleanupCounter = 0;
const CLEANUP_INTERVAL = 100;
let startupCleanupDone = false;

/**
 * Trigger cleanup periodically based on request count.
 * Also runs cleanup on first call (startup).
 */
export function maybeCleanup(): void {
  // Run cleanup on startup
  if (!startupCleanupDone) {
    startupCleanupDone = true;
    cleanupOldEntries().catch(() => {});
    return;
  }

  cleanupCounter++;
  if (cleanupCounter >= CLEANUP_INTERVAL) {
    cleanupCounter = 0;
    cleanupOldEntries().catch(() => {});
  }
}

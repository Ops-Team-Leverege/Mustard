/**
 * Meeting Utilities
 * 
 * Shared utility functions for meeting scope resolution.
 * Deterministic parsing - no LLM calls.
 */

import type { SingleMeetingContext } from "./types";

/**
 * Meeting-like words that users use to refer to meetings.
 */
const MEETING_WORDS = "meeting|call|transcript|sync|session|conversation|chat|touchpoint|demo|visit";

/**
 * Temporal language patterns for meeting resolution.
 * 
 * These patterns detect when a user is asking about a specific meeting
 * using temporal language. When matched, the system should attempt
 * single-meeting resolution.
 */
export const TEMPORAL_PATTERNS = {
  lastMeetingDirect: new RegExp(`\\b(last|latest|most recent)\\s+(${MEETING_WORDS})\\b`, 'i'),
  lastMeetingWithCompany: new RegExp(`\\b(last|latest|most recent)\\s+\\S+(?:\\s+\\S+)?\\s+(${MEETING_WORDS})\\b`, 'i'),
  lastMeetingWithSuffix: new RegExp(`\\b(last|latest|most recent)\\s+(${MEETING_WORDS})\\s+(?:with|from)\\s+`, 'i'),
  dateReference: new RegExp(`\\b(${MEETING_WORDS})\\s+(?:on|from)\\s+(\\w+\\s+\\d{1,2}(?:,?\\s*\\d{4})?|\\d{1,2}(?:\\/|-)\\d{1,2}(?:(?:\\/|-)\\d{2,4})?)\\b`, 'i'),
  lastWeek: new RegExp(`\\b(${MEETING_WORDS})\\s+last\\s+week\\b`, 'i'),
  lastMonth: new RegExp(`\\b(${MEETING_WORDS})\\s+last\\s+month\\b`, 'i'),
  inTheLast: /\b(?:in|from|during)\s+(?:the|our|their)?\s*(last|latest|most recent)\s+/i,
  recentWithCompany: new RegExp(`\\b(?:our|the)?\\s*recent\\s+\\S+(?:\\s+\\S+)?\\s+(${MEETING_WORDS})\\b`, 'i'),
  companyThenTemporal: new RegExp(`\\b\\w+(?:\\s+\\w+)?,\\s*(last|latest|recent)\\s+(${MEETING_WORDS})`, 'i'),
};

/**
 * Check if message contains temporal meeting reference.
 */
export function hasTemporalMeetingReference(message: string): boolean {
  return Object.values(TEMPORAL_PATTERNS).some(pattern => pattern.test(message));
}

/**
 * Format meeting date for display in responses.
 */
export function formatMeetingDate(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Get meeting date suffix for responses (e.g., " (Jan 20, 2026)")
 */
export function getMeetingDateSuffix(ctx: SingleMeetingContext): string {
  if (ctx.meetingDate) {
    return ` (${formatMeetingDate(ctx.meetingDate)})`;
  }
  return "";
}

/**
 * Patterns indicating user wants ALL customers (no filtering by company).
 */
export const ALL_CUSTOMERS_PATTERNS = [
  /\b(all\s+customers?|every\s+customer|across\s+all|everyone|all\s+calls?|all\s+meetings?)\b/i,
  /\b(across\s+customers?|across\s+companies|across\s+the\s+board)\b/i,
  /\b(our\s+meetings?|our\s+calls?|we'?ve\s+had)\b/i,
  /\b(\d+|three|two|four|five|six|seven|eight|nine|ten)\s+(most\s+)?recent\s+(meetings?|calls?)\b/i,
  /\b(most\s+)?recent\s+(meetings?|calls?)\b/i,
];

/**
 * Check if message indicates user wants all customers scope.
 */
export function wantsAllCustomers(message: string): boolean {
  return ALL_CUSTOMERS_PATTERNS.some(p => p.test(message));
}

/**
 * Extract topic from user message (e.g., "about cameras" → "cameras").
 */
export function extractTopic(message: string): string | undefined {
  const aboutMatch = message.match(/\babout\s+([^?.,!]+)/i);
  if (aboutMatch) {
    return aboutMatch[1].trim();
  }
  
  const regardingMatch = message.match(/\bregarding\s+([^?.,!]+)/i);
  if (regardingMatch) {
    return regardingMatch[1].trim();
  }
  
  return undefined;
}

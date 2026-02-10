/**
 * Progress Manager
 * 
 * Manages progress messages sent to Slack during long-running operations.
 * Provides recurring timer-based messages with a maximum count.
 */

import { postSlackMessage } from "../slackApi";
import { getProgressMessage, getProgressDelayMs, generatePersonalizedProgressMessage, type ProgressIntentType } from "../progressMessages";
import { PROGRESS_MESSAGE_CONSTANTS } from "../../config/constants";

export interface ProgressContext {
  channel: string;
  threadTs: string;
  testRun: boolean;
}

export interface ProgressManager {
  start(): void;
  stop(): void;
  getCount(): number;
  canPost(): boolean;
  markResponseSent(): void;
  sendPersonalizedProgress(userMessage: string, intentType: ProgressIntentType): Promise<void>;
}

const MAX_PROGRESS_MESSAGES = PROGRESS_MESSAGE_CONSTANTS.MAX_PROGRESS_MESSAGES;

/**
 * Create a progress manager for a Slack thread.
 * Sends periodic progress messages during long-running operations.
 * Uses response coordination to prevent progress messages after response is sent.
 */
export function createProgressManager(ctx: ProgressContext): ProgressManager {
  let progressMessageCount = 0;
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  let responseSent = false;
  
  const canPostInternal = () => !responseSent && progressMessageCount < MAX_PROGRESS_MESSAGES;
  
  return {
    start() {
      if (ctx.testRun || progressInterval) {
        return;
      }
      
      progressInterval = setInterval(async () => {
        // Check coordination flag before posting
        if (!canPostInternal()) {
          return;
        }
        try {
          const progressMsg = getProgressMessage();
          // Double-check after await to prevent race
          if (responseSent) return;
          await postSlackMessage({
            channel: ctx.channel,
            text: progressMsg,
            thread_ts: ctx.threadTs,
          });
          progressMessageCount++;
          console.log(`[Slack] Progress message #${progressMessageCount} sent`);
        } catch (err) {
          console.error("[Slack] Failed to send progress message:", err);
        }
      }, getProgressDelayMs());
    },
    
    stop() {
      responseSent = true; // Prevent any in-flight progress from posting
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    },
    
    getCount() {
      return progressMessageCount;
    },
    
    canPost() {
      return canPostInternal();
    },
    
    markResponseSent() {
      responseSent = true;
    },
    
    async sendPersonalizedProgress(userMessage: string, intentType: ProgressIntentType) {
      // Check coordination flag before doing any work
      if (!canPostInternal()) {
        console.log(`[Slack] Personalized progress skipped - response already sent or max reached`);
        return;
      }
      
      if (ctx.testRun) {
        return;
      }
      
      try {
        const personalizedMsg = await generatePersonalizedProgressMessage(userMessage, intentType);
        // Double-check after async operation
        if (responseSent) {
          console.log(`[Slack] Personalized progress skipped (post-generation) - response sent during generation`);
          return;
        }
        await postSlackMessage({
          channel: ctx.channel,
          text: personalizedMsg,
          thread_ts: ctx.threadTs,
        });
        progressMessageCount++;
        console.log(`[Slack] Personalized progress message sent for intent: ${intentType}`);
      } catch (err) {
        console.error("[Slack] Failed to send personalized progress:", err);
      }
    },
  };
}

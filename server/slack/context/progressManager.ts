/**
 * Progress Manager
 * 
 * Manages progress messages sent to Slack during long-running operations.
 * Provides recurring timer-based messages with a maximum count.
 */

import { postSlackMessage } from "../slackApi";
import { getProgressMessage, getProgressDelayMs, generatePersonalizedProgressMessage, type ProgressIntentType } from "../progressMessages";

export interface ProgressContext {
  channel: string;
  threadTs: string;
  testRun: boolean;
}

export interface ProgressManager {
  start(): void;
  stop(): void;
  getCount(): number;
  sendPersonalizedProgress(userMessage: string, intentType: ProgressIntentType): Promise<void>;
}

const MAX_PROGRESS_MESSAGES = 4;

/**
 * Create a progress manager for a Slack thread.
 * Sends periodic progress messages during long-running operations.
 */
export function createProgressManager(ctx: ProgressContext): ProgressManager {
  let progressMessageCount = 0;
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  
  return {
    start() {
      if (ctx.testRun || progressInterval) {
        return;
      }
      
      progressInterval = setInterval(async () => {
        if (progressMessageCount >= MAX_PROGRESS_MESSAGES) {
          return; // Stop sending after max reached
        }
        try {
          const progressMsg = getProgressMessage();
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
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    },
    
    getCount() {
      return progressMessageCount;
    },
    
    async sendPersonalizedProgress(userMessage: string, intentType: ProgressIntentType) {
      if (ctx.testRun || progressMessageCount > 0) {
        // Skip if in test mode or generic messages already sent
        return;
      }
      
      try {
        const personalizedMsg = await generatePersonalizedProgressMessage(userMessage, intentType);
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

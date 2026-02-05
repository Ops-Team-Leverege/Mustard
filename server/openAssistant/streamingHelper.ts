/**
 * Streaming Helper
 * 
 * Provides streaming OpenAI responses with Slack message updates.
 * Posts an initial message and updates it as content streams in.
 * 
 * Configuration: config/streaming.json
 */

import { OpenAI } from "openai";
import { updateSlackMessage } from "../slack/slackApi";
import * as fs from "fs";
import * as path from "path";

interface StreamingConfig {
  preview: {
    enabled: boolean;
    maxVisibleChars: number;
    minParagraphLength: number;
    message: string;
  };
  updates: {
    intervalMs: number;
    minContentForUpdate: number;
  };
}

let configCache: StreamingConfig | null = null;

export function getStreamingConfig(): StreamingConfig {
  if (configCache) return configCache;
  
  const configPath = path.join(process.cwd(), 'config', 'streaming.json');
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    configCache = JSON.parse(configContent) as StreamingConfig;
  } catch (error) {
    console.warn(`[StreamingHelper] Config not found, using defaults`);
    configCache = {
      preview: {
        enabled: true,
        maxVisibleChars: 350,
        minParagraphLength: 50,
        message: "Full details in the attached document below."
      },
      updates: {
        intervalMs: 1500,
        minContentForUpdate: 100
      }
    };
  }
  return configCache;
}

export function clearStreamingConfigCache(): void {
  configCache = null;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type StreamingContext = {
  channel: string;
  messageTs: string;
  threadTs: string;
  /** If set, streaming will show only this many chars before switching to "preparing document..." */
  previewMode?: {
    maxVisibleChars: number;
    message: string;
  };
};

export type StreamingResult = {
  content: string;
  streamingUsed: boolean;
  finalUpdateSucceeded: boolean;
};

/**
 * Stream an OpenAI response and update a Slack message incrementally.
 * 
 * @param model - OpenAI model to use
 * @param systemPrompt - System prompt
 * @param userMessage - User message
 * @param streamingContext - Slack context for message updates (optional)
 * @returns StreamingResult with content, whether streaming was used, and if final update succeeded
 */
export async function streamOpenAIResponse(
  model: string,
  systemPrompt: string,
  userMessage: string,
  streamingContext?: StreamingContext
): Promise<string> {
  const startTime = Date.now();
  
  // If no streaming context, fall back to non-streaming
  if (!streamingContext) {
    console.log(`[StreamingHelper] No streaming context, using non-streaming call`);
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });
    const content = response.choices[0]?.message?.content || "";
    console.log(`[StreamingHelper] Non-streaming completed in ${Date.now() - startTime}ms`);
    return content;
  }
  
  console.log(`[StreamingHelper] Starting streaming response with Slack updates...`);
  
  const stream = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: true,
  });
  
  const { STREAMING } = await import("../config/constants");
  
  let accumulatedContent = "";
  let lastUpdateTime = Date.now();
  const UPDATE_INTERVAL_MS = STREAMING.UPDATE_INTERVAL_MS;
  const MIN_CONTENT_FOR_UPDATE = STREAMING.MIN_CONTENT_FOR_UPDATE;
  
  // Preview mode: track if we've hit the limit and switched to "preparing document" message
  const previewMode = streamingContext.previewMode;
  let previewLimitReached = false;
  
  // Load config for preview settings
  clearStreamingConfigCache();
  const streamingConfig = getStreamingConfig();
  const minParagraphLength = streamingConfig.preview.minParagraphLength;
  
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || "";
    accumulatedContent += delta;
    
    // Update Slack message periodically
    const now = Date.now();
    if (
      accumulatedContent.length >= MIN_CONTENT_FOR_UPDATE &&
      now - lastUpdateTime >= UPDATE_INTERVAL_MS
    ) {
      try {
        // If preview mode and we've exceeded the limit, show preview + message
        if (previewMode && accumulatedContent.length > previewMode.maxVisibleChars) {
          if (!previewLimitReached) {
            // First time hitting limit - extract first paragraph only
            // Look for double newline (paragraph break) or list start (numbered/bulleted)
            const paragraphEnd = accumulatedContent.indexOf('\n\n');
            const listStart = accumulatedContent.search(/\n[•\-\*\d]/);
            
            let preview: string;
            if (paragraphEnd > minParagraphLength && paragraphEnd < previewMode.maxVisibleChars) {
              // Use first paragraph
              preview = accumulatedContent.substring(0, paragraphEnd);
            } else if (listStart > minParagraphLength && listStart < previewMode.maxVisibleChars) {
              // Cut before list starts
              preview = accumulatedContent.substring(0, listStart);
            } else {
              // Fallback: truncate at last sentence
              preview = accumulatedContent.substring(0, previewMode.maxVisibleChars);
              const lastPeriod = preview.lastIndexOf('. ');
              if (lastPeriod > minParagraphLength) {
                preview = preview.substring(0, lastPeriod + 1);
              }
            }
            
            await updateSlackMessage({
              channel: streamingContext.channel,
              ts: streamingContext.messageTs,
              text: `${preview.trim()}\n\n_${previewMode.message}_`,
            });
            previewLimitReached = true;
            console.log(`[StreamingHelper] Preview: first paragraph (${preview.length} chars)`);
          }
          // Don't update further - keep showing the preview message
        } else {
          // Normal streaming - show all content
          await updateSlackMessage({
            channel: streamingContext.channel,
            ts: streamingContext.messageTs,
            text: accumulatedContent + " ...",
          });
        }
        lastUpdateTime = now;
        console.log(`[StreamingHelper] Updated message with ${accumulatedContent.length} chars`);
      } catch (err) {
        console.error(`[StreamingHelper] Failed to update message:`, err);
      }
    }
  }
  
  // Final update without the spinner
  let finalUpdateSucceeded = false;
  if (streamingContext && accumulatedContent) {
    try {
      // If preview mode was used and limit was reached, keep the preview message
      // (document generation will update it later)
      if (previewLimitReached) {
        console.log(`[StreamingHelper] Preview mode - skipping final full-content update`);
        finalUpdateSucceeded = true;
      } else {
        await updateSlackMessage({
          channel: streamingContext.channel,
          ts: streamingContext.messageTs,
          text: accumulatedContent,
        });
        finalUpdateSucceeded = true;
        console.log(`[StreamingHelper] Final update sent successfully`);
      }
    } catch (err) {
      console.error(`[StreamingHelper] Failed final update:`, err);
      // Caller should handle fallback posting
    }
  } else if (streamingContext && !accumulatedContent) {
    // Empty response - update placeholder with error message
    try {
      await updateSlackMessage({
        channel: streamingContext.channel,
        ts: streamingContext.messageTs,
        text: "I'm sorry, I wasn't able to generate a response. Please try again.",
      });
      finalUpdateSucceeded = true;
      console.log(`[StreamingHelper] Empty response - posted fallback message`);
    } catch (err) {
      console.error(`[StreamingHelper] Failed to post fallback:`, err);
    }
  }
  
  console.log(`[StreamingHelper] Streaming completed in ${Date.now() - startTime}ms (${accumulatedContent.length} chars, finalUpdate=${finalUpdateSucceeded})`);
  return accumulatedContent;
}

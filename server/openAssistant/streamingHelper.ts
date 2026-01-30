/**
 * Streaming Helper
 * 
 * Provides streaming OpenAI responses with Slack message updates.
 * Posts an initial message and updates it as content streams in.
 */

import { OpenAI } from "openai";
import { updateSlackMessage } from "../slack/slackApi";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type StreamingContext = {
  channel: string;
  messageTs: string;
  threadTs: string;
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
        await updateSlackMessage({
          channel: streamingContext.channel,
          ts: streamingContext.messageTs,
          text: accumulatedContent + " ...",
        });
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
      await updateSlackMessage({
        channel: streamingContext.channel,
        ts: streamingContext.messageTs,
        text: accumulatedContent,
      });
      finalUpdateSucceeded = true;
      console.log(`[StreamingHelper] Final update sent successfully`);
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

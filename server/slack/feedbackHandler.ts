/**
 * Feedback Handler
 * 
 * Handles Slack reaction events for user feedback on bot responses.
 * Classifies reactions as positive/negative and logs them for evaluation.
 * Sends notifications for negative feedback.
 * 
 * SAFETY: Gracefully handles storage backend failures to prevent crashes.
 */

import { storage } from "../storage";
import { postSlackMessage } from "./slackApi";
import feedbackConfig from "../../config/feedback.json";
import OpenAI from "openai";
import { LLM_MODELS } from "../config/models";

type FeedbackConfig = {
    emojis: {
        positive: string[];
        negative: string[];
    };
    useLLMForUnknownEmojis: boolean;
    notificationChannel: string;
    notificationSettings: {
        enabled: boolean;
        includeThreadLink: boolean;
        includePromptVersions: boolean;
        includeEvidenceSources: boolean;
    };
};

const config = feedbackConfig as FeedbackConfig;

/**
 * Classify an emoji using LLM.
 * Fallback for emojis not in the config file.
 */
async function classifyEmojiWithLLM(emoji: string): Promise<"positive" | "negative" | "unknown"> {
    try {
        const openai = new OpenAI();

        const response = await openai.chat.completions.create({
            model: LLM_MODELS.FAST_CLASSIFICATION,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [{
                role: "system",
                content: `You classify emoji reactions as positive, negative, or neutral feedback.

Positive = User likes/approves (thumbs up, check marks, hearts, celebration, etc.)
Negative = User dislikes/disapproves (X, thumbs down, warning signs, etc.)
Neutral = Unclear sentiment or informational (eyes, thinking, etc.)

Return JSON: {"sentiment": "positive" | "negative" | "neutral", "confidence": "high" | "medium" | "low"}`
            }, {
                role: "user",
                content: `Classify this emoji reaction: ${emoji}`
            }]
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
            console.log(`[Feedback] LLM returned no content for emoji: ${emoji}`);
            return "unknown";
        }

        const result = JSON.parse(content);
        const sentiment = result.sentiment;
        const confidence = result.confidence;

        console.log(`[Feedback] LLM classified "${emoji}" as ${sentiment} (confidence: ${confidence})`);

        // Only use high/medium confidence classifications
        if (confidence === "low") {
            console.log(`[Feedback] Low confidence classification - treating as unknown`);
            return "unknown";
        }

        return sentiment === "neutral" ? "unknown" : sentiment;
    } catch (error) {
        console.error(`[Feedback] Error classifying emoji with LLM:`, error);
        return "unknown";
    }
}

/**
 * Classify an emoji as positive, negative, or unknown.
 * Uses config file first (fast path), then LLM for unknown emojis (slow path).
 */
async function classifyEmoji(emoji: string): Promise<"positive" | "negative" | "unknown"> {
    const normalized = emoji.replace(/:/g, ""); // Remove colons if present
    const baseEmoji = normalized.split("::")[0]; // Strip skin-tone variants (e.g., "+1::skin-tone-2" → "+1")

    // Fast path: Check config first (try both full and base emoji)
    if (config.emojis.positive.includes(normalized) || config.emojis.positive.includes(baseEmoji)) {
        console.log(`[Feedback] Config classified "${emoji}" as positive`);
        return "positive";
    }

    if (config.emojis.negative.includes(normalized) || config.emojis.negative.includes(baseEmoji)) {
        console.log(`[Feedback] Config classified "${emoji}" as negative`);
        return "negative";
    }

    // Slow path: Ask LLM for unknown emojis (if enabled)
    if (config.useLLMForUnknownEmojis) {
        console.log(`[Feedback] Emoji "${emoji}" not in config - using LLM classification`);
        return await classifyEmojiWithLLM(emoji);
    }

    console.log(`[Feedback] Emoji "${emoji}" not in config and LLM disabled - treating as unknown`);
    return "unknown";
}

/**
 * Handle a reaction_added event from Slack.
 * 
 * SAFETY: Wrapped in try-catch with graceful degradation for unsupported storage backends.
 */
export async function handleReactionAdded(event: {
    user: string;
    reaction: string;
    item: {
        type: string;
        channel: string;
        ts: string;
    };
}): Promise<void> {
    try {
        // Only handle message reactions
        if (event.item.type !== "message") {
            console.log(`[Feedback] Ignoring non-message reaction: ${event.item.type}`);
            return;
        }

        const { user: userId, reaction: emoji, item } = event;
        const { channel, ts: messageTs } = item;

        console.log(`[Feedback] Reaction added: ${emoji} by ${userId} on message ${messageTs}`);

        // Classify the emoji (async - may use LLM for unknown emojis)
        const sentiment = await classifyEmoji(emoji);
        if (sentiment === "unknown") {
            console.log(`[Feedback] Ignoring unknown emoji: ${emoji}`);
            return;
        }

        console.log(`[Feedback] Final classification: ${sentiment}`);

        // Find the interaction this reaction is for
        // SAFETY: Catch "not supported" errors from MemStorage
        let interaction;
        try {
            interaction = await storage.getInteractionByMessageTs(messageTs);
        } catch (error: any) {
            if (error.message?.includes("not supported")) {
                console.log(`[Feedback] Storage backend does not support feedback tracking - skipping`);
                return;
            }
            throw error; // Re-throw other errors
        }

        if (!interaction) {
            console.log(`[Feedback] No interaction found for message ${messageTs}`);
            return;
        }

        console.log(`[Feedback] Found interaction: ${interaction.id}`);

        // Check if user already reacted with this emoji (prevent duplicates)
        // SAFETY: Gracefully handle if duplicate checking not supported
        let alreadyReacted = false;
        try {
            alreadyReacted = await storage.hasUserReacted(interaction.id, userId, emoji);
        } catch (error: any) {
            if (error.message?.includes("not supported")) {
                console.log(`[Feedback] Storage backend does not support duplicate checking - proceeding anyway`);
            } else {
                throw error;
            }
        }

        if (alreadyReacted) {
            console.log(`[Feedback] User ${userId} already reacted with ${emoji} to interaction ${interaction.id}`);
            return;
        }

        // Store the feedback
        // SAFETY: Catch "not supported" errors to prevent crash
        try {
            await storage.insertInteractionFeedback({
                interactionId: interaction.id,
                slackMessageTs: messageTs,
                userId,
                emoji,
                sentiment,
                intent: interaction.intent,
                answerContract: interaction.answerContract,
                promptVersions: interaction.promptVersions,
            });

            console.log(`[Feedback] Stored ${sentiment} feedback for interaction ${interaction.id}`);

            // Send notification for negative feedback
            if (sentiment === "negative" && config.notificationSettings.enabled) {
                await sendNegativeFeedbackNotification(interaction, userId, emoji, channel, messageTs);
            }
        } catch (error: any) {
            if (error.message?.includes("not supported")) {
                console.log(`[Feedback] Storage backend does not support feedback tracking - skipping notification`);
                return;
            }
            throw error;
        }
    } catch (error) {
        console.error("[Feedback] Error handling reaction:", error);
        // Don't re-throw - we don't want a reaction to crash the event handler
    }
}

/**
 * Send a notification to the operations channel for negative feedback.
 */
async function sendNegativeFeedbackNotification(
    interaction: any,
    userId: string,
    emoji: string,
    channel: string,
    messageTs: string
): Promise<void> {
    try {
        const threadLink = messageTs
            ? `https://slack.com/archives/${channel}/p${messageTs.replace(".", "")}`
            : null;

        let message = `*Negative Feedback Received*\n\n`;
        message += `*User:* <@${userId}>\n`;
        message += `*Reaction:* :${emoji}:\n`;
        message += `*Intent:* ${interaction.intent || "unknown"}\n`;
        message += `*Contract:* ${interaction.answerContract || "unknown"}\n\n`;

        message += `*Question:*\n> ${interaction.questionText || "(no question recorded)"}\n\n`;

        const answerText = interaction.answerText || "(no answer recorded)";
        message += `*Answer:*\n> ${answerText.substring(0, 500)}${answerText.length > 500 ? "..." : ""}\n\n`;

        if (config.notificationSettings.includePromptVersions && interaction.promptVersions) {
            message += `*Prompt Versions:*\n`;
            const versions = interaction.promptVersions as Record<string, string>;
            for (const [promptName, version] of Object.entries(versions)) {
                message += `- ${promptName}: \`${version}\`\n`;
            }
            message += `\n`;
        }

        if (config.notificationSettings.includeEvidenceSources && interaction.evidenceSources) {
            const sources = interaction.evidenceSources as Array<{ type: string; id?: string }>;
            if (sources.length > 0) {
                message += `*Evidence Sources:* ${sources.map(s => s.type).join(", ")}\n\n`;
            }
        }

        if (config.notificationSettings.includeThreadLink && threadLink) {
            message += `<${threadLink}|View Thread>`;
        }

        await postSlackMessage({ channel: config.notificationChannel, text: message });
        console.log(`[Feedback] Sent negative feedback notification to ${config.notificationChannel}`);
    } catch (error) {
        console.error("[Feedback] Error sending notification:", error);
        // Don't re-throw - notification failure shouldn't crash the handler
    }
}

/**
 * Handle a reaction_removed event from Slack.
 * Currently just logs - could be extended to remove feedback records.
 */
export async function handleReactionRemoved(event: {
    user: string;
    reaction: string;
    item: {
        type: string;
        channel: string;
        ts: string;
    };
}): Promise<void> {
    console.log(`[Feedback] Reaction removed: ${event.reaction} by ${event.user} on message ${event.item.ts}`);
    // Could implement feedback removal here if needed
}

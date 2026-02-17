/**
 * Feedback Handler
 * 
 * Handles Slack reaction events for user feedback on bot responses.
 * Classifies reactions as positive/negative and logs them for evaluation.
 * Sends notifications for negative feedback.
 */

import { storage } from "../storage";
import { postSlackMessage } from "./slackApi";
import feedbackConfig from "../../config/feedback.json";

type FeedbackConfig = {
    emojis: {
        positive: string[];
        negative: string[];
    };
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
 * Classify an emoji as positive, negative, or unknown.
 */
function classifyEmoji(emoji: string): "positive" | "negative" | "unknown" {
    const normalized = emoji.replace(/:/g, ""); // Remove colons if present

    if (config.emojis.positive.includes(normalized)) {
        return "positive";
    }

    if (config.emojis.negative.includes(normalized)) {
        return "negative";
    }

    return "unknown";
}

/**
 * Handle a reaction_added event from Slack.
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

        // Classify the emoji
        const sentiment = classifyEmoji(emoji);
        if (sentiment === "unknown") {
            console.log(`[Feedback] Ignoring unknown emoji: ${emoji}`);
            return;
        }

        console.log(`[Feedback] Classified as: ${sentiment}`);

        // Find the interaction this reaction is for
        const interaction = await storage.getInteractionByMessageTs(messageTs);
        if (!interaction) {
            console.log(`[Feedback] No interaction found for message ${messageTs}`);
            return;
        }

        console.log(`[Feedback] Found interaction: ${interaction.id}`);

        // Check if user already reacted with this emoji (prevent duplicates)
        const alreadyReacted = await storage.hasUserReacted(interaction.id, userId, emoji);
        if (alreadyReacted) {
            console.log(`[Feedback] User ${userId} already reacted with ${emoji} to interaction ${interaction.id}`);
            return;
        }

        // Store the feedback
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
    } catch (error) {
        console.error("[Feedback] Error handling reaction:", error);
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
        const threadLink = `https://slack.com/archives/${channel}/p${messageTs.replace(".", "")}`;

        let message = `🚨 *Negative Feedback Received*\n\n`;
        message += `*User:* <@${userId}>\n`;
        message += `*Reaction:* :${emoji}:\n`;
        message += `*Intent:* ${interaction.intent || "unknown"}\n`;
        message += `*Contract:* ${interaction.answerContract || "unknown"}\n\n`;

        message += `*Question:*\n> ${interaction.questionText}\n\n`;

        message += `*Answer:*\n> ${interaction.answerText?.substring(0, 500)}${interaction.answerText?.length > 500 ? "..." : ""}\n\n`;

        if (config.notificationSettings.includePromptVersions && interaction.promptVersions) {
            message += `*Prompt Versions:*\n`;
            const versions = interaction.promptVersions as Record<string, string>;
            for (const [promptName, version] of Object.entries(versions)) {
                message += `• ${promptName}: \`${version}\`\n`;
            }
            message += `\n`;
        }

        if (config.notificationSettings.includeEvidenceSources && interaction.evidenceSources) {
            const sources = interaction.evidenceSources as Array<{ type: string; id?: string }>;
            if (sources.length > 0) {
                message += `*Evidence Sources:* ${sources.map(s => s.type).join(", ")}\n\n`;
            }
        }

        if (config.notificationSettings.includeThreadLink) {
            message += `<${threadLink}|View Thread>`;
        }

        await postSlackMessage(config.notificationChannel, message);
        console.log(`[Feedback] Sent negative feedback notification to ${config.notificationChannel}`);
    } catch (error) {
        console.error("[Feedback] Error sending notification:", error);
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

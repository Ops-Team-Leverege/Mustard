/**
 * Slack Search Handler
 * 
 * Purpose:
 * Handles SLACK_SEARCH intent - searches Slack messages and channels.
 * This is separate from the Slack events integration (server/slack/)
 * which handles incoming webhooks.
 * 
 * This handler searches Slack as a DATA SOURCE, not for receiving events.
 * 
 * Layer: Execution Plane (Open Assistant)
 */

import { SlackSearchService, type SlackSearchResult, type SlackChannel } from '../services/slackSearchService';
import { AnswerContract } from '../decisionLayer/answerContracts';
import type { OpenAssistantResult } from './types';

export interface SlackSearchContext {
    question: string;
    contract: AnswerContract;
}

export class SlackSearchHandler {
    /**
     * Handle Slack search queries.
     * Routes to appropriate handler based on contract.
     */
    static async handleSlackSearch(context: SlackSearchContext): Promise<OpenAssistantResult> {
        const { question, contract } = context;

        console.log(`[SlackSearchHandler] Handling ${contract} for: "${question}"`);

        try {
            switch (contract) {
                case AnswerContract.SLACK_MESSAGE_SEARCH:
                    return await this.handleMessageSearch(question);

                case AnswerContract.SLACK_CHANNEL_INFO:
                    return await this.handleChannelInfo(question);

                default:
                    // Default to message search
                    return await this.handleMessageSearch(question);
            }
        } catch (error) {
            console.error('[SlackSearchHandler] Error:', error);
            return {
                answer: `I encountered an error searching Slack: ${error instanceof Error ? error.message : 'Unknown error'}`,
                dataSource: 'slack',
                intent: 'slack_search',
                coverage: {
                    messagesSearched: 0,
                    channelsSearched: 0,
                },
            };
        }
    }

    /**
     * Handle message search queries.
     * Searches Slack and synthesizes findings into a coherent answer with metadata.
     */
    private static async handleMessageSearch(question: string): Promise<OpenAssistantResult> {
        // Extract search query from question
        const searchQuery = this.extractSearchQuery(question);

        console.log(`[SlackSearchHandler] Searching for: "${searchQuery}"`);

        // Search Slack
        const searchResponse = await SlackSearchService.searchMessages({
            query: searchQuery,
            limit: 20,
        });

        if (searchResponse.results.length === 0) {
            return {
                answer: `No messages found in Slack matching "${searchQuery}".`,
                dataSource: 'slack',
                intent: 'slack_search',
                coverage: {
                    messagesSearched: 0,
                    channelsSearched: 0,
                },
            };
        }

        // Get unique channels
        const uniqueChannels = new Set(searchResponse.results.map(r => r.channelId));

        // Synthesize findings into a coherent answer with metadata
        const synthesizedAnswer = await this.synthesizeSlackFindings(
            question,
            searchQuery,
            searchResponse.results,
            searchResponse.totalCount,
            uniqueChannels.size,
            searchResponse.hasMore
        );

        return {
            answer: synthesizedAnswer,
            dataSource: 'slack',
            intent: 'slack_search',
            coverage: {
                messagesSearched: searchResponse.results.length,
                channelsSearched: uniqueChannels.size,
                totalAvailable: searchResponse.totalCount,
                hasMore: searchResponse.hasMore,
                note: searchResponse.hasMore
                    ? "Showing top 20 results. Try refining your search for more specific results."
                    : undefined,
            },
        };
    }

    /**
     * Handle channel info queries.
     */
    private static async handleChannelInfo(question: string): Promise<OpenAssistantResult> {
        const searchQuery = this.extractSearchQuery(question);

        console.log(`[SlackSearchHandler] Searching channels for: "${searchQuery}"`);

        const channels = await SlackSearchService.searchChannels(searchQuery);

        if (channels.length === 0) {
            return {
                answer: `No channels found matching "${searchQuery}".`,
                dataSource: 'slack',
                intent: 'slack_search',
                coverage: {
                    channelsSearched: 0,
                },
            };
        }

        const formattedAnswer = this.formatChannelResults(channels, searchQuery);

        return {
            answer: formattedAnswer,
            dataSource: 'slack',
            intent: 'slack_search',
            coverage: {
                channelsSearched: channels.length,
            },
        };
    }

    /**
     * Synthesize Slack search results into a coherent answer using LLM.
     * Similar to how Claude synthesizes information from multiple sources.
     */
    private static async synthesizeSlackFindings(
        originalQuestion: string,
        searchQuery: string,
        results: SlackSearchResult[],
        totalCount: number,
        channelsSearched: number,
        hasMore: boolean
    ): Promise<string> {
        const { OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

        // Group messages by channel for context
        const channelGroups = new Map<string, SlackSearchResult[]>();
        results.forEach(msg => {
            const existing = channelGroups.get(msg.channelName) || [];
            existing.push(msg);
            channelGroups.set(msg.channelName, existing);
        });

        // Prepare context from Slack messages
        const messagesContext = results.map((msg, idx) => {
            return `[Message ${idx + 1} from #${msg.channelName}]
${msg.text}
Link: ${msg.permalink || 'N/A'}`;
        }).join('\n\n');

        const channelSummary = Array.from(channelGroups.entries())
            .map(([channel, msgs]) => `#${channel} (${msgs.length} messages)`)
            .join(', ');

        const prompt = `You are analyzing Slack messages to answer a user's question.

User's Question: "${originalQuestion}"

Search Metadata:
- Found ${results.length} messages (${totalCount} total available)
- Searched ${channelsSearched} channels: ${channelSummary}
${hasMore ? '- More results available (showing top 20)' : ''}

Slack Messages:
${messagesContext}

Instructions:
1. Start with a brief summary of what you found (e.g., "Based on ${results.length} messages across ${channelsSearched} channels...")
2. Synthesize the key information that answers the user's question
3. Quote specific relevant excerpts when helpful (use quotes: "...")
4. List the most relevant sources at the end with their Slack links
5. If there are many messages, focus on the most relevant ones
6. End with a coverage note: "📊 Searched ${channelsSearched} channels, found ${results.length} messages${hasMore ? ` (${totalCount} total available)` : ''}"

Keep the answer focused and actionable.`;

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that synthesizes information from Slack messages.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 1500,
            });

            const synthesized = response.choices[0]?.message?.content || '';

            if (!synthesized) {
                // Fallback to simple formatting if LLM fails
                return this.formatMessageResults(results, searchQuery);
            }

            return synthesized;
        } catch (error) {
            console.error('[SlackSearchHandler] Synthesis error:', error);
            // Fallback to simple formatting
            return this.formatMessageResults(results, searchQuery);
        }
    }

    /**
     * Extract the actual search query from the user's question.
     * Removes common prefixes and Slack-specific language.
     */
    private static extractSearchQuery(question: string): string {
        let query = question
            // Remove common action verbs
            .replace(/^(check|search|find|look for|show me|get|fetch)\s+/i, '')
            // Remove Slack-specific language
            .replace(/\s+(in|from|on)\s+slack$/i, '')
            .replace(/\s+in\s+#[\w-]+$/i, '')  // Remove "in #channel" at end
            .replace(/^slack\s+for\s+/i, '')
            // Clean up
            .trim();

        // If query is empty after cleaning, use original question
        if (!query) {
            query = question;
        }

        return query;
    }

    /**
     * Format Slack message results for presentation.
     */
    private static formatMessageResults(results: SlackSearchResult[], query: string): string {
        const lines: string[] = [];

        lines.push(`*Slack Messages — "${query}"*`);
        lines.push(`Found ${results.length} message${results.length !== 1 ? 's' : ''}:\n`);

        // Group by channel for better readability
        const byChannel = new Map<string, SlackSearchResult[]>();
        results.forEach(result => {
            const existing = byChannel.get(result.channelName) || [];
            existing.push(result);
            byChannel.set(result.channelName, existing);
        });

        // Format each channel's messages
        byChannel.forEach((messages, channelName) => {
            lines.push(`\n*#${channelName}*`);
            messages.forEach((msg) => {
                // Truncate long messages
                const text = msg.text.length > 200
                    ? msg.text.substring(0, 200) + '...'
                    : msg.text;

                lines.push(`• ${text}`);
                if (msg.permalink) {
                    lines.push(`  ${msg.permalink}`);
                }
                lines.push(''); // Add spacing between messages
            });
        });

        return lines.join('\n');
    }

    /**
     * Format channel results for presentation.
     */
    private static formatChannelResults(channels: SlackChannel[], query: string): string {
        const lines: string[] = [];

        lines.push(`*Slack Channels — "${query}"*`);
        lines.push(`Found ${channels.length} channel${channels.length !== 1 ? 's' : ''}:\n`);

        channels.forEach((channel, idx) => {
            lines.push(`${idx + 1}. *#${channel.name}*${channel.isPrivate ? ' 🔒' : ''}`);
            if (channel.purpose) {
                lines.push(`   ${channel.purpose}`);
            }
            if (channel.numMembers) {
                lines.push(`   ${channel.numMembers} member${channel.numMembers !== 1 ? 's' : ''}`);
            }
            lines.push('');
        });

        return lines.join('\n');
    }
}

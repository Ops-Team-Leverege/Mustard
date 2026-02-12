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
import type { OpenAssistantResult, IntentClassification } from './types';
import { getSlackSearchSystemPrompt, buildSlackSearchAnalysisPrompt } from '../config/prompts/slackSearch';

export interface SlackSearchContext {
    question: string;
    contract: AnswerContract;
    threadContext?: string;
    extractedCompany?: string;
    keyTopics?: string[];
    conversationContext?: string;
}

// Default classification for Slack search results
function slackClassification(): IntentClassification {
    return {
        intent: "slack_search",
        confidence: "high",
        rationale: "Searching Slack messages",
        meetingRelevance: {
            referencesSpecificInteraction: false,
            asksWhatWasSaidOrAgreed: false,
            asksAboutCustomerQuestions: false,
        },
        researchRelevance: {
            needsPublicInfo: false,
            companyOrEntityMentioned: null,
            topicForResearch: null,
        },
    };
}

export class SlackSearchHandler {
    /**
     * Handle Slack search queries.
     * Routes to appropriate handler based on contract.
     */
    static async handleSlackSearch(context: SlackSearchContext): Promise<OpenAssistantResult> {
        const { question, contract, threadContext, extractedCompany, keyTopics, conversationContext } = context;

        console.log(`[SlackSearchHandler] Handling ${contract} for: "${question}", hasThreadContext=${!!threadContext}, extractedCompany=${extractedCompany || 'none'}`);

        try {
            switch (contract) {
                case AnswerContract.SLACK_MESSAGE_SEARCH:
                    return await this.handleMessageSearch(question, threadContext, extractedCompany, keyTopics, conversationContext);

                case AnswerContract.SLACK_CHANNEL_INFO:
                    return await this.handleChannelInfo(question);

                default:
                    // Default to message search
                    return await this.handleMessageSearch(question, threadContext, extractedCompany, keyTopics, conversationContext);
            }
        } catch (error) {
            console.error('[SlackSearchHandler] Error:', error);
            return {
                answer: `I encountered an error searching Slack: ${error instanceof Error ? error.message : 'Unknown error'}`,
                dataSource: 'slack',
                intent: 'slack_search',
                intentClassification: slackClassification(),
                delegatedToSingleMeeting: false,
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
    private static async handleMessageSearch(
        question: string,
        threadContext?: string,
        extractedCompany?: string,
        keyTopics?: string[],
        conversationContext?: string
    ): Promise<OpenAssistantResult> {
        // Build search query using thread context when the question is referential
        const searchQuery = this.buildContextAwareSearchQuery(question, extractedCompany, keyTopics, conversationContext);

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
                intentClassification: slackClassification(),
                delegatedToSingleMeeting: false,
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
            searchResponse.hasMore,
            threadContext
        );

        return {
            answer: synthesizedAnswer,
            dataSource: 'slack',
            intent: 'slack_search',
            intentClassification: slackClassification(),
            delegatedToSingleMeeting: false,
            shouldGenerateDoc: true, // Generate doc with clickable links for references
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
                intentClassification: slackClassification(),
                delegatedToSingleMeeting: false,
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
            intentClassification: slackClassification(),
            delegatedToSingleMeeting: false,
            coverage: {
                channelsSearched: channels.length,
            },
        };
    }

    /**
     * Synthesize Slack search results into a coherent answer using LLM.
     * Returns both the synthesized answer AND structured evidence for document generation.
     */
    private static async synthesizeSlackFindings(
        originalQuestion: string,
        searchQuery: string,
        results: SlackSearchResult[],
        totalCount: number,
        channelsSearched: number,
        hasMore: boolean,
        threadContext?: string
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

        // Format messages with dates for temporal context
        const messagesContext = results.map((msg, idx) => {
            const date = this.formatSlackTimestamp(msg.timestamp);
            return `[Message ${idx + 1} from #${msg.channelName} by ${msg.username} on ${date}]
${msg.text}
Link: ${msg.permalink || 'N/A'}`;
        }).join('\n\n');

        const channelSummary = Array.from(channelGroups.entries())
            .map(([channel, msgs]) => `#${channel} (${msgs.length} messages)`)
            .join(', ');

        // Extract company/entity from the original question for context-aware synthesis
        const companyMatch = originalQuestion.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
        const mentionedEntity = companyMatch ? companyMatch[1] : null;

        const prompt = buildSlackSearchAnalysisPrompt({
            originalQuestion,
            mentionedEntity,
            resultCount: results.length,
            totalCount,
            channelsSearched,
            channelSummary,
            hasMore,
            messagesContext,
        });

        // Include thread context in system prompt so LLM understands follow-up references
        const systemPrompt = threadContext
            ? `${getSlackSearchSystemPrompt()}\n\n${threadContext}`
            : getSlackSearchSystemPrompt();

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
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
     * Format Slack timestamp to readable date.
     */
    private static formatSlackTimestamp(ts: string): string {
        try {
            // Slack timestamps are in format "1234567890.123456"
            const timestamp = parseFloat(ts) * 1000;
            const date = new Date(timestamp);

            // Format as "Dec 12, 2025"
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch (error) {
            return 'Unknown date';
        }
    }

    /**
     * Build a context-aware search query.
     * When the user's question is referential ("this conversation", "that", "them"),
     * uses Decision Layer context (extractedCompany, keyTopics, conversationContext)
     * to build a meaningful search query instead of searching for "this conversation".
     */
    private static buildContextAwareSearchQuery(
        question: string,
        extractedCompany?: string,
        keyTopics?: string[],
        conversationContext?: string
    ): string {
        const isReferential =
            /\b(this|that|the|it|them|those|these)\s+(conversation|discussion|topic|meeting|company|thread|chat|exchange)\b/i.test(question)
            || /\b(link\s+me|find\s+the|show\s+me|pull\s+up|look\s+up|search\s+for)\b.*\b(conversation|discussion|message|thread|chat|exchange)\b/i.test(question)
            || /\b(link|find|search|pull\s+up|show)\b.*\b(to|for|about)\s+(this|that|them|it)\b/i.test(question)
            || /\b(about|regarding|related\s+to)\s+(this|that|them|it|the\s+above)\b/i.test(question);

        if (isReferential && (extractedCompany || (keyTopics && keyTopics.length > 0))) {
            const parts: string[] = [];
            if (extractedCompany) parts.push(extractedCompany);
            if (keyTopics && keyTopics.length > 0) {
                parts.push(...keyTopics.slice(0, 2));
            }
            const contextQuery = parts.join(' ');
            console.log(`[SlackSearchHandler] Referential query detected, resolved to: "${contextQuery}" (from extractedCompany=${extractedCompany}, keyTopics=${keyTopics?.join(', ')})`);
            return contextQuery;
        }

        if (isReferential && conversationContext) {
            console.log(`[SlackSearchHandler] Referential query detected, using conversationContext: "${conversationContext}"`);
            return this.extractSearchQuery(conversationContext);
        }

        return this.extractSearchQuery(question);
    }

    /**
     * Extract the actual search query from the user's question.
     * Removes common prefixes and Slack-specific language.
     * Preserves company/entity names for better search results.
     */
    private static extractSearchQuery(question: string): string {
        let query = question
            // Remove common action verbs
            .replace(/^(check|search|find|look for|show me|get|fetch)\s+/i, '')
            // Remove Slack-specific language
            .replace(/\s+(in|from|on)\s+slack$/i, '')
            .replace(/\s+in\s+#[\w-]+$/i, '')  // Remove "in #channel" at end
            .replace(/^slack\s+for\s+/i, '')
            // Remove filler words but keep company names
            .replace(/\b(someone|anyone)\s+(mentioned|said)\s+/i, '')
            .replace(/\ba\s+recommended\s+/i, 'recommended ')
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

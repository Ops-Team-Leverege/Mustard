/**
 * Slack Search Handler
 * 
 * Two-step LLM pipeline for Slack search:
 * 
 * Step 1: QUERY EXTRACTION (LLM)
 *   Input: user message + thread context + Decision Layer fields
 *   Output: clean Slack search terms
 *   Purpose: Converts conversational intent into effective search queries
 *   Thread context is consumed here and NEVER passed further
 * 
 * Step 2: SEARCH + SYNTHESIS (Slack API → LLM)
 *   Input: Slack API results + original question
 *   Output: synthesized answer with proper attribution
 *   Purpose: Analyzes ONLY actual Slack messages — no meeting data, no thread context
 * 
 * Layer: Execution Plane (Open Assistant)
 */

import { SlackSearchService, type SlackSearchResult, type SlackChannel } from '../services/slackSearchService';
import { AnswerContract } from '../decisionLayer/answerContracts';
import type { OpenAssistantResult, IntentClassification } from './types';
import { getSlackSearchSystemPrompt, buildSlackSearchAnalysisPrompt, buildSlackQueryExtractionPrompt } from '../config/prompts/slackSearch';
import { MODEL_ASSIGNMENTS } from '../config/models';

export interface SlackSearchContext {
    question: string;
    contract: AnswerContract;
    extractedCompany?: string;
    keyTopics?: string[];
    conversationContext?: string;
    threadMessages?: Array<{ text: string; isBot: boolean }>;
}

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
    static async handleSlackSearch(context: SlackSearchContext): Promise<OpenAssistantResult> {
        const { question, contract, extractedCompany, keyTopics, conversationContext, threadMessages } = context;

        console.log(`[SlackSearchHandler] Handling ${contract} for: "${question}", hasThreadMessages=${!!(threadMessages?.length)}, extractedCompany=${extractedCompany || 'none'}`);

        try {
            switch (contract) {
                case AnswerContract.SLACK_MESSAGE_SEARCH:
                    return await this.handleMessageSearch(question, extractedCompany, keyTopics, conversationContext, threadMessages);

                case AnswerContract.SLACK_CHANNEL_INFO:
                    return await this.handleChannelInfo(question, extractedCompany, keyTopics, conversationContext, threadMessages);

                default:
                    return await this.handleMessageSearch(question, extractedCompany, keyTopics, conversationContext, threadMessages);
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
     * STEP 1: Extract structured search intent using LLM.
     * 
     * The LLM outputs structured topic components (coreTopic, company, people, sortByOldest).
     * The handler assembles the actual search query deterministically based on sort mode:
     *   - Relevance sort: company + coreTopic + people (specific, relevance scoring handles fuzzy matching)
     *   - Timestamp sort: company + coreTopic only (broad, because Slack AND logic + timestamp sort kills recall)
     * 
     * This separation ensures the LLM handles semantic understanding while
     * the code handles search engineering — no mixed responsibilities.
     */
    private static async extractSearchQuery(
        question: string,
        extractedCompany?: string,
        keyTopics?: string[],
        conversationContext?: string,
        threadMessages?: Array<{ text: string; isBot: boolean }>
    ): Promise<{ searchQuery: string; searchDescription: string; resolvedQuestion: string; sortByOldest: boolean }> {
        const { OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

        const { system, user } = buildSlackQueryExtractionPrompt({
            question,
            extractedCompany,
            keyTopics,
            conversationContext,
            threadMessages,
        });

        try {
            const response = await openai.chat.completions.create({
                model: MODEL_ASSIGNMENTS.SLACK_QUERY_EXTRACTION,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                temperature: 0,
                response_format: { type: "json_object" },
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                console.warn('[SlackSearchHandler] LLM query extraction returned empty');
                return { searchQuery: question, searchDescription: 'Fallback to raw question', resolvedQuestion: question, sortByOldest: false };
            }

            const parsed = JSON.parse(content);
            const coreTopic = (parsed.coreTopic || '').trim();
            const company = (parsed.company || '').trim();
            const people: string[] = Array.isArray(parsed.people) ? parsed.people : [];
            const resolvedQuestion = (parsed.resolvedQuestion || '').trim() || question;
            const sortByOldest = parsed.sortByOldest === true;
            const searchDescription = parsed.searchDescription || '';

            const searchQuery = this.assembleSearchQuery(coreTopic, company, people, sortByOldest);

            if (!searchQuery) {
                console.warn('[SlackSearchHandler] Assembled empty query from components');
                return { searchQuery: question, searchDescription: 'Empty assembled query, using raw question', resolvedQuestion, sortByOldest };
            }

            console.log(`[SlackSearchHandler] LLM components: coreTopic="${coreTopic}", company="${company}", people=[${people.join(', ')}], sortByOldest=${sortByOldest}`);
            console.log(`[SlackSearchHandler] Assembled query: "${searchQuery}", resolvedQuestion: "${resolvedQuestion}" (${searchDescription})`);
            return { searchQuery, searchDescription, resolvedQuestion, sortByOldest };
        } catch (error) {
            console.error('[SlackSearchHandler] Query extraction LLM error:', error);
            return { searchQuery: question, searchDescription: 'LLM extraction failed, using raw question', resolvedQuestion: question, sortByOldest: false };
        }
    }

    /**
     * Assemble the actual Slack search query from structured components.
     * 
     * Search strategy adapts to sort mode:
     *   - Relevance sort: include all components (company + topic + people)
     *     because relevance scoring handles fuzzy matching well
     *   - Timestamp sort: broad query (company + topic only)
     *     because Slack AND logic + timestamp sort kills recall with too many terms
     */
    private static assembleSearchQuery(
        coreTopic: string,
        company: string,
        people: string[],
        sortByOldest: boolean
    ): string {
        const parts: string[] = [];

        if (company) parts.push(company);
        if (coreTopic) parts.push(coreTopic);

        if (!sortByOldest && people.length > 0) {
            parts.push(...people);
        }

        return parts.join(' ');
    }

    /**
     * Handle message search queries.
     * Two-step pipeline: extract query (Step 1) → search + synthesize (Step 2).
     */
    private static async handleMessageSearch(
        question: string,
        extractedCompany?: string,
        keyTopics?: string[],
        conversationContext?: string,
        threadMessages?: Array<{ text: string; isBot: boolean }>
    ): Promise<OpenAssistantResult> {
        const { searchQuery, resolvedQuestion, sortByOldest } = await this.extractSearchQuery(
            question, extractedCompany, keyTopics, conversationContext, threadMessages
        );

        console.log(`[SlackSearchHandler] Searching Slack for: "${searchQuery}" (resolvedQuestion: "${resolvedQuestion}", sortByOldest: ${sortByOldest})`);

        const searchResponse = await SlackSearchService.searchMessages({
            query: searchQuery,
            limit: 20,
            ...(sortByOldest ? { sort: 'timestamp' as const, sortDir: 'asc' as const } : {}),
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

        const uniqueChannels = new Set(searchResponse.results.map(r => r.channelId));

        const synthesizedAnswer = await this.synthesizeSlackFindings(
            resolvedQuestion,
            searchQuery,
            searchResponse.results,
            searchResponse.totalCount,
            uniqueChannels.size,
            searchResponse.hasMore,
            extractedCompany,
            sortByOldest
        );

        return {
            answer: synthesizedAnswer,
            dataSource: 'slack',
            intent: 'slack_search',
            intentClassification: slackClassification(),
            delegatedToSingleMeeting: false,
            shouldGenerateDoc: true,
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
     * Intentionally uses simple formatting (not LLM synthesis) because channel
     * listings are structured data — name, purpose, member count — that don't
     * benefit from LLM interpretation. Step 1 (query extraction) is still used
     * to resolve referential queries from thread context.
     */
    private static async handleChannelInfo(
        question: string,
        extractedCompany?: string,
        keyTopics?: string[],
        conversationContext?: string,
        threadMessages?: Array<{ text: string; isBot: boolean }>
    ): Promise<OpenAssistantResult> {
        const { searchQuery } = await this.extractSearchQuery(
            question, extractedCompany, keyTopics, conversationContext, threadMessages
        );

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
     * STEP 2: Synthesize Slack search results into a coherent answer using LLM.
     * 
     * This step receives ONLY Slack API results and the original question.
     * No thread context, no meeting data — pure Slack synthesis.
     */
    private static async synthesizeSlackFindings(
        originalQuestion: string,
        searchQuery: string,
        results: SlackSearchResult[],
        totalCount: number,
        channelsSearched: number,
        hasMore: boolean,
        extractedCompany?: string,
        sortByOldest?: boolean
    ): Promise<string> {
        const { OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

        const channelGroups = new Map<string, SlackSearchResult[]>();
        results.forEach(msg => {
            const existing = channelGroups.get(msg.channelName) || [];
            existing.push(msg);
            channelGroups.set(msg.channelName, existing);
        });

        const messagesContext = results.map((msg, idx) => {
            const date = this.formatSlackTimestamp(msg.timestamp);
            return `[Message ${idx + 1} from #${msg.channelName} by ${msg.username} on ${date}]
${msg.text}
Link: ${msg.permalink || 'N/A'}`;
        }).join('\n\n');

        const channelSummary = Array.from(channelGroups.entries())
            .map(([channel, msgs]) => `#${channel} (${msgs.length} messages)`)
            .join(', ');

        const mentionedEntity = extractedCompany || null;

        const prompt = buildSlackSearchAnalysisPrompt({
            originalQuestion,
            mentionedEntity,
            resultCount: results.length,
            totalCount,
            channelsSearched,
            channelSummary,
            hasMore,
            messagesContext,
            sortByOldest,
        });

        try {
            const response = await openai.chat.completions.create({
                model: MODEL_ASSIGNMENTS.SLACK_SEARCH_SYNTHESIS,
                messages: [
                    { role: 'system', content: getSlackSearchSystemPrompt() },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 1500,
            });

            const synthesized = response.choices[0]?.message?.content || '';

            if (!synthesized) {
                return this.formatMessageResults(results, searchQuery);
            }

            return synthesized;
        } catch (error) {
            console.error('[SlackSearchHandler] Synthesis error:', error);
            return this.formatMessageResults(results, searchQuery);
        }
    }

    private static formatSlackTimestamp(ts: string): string {
        try {
            const timestamp = parseFloat(ts) * 1000;
            const date = new Date(timestamp);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch (error) {
            return 'Unknown date';
        }
    }

    private static formatMessageResults(results: SlackSearchResult[], query: string): string {
        const lines: string[] = [];

        lines.push(`*Slack Messages — "${query}"*`);
        lines.push(`Found ${results.length} message${results.length !== 1 ? 's' : ''}:\n`);

        const byChannel = new Map<string, SlackSearchResult[]>();
        results.forEach(result => {
            const existing = byChannel.get(result.channelName) || [];
            existing.push(result);
            byChannel.set(result.channelName, existing);
        });

        byChannel.forEach((messages, channelName) => {
            lines.push(`\n*#${channelName}*`);
            messages.forEach((msg) => {
                const text = msg.text.length > 200
                    ? msg.text.substring(0, 200) + '...'
                    : msg.text;

                lines.push(`• ${text}`);
                if (msg.permalink) {
                    lines.push(`  ${msg.permalink}`);
                }
                lines.push('');
            });
        });

        return lines.join('\n');
    }

    private static formatChannelResults(channels: SlackChannel[], query: string): string {
        const lines: string[] = [];

        lines.push(`*Slack Channels — "${query}"*`);
        lines.push(`Found ${channels.length} channel${channels.length !== 1 ? 's' : ''}:\n`);

        channels.forEach((channel, idx) => {
            lines.push(`${idx + 1}. *#${channel.name}*${channel.isPrivate ? ' (private)' : ''}`);
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

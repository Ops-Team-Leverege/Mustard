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

export interface SlackSearchContext {
    question: string;
    contract: AnswerContract;
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
            searchResponse.hasMore
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

        const prompt = `You are analyzing Slack messages to answer a user's question.

User's Question: "${originalQuestion}"
${mentionedEntity ? `\n⚠️ IMPORTANT: User asked specifically about "${mentionedEntity}" - prioritize information about this entity!` : ''}

Search Metadata:
- Found ${results.length} messages (${totalCount} total available)
- Searched ${channelsSearched} channels: ${channelSummary}
${hasMore ? '- More results available (showing top 20)' : ''}

Slack Messages (with dates and proper attribution):
${messagesContext}

CRITICAL INSTRUCTIONS:

1. **ATTRIBUTION ACCURACY**:
   - Use the actual message author (shown as "by [username]")
   - If someone @mentions another person, that's NOT the author
   - Example: If "Calum" writes "@eric on sales calls...", say "Calum mentioned to Eric..." NOT "Eric mentioned..."

2. **COMPANY-SPECIFIC CONTEXT** (HIGHEST PRIORITY):
   ${mentionedEntity ? `- The user asked about "${mentionedEntity}" specifically
   - Look for messages that mention "${mentionedEntity}" by name
   - If "${mentionedEntity}" has different rules/exceptions, HIGHLIGHT THIS FIRST
   - Don't give generic answers if company-specific info exists` : '- Check if the question is about a specific company/entity'}

3. **DISTINGUISH GENERAL POLICY vs COMPANY-SPECIFIC EXCEPTIONS** (CRITICAL):
   - When you see messages about "standard" or "general policy", that applies to ALL companies
   - When you see messages about a SPECIFIC company, that's an exception or special case
   - NEVER say "the standard for [Company X] is..." - standards are company-wide, not per-company
   - DO say: "[Company X] is getting [Y] as an exception to the standard [Z]"
   - Example: If standard is 45 days but Pomps gets 90 days, say "Pomps: 90-day pilot (exception to standard 45-day policy)" NOT "standard for Pomps is 90 days"
   
   EXAMPLE OF CORRECT INTERPRETATION:
   - Message 1: "Our standard pilot length is 45 days"
   - Message 2: "Recommending 90 days for Pomps due to commercial tire complexity"
   - CORRECT: "Pomps is being offered a 90-day pilot, which is an exception to the standard 45-day policy"
   - WRONG: "The standard for Pomps is 90 days"
   - WRONG: "The pilot agreement has evolved and the standard for Pomps is now 90 days"

4. **CITE SOURCES ACCURATELY** (CRITICAL):
   - ONLY cite what a message ACTUALLY says
   - If Message 8 says "standard changed from 60 to 45 days", DO NOT claim it says anything about a specific company
   - If Message 3 says "recommending 90 days for Pomps", DO NOT claim it says this is "the standard"
   - Each source should be cited for EXACTLY what it contains, nothing more
   - If you need to combine information from multiple sources, cite each source separately for its specific contribution

5. **START WITH DIRECT ANSWER**:
   - Put the key finding first in bold
   - If there's a company-specific exception, state it immediately
   - Example: "✅ **For Pomps specifically: 90-day pilot recommended** (exception to standard 45-day policy)"

6. **STRUCTURED FORMAT**:
   📊 Key Details:
   • [Most important point first]
   • [Company-specific details if applicable]
   • [General context]

7. **TEMPORAL CONTEXT** (CRITICAL):
   - ALWAYS mention dates when referencing information
   - Note if information is recent or old
   - Example: "According to a message from December 12, 2025..."
   - Flag if information might be outdated

8. **REFERENCE ONLY ACTUAL MESSAGES**:
   - ONLY cite messages from the list above
   - Use the exact message numbers [Message 1], [Message 2], etc.
   - Include the date and channel for each reference
   - DO NOT make up or infer sources that aren't in the list
   - DO NOT claim a message says something it doesn't say

9. **END WITH REFERENCES SECTION**:
   
   References:
   [List ONLY the messages you actually used, with dates and links]
   
   Format:
   • Message [#] from #[channel] by [author] ([date])
     [Brief description of EXACTLY what this message contains - don't exaggerate or misrepresent]
     [Actual Slack link]

10. **SEARCH TRANSPARENCY**:
   🔍 Searched ${channelsSearched} channels, found ${results.length} messages
   Confidence: [High/Medium/Low based on source quality and consistency]

Keep the answer scannable with short paragraphs, bullet points, and clear structure.`;

        try {
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that synthesizes information from Slack messages with perfect attribution accuracy, temporal awareness, and company-specific context awareness. You ONLY reference actual messages provided, never make up sources. CRITICAL: Distinguish between general company policies and company-specific exceptions. Never say "the standard for [Company X]" - standards apply to all companies. If a specific company gets different terms, call it an exception.' },
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

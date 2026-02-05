/**
 * Slack Search Service
 * 
 * Purpose:
 * Provides search capabilities for Slack messages and channels.
 * This is separate from the Slack events integration (server/slack/)
 * which handles incoming webhooks.
 * 
 * This service is for SEARCHING Slack as a data source,
 * not for receiving events from Slack.
 * 
 * Layer: Service (Data Access)
 */

import { WebClient } from '@slack/web-api';

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

export interface SlackSearchResult {
    channelName: string;
    channelId: string;
    username: string;
    userId: string;
    text: string;
    timestamp: string;
    permalink?: string;
}

export interface SlackSearchOptions {
    query: string;
    limit?: number;
    page?: number;
    sort?: 'score' | 'timestamp';
    sortDir?: 'asc' | 'desc';
}

export interface SlackSearchResponse {
    results: SlackSearchResult[];
    totalCount: number;
    hasMore: boolean;
    page: number;
}

export interface SlackChannel {
    id: string;
    name: string;
    purpose?: string;
    topic?: string;
    numMembers?: number;
    isPrivate: boolean;
}

export class SlackSearchService {
    /**
     * Search messages across Slack channels.
     * Uses Slack's search.messages API with pagination support.
     */
    static async searchMessages(options: SlackSearchOptions): Promise<SlackSearchResponse> {
        try {
            const page = options.page || 1;
            const limit = options.limit || 20;

            console.log(`[SlackSearchService] Searching for: "${options.query}" (page ${page})`);

            const response = await slackClient.search.messages({
                query: options.query,
                count: limit,
                page: page,
                sort: options.sort || 'score',
                sort_dir: options.sortDir || 'desc',
            });

            if (!response.messages?.matches) {
                console.log(`[SlackSearchService] No messages found`);
                return {
                    results: [],
                    totalCount: 0,
                    hasMore: false,
                    page: page,
                };
            }

            const results = response.messages.matches.map((match: any) => ({
                channelName: match.channel?.name || 'Unknown',
                channelId: match.channel?.id || '',
                username: match.username || 'Unknown',
                userId: match.user || '',
                text: match.text || '',
                timestamp: match.ts || '',
                permalink: match.permalink,
            }));

            const totalCount = response.messages.total || results.length;
            const pageCount = response.messages.pagination?.page_count || 1;
            const hasMore = page < pageCount;

            console.log(`[SlackSearchService] Found ${results.length} messages (${totalCount} total, page ${page}/${pageCount})`);

            return {
                results,
                totalCount,
                hasMore,
                page,
            };
        } catch (error) {
            console.error('[SlackSearchService] Search error:', error);
            throw new Error(`Failed to search Slack: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Search for channels by name or description.
     */
    static async searchChannels(query: string): Promise<SlackChannel[]> {
        try {
            console.log(`[SlackSearchService] Searching channels for: "${query}"`);

            const response = await slackClient.conversations.list({
                types: 'public_channel,private_channel',
                limit: 1000,
            });

            if (!response.channels) {
                return [];
            }

            const queryLower = query.toLowerCase();
            const matches = response.channels.filter((channel: any) => {
                const nameMatch = channel.name?.toLowerCase().includes(queryLower);
                const purposeMatch = channel.purpose?.value?.toLowerCase().includes(queryLower);
                const topicMatch = channel.topic?.value?.toLowerCase().includes(queryLower);
                return nameMatch || purposeMatch || topicMatch;
            });

            const results = matches.map((channel: any) => ({
                id: channel.id,
                name: channel.name,
                purpose: channel.purpose?.value,
                topic: channel.topic?.value,
                numMembers: channel.num_members,
                isPrivate: channel.is_private || false,
            }));

            console.log(`[SlackSearchService] Found ${results.length} channels`);
            return results;
        } catch (error) {
            console.error('[SlackSearchService] Channel search error:', error);
            throw new Error(`Failed to search channels: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Read messages from a specific channel.
     */
    static async readChannel(channelId: string, limit: number = 100): Promise<any[]> {
        try {
            console.log(`[SlackSearchService] Reading channel ${channelId}`);

            const response = await slackClient.conversations.history({
                channel: channelId,
                limit: limit,
            });

            return response.messages || [];
        } catch (error) {
            console.error('[SlackSearchService] Channel read error:', error);
            throw new Error(`Failed to read channel: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Read a specific thread.
     */
    static async readThread(channelId: string, threadTs: string): Promise<any[]> {
        try {
            console.log(`[SlackSearchService] Reading thread ${threadTs} in ${channelId}`);

            const response = await slackClient.conversations.replies({
                channel: channelId,
                ts: threadTs,
            });

            return response.messages || [];
        } catch (error) {
            console.error('[SlackSearchService] Thread read error:', error);
            throw new Error(`Failed to read thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

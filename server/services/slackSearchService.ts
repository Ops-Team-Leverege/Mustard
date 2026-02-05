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
 * Configuration: config/slackSearch.json
 * 
 * Layer: Service (Data Access)
 */

import { WebClient } from '@slack/web-api';
import * as fs from 'fs';
import * as path from 'path';

// Search API requires a User Token (xoxp-), not a Bot Token (xoxb-)
// SLACK_USER_TOKEN is used for search, SLACK_BOT_TOKEN is used for posting
const slackClient = new WebClient(process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN);

interface SlackSearchConfig {
  channelFilter: {
    enabled: boolean;
    mustContain: string[];
    exclude: string[];
  };
  search: {
    defaultLimit: number;
    sortBy: 'score' | 'timestamp';
    sortDirection: 'asc' | 'desc';
  };
}

let configCache: SlackSearchConfig | null = null;

function getSlackSearchConfig(): SlackSearchConfig {
  if (configCache) return configCache;
  
  const configPath = path.join(process.cwd(), 'config', 'slackSearch.json');
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    configCache = JSON.parse(configContent) as SlackSearchConfig;
    console.log(`[SlackSearchService] Loaded config - channel filter: ${configCache.channelFilter.enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.warn(`[SlackSearchService] Config not found, using defaults`);
    configCache = {
      channelFilter: { enabled: false, mustContain: [], exclude: [] },
      search: { defaultLimit: 20, sortBy: 'score', sortDirection: 'desc' }
    };
  }
  return configCache;
}

export function clearSlackSearchConfigCache(): void {
  configCache = null;
}

function channelMatchesFilter(channelName: string, config: SlackSearchConfig): boolean {
  if (!config.channelFilter.enabled) return true;
  
  const lowerName = channelName.toLowerCase();
  
  // Check exclusions first
  for (const exclude of config.channelFilter.exclude) {
    if (lowerName.includes(exclude.toLowerCase())) {
      return false;
    }
  }
  
  // Check mustContain - at least one must match
  if (config.channelFilter.mustContain.length === 0) return true;
  
  for (const required of config.channelFilter.mustContain) {
    if (lowerName.includes(required.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

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
     * Filters results based on channel name rules in config/slackSearch.json
     */
    static async searchMessages(options: SlackSearchOptions): Promise<SlackSearchResponse> {
        try {
            // Reload config to pick up changes
            clearSlackSearchConfigCache();
            const config = getSlackSearchConfig();
            
            const page = options.page || 1;
            const limit = options.limit || config.search.defaultLimit;

            console.log(`[SlackSearchService] Searching for: "${options.query}" (page ${page})`);
            if (config.channelFilter.enabled) {
                console.log(`[SlackSearchService] Channel filter: must contain [${config.channelFilter.mustContain.join(', ')}]`);
            }

            const response = await slackClient.search.messages({
                query: options.query,
                count: limit * 2, // Fetch extra to account for filtering
                page: page,
                sort: options.sort || config.search.sortBy,
                sort_dir: options.sortDir || config.search.sortDirection,
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

            // Map and filter results by channel name
            const allResults = response.messages.matches.map((match: any) => ({
                channelName: match.channel?.name || 'Unknown',
                channelId: match.channel?.id || '',
                username: match.username || 'Unknown',
                userId: match.user || '',
                text: match.text || '',
                timestamp: match.ts || '',
                permalink: match.permalink,
            }));
            
            // Apply channel filter
            const filteredResults = allResults.filter(r => channelMatchesFilter(r.channelName, config));
            const results = filteredResults.slice(0, limit);
            
            if (config.channelFilter.enabled) {
                console.log(`[SlackSearchService] Filtered: ${allResults.length} -> ${filteredResults.length} messages (channels matching filter)`);
            }

            const totalCount = response.messages.total || results.length;
            const pageCount = response.messages.pagination?.page_count || 1;
            const hasMore = page < pageCount;

            console.log(`[SlackSearchService] Returning ${results.length} messages (${totalCount} total, page ${page}/${pageCount})`);

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

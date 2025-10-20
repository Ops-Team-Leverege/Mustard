import { Version3Client } from 'jira.js';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings?.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
    const hostName = connectionSettings?.settings?.site_url;
    if (accessToken && hostName) {
      return {accessToken, hostName};
    }
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  try {
    connectionSettings = await fetch(
      'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=jira',
      {
        headers: {
          'Accept': 'application/json',
          'X_REPLIT_TOKEN': xReplitToken
        }
      }
    ).then(res => res.json()).then(data => data?.items?.[0]);
  } catch (error) {
    throw new Error('Failed to fetch Jira connection settings');
  }

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;
  const hostName = connectionSettings?.settings?.site_url;

  if (!connectionSettings || !accessToken || !hostName) {
    throw new Error('Jira not connected. Please set up the Jira integration in your Replit project settings.');
  }

  return {accessToken, hostName};
}

export async function getUncachableJiraClient() {
  const { accessToken, hostName } = await getAccessToken();

  return new Version3Client({
    host: hostName,
    authentication: {
      oauth2: { accessToken },
    },
  });
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        name: string;
      };
    };
    issuetype: {
      name: string;
      iconUrl: string;
    };
    priority?: {
      name: string;
      iconUrl: string;
    };
    assignee?: {
      displayName: string;
      avatarUrls: {
        '48x48': string;
      };
    };
    created: string;
    updated: string;
    duedate?: string;
    description?: any;
    project: {
      key: string;
      name: string;
    };
  };
}

function validateProjectKey(key: string): boolean {
  // Jira project keys must be uppercase alphanumeric and underscores only
  return /^[A-Z0-9_]+$/.test(key);
}

export async function getIssuesFromProjects(projectKeys: string[]): Promise<JiraIssue[]> {
  if (projectKeys.length === 0) {
    return [];
  }

  // Validate all project keys to prevent JQL injection
  const validKeys = projectKeys.filter(validateProjectKey);
  
  if (validKeys.length === 0) {
    throw new Error('No valid project keys provided. Project keys must contain only uppercase letters, numbers, and underscores.');
  }

  const client = await getUncachableJiraClient();
  
  // Safely construct JQL by quoting each project key
  const quotedKeys = validKeys.map(key => `"${key}"`).join(',');
  const jql = `project IN (${quotedKeys}) ORDER BY created DESC`;
  
  const response = await client.issueSearch.searchForIssuesUsingJql({
    jql,
    maxResults: 100,
    fields: [
      'summary',
      'status',
      'issuetype',
      'priority',
      'assignee',
      'created',
      'updated',
      'duedate',
      'description',
      'project'
    ],
  });

  return response.issues as unknown as JiraIssue[];
}

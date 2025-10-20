import { Version3Client } from 'jira.js';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
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

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=jira',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
  const hostName = connectionSettings?.settings?.site_url;

  if (!connectionSettings || !accessToken || !hostName) {
    throw new Error('Jira not connected');
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

export async function getIssuesFromProjects(projectKeys: string[]): Promise<JiraIssue[]> {
  const client = await getUncachableJiraClient();
  
  const jql = `project IN (${projectKeys.join(',')}) ORDER BY created DESC`;
  
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

  return response.issues as JiraIssue[];
}

import { Version3Client } from 'jira.js';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
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

export async function getJiraClient() {
  const { accessToken, hostName } = await getAccessToken();

  return new Version3Client({
    host: hostName,
    authentication: {
      oauth2: { accessToken },
    },
  });
}

export async function fetchJiraTickets(projectKey: string) {
  const client = await getJiraClient();
  
  try {
    const response = await client.issueSearch.searchForIssuesUsingJql({
      jql: `project = "${projectKey}" ORDER BY created DESC`,
      maxResults: 100,
      fields: ['summary', 'description', 'status', 'priority', 'assignee', 'reporter', 'issuetype', 'labels', 'duedate', 'created', 'updated'],
    });

    return response.issues || [];
  } catch (error) {
    console.error(`Error fetching Jira tickets for project ${projectKey}:`, error);
    throw error;
  }
}

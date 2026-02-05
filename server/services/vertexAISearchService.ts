import { GoogleAuth } from 'google-auth-library';

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  link?: string;
}

interface SearchResponse {
  results: SearchResult[];
  totalSize: number;
  answer?: string;
}

const PROJECT_ID = '215977550816';
const LOCATION = 'us';
const ENGINE_ID = 'pitcrew-help-center_1770319577980';
const COLLECTION = 'default_collection';

function getGoogleAuth(): GoogleAuth {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable not set');
  }

  const credentials = JSON.parse(credentialsJson);
  return new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

export async function searchHelpArticles(query: string): Promise<SearchResponse> {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const url = `https://us-discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/${LOCATION}/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:search`;

  const requestBody = {
    query,
    pageSize: 10,
    queryExpansionSpec: { condition: 'AUTO' },
    spellCorrectionSpec: { mode: 'AUTO' },
    languageCode: 'en-US',
    contentSearchSpec: {
      snippetSpec: { returnSnippet: true },
    },
    userInfo: { timeZone: 'America/Los_Angeles' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[VertexAISearch] Error:', response.status, errorText);
    throw new Error(`Vertex AI Search failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  
  const results: SearchResult[] = (data.results || []).map((result: any, index: number) => ({
    id: result.id || `result-${index}`,
    title: result.document?.derivedStructData?.title || result.document?.name || 'Untitled',
    snippet: result.document?.derivedStructData?.snippets?.[0]?.snippet || '',
    link: result.document?.derivedStructData?.link || null,
  }));

  return {
    results,
    totalSize: data.totalSize || results.length,
  };
}

export async function getAnswerFromHelpArticles(query: string): Promise<SearchResponse> {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  // First, do a search to start a session
  const searchUrl = `https://us-discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/${LOCATION}/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:search`;

  const searchBody = {
    query,
    pageSize: 10,
    queryExpansionSpec: { condition: 'AUTO' },
    spellCorrectionSpec: { mode: 'AUTO' },
    languageCode: 'en-US',
    contentSearchSpec: {
      snippetSpec: { returnSnippet: true },
    },
    userInfo: { timeZone: 'America/Los_Angeles' },
    session: `projects/${PROJECT_ID}/locations/${LOCATION}/collections/${COLLECTION}/engines/${ENGINE_ID}/sessions/-`,
  };

  const searchResponse = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchBody),
  });

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    console.error('[VertexAISearch] Search error:', searchResponse.status, errorText);
    throw new Error(`Vertex AI Search failed: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  const sessionName = searchData.sessionInfo?.name;
  const queryId = searchData.sessionInfo?.queryId;

  // Now get the answer
  const answerUrl = `https://us-discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/${LOCATION}/collections/${COLLECTION}/engines/${ENGINE_ID}/servingConfigs/default_search:answer`;

  const answerBody = {
    query: { text: query, queryId: queryId || '' },
    session: sessionName || '',
    relatedQuestionsSpec: { enable: true },
    answerGenerationSpec: {
      ignoreAdversarialQuery: false,
      ignoreNonAnswerSeekingQuery: false,
      ignoreLowRelevantContent: false,
      includeCitations: true,
      modelSpec: { modelVersion: 'stable' },
    },
  };

  const answerResponse = await fetch(answerUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(answerBody),
  });

  const results: SearchResult[] = (searchData.results || []).map((result: any, index: number) => ({
    id: result.id || `result-${index}`,
    title: result.document?.derivedStructData?.title || result.document?.name || 'Untitled',
    snippet: result.document?.derivedStructData?.snippets?.[0]?.snippet || '',
    link: result.document?.derivedStructData?.link || null,
  }));

  let answer: string | undefined;
  if (answerResponse.ok) {
    const answerData = await answerResponse.json();
    answer = answerData.answer?.answerText;
  }

  return {
    results,
    totalSize: searchData.totalSize || results.length,
    answer,
  };
}

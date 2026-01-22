/**
 * Airtable API Client
 * 
 * Purpose:
 * Low-level client for Airtable API operations.
 * Handles authentication, pagination, and rate limiting.
 * 
 * Layer: Airtable (API client)
 */

import type { AirtableRecord } from "./types";
export type { AirtableRecord } from "./types";

function getAirtableConfig() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  
  if (!apiKey) {
    throw new Error("[Airtable] AIRTABLE_API_KEY environment variable is not set");
  }
  if (!baseId) {
    throw new Error("[Airtable] AIRTABLE_BASE_ID environment variable is not set");
  }
  
  return { apiKey, baseId };
}

type FetchRecordsOptions = {
  tableId: string;
  view?: string;
  maxRecords?: number;
  filterByFormula?: string;
};

export async function fetchAllRecords<T>(options: FetchRecordsOptions): Promise<AirtableRecord<T>[]> {
  const { tableId, view, maxRecords, filterByFormula } = options;
  const records: AirtableRecord<T>[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    if (maxRecords) params.set("maxRecords", String(maxRecords));
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (offset) params.set("offset", offset);

    const { apiKey, baseId } = getAirtableConfig();
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Airtable API error: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    records.push(...data.records);
    offset = data.offset;

    if (offset) {
      await sleep(200);
    }
  } while (offset);

  return records;
}

export async function fetchRecord<T>(tableId: string, recordId: string): Promise<AirtableRecord<T> | null> {
  const { apiKey, baseId } = getAirtableConfig();
  const url = `https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Airtable API error: ${JSON.stringify(error)}`);
  }

  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

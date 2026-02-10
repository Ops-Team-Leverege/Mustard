/**
 * Company Resolution
 *
 * Resolves company identity from available sources with a clear priority order:
 * 1. Thread context (prior interaction already identified the company)
 * 2. Decision Layer LLM extraction (semantic understanding of the message)
 *
 * The Decision Layer is the sole authority for company extraction from new messages.
 * Regex-based extraction is handled separately in the meeting resolver where it's
 * needed for temporal resolution (e.g., "last meeting with ACE").
 */

import { storage } from "../../storage";
import type { ThreadContext } from "../../mcp/context";
import type { DecisionLayerResult } from "../../decisionLayer";

export interface CompanyMention {
  companyId: string;
  companyName: string;
}

interface CompanyResolutionSources {
  threadContext?: ThreadContext;
  decisionLayerResult: DecisionLayerResult;
}

/**
 * Minimum name length for word-boundary matching.
 * Short names (< 4 chars) like "ACE" risk false positives via word-boundary
 * patterns (e.g., "ACE" matching "Palace"). Exact and prefix matches still
 * apply for short names.
 */
const MIN_NAME_LENGTH_FOR_WORD_BOUNDARY = 4;

const COMPANY_QUERIES = {
  BY_ID: `SELECT id, name FROM companies WHERE id = $1`,
  EXACT: `SELECT id, name FROM companies WHERE LOWER(name) = LOWER($1)`,
  PREFIX: `SELECT id, name FROM companies WHERE LOWER(name) LIKE LOWER($1) || '%'`,
  WORD_BOUNDARY: `SELECT id, name FROM companies WHERE 
    LOWER(name) LIKE LOWER($1) || ' %' OR 
    LOWER(name) LIKE '% ' || LOWER($1) || '%' OR
    LOWER(name) LIKE '%(' || LOWER($1) || ')%' OR
    LOWER(name) LIKE '%(' || LOWER($1) || ' %'`,
} as const;

function toMention(row: Record<string, unknown>): CompanyMention {
  return { companyId: row.id as string, companyName: row.name as string };
}

async function resolveFromThreadContext(
  companyId: string
): Promise<CompanyMention | null> {
  const rows = await storage.rawQuery(COMPANY_QUERIES.BY_ID, [companyId]);
  return rows?.[0] ? toMention(rows[0]) : null;
}

async function resolveFromLLMExtraction(
  extractedName: string
): Promise<CompanyMention | null> {
  let rows = await storage.rawQuery(COMPANY_QUERIES.EXACT, [extractedName]);

  if (!rows || rows.length === 0) {
    rows = await storage.rawQuery(COMPANY_QUERIES.PREFIX, [extractedName]);
  }

  if ((!rows || rows.length === 0) && extractedName.length >= MIN_NAME_LENGTH_FOR_WORD_BOUNDARY) {
    rows = await storage.rawQuery(COMPANY_QUERIES.WORD_BOUNDARY, [extractedName]);
  }

  return rows?.[0] ? toMention(rows[0]) : null;
}

/**
 * Resolve company from all available sources.
 *
 * Priority:
 * 1. Thread context (company already known from prior interaction)
 * 2. LLM extraction from Decision Layer (semantic understanding)
 *
 * Returns the first successful match with a log of the resolution source.
 */
export async function resolveCompany(
  sources: CompanyResolutionSources
): Promise<CompanyMention | null> {
  const { threadContext, decisionLayerResult } = sources;

  if (threadContext?.companyId) {
    const result = await resolveFromThreadContext(threadContext.companyId);
    if (result) {
      console.log(`[CompanyResolver] Resolved from thread context: ${result.companyName}`);
      return result;
    }
  }

  if (decisionLayerResult.extractedCompany) {
    const result = await resolveFromLLMExtraction(decisionLayerResult.extractedCompany);
    if (result) {
      console.log(`[CompanyResolver] Resolved from LLM extraction: ${result.companyName}`);
      return result;
    }
    console.warn(`[CompanyResolver] LLM extracted "${decisionLayerResult.extractedCompany}" but not found in database`);
  }

  console.log(`[CompanyResolver] No company resolved from any source`);
  return null;
}

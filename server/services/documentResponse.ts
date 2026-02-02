/**
 * Document Response Service
 * 
 * Decides whether to send a normal Slack message or generate a .docx document
 * based on the answer contract and content length.
 * 
 * Config-driven: uses config/documents.json for all settings
 */

import { postSlackMessage, uploadSlackFile } from "../slack/slackApi";
import { 
  shouldGenerateDocument, 
  getDocumentMessage, 
  generateFileName, 
  generateDocument,
  countWords,
  contentToSections 
} from "./documentGenerator";
import { AnswerContract } from "../decisionLayer/answerContracts";
import OpenAI from 'openai';
import { MODEL_ASSIGNMENTS } from '../config/models';

const openai = new OpenAI();

interface DocumentResponseParams {
  channel: string;
  threadTs?: string;
  content: string;
  contract: AnswerContract;
  customerName?: string;
  title?: string;
  userQuery?: string;
}

interface DocumentResponseResult {
  type: "message" | "document";
  success: boolean;
  error?: string;
}

// Contracts that should never generate documents - conversational responses only
const NON_DOCUMENT_CONTRACTS: AnswerContract[] = [
  AnswerContract.CLARIFY,
  AnswerContract.REFUSE,
];

/**
 * Fallback check for error content that might slip through contract-based gating.
 * Used as a safety net when contract doesn't indicate error but content does.
 */
function isErrorOrClarificationContent(content: string): boolean {
  const errorPatterns = [
    /I need more data/i,
    /Found \d+ meeting\(s\), but need at least/i,
    /I couldn't find/i,
    /Could you (please )?clarify/i,
    /Please (try|provide|specify)/i,
    /I searched .* but (couldn't|found no)/i,
  ];
  
  return errorPatterns.some(pattern => pattern.test(content));
}

export async function sendResponseWithDocumentSupport(
  params: DocumentResponseParams
): Promise<DocumentResponseResult> {
  const { channel, threadTs, content, contract, customerName, title, userQuery } = params;
  
  // Primary check: Don't generate documents for CLARIFY/REFUSE contracts
  const isNonDocContract = NON_DOCUMENT_CONTRACTS.includes(contract);
  // Fallback check: Content-based detection for edge cases
  const isErrorContent = isErrorOrClarificationContent(content);
  
  if (isNonDocContract || isErrorContent) {
    console.log(`[DocumentResponse] Skipping document: contract=${contract} (nonDoc=${isNonDocContract}), errorContent=${isErrorContent}`);
    try {
      await postSlackMessage({
        channel,
        text: content,
        thread_ts: threadTs,
      });
      return { type: "message", success: true };
    } catch (error) {
      console.error("[DocumentResponse] Failed to post message:", error);
      return { 
        type: "message", 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }
  
  const wordCount = countWords(content);
  const shouldGenerate = shouldGenerateDocument(contract, wordCount);
  
  console.log(`[DocumentResponse] Contract: ${contract}, Words: ${wordCount}, Generate doc: ${shouldGenerate}`);
  
  if (!shouldGenerate) {
    try {
      await postSlackMessage({
        channel,
        text: content,
        thread_ts: threadTs,
      });
      return { type: "message", success: true };
    } catch (error) {
      console.error("[DocumentResponse] Failed to post message:", error);
      return { 
        type: "message", 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }
  
  try {
    console.log(`[DocumentResponse] Starting document generation for contract: ${contract}`);
    
    const docTitle = title || await generateTitleFromQuery(userQuery, contract, customerName);
    console.log(`[DocumentResponse] Document title: ${docTitle}`);
    
    const sections = contentToSections(content, docTitle);
    console.log(`[DocumentResponse] Parsed ${sections.length} sections`);
    
    const docBuffer = await generateDocument({
      type: contract,
      title: docTitle,
      sections,
      metadata: {
        customer: customerName,
        date: new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
      },
    });
    console.log(`[DocumentResponse] Generated document buffer: ${docBuffer.length} bytes`);
    
    const fileName = generateFileName(contract, customerName);
    const slackMessage = generateSlackMessage(userQuery, contract);
    console.log(`[DocumentResponse] Uploading to Slack: ${fileName}`);
    
    await uploadSlackFile({
      channel,
      thread_ts: threadTs,
      filename: fileName,
      fileBuffer: docBuffer,
      title: docTitle,
      initialComment: slackMessage,
    });
    
    console.log(`[DocumentResponse] Successfully uploaded document: ${fileName}`);
    return { type: "document", success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error(`[DocumentResponse] FAILED to generate/upload document. Error: ${errorMessage}`);
    console.error(`[DocumentResponse] Stack trace: ${errorStack}`);
    console.error("[DocumentResponse] Falling back to plain text message");
    
    // Add visible indicator that document generation failed
    const fallbackContent = `${content}\n\n_[Document generation encountered an issue - showing text instead]_`;
    
    try {
      await postSlackMessage({
        channel,
        text: fallbackContent,
        thread_ts: threadTs,
      });
      return { type: "message", success: true };
    } catch (msgError) {
      return { 
        type: "message", 
        success: false, 
        error: msgError instanceof Error ? msgError.message : "Unknown error" 
      };
    }
  }
}

/**
 * Use LLM to generate a clear, professional document title from the user's query.
 * This is more reliable than regex-based extraction for complex questions.
 * Falls back to contract-based title if LLM fails.
 */
async function generateTitleWithLLM(query: string, contract?: AnswerContract): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.DOCUMENT_TITLE_GENERATION,
      messages: [
        {
          role: "system",
          content: `Generate a clear, concise document title (3-8 words) from the user's question.

Rules:
- Capture the core topic/question being asked
- Use title case (capitalize major words)
- Do NOT include "PitCrew:" prefix - that's added separately
- Keep it professional and descriptive
- Preserve key question words when they add meaning (e.g., "What to Ask About X")
- Remove filler like "Can you tell me" but keep substantive question words

Examples:
- "what should I ask the customer to validate if their cameras are supported?" → "What to Ask About Camera Compatibility"
- "how does PitCrew handle network connections?" → "Network Connection Handling"
- "tell me about the integration pipeline" → "Integration Pipeline Overview"
- "what are the value props for fleet management?" → "Fleet Management Value Propositions"`
        },
        {
          role: "user",
          content: query.substring(0, 200)
        }
      ],
      max_tokens: 30,
      temperature: 0.3,
    });
    
    const generated = response.choices[0]?.message?.content?.trim();
    if (generated && generated.length >= 5 && generated.length <= 80) {
      return generated;
    }
    return null;
  } catch (error) {
    console.log(`[DocumentResponse] LLM title generation failed, using fallback`);
    return null;
  }
}

/**
 * Simple fallback topic extraction using regex.
 * Used when LLM title generation is not available.
 */
function extractTopicFromQuery(query?: string): string | null {
  if (!query || query.length < 5) return null;
  
  // Clean leading punctuation and whitespace
  let topic = query
    .replace(/^[\s,;:\-]+/, '')
    .replace(/^(what|how|can you|please|could you|tell me|explain|give me|show me|i need|i want)\s+(is|are|about|the|a|an)?\s*/gi, '')
    .replace(/^[\s,;:\-]+/, '')
    .replace(/\?+$/g, '')
    .trim();
  
  // Capitalize first letter
  if (topic.length > 0) {
    topic = topic.charAt(0).toUpperCase() + topic.slice(1);
  }
  
  // Truncate if too long
  if (topic.length > 50) {
    const words = topic.split(' ').slice(0, 6);
    topic = words.join(' ');
  }
  
  return topic.length > 3 ? topic : null;
}

/**
 * Generate a document title based on the user's query, falling back to contract-based title.
 * Uses LLM for better title generation when query is provided.
 */
async function generateTitleFromQuery(query?: string, contract?: AnswerContract, customerName?: string): Promise<string> {
  const customer = customerName || "General";
  
  // For most contracts, use contract-based title (more professional than query extraction)
  // Only PRODUCT_EXPLANATION benefits from query-specific titles
  const useQueryTitleContracts = [
    AnswerContract.PRODUCT_EXPLANATION,
  ];
  
  // If contract doesn't benefit from query-based titles, use contract-based
  if (contract && !useQueryTitleContracts.includes(contract)) {
    return generateTitleFromContract(contract, customerName);
  }
  
  // Try LLM-based title generation first (better quality)
  if (query) {
    const llmTitle = await generateTitleWithLLM(query, contract);
    if (llmTitle) {
      // For product-related queries, prefix with PitCrew
      if (contract === AnswerContract.PRODUCT_EXPLANATION) {
        return `PitCrew: ${llmTitle}`;
      }
      return llmTitle;
    }
  }
  
  // Fallback to regex-based extraction
  const topic = extractTopicFromQuery(query);
  if (topic) {
    if (contract === AnswerContract.PRODUCT_EXPLANATION) {
      return `PitCrew: ${topic}`;
    }
    return topic;
  }
  
  // Fall back to contract-based titles
  return generateTitleFromContract(contract, customerName);
}

function generateTitleFromContract(contract?: AnswerContract, customerName?: string): string {
  const customer = customerName || "General";
  
  switch (contract) {
    case AnswerContract.VALUE_PROPOSITION:
      return `${customer} Value Proposition`;
    case AnswerContract.MEETING_SUMMARY:
      return `${customer} Meeting Summary`;
    case AnswerContract.COMPARISON:
      return `${customer} Comparison Analysis`;
    case AnswerContract.DRAFT_EMAIL:
      return `Email Draft for ${customer}`;
    case AnswerContract.PATTERN_ANALYSIS:
      return `Pattern Analysis - ${customer}`;
    case AnswerContract.TREND_SUMMARY:
      return `Trend Summary - ${customer}`;
    case AnswerContract.CROSS_MEETING_QUESTIONS:
      return `Customer Questions Analysis`;
    case AnswerContract.PRODUCT_EXPLANATION:
      return `PitCrew Product Overview`;
    case AnswerContract.EXTERNAL_RESEARCH:
      return `${customer} Research Report`;
    case AnswerContract.SALES_DOCS_PREP:
      return `${customer} Sales Deck Brief`;
    default:
      // Use the customer name as title if available, otherwise generic
      return customer && customer !== "General" ? `${customer} Report` : `PitCrew Report`;
  }
}

/**
 * Generate a Slack message based on the user's query, falling back to config messages.
 */
function generateSlackMessage(query?: string, contract?: AnswerContract): string {
  // Only PRODUCT_EXPLANATION benefits from query-specific messages
  const useQueryMessageContracts = [
    AnswerContract.PRODUCT_EXPLANATION,
  ];
  
  // For most contracts, use config-based messages
  if (contract && !useQueryMessageContracts.includes(contract)) {
    return getDocumentMessage(contract);
  }
  
  const topic = extractTopicFromQuery(query);
  
  // If we have a clear topic, generate a query-specific message
  if (topic) {
    const topicLower = topic.toLowerCase();
    
    // Match common query patterns
    if (topicLower.includes('pipeline') || topicLower.includes('feature')) {
      return `Here's an overview of ${topicLower}.`;
    }
    if (topicLower.includes('value') || topicLower.includes('benefit')) {
      return `Here's the value proposition breakdown.`;
    }
    if (topicLower.includes('comparison') || topicLower.includes('vs') || topicLower.includes('difference')) {
      return `Here's the comparison you requested.`;
    }
    
    // Generic but topic-specific message
    return `Here's the information on ${topicLower}.`;
  }
  
  // Fall back to config-based messages
  return getDocumentMessage(contract || 'default');
}

export function isDocumentEligibleContract(contract: AnswerContract): boolean {
  return shouldGenerateDocument(contract, 0);
}

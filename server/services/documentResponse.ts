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
import { AnswerContract } from "../controlPlane/answerContracts";

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
    
    const docTitle = title || generateTitleFromQuery(userQuery, contract, customerName);
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
 * Extract a concise topic from the user's query for use in titles.
 * Removes filler words and extracts the core subject.
 */
function extractTopicFromQuery(query?: string): string | null {
  if (!query || query.length < 5) return null;
  
  // Remove common question starters and filler phrases
  let topic = query
    .replace(/^(what|how|can you|please|could you|tell me|explain|give me|show me|i need|i want)\s+(is|are|about|the|a|an)?\s*/gi, '')
    .replace(/\?+$/g, '')
    .trim();
  
  // Capitalize first letter
  if (topic.length > 0) {
    topic = topic.charAt(0).toUpperCase() + topic.slice(1);
  }
  
  // If topic is too long, truncate at a sensible word boundary
  if (topic.length > 50) {
    const words = topic.split(' ').slice(0, 6);
    topic = words.join(' ');
  }
  
  return topic.length > 3 ? topic : null;
}

/**
 * Generate a document title based on the user's query, falling back to contract-based title.
 */
function generateTitleFromQuery(query?: string, contract?: AnswerContract, customerName?: string): string {
  const customer = customerName || "General";
  
  // For certain contracts, always use contract-based title (not query-based)
  const useContractTitleContracts = [
    AnswerContract.DRAFT_EMAIL,
    AnswerContract.DRAFT_RESPONSE,
    AnswerContract.MEETING_SUMMARY,
    AnswerContract.VALUE_PROPOSITION,
  ];
  
  if (contract && useContractTitleContracts.includes(contract)) {
    return generateTitleFromContract(contract, customerName);
  }
  
  const topic = extractTopicFromQuery(query);
  
  // If we have a clear topic from the query, use it
  if (topic) {
    // For product-related queries, prefix with PitCrew
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
  // For certain contracts, always use config-based messages
  const useConfigMessageContracts = [
    AnswerContract.DRAFT_EMAIL,
    AnswerContract.DRAFT_RESPONSE,
    AnswerContract.MEETING_SUMMARY,
    AnswerContract.VALUE_PROPOSITION,
  ];
  
  if (contract && useConfigMessageContracts.includes(contract)) {
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

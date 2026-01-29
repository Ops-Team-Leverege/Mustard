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
  const { channel, threadTs, content, contract, customerName, title } = params;
  
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
    
    const docTitle = title || generateTitleFromContract(contract, customerName);
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
    const slackMessage = getDocumentMessage(contract);
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

function generateTitleFromContract(contract: AnswerContract, customerName?: string): string {
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

export function isDocumentEligibleContract(contract: AnswerContract): boolean {
  return shouldGenerateDocument(contract, 0);
}

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

export async function sendResponseWithDocumentSupport(
  params: DocumentResponseParams
): Promise<DocumentResponseResult> {
  const { channel, threadTs, content, contract, customerName, title } = params;
  
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
    const docTitle = title || generateTitleFromContract(contract, customerName);
    const sections = contentToSections(content, docTitle);
    
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
    
    const fileName = generateFileName(contract, customerName);
    const slackMessage = getDocumentMessage(contract);
    
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
    console.error("[DocumentResponse] Failed to generate/upload document, falling back to message:", error);
    
    try {
      await postSlackMessage({
        channel,
        text: content,
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
    default:
      return `PitCrew Document - ${customer}`;
  }
}

export function isDocumentEligibleContract(contract: AnswerContract): boolean {
  return shouldGenerateDocument(contract, 0);
}

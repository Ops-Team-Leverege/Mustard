import OpenAI from "openai";
import type { Category } from "@shared/schema";

// Using OpenAI blueprint - the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 180000, // 3 minutes timeout for very long transcripts
  maxRetries: 0, // No retries to avoid further delays
});

interface TranscriptAnalysisInput {
  transcript: string;
  companyName: string;
  leverageTeam: string[];
  customerNames: string[];
  categories: Category[];
  contentType?: "transcript" | "notes";
}

export interface ProductInsightResult {
  feature: string;
  context: string;
  quote: string;
  categoryId: string | null;
}

export interface QAPairResult {
  question: string;
  answer: string;
  asker: string;
  categoryId: string | null;
}

export interface POSSystemResult {
  name: string;
  websiteLink?: string;
  description?: string;
}

export interface AnalysisResult {
  insights: ProductInsightResult[];
  qaPairs: QAPairResult[];
  posSystem: POSSystemResult | null;
}

// Split transcript into chunks at natural boundaries
function splitTranscriptIntoChunks(transcript: string, maxChunkSize: number = 15000): string[] {
  // If transcript is small enough, return as single chunk
  if (transcript.length <= maxChunkSize) {
    return [transcript];
  }

  const chunks: string[] = [];
  let remainingText = transcript;

  while (remainingText.length > 0) {
    if (remainingText.length <= maxChunkSize) {
      chunks.push(remainingText);
      break;
    }

    // Try to split at a paragraph boundary (double newline)
    let splitIndex = remainingText.lastIndexOf('\n\n', maxChunkSize);
    
    // If no paragraph boundary, try single newline
    if (splitIndex === -1 || splitIndex < maxChunkSize * 0.7) {
      splitIndex = remainingText.lastIndexOf('\n', maxChunkSize);
    }
    
    // If still no good split point, try a period with space
    if (splitIndex === -1 || splitIndex < maxChunkSize * 0.7) {
      splitIndex = remainingText.lastIndexOf('. ', maxChunkSize);
      if (splitIndex !== -1) splitIndex += 1; // Include the period
    }
    
    // If still nothing, just split at maxChunkSize
    if (splitIndex === -1 || splitIndex < maxChunkSize * 0.7) {
      splitIndex = maxChunkSize;
    }

    chunks.push(remainingText.substring(0, splitIndex).trim());
    remainingText = remainingText.substring(splitIndex).trim();
  }

  return chunks;
}

async function analyzeTranscriptChunk(
  transcript: string,
  companyName: string,
  leverageTeam: string[],
  customerNames: string[],
  categories: Category[],
  chunkNumber: number = 1,
  totalChunks: number = 1,
  contentType: "transcript" | "notes" = "transcript"
): Promise<AnalysisResult> {
  const categoryList = categories.map(c => 
    `- ${c.name} (ID: ${c.id})${c.description ? `: ${c.description}` : ''}`
  ).join('\n');
  
  const chunkInfo = totalChunks > 1 ? ` (Part ${chunkNumber} of ${totalChunks})` : '';
  
  const isNotes = contentType === "notes";
  const contentLabel = isNotes ? "meeting notes" : "BD (Business Development) call transcript";
  
  const prompt = `You are analyzing ${contentLabel} to extract product insights and Q&A pairs${chunkInfo}.

${isNotes ? 'MEETING NOTES:' : 'TRANSCRIPT:'}
${transcript}

CONTEXT:
- Company: ${companyName}
- Leverege Team Members: ${leverageTeam.join(', ')}
- Customer Names: ${customerNames.join(', ')}

AVAILABLE CATEGORIES:
${categoryList}

${isNotes ? `
NOTE: These are meeting notes from an onsite visit, not a full transcript. The notes may be brief, informal, or fragmented. Extract insights and questions based on the captured information, understanding that details may be condensed or paraphrased by the note-taker.
` : ''}

TASK 1 - Extract Product Insights (LEARNINGS ONLY):
Focus on meaningful learnings, NOT simple confirmations or explanations. Extract insights ONLY if they meet one of these criteria:

A) Customer comments on EXISTING features that reveal VALUE/USEFULNESS:
   - How useful/important a feature is to them
   - Their specific use case that shows why they need it
   - Pain points the feature would solve

B) Customer asks about or expresses interest in NEW features we DON'T currently have:
   - Requests for capabilities we don't offer
   - Questions about features we're missing
   - Suggestions for improvements

DO NOT include:
- Simple confirmations of how a feature works
${isNotes ? '- General observations without specific product relevance' : '- BD team explaining features (unless customer responds with value/need)'}
- Administrative or scheduling topics

For each insight:
- feature: The specific feature or capability name
- context: Why this feature is important/valuable to the customer (their use case/need)
- quote: ${isNotes ? 'Key observation or customer statement from notes - lightly paraphrased for clarity' : 'Customer quote - lightly paraphrased for readability while preserving exact intent and meaning'}
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

TASK 2 - Extract Q&A Pairs:
${isNotes ? 'Identify any product-specific questions that were asked and answered during the meeting.' : 'Identify product-specific questions asked during the call.'} For each:
- question: The question that was asked (product-related only, not scheduling/admin) - lightly paraphrased for clarity
- answer: The answer that was provided - lightly paraphrased for clarity
- asker: The name of the person who asked (from customer names list)
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

TASK 3 - Detect Point of Sale (POS) System:
If the customer mentions their POS system by name (e.g., Square, Toast, Clover, Lightspeed, NCR, etc.), extract:
- name: The POS system name (normalized, e.g., "Square" not "square pos system")
- websiteLink: If mentioned or if you know it, provide the official website (optional)
- description: Brief description of what was mentioned about it (optional)

If no POS system is mentioned, set "posSystem" to null.

OUTPUT FORMAT:
Respond with valid JSON in this exact structure:
{
  "insights": [
    {
      "feature": "feature name",
      "context": "why valuable to customer",
      "quote": "paraphrased customer quote (readable, intent preserved)",
      "categoryId": "category-id-or-null"
    }
  ],
  "qaPairs": [
    {
      "question": "paraphrased question (clear and readable)",
      "answer": "paraphrased answer (clear and readable)",
      "asker": "person name",
      "categoryId": "category-id-or-null"
    }
  ],
  "posSystem": {
    "name": "POS system name",
    "websiteLink": "https://example.com (optional)",
    "description": "brief description (optional)"
  }
}

IMPORTANT:
- Be SELECTIVE - only include real learnings, not confirmations
- Paraphrase quotes lightly for readability without changing meaning
- Focus on VALUE and NEW capabilities
- categoryId must be one of the IDs listed above or null
- Only include product-specific Q&A, not logistics/scheduling`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing business development call transcripts to extract product insights and customer questions. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    const result: AnalysisResult = JSON.parse(content);
    
    // Validate structure
    if (!result.insights || !Array.isArray(result.insights)) {
      result.insights = [];
    }
    if (!result.qaPairs || !Array.isArray(result.qaPairs)) {
      result.qaPairs = [];
    }
    if (!result.posSystem) {
      result.posSystem = null;
    }

    return result;
  } catch (error) {
    console.error("Error analyzing transcript chunk:", error);
    throw new Error(`Failed to analyze transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function analyzeTranscript(
  input: TranscriptAnalysisInput
): Promise<AnalysisResult> {
  const chunks = splitTranscriptIntoChunks(input.transcript);
  const contentType = input.contentType || "transcript";
  
  console.log(`Analyzing ${contentType} in ${chunks.length} chunk(s)...`);
  
  // If single chunk, process normally
  if (chunks.length === 1) {
    return await analyzeTranscriptChunk(
      chunks[0],
      input.companyName,
      input.leverageTeam,
      input.customerNames,
      input.categories,
      1,
      1,
      contentType
    );
  }
  
  // Process multiple chunks and merge results
  const allInsights: ProductInsightResult[] = [];
  const allQAPairs: QAPairResult[] = [];
  let detectedPOSSystem: POSSystemResult | null = null;
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1} of ${chunks.length}...`);
    
    const chunkResult = await analyzeTranscriptChunk(
      chunks[i],
      input.companyName,
      input.leverageTeam,
      input.customerNames,
      input.categories,
      i + 1,
      chunks.length,
      contentType
    );
    
    allInsights.push(...chunkResult.insights);
    allQAPairs.push(...chunkResult.qaPairs);
    
    // Take the first non-null POS system detected
    if (chunkResult.posSystem && !detectedPOSSystem) {
      detectedPOSSystem = chunkResult.posSystem;
    }
  }
  
  console.log(`Merged results: ${allInsights.length} insights, ${allQAPairs.length} Q&A pairs${detectedPOSSystem ? ', POS system detected: ' + detectedPOSSystem.name : ''}`);
  
  return {
    insights: allInsights,
    qaPairs: allQAPairs,
    posSystem: detectedPOSSystem
  };
}

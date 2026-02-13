import OpenAI from "openai";
import type { Category } from "@shared/schema";
import { MODEL_ASSIGNMENTS } from "./config/models";
import { TRANSCRIPT_ANALYZER_SYSTEM_PROMPT, buildTranscriptAnalysisPrompt } from "./config/prompts";
import { TIMEOUT_CONSTANTS, MEETING_CONSTANTS } from "./config/constants";
import { parseTranscriptTurns } from "./ingestion/ingestTranscriptChunks";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: TIMEOUT_CONSTANTS.TRANSCRIPT_ANALYSIS_TIMEOUT_MS,
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

function splitTranscriptByTurns(transcript: string, maxChunkSize: number = MEETING_CONSTANTS.MAX_CHUNK_SIZE): string[] {
  if (transcript.length <= maxChunkSize) {
    return [transcript];
  }

  const turns = parseTranscriptTurns(transcript);

  if (turns.length === 0) {
    return [transcript];
  }

  const chunks: string[] = [];
  let currentChunkTurns: string[] = [];
  let currentLength = 0;

  for (const turn of turns) {
    const turnText = `${turn.speakerName}: ${turn.content}`;
    const turnLength = turnText.length + 1;

    if (currentLength + turnLength > maxChunkSize && currentChunkTurns.length > 0) {
      chunks.push(currentChunkTurns.join("\n"));
      currentChunkTurns = [];
      currentLength = 0;
    }

    currentChunkTurns.push(turnText);
    currentLength += turnLength;
  }

  if (currentChunkTurns.length > 0) {
    chunks.push(currentChunkTurns.join("\n"));
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

  const prompt = buildTranscriptAnalysisPrompt({
    transcript,
    companyName,
    leverageTeam,
    customerNames,
    categoryList,
    contentType,
    chunkInfo,
  });

  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.TRANSCRIPT_ANALYSIS,
      // Note: gpt-5 only supports temperature=1 (default), so we don't override temperature/top_p here
      messages: [
        {
          role: "system",
          content: TRANSCRIPT_ANALYZER_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: prompt,
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
  const chunks = splitTranscriptByTurns(input.transcript);
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

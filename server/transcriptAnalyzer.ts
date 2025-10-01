import OpenAI from "openai";
import type { Category } from "@shared/schema";

// Using OpenAI blueprint - the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface TranscriptAnalysisInput {
  transcript: string;
  companyName: string;
  leverageTeam: string[];
  customerNames: string[];
  categories: Category[];
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
}

export interface AnalysisResult {
  insights: ProductInsightResult[];
  qaPairs: QAPairResult[];
}

export async function analyzeTranscript(
  input: TranscriptAnalysisInput
): Promise<AnalysisResult> {
  const categoryList = input.categories.map(c => 
    `- ${c.name} (ID: ${c.id})${c.description ? `: ${c.description}` : ''}`
  ).join('\n');
  
  const prompt = `You are analyzing a BD (Business Development) call transcript to extract product insights and Q&A pairs.

TRANSCRIPT:
${input.transcript}

CONTEXT:
- Company: ${input.companyName}
- Leverege Team Members: ${input.leverageTeam.join(', ')}
- Customer Names: ${input.customerNames.join(', ')}

AVAILABLE CATEGORIES:
${categoryList}

TASK 1 - Extract Product Insights:
Identify any features or capabilities the customer asked about or expressed interest in. For each:
- feature: The specific feature or capability name
- context: Why this feature is important to the customer (their use case/need)
- quote: A direct quote from the customer about this feature (verbatim from transcript)
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

TASK 2 - Extract Q&A Pairs:
Identify product-specific questions asked during the call. For each:
- question: The question that was asked (product-related only, not scheduling/admin)
- answer: The answer that was provided
- asker: The name of the person who asked (from customer names list)

OUTPUT FORMAT:
Respond with valid JSON in this exact structure:
{
  "insights": [
    {
      "feature": "feature name",
      "context": "why important to customer",
      "quote": "exact customer quote",
      "categoryId": "category-id-or-null"
    }
  ],
  "qaPairs": [
    {
      "question": "the question asked",
      "answer": "the answer provided",
      "asker": "person name"
    }
  ]
}

IMPORTANT:
- Only include actual product features discussed, not general conversation
- Quotes must be verbatim from the transcript
- categoryId must be one of the IDs listed above or null
- Only include product-specific questions, not logistics/scheduling
- Be thorough but accurate`;

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

    return result;
  } catch (error) {
    console.error("Error analyzing transcript:", error);
    throw new Error(`Failed to analyze transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

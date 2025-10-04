import OpenAI from "openai";
import type { Category } from "@shared/schema";

// Using OpenAI blueprint - the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 90000, // 90 seconds timeout for long transcripts
  maxRetries: 0, // No retries to avoid further delays
});

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
  categoryId: string | null;
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
- BD team explaining features (unless customer responds with value/need)
- Administrative or scheduling topics

For each insight:
- feature: The specific feature or capability name
- context: Why this feature is important/valuable to the customer (their use case/need)
- quote: Customer quote - lightly paraphrased for readability while preserving exact intent and meaning
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

TASK 2 - Extract Q&A Pairs:
Identify product-specific questions asked during the call. For each:
- question: The question that was asked (product-related only, not scheduling/admin) - lightly paraphrased for clarity
- answer: The answer that was provided - lightly paraphrased for clarity
- asker: The name of the person who asked (from customer names list)
- categoryId: Match to one of the category IDs above, or null if no good match (will be marked as NEW)

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
  ]
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

    return result;
  } catch (error) {
    console.error("Error analyzing transcript:", error);
    throw new Error(`Failed to analyze transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

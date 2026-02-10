/**
 * Prompt Sufficiency Detector
 * 
 * Determines whether a user's GENERAL_HELP request needs comprehensive guidance (GUIDED)
 * or if they've provided sufficient detail to execute directly (MINIMAL).
 * 
 * Architecture:
 * - Fast-path: Simple heuristic (message length) for obvious cases
 * - LLM fallback: Semantic understanding for ambiguous cases
 * 
 * Principle: Avoid keyword lists. Use objective heuristics + LLM semantic understanding.
 */

import { OpenAI } from "openai";
import { MODEL_ASSIGNMENTS } from "../config/models";

export type PromptMode = "MINIMAL" | "GUIDED";

export type SufficiencyResult = {
    mode: PromptMode;
    confidence: number;
    reason: string;
    detectionMethod: "heuristic" | "llm";
};

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
});

/**
 * Fast heuristic detection for obvious cases.
 * Returns null if ambiguous (needs LLM).
 * 
 * IMPORTANT: Keep this EXTREMELY minimal to avoid keyword scope creep.
 * Only check for objective, measurable characteristics.
 */
function detectSufficiencyFastPath(userMessage: string): SufficiencyResult | null {
    // Only use message length as a simple heuristic
    // Very short messages likely need more guidance
    if (userMessage.length < 30) {
        return {
            mode: "GUIDED",
            confidence: 0.7,
            reason: "Very short query likely needs guidance",
            detectionMethod: "heuristic",
        };
    }

    // Everything else goes to LLM for semantic understanding
    return null;
}

/**
 * LLM-based detection for ambiguous cases.
 * Uses semantic understanding to determine if user needs guidance.
 */
async function detectSufficiencyLLM(userMessage: string): Promise<SufficiencyResult> {
    const prompt = `Analyze this user request and determine if they need comprehensive guidance (GUIDED) or if they've provided sufficient detail (MINIMAL).

User Request: "${userMessage}"

MINIMAL Mode (User is Self-Sufficient):
- User specified explicit format ("5 bullets", "brief summary", "3 paragraphs")
- User listed detailed requirements (sections, items, structure)
- User stated clear scope and purpose with specifics
- User provided step-by-step structure

GUIDED Mode (User Needs Structure):
- Vague request without specifics ("draft an email", "help me with X")
- Help-seeking language without details ("what should I say", "how do I")
- Short query without context
- Question format without specifics ("How should I...?")

KEY PRINCIPLE:
Focus on whether the user has PROVIDED STRUCTURE vs NEEDS STRUCTURE.
Not about keywords - about semantic intent.

Examples:
- "Give me 5 bullet points about tire features" → MINIMAL (explicit format: 5 bullets)
- "Draft an email" → GUIDED (no structure provided)
- "Create document with: exec summary, metrics, timeline" → MINIMAL (detailed structure)
- "Help me with pricing" → GUIDED (no structure, needs guidance)
- "Brief summary in 3 paragraphs" → MINIMAL (explicit format: 3 paragraphs)

Respond with JSON:
{
  "mode": "MINIMAL" | "GUIDED",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

    try {
        const response = await openai.chat.completions.create({
            model: MODEL_ASSIGNMENTS.FAST_CLASSIFICATION,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 200,
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");
        return {
            mode: result.mode || "GUIDED",
            confidence: result.confidence || 0.5,
            reason: result.reason || "LLM classification",
            detectionMethod: "llm",
        };
    } catch (error) {
        console.error("[PromptSufficiency] LLM classification error:", error);
        // Default to GUIDED on error (safer to provide more guidance)
        return {
            mode: "GUIDED",
            confidence: 0.5,
            reason: "LLM error, defaulting to GUIDED",
            detectionMethod: "llm",
        };
    }
}

/**
 * Main entry point: Detect prompt sufficiency.
 * Uses fast heuristics first, falls back to LLM if ambiguous.
 */
export async function detectPromptSufficiency(userMessage: string): Promise<SufficiencyResult> {
    // Try fast path first
    const fastResult = detectSufficiencyFastPath(userMessage);
    if (fastResult) {
        console.log(`[PromptSufficiency] Fast path: ${fastResult.mode} (${fastResult.reason})`);
        return fastResult;
    }

    // Fall back to LLM for semantic understanding
    console.log(`[PromptSufficiency] Using LLM classification for: "${userMessage.substring(0, 50)}..."`);
    const llmResult = await detectSufficiencyLLM(userMessage);
    console.log(`[PromptSufficiency] LLM result: ${llmResult.mode} (confidence: ${llmResult.confidence}, reason: ${llmResult.reason})`);

    return llmResult;
}

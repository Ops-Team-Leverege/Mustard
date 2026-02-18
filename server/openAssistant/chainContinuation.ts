/**
 * Chain Continuation Executor
 * 
 * Executes remaining contracts in a chain after the primary contract
 * has been handled by the intent-specific handler.
 * 
 * Architecture:
 * - Intent handlers execute the primary (first) contract using their existing logic
 * - This module handles subsequent contracts, passing prior output as context
 * - Each contract in the chain receives the accumulated output from previous steps
 * - The final output combines all contract results with clear section headers
 * 
 * This is the intent-agnostic continuation layer. It does NOT handle
 * primary contract execution — that stays in each intent handler.
 */

import { OpenAI } from "openai";
import { AnswerContract } from "../decisionLayer/answerContracts";
import { MODEL_ASSIGNMENTS } from "../config/models";
import { getComprehensiveProductKnowledge, formatProductKnowledgeForPrompt } from "../airtable/productData";

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("[ChainContinuation] OPENAI_API_KEY is not set. Cannot execute chain continuation.");
  }
  return new OpenAI({ apiKey });
}

export interface ChainContinuationInput {
  userMessage: string;
  primaryOutput: string;
  remainingContracts: AnswerContract[];
  meetingContext?: {
    companyName: string;
    meetingDate?: Date | null;
  };
}

export interface ChainContinuationResult {
  finalOutput: string;
  contractOutputs: Array<{ contract: AnswerContract; output: string }>;
}

/**
 * Execute remaining contracts in a chain after the primary contract.
 * 
 * Each contract receives the accumulated output from all previous steps.
 * Returns the combined output with section headers for multi-step results.
 */
export async function executeChainContinuation(
  input: ChainContinuationInput
): Promise<ChainContinuationResult> {
  const { userMessage, primaryOutput, remainingContracts, meetingContext } = input;
  const contractOutputs: Array<{ contract: AnswerContract; output: string }> = [];
  let accumulatedContext = primaryOutput;

  console.log(`[ChainContinuation] Executing ${remainingContracts.length} remaining contract(s): [${remainingContracts.join(" → ")}]`);

  for (const contract of remainingContracts) {
    console.log(`[ChainContinuation] Executing continuation contract: ${contract}`);

    const output = await executeContinuationContract(
      contract,
      userMessage,
      accumulatedContext,
      meetingContext
    );

    contractOutputs.push({ contract, output });
    accumulatedContext += `\n\n${output}`;
  }

  console.log(`[ChainContinuation] Chain complete: ${contractOutputs.length} continuation contract(s) executed`);

  return {
    finalOutput: accumulatedContext,
    contractOutputs,
  };
}

/**
 * Execute a single continuation contract with prior output as context.
 */
async function executeContinuationContract(
  contract: AnswerContract,
  userMessage: string,
  priorOutput: string,
  meetingContext?: { companyName: string; meetingDate?: Date | null }
): Promise<string> {
  let enrichedPriorOutput = priorOutput;

  const pkContracts = [
    AnswerContract.PRODUCT_KNOWLEDGE,
    AnswerContract.PRODUCT_INFO,
    AnswerContract.PRODUCT_EXPLANATION,
    AnswerContract.FEATURE_VERIFICATION,
  ];
  if (pkContracts.includes(contract)) {
    try {
      const pkResult = await getComprehensiveProductKnowledge();
      const pkText = formatProductKnowledgeForPrompt(pkResult);
      enrichedPriorOutput = `${priorOutput}\n\n## PitCrew Product Knowledge Reference\n${pkText}`;
      console.log(`[ChainContinuation] Injected product knowledge (${pkText.length} chars) for ${contract}`);
    } catch (err) {
      console.error(`[ChainContinuation] Failed to load product knowledge for ${contract}:`, err);
    }
  }

  const systemPrompt = buildContinuationPrompt(contract, enrichedPriorOutput, meetingContext);

  try {
    const response = await getOpenAI().chat.completions.create({
      model: getContinuationModel(contract),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: getContinuationTemperature(contract),
      max_tokens: 2000,
    });

    const output = response.choices[0]?.message?.content?.trim();
    if (!output) {
      console.error(`[ChainContinuation] Empty response for contract ${contract}`);
      return priorOutput;
    }

    console.log(`[ChainContinuation] ${contract} produced ${output.length} chars`);
    return output;
  } catch (error) {
    console.error(`[ChainContinuation] Error executing ${contract}:`, error);
    return priorOutput;
  }
}

function getContinuationModel(contract: AnswerContract): string {
  switch (contract) {
    case AnswerContract.DRAFT_EMAIL:
    case AnswerContract.DRAFT_RESPONSE:
      return MODEL_ASSIGNMENTS.SINGLE_MEETING_RESPONSE;
    case AnswerContract.SALES_DOCS_PREP:
    case AnswerContract.VALUE_PROPOSITION:
    case AnswerContract.PRODUCT_KNOWLEDGE:
    case AnswerContract.PRODUCT_INFO:
    case AnswerContract.PRODUCT_EXPLANATION:
    case AnswerContract.FEATURE_VERIFICATION:
      return MODEL_ASSIGNMENTS.PRODUCT_KNOWLEDGE_RESPONSE;
    default:
      return MODEL_ASSIGNMENTS.SINGLE_MEETING_RESPONSE;
  }
}

function getContinuationTemperature(contract: AnswerContract): number {
  switch (contract) {
    case AnswerContract.DRAFT_EMAIL:
    case AnswerContract.DRAFT_RESPONSE:
      return 0.7;
    case AnswerContract.SALES_DOCS_PREP:
      return 0.3;
    case AnswerContract.VALUE_PROPOSITION:
    case AnswerContract.PRODUCT_KNOWLEDGE:
    case AnswerContract.PRODUCT_INFO:
    case AnswerContract.PRODUCT_EXPLANATION:
    case AnswerContract.FEATURE_VERIFICATION:
      return 0.3;
    default:
      return 0.5;
  }
}

function buildContinuationPrompt(
  contract: AnswerContract,
  priorOutput: string,
  meetingContext?: { companyName: string; meetingDate?: Date | null }
): string {
  const meetingLine = meetingContext
    ? `\nMeeting: ${meetingContext.companyName}${meetingContext.meetingDate ? ` (${meetingContext.meetingDate.toLocaleDateString()})` : ""}`
    : "";

  switch (contract) {
    case AnswerContract.DRAFT_EMAIL:
      return `You are drafting a professional follow-up email for the Leverege sales team.
${meetingLine}

PRIOR ANALYSIS:
${priorOutput}

Use the analysis above as the basis for the email. Follow these rules:
1. Write a professional, warm follow-up email
2. Reference specific details from the analysis (action items, questions, key points)
3. For pricing questions: mention "per-store flat monthly fee" model but defer specifics to a follow-up call
4. Keep it concise but thorough
5. End with a clear next step or call to action

Format:
- Subject line (prefix with "Subject:")
- Greeting
- Body (2-3 short paragraphs)
- Closing with next step
- Signature placeholder "[Your name]"`;

    case AnswerContract.DRAFT_RESPONSE:
      return `You are helping the Leverege sales team draft a response.
${meetingLine}

PRIOR ANALYSIS:
${priorOutput}

Use the analysis above to craft a helpful, accurate response. Follow these rules:
1. Address the specific points raised
2. Be direct and professional
3. Use information from the prior analysis to support your response
4. Keep it focused and actionable`;

    case AnswerContract.SALES_DOCS_PREP:
      return `You are preparing sales presentation materials for the Leverege/PitCrew team.
${meetingLine}

RESEARCH / PRIOR ANALYSIS:
${priorOutput}

Create structured presentation content based on the analysis above:
1. Structure content for slides (clear headers, bullet points, key stats)
2. Focus on the prospect's specific needs identified in the analysis
3. Connect PitCrew capabilities to the prospect's pain points
4. Include talking points for each section`;

    case AnswerContract.VALUE_PROPOSITION:
      return `You are crafting a value proposition for PitCrew based on prior analysis.
${meetingLine}

PRIOR ANALYSIS:
${priorOutput}

Create a targeted value proposition:
1. Lead with the prospect's specific challenges identified in the analysis
2. Map PitCrew capabilities to their needs
3. Include quantifiable benefits where possible
4. Keep it concise and compelling`;

    case AnswerContract.MEETING_SUMMARY:
      return `You are summarizing meeting content.
${meetingLine}

PRIOR DATA:
${priorOutput}

Provide a clear, structured summary of the key takeaways, decisions, and action items.`;

    case AnswerContract.PRODUCT_KNOWLEDGE:
    case AnswerContract.PRODUCT_INFO:
    case AnswerContract.PRODUCT_EXPLANATION:
    case AnswerContract.FEATURE_VERIFICATION:
      return `You are a product knowledge expert for PitCrew (by Leverege).
${meetingLine}

PRIOR OUTPUT (may contain customer questions, meeting data, or research):
${priorOutput}

Your task: review the prior output against PitCrew's product knowledge.
- If the prior output contains customer questions with answers, assess each answer for correctness
- If the prior output contains unanswered questions, provide answers from product knowledge
- If the prior output contains research or analysis, enrich it with relevant PitCrew capabilities
- Flag any incorrect claims and provide corrections
- Be specific about which PitCrew features or tiers are relevant`;

    default:
      return `You are a helpful assistant for the Leverege/PitCrew sales team.
${meetingLine}

PRIOR CONTEXT:
${priorOutput}

Use the context above to help with the user's request.`;
  }
}

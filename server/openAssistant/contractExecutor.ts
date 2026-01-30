/**
 * Contract Executor Module
 * 
 * Executes ContractChain with authority and evidence threshold enforcement.
 * No routing, intent logic, or meeting resolution - purely focused on
 * executing contracts and enforcing constraints.
 * 
 * KEY ARCHITECTURE:
 * - Extraction contracts: Return raw data from meetings
 * - Synthesis contracts: Gather data, then use LLM to analyze patterns/trends
 */

import { AnswerContract, type SSOTMode, getContractConstraints, type ContractChain } from "../controlPlane/answerContracts";
import type { SingleMeetingContext } from "../mcp/singleMeetingOrchestrator";
import { storage } from "../storage";
import { searchAcrossMeetings } from "./meetingResolver";
import type { ContractExecutionDecision } from "./types";
import { OpenAI } from "openai";
import { MODEL_ASSIGNMENTS } from "../config/models";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Contracts that require LLM synthesis after gathering raw data
const SYNTHESIS_CONTRACTS = [
  AnswerContract.PATTERN_ANALYSIS,
  AnswerContract.TREND_SUMMARY,
  AnswerContract.CROSS_MEETING_QUESTIONS,
];

/**
 * Coverage metadata for language qualification.
 */
export type CoverageContext = {
  totalMeetings: number;
  uniqueCompanies: number;
};

/**
 * Structured result from contract execution with evidence tracking.
 */
interface ContractExecutionResult {
  output: string;
  evidenceFound: boolean;
  evidenceCount: number;
  meetingsWithEvidence: number;
}

/**
 * Execute a contract chain for MULTI_MEETING queries.
 * 
 * Each contract in the chain:
 * - Receives the output of the previous contract as context
 * - Has its own constraints and output format
 * - Contributes to the final response
 * 
 * HARDENING: All contracts go through uniform constraint enforcement.
 */
export async function executeContractChain(
  chain: ContractChain,
  userMessage: string,
  meetings: SingleMeetingContext[],
  topic?: string
): Promise<{ finalOutput: string; chainResults: Array<{ contract: AnswerContract; output: string }> }> {
  const chainResults: Array<{ contract: AnswerContract; output: string }> = [];
  const executionDecisions: ContractExecutionDecision[] = [];
  let previousOutput = "";
  
  const uniqueCompanyIds = new Set(meetings.map(m => m.companyId));
  const coverage: CoverageContext = {
    totalMeetings: meetings.length,
    uniqueCompanies: uniqueCompanyIds.size,
  };
  console.log(`[ContractExecutor] Chain execution with coverage: ${coverage.totalMeetings} meetings, ${coverage.uniqueCompanies} companies`);
  
  if (chain.clarifyReason) {
    console.log(`[ContractExecutor] Chain validation failed, returning CLARIFY: ${chain.clarifyReason}`);
    return { 
      finalOutput: chain.clarifyReason, 
      chainResults: [{ contract: AnswerContract.CLARIFY, output: chain.clarifyReason }] 
    };
  }
  
  for (const contract of chain.contracts) {
    const constraints = getContractConstraints(contract);
    
    const decision: ContractExecutionDecision = {
      contract,
      authority: constraints.ssotMode,
      authorityValidated: true,
      evidenceCount: meetings.length,
      executionOutcome: "executed",
    };
    
    if (constraints.ssotMode === "authoritative") {
      console.warn(`[ContractExecutor] Authoritative contract ${contract} requires Product SSOT - refusing without explicit evidence`);
      decision.authorityValidated = false;
      decision.executionOutcome = "short_circuit_refuse";
      executionDecisions.push(decision);
      
      return { 
        finalOutput: "I can't provide authoritative product information without verified product documentation. For accurate details about features, pricing, or integrations, please check the product knowledge base or contact the product team.",
        chainResults: [{ contract: AnswerContract.REFUSE, output: "Authority requirements not met: Product SSOT unavailable" }]
      };
    }
    
    if (constraints.minEvidenceThreshold && meetings.length < constraints.minEvidenceThreshold) {
      console.log(`[ContractExecutor] Evidence threshold not met: need ${constraints.minEvidenceThreshold}, have ${meetings.length}`);
      decision.executionOutcome = "evidence_threshold_not_met";
      
      if (constraints.emptyResultBehavior === "clarify") {
        executionDecisions.push(decision);
        return {
          finalOutput: `I need more data to provide a reliable ${getContractHeader(contract).toLowerCase()}. Found ${meetings.length} meeting(s), but need at least ${constraints.minEvidenceThreshold} for this type of analysis.`,
          chainResults: [{ contract: AnswerContract.CLARIFY, output: "Evidence threshold not met" }]
        };
      }
    }
    
    console.log(`[ContractExecutor] Executing contract: ${contract} (authority: ${constraints.ssotMode}, format: ${constraints.responseFormat}, meetings: ${meetings.length})`);
    
    const contextForContract = previousOutput 
      ? `Previous analysis:\n${previousOutput}\n\nNow applying ${contract} analysis:`
      : "";
    
    const executionResult = await executeMultiMeetingContract(
      contract,
      userMessage,
      meetings,
      contextForContract,
      constraints,
      coverage,
      topic
    );
    
    decision.evidenceCount = executionResult.evidenceCount;
    
    if (!executionResult.evidenceFound && constraints.emptyResultBehavior) {
      console.log(`[ContractExecutor] Contract ${contract} returned no evidence (count=${executionResult.evidenceCount}, meetingsContributing=${executionResult.meetingsWithEvidence}), applying emptyResultBehavior: ${constraints.emptyResultBehavior}`);
      decision.executionOutcome = "empty_evidence";
      
      const topicClause = topic ? ` about "${topic}"` : '';
      const companyNames = Array.from(new Set(meetings.map(m => m.companyName))).join(", ");
      
      if (constraints.emptyResultBehavior === "refuse") {
        executionDecisions.push(decision);
        return {
          finalOutput: `I couldn't find any discussion${topicClause} in the ${meetings.length} ${companyNames} meeting(s) I searched. It may not have been discussed, or you might want to try different search terms.`,
          chainResults: [{ contract: AnswerContract.REFUSE, output: "Empty evidence - refused" }]
        };
      } else if (constraints.emptyResultBehavior === "clarify") {
        executionDecisions.push(decision);
        return {
          finalOutput: `I searched ${meetings.length} ${companyNames} meeting(s) but couldn't find any discussion${topicClause}. Would you like me to search for something else, or can you provide more details?`,
          chainResults: [{ contract: AnswerContract.CLARIFY, output: "Empty evidence - clarification needed" }]
        };
      }
    }
    
    chainResults.push({ contract, output: executionResult.output });
    previousOutput = executionResult.output;
    executionDecisions.push(decision);
  }
  
  console.log(`[ContractExecutor] Chain execution complete:`, 
    JSON.stringify(executionDecisions.map(d => ({
      contract: d.contract,
      authority: d.authority,
      validated: d.authorityValidated,
      outcome: d.executionOutcome
    }))));
  
  let finalOutput: string;
  if (chain.contracts.length > 1) {
    finalOutput = chainResults.map((r, i) => {
      const header = getContractHeader(r.contract);
      return `**${header}**\n${r.output}`;
    }).join("\n\n");
  } else {
    finalOutput = chainResults[0]?.output || "No results found.";
  }
  
  return { finalOutput, chainResults };
}

/**
 * Fetch actual evidence from database for contracts that support it.
 * Returns structured counts from real data, not LLM output heuristics.
 */
async function fetchActualEvidence(
  contract: AnswerContract,
  meetings: SingleMeetingContext[]
): Promise<{ count: number; meetingsWithEvidence: number; items: unknown[] }> {
  const meetingIds = meetings.map(m => m.meetingId);
  let items: unknown[] = [];
  let meetingsWithEvidence = 0;
  
  try {
    switch (contract) {
      case AnswerContract.CROSS_MEETING_QUESTIONS:
      case AnswerContract.CUSTOMER_QUESTIONS:
        for (const meetingId of meetingIds) {
          const questions = await storage.getCustomerQuestionsByTranscript(meetingId);
          if (questions.length > 0) {
            items.push(...questions);
            meetingsWithEvidence++;
          }
        }
        break;
        
      case AnswerContract.ATTENDEES:
        for (const meeting of meetings) {
          const transcript = await storage.getTranscript("PitCrew", meeting.meetingId);
          if (transcript) {
            const hasAttendees = (transcript.leverageTeam && transcript.leverageTeam.length > 0) ||
                                 (transcript.customerNames && transcript.customerNames.length > 0);
            if (hasAttendees) {
              items.push({ meetingId: meeting.meetingId, attendees: transcript.leverageTeam, customers: transcript.customerNames });
              meetingsWithEvidence++;
            }
          }
        }
        break;
        
      default:
        items = meetings;
        meetingsWithEvidence = meetings.length;
    }
  } catch (error) {
    console.warn(`[fetchActualEvidence] Error fetching evidence for ${contract}:`, error);
  }
  
  return {
    count: items.length,
    meetingsWithEvidence,
    items,
  };
}

/**
 * Execute a single contract for MULTI_MEETING analysis.
 * Returns structured result with evidence tracking for emptyResultBehavior enforcement.
 */
async function executeMultiMeetingContract(
  contract: AnswerContract,
  userMessage: string,
  meetings: SingleMeetingContext[],
  previousContext: string,
  constraints: { ssotMode: SSOTMode; responseFormat: string; requiresCitation: boolean },
  coverage?: CoverageContext,
  topic?: string
): Promise<ContractExecutionResult> {
  const actualEvidence = await fetchActualEvidence(contract, meetings);
  console.log(`[executeMultiMeetingContract] ${contract}: actual evidence count=${actualEvidence.count}, meetingsWithEvidence=${actualEvidence.meetingsWithEvidence}`);
  
  // Extraction-only contracts (no synthesis needed)
  // Note: CROSS_MEETING_QUESTIONS needs synthesis, so it's NOT in this list
  const isExtractionOnlyContract = [
    AnswerContract.CUSTOMER_QUESTIONS,
    AnswerContract.ATTENDEES,
  ].includes(contract);
  
  if (isExtractionOnlyContract && actualEvidence.count === 0) {
    return {
      output: `No ${contract === AnswerContract.ATTENDEES ? 'attendee information' : 'customer questions'} found in the searched meetings.`,
      evidenceFound: false,
      evidenceCount: 0,
      meetingsWithEvidence: 0,
    };
  }
  
  const contractPrompt = getContractPrompt(contract, previousContext, coverage);
  const fullQuery = contractPrompt ? `${contractPrompt}\n\nUser question: ${userMessage}` : userMessage;
  
  const rawOutput = await searchAcrossMeetings(fullQuery, meetings, topic);
  
  if (isExtractionOnlyContract) {
    return {
      output: rawOutput,
      evidenceFound: actualEvidence.count > 0,
      evidenceCount: actualEvidence.count,
      meetingsWithEvidence: actualEvidence.meetingsWithEvidence,
    };
  }
  
  // SYNTHESIS STEP: For analysis contracts, synthesize raw excerpts into insights
  if (SYNTHESIS_CONTRACTS.includes(contract)) {
    console.log(`[ContractExecutor] Applying synthesis step for ${contract}`);
    // Compute accurate coverage from meetings if not provided
    const uniqueCompanyIds = new Set(meetings.map(m => m.companyId));
    const effectiveCoverage = coverage || { 
      totalMeetings: meetings.length, 
      uniqueCompanies: uniqueCompanyIds.size 
    };
    const synthesizedOutput = await synthesizeAnalysis(
      contract,
      userMessage,
      rawOutput,
      meetings,
      effectiveCoverage
    );
    
    const evidenceResult = analyzeOutputForEvidence(contract, synthesizedOutput, meetings.length);
    
    return {
      output: synthesizedOutput,
      evidenceFound: evidenceResult.found,
      evidenceCount: evidenceResult.count,
      meetingsWithEvidence: evidenceResult.meetingsContributing,
    };
  }
  
  const evidenceResult = analyzeOutputForEvidence(contract, rawOutput, meetings.length);
  
  return {
    output: rawOutput,
    evidenceFound: evidenceResult.found,
    evidenceCount: evidenceResult.count,
    meetingsWithEvidence: evidenceResult.meetingsContributing,
  };
}

/**
 * Analyze contract output to determine evidence presence.
 * Uses contract-specific heuristics to count distinct evidence items.
 */
function analyzeOutputForEvidence(
  contract: AnswerContract,
  output: string,
  totalMeetings: number
): { found: boolean; count: number; meetingsContributing: number } {
  if (!output || output.length < 15) {
    return { found: false, count: 0, meetingsContributing: 0 };
  }
  
  const noEvidencePatterns = [
    /no (data|evidence|results|questions|items|attendees|information) (found|available|detected)/i,
    /could not find|couldn't find|unable to (find|locate)/i,
    /no specific (questions|concerns|topics)/i,
    /didn't (find|mention|discuss)/i,
  ];
  
  for (const pattern of noEvidencePatterns) {
    if (pattern.test(output)) {
      return { found: false, count: 0, meetingsContributing: 0 };
    }
  }
  
  let evidenceCount = 0;
  let meetingsContributing = 0;
  
  switch (contract) {
    case AnswerContract.CROSS_MEETING_QUESTIONS:
    case AnswerContract.CUSTOMER_QUESTIONS:
      evidenceCount = (output.match(/\?/g) || []).length;
      meetingsContributing = Math.min(totalMeetings, (output.match(/\b(meeting|call|conversation)\b/gi) || []).length);
      break;
      
    case AnswerContract.ATTENDEES:
      evidenceCount = (output.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || []).length;
      meetingsContributing = Math.min(totalMeetings, 1);
      break;
      
    case AnswerContract.PATTERN_ANALYSIS:
    case AnswerContract.TREND_SUMMARY:
      evidenceCount = (output.match(/^[\-\*\d\.]+\s/gm) || []).length;
      if (evidenceCount === 0) {
        evidenceCount = Math.max(1, (output.match(/\./g) || []).length);
      }
      meetingsContributing = totalMeetings;
      break;
      
    case AnswerContract.COMPARISON:
      evidenceCount = (output.match(/\b(differ|similar|unlike|whereas|however|in contrast)\b/gi) || []).length;
      meetingsContributing = Math.min(totalMeetings, 2);
      break;
      
    default:
      evidenceCount = Math.max(1, (output.match(/[.!?]/g) || []).length);
      meetingsContributing = 1;
  }
  
  return {
    found: evidenceCount > 0,
    count: evidenceCount,
    meetingsContributing: Math.max(0, meetingsContributing),
  };
}

/**
 * Get a human-readable header for a contract in chained output.
 */
export function getContractHeader(contract: AnswerContract): string {
  switch (contract) {
    case AnswerContract.CROSS_MEETING_QUESTIONS:
      return "Customer Questions Across Meetings";
    case AnswerContract.PATTERN_ANALYSIS:
      return "Pattern Analysis";
    case AnswerContract.COMPARISON:
      return "Comparison";
    case AnswerContract.TREND_SUMMARY:
      return "Trend Summary";
    default:
      return contract;
  }
}

/**
 * Get coverage-aware language qualification instructions.
 * 
 * HARDENING: Coverage must constrain how confident the system is allowed to sound.
 * Limited coverage requires explicit qualification of claims.
 */
export function getCoverageQualification(coverage: CoverageContext): string {
  const { totalMeetings, uniqueCompanies } = coverage;
  
  if (totalMeetings <= 2 || uniqueCompanies <= 1) {
    return `

IMPORTANT - LIMITED COVERAGE QUALIFICATION:
You are analyzing only ${totalMeetings} meeting(s) from ${uniqueCompanies} company/companies.
With limited coverage, you MUST:
- Explicitly state the sample size: "Based on ${totalMeetings} meeting(s)..."
- Avoid unqualified generalizations like "customers consistently..." or "typically..."
- Use hedged language: "In these meetings...", "From what I found...", "Among the meetings reviewed..."
- Do NOT extrapolate beyond what was directly observed`;
  }
  
  if (totalMeetings <= 5 || uniqueCompanies <= 2) {
    return `

COVERAGE NOTE:
You are analyzing ${totalMeetings} meeting(s) from ${uniqueCompanies} company/companies.
- Include sample size when making analytical claims: "Across ${totalMeetings} meetings..."
- Qualify patterns: "In several meetings reviewed..." rather than absolute statements`;
  }
  
  return `

COVERAGE: Analyzing ${totalMeetings} meeting(s) from ${uniqueCompanies} company/companies.
When drawing conclusions, you may make analytical claims but should still ground them in the evidence.`;
}

/**
 * Get contract-specific prompting instructions with coverage qualification.
 */
function getContractPrompt(contract: AnswerContract, previousContext: string, coverage?: CoverageContext): string {
  const contextPrefix = previousContext ? `${previousContext}\n\n` : "";
  const coverageQualification = coverage ? getCoverageQualification(coverage) : "";
  
  switch (contract) {
    case AnswerContract.CROSS_MEETING_QUESTIONS:
      return `${contextPrefix}Focus on extracting and listing customer questions from these meetings. Include verbatim quotes where possible.${coverageQualification}`;
    case AnswerContract.PATTERN_ANALYSIS:
      return `${contextPrefix}Analyze patterns and recurring themes across these meetings. Identify what comes up frequently.${coverageQualification}`;
    case AnswerContract.COMPARISON:
      return `${contextPrefix}Compare and contrast the discussions across these meetings. Highlight key differences.${coverageQualification}`;
    case AnswerContract.TREND_SUMMARY:
      return `${contextPrefix}Summarize how topics or concerns have evolved over time across these meetings.${coverageQualification}`;
    default:
      return contextPrefix + coverageQualification;
  }
}

/**
 * Select appropriate contract for MULTI_MEETING queries.
 * Uses keyword-first deterministic matching.
 * 
 * IMPORTANT: Keywords are used only to infer the analytical task
 * (e.g., comparison vs pattern), not to create new intent categories
 * or topic-specific contracts.
 * 
 * This is task inference within a fixed intent, not intent classification.
 */
export function selectMultiMeetingContract(userMessage: string): AnswerContract {
  const msg = userMessage.toLowerCase();
  
  if (/pattern|recurring|common|theme|frequently|often|always/i.test(msg)) {
    return AnswerContract.PATTERN_ANALYSIS;
  }
  
  if (/compare|difference|differ|contrast|versus|vs\.?|between/i.test(msg)) {
    return AnswerContract.COMPARISON;
  }
  
  if (/trend|over time|change|evolving|growing|declining|progression/i.test(msg)) {
    return AnswerContract.TREND_SUMMARY;
  }
  
  if (/questions|asked|concerns|issues|objections/i.test(msg)) {
    return AnswerContract.CROSS_MEETING_QUESTIONS;
  }
  
  return AnswerContract.PATTERN_ANALYSIS;
}

/**
 * Map SingleMeetingOrchestrator's internal intent to an AnswerContract.
 * 
 * The orchestrator has its own intent classification (extractive/aggregative/summary)
 * which we map to the appropriate contract. The chain's primary contract is used
 * as a fallback if the orchestrator intent doesn't map directly.
 */
export function mapOrchestratorIntentToContract(
  orchestratorIntent: "extractive" | "aggregative" | "summary",
  chainPrimaryContract: AnswerContract
): AnswerContract {
  switch (orchestratorIntent) {
    case "extractive":
      return AnswerContract.EXTRACTIVE_FACT;
    case "aggregative":
      return AnswerContract.AGGREGATIVE_LIST;
    case "summary":
      return AnswerContract.MEETING_SUMMARY;
    default:
      return chainPrimaryContract;
  }
}

/**
 * Synthesize raw excerpts into structured analysis using LLM.
 * 
 * This is the key step that transforms raw transcript excerpts into
 * actionable insights with patterns, frequencies, and groupings.
 */
async function synthesizeAnalysis(
  contract: AnswerContract,
  userMessage: string,
  rawExcerpts: string,
  meetings: SingleMeetingContext[],
  coverage: CoverageContext
): Promise<string> {
  const uniqueCompanies = Array.from(new Set(meetings.map(m => m.companyName)));
  const companyList = uniqueCompanies.slice(0, 5).join(", ") + (uniqueCompanies.length > 5 ? ` and ${uniqueCompanies.length - 5} more` : "");
  
  const synthesisPrompt = getSynthesisPrompt(contract, coverage, companyList);
  
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_ASSIGNMENTS.MULTI_MEETING_SYNTHESIS,
      messages: [
        {
          role: "system",
          content: synthesisPrompt,
        },
        {
          role: "user",
          content: `USER QUESTION: ${userMessage}\n\n=== RAW DATA FROM ${coverage.totalMeetings} MEETINGS ===\n${rawExcerpts}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });
    
    const synthesis = response.choices[0]?.message?.content || rawExcerpts;
    console.log(`[ContractExecutor] Synthesis complete for ${contract} (${synthesis.length} chars)`);
    return synthesis;
  } catch (error) {
    console.error(`[ContractExecutor] Synthesis failed, returning raw excerpts:`, error);
    return rawExcerpts;
  }
}

/**
 * Get contract-specific synthesis prompts.
 * These prompts instruct the LLM how to transform raw excerpts into insights.
 * Includes coverage qualification to ensure appropriate confidence levels.
 */
function getSynthesisPrompt(contract: AnswerContract, coverage: CoverageContext, companyList: string): string {
  const baseContext = `You are analyzing customer call data from ${coverage.totalMeetings} meetings across ${coverage.uniqueCompanies} companies (${companyList}).`;
  const coverageQualification = getCoverageQualification(coverage);
  
  switch (contract) {
    case AnswerContract.PATTERN_ANALYSIS:
      return `${baseContext}
${coverageQualification}

CRITICAL: You must analyze the data TO ANSWER THE USER'S SPECIFIC QUESTION. Do not provide generic patterns - focus on what they asked about.

For example:
- If they ask about "concerns" → find customer CONCERNS, worries, hesitations, objections
- If they ask about "questions" → find customer QUESTIONS they asked
- If they ask about "objections" → find sales OBJECTIONS and pushback
- If they ask about "pain points" → find customer PAIN POINTS and frustrations

OUTPUT FORMAT:
**[Topic from User's Question] Across ${coverage.totalMeetings} Calls:**

1. **[Specific Finding]** (mentioned in X/${coverage.totalMeetings} calls)
   - Brief description
   - Representative quote if available

2. **[Specific Finding]** (mentioned in X/${coverage.totalMeetings} calls)
   - Brief description
   - Representative quote

RULES:
- FOCUS on exactly what the user asked about - do not drift to general themes
- Group similar items together
- Count frequency (estimate if unclear)
- Prioritize by frequency (most common first)
- Include 1-2 representative quotes per item
- Limit to 5-7 most significant findings
- If the data doesn't contain what the user asked about, say so explicitly`;

    case AnswerContract.TREND_SUMMARY:
      return `${baseContext}
${coverageQualification}

CRITICAL: Focus your analysis on what the user specifically asked about. Do not provide generic trends.

Your task is to identify TRENDS and CHANGES OVER TIME related to the user's question.

OUTPUT FORMAT:
**[Topic from User's Question] - Trends Across ${coverage.totalMeetings} Calls:**

1. **[Trend Name]**
   - How this has evolved over time
   - Earlier vs more recent discussions

2. **[Trend Name]**
   - Direction of change
   - Notable shifts

RULES:
- FOCUS on trends related to what the user asked about
- Look for topics that appear more/less frequently over time
- Note any shifts in customer sentiment or priorities
- Identify emerging concerns vs declining ones
- If meeting dates are visible in the data, reference them
- If temporal data is insufficient or dates are unclear, explicitly state: "Temporal trends cannot be determined from this data - consider organizing by theme instead"
- Do not fabricate timeline information`;

    case AnswerContract.CROSS_MEETING_QUESTIONS:
      return `${baseContext}
${coverageQualification}

Your task is to consolidate and categorize CUSTOMER QUESTIONS from across meetings.

OUTPUT FORMAT:
**Customer Questions Across ${coverage.totalMeetings} Calls:**

**[Category 1: e.g., Technical/Integration]** (X questions)
- Question 1 (from [Company])
- Question 2 (from [Company])

**[Category 2: e.g., Pricing/Business]** (X questions)
- Question 1 (from [Company])
- Question 2 (from [Company])

RULES:
- Group questions by theme/category
- Include the company name for each question
- Consolidate similar questions (don't repeat variations)
- Note if a question came up in multiple meetings
- Prioritize unanswered or recurring questions
- If no clear questions are found, say so rather than inventing them`;

    default:
      return `${baseContext}
${coverageQualification}

Analyze the provided meeting excerpts and synthesize the key insights relevant to the user's question.
Be specific, cite evidence, and organize your response clearly.`;
  }
}

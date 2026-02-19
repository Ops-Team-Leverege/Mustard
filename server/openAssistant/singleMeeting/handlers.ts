import { PROMPT_VERSIONS } from "../../config/prompts/versions";
import { MODEL_ASSIGNMENTS } from "../../config/models";
import { storage } from "../../storage";
import { OpenAI } from "openai";
import { AnswerContract } from "../../decisionLayer/answerContracts";
import { generateText } from "../../llm/client";
import { getComprehensiveProductKnowledge, formatProductKnowledgeForPrompt } from "../../airtable/productData";
import {
  buildCustomerQuestionsAssessmentPrompt,
  getMeetingSummarySystemPrompt,
  buildSingleMeetingSummaryPrompt,
  type MeetingSummaryInput,
} from "../../config/prompts/singleMeeting";
import {
  RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT,
  buildExtractiveAnswerUserPrompt,
} from "../../config/prompts/transcript";
import {
  type SingleMeetingContext,
  type SingleMeetingResult,
  formatMeetingDate,
  getMeetingDateSuffix,
} from "../../meeting";
import {
  lookupQAPairs,
  getMeetingAttendees,
  getMeetingActionItems,
  searchTranscriptSnippets,
  UNCERTAINTY_RESPONSE,
} from "./helpers";

function getValidatedOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("[SingleMeeting] OPENAI_API_KEY is not set. Cannot initialize OpenAI client.");
  }
  return new OpenAI({ apiKey });
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = getValidatedOpenAIClient();
  }
  return _openai;
}

export async function handleExtractiveIntent(
  ctx: SingleMeetingContext,
  question: string,
  contract?: AnswerContract
): Promise<SingleMeetingResult> {
  const startTime = Date.now();

  const isAttendee = contract === AnswerContract.ATTENDEES;
  const isAction = contract === AnswerContract.NEXT_STEPS;

  const isCustomerQuestionsRequest = contract === AnswerContract.CUSTOMER_QUESTIONS;

  if (isCustomerQuestionsRequest) {
    console.log(`[SingleMeeting] Fast path: customer questions (contract=${contract})`);
    const customerQuestions = await lookupQAPairs(ctx.meetingId);
    console.log(`[SingleMeeting] Customer questions fetch: ${Date.now() - startTime}ms`);

    if (customerQuestions.length === 0) {
      const dateSuffix = getMeetingDateSuffix(ctx);
      return {
        answer: `No customer questions were identified in this meeting${dateSuffix}.`,
        intent: "extractive",
        dataSource: "qa_pairs",
      };
    }

    const lines: string[] = [];
    const dateSuffix = getMeetingDateSuffix(ctx);
    lines.push(`*Customer Questions — ${ctx.companyName}${dateSuffix}*`);

    customerQuestions.slice(0, 15).forEach(q => {
      lines.push(`• "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      if (q.answerEvidence) {
        lines.push(`  _Answer: ${q.answerEvidence}_`);
      }
    });
    if (customerQuestions.length > 15) {
      lines.push(`_...and ${customerQuestions.length - 15} more_`);
    }

    if (customerQuestions.length > 0) {
      lines.push("\n---");
      lines.push("_Would you like me to check these answers for correctness against our product knowledge? Just say \"check for correctness\" and I'll review them._");
    }

    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "qa_pairs",
      promptVersions: {
        CUSTOMER_QUESTIONS_EXTRACTION_PROMPT: PROMPT_VERSIONS.CUSTOMER_QUESTIONS_EXTRACTION_PROMPT
      }
    };
  }

  if (isAttendee) {
    console.log(`[SingleMeeting] Fast path: attendee question`);
    const { leverageTeam, customerNames } = await getMeetingAttendees(ctx.meetingId);
    console.log(`[SingleMeeting] Attendee fetch: ${Date.now() - startTime}ms`);

    if (leverageTeam.length === 0 && customerNames.length === 0) {
      return {
        answer: UNCERTAINTY_RESPONSE,
        intent: "extractive",
        dataSource: "not_found",
      };
    }

    const lines: string[] = [];
    lines.push(`*Meeting Attendees (${ctx.companyName})*`);
    if (leverageTeam.length > 0) {
      lines.push(`\n*Leverege Team:* ${leverageTeam.join(", ")}`);
    }
    if (customerNames.length > 0) {
      lines.push(`*Customer:* ${customerNames.join(", ")}`);
    }

    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "attendees",
      promptVersions: {
        RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT
      }
    };
  }

  if (isAction) {
    console.log(`[SingleMeeting] Fast path: action item question`);
    const actionItems = await getMeetingActionItems(ctx.meetingId);
    console.log(`[SingleMeeting] Action items fetch: ${Date.now() - startTime}ms`);

    if (actionItems.length === 0) {
      const dateSuffix = getMeetingDateSuffix(ctx);
      return {
        answer: `No explicit action items were identified in this meeting${dateSuffix}.`,
        intent: "extractive",
        dataSource: "action_items",
      };
    }

    const lines: string[] = [];
    const dateSuffix = getMeetingDateSuffix(ctx);
    lines.push(`*Next Steps — ${ctx.companyName}${dateSuffix}*`);
    actionItems.forEach(item => {
      let formattedItem = `• ${item.action} — ${item.owner}`;
      if (item.deadline && item.deadline !== "Not specified") {
        formattedItem += ` _(${item.deadline})_`;
      }
      lines.push(formattedItem);
      lines.push(`  _"${item.evidence}"_`);
    });

    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "action_items",
      promptVersions: {
        RAG_ACTION_ITEMS_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_ACTION_ITEMS_SYSTEM_PROMPT
      }
    };
  }

  console.log(`[SingleMeeting] EXTRACTIVE_FACT: transcript search`);
  const snippets = await searchTranscriptSnippets(ctx.meetingId, question, 5);
  console.log(`[SingleMeeting] Transcript fetch: ${Date.now() - startTime}ms`);

  const relevantSnippets = snippets.filter(s => s.matchType === "both" || s.matchType === "keyword");

  if (relevantSnippets.length > 0) {
    const transcriptContext = relevantSnippets
      .map(s => `[${s.speakerName}]: ${s.content}`)
      .join("\n\n");

    console.log(`[SingleMeeting] EXTRACTIVE_FACT: sending ${relevantSnippets.length} snippets to LLM for answer extraction`);

    try {
      const llmResponse = await generateText({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT },
          { role: "user", content: buildExtractiveAnswerUserPrompt(question, transcriptContext) },
        ],
        temperature: 0.1,
        responseFormat: "json",
      });

      console.log(`[SingleMeeting] EXTRACTIVE_FACT LLM response: ${Date.now() - startTime}ms`);

      const parsed = JSON.parse(llmResponse.text);
      const dateSuffix = getMeetingDateSuffix(ctx);

      if (parsed.wasFound && parsed.answer) {
        const lines: string[] = [];
        lines.push(`In this meeting${dateSuffix}:`);
        lines.push(`\n${parsed.answer}`);
        if (parsed.evidence) {
          lines.push(`\n_Evidence: "${parsed.evidence}"_`);
        }

        return {
          answer: lines.join("\n"),
          intent: "extractive",
          dataSource: "transcript",
          evidence: parsed.evidence || relevantSnippets[0].content,
          promptVersions: {
            RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT
          }
        };
      }
    } catch (err) {
      console.error(`[SingleMeeting] EXTRACTIVE_FACT LLM error, falling back to raw snippets:`, err);
    }

    const dateSuffix = getMeetingDateSuffix(ctx);
    const lines: string[] = [];
    lines.push(`In this meeting${dateSuffix}, the transcript mentions:`);
    relevantSnippets.slice(0, 2).forEach(s => {
      lines.push(`\n_"${s.content.substring(0, 200)}${s.content.length > 200 ? '...' : ''}"_`);
      lines.push(`— ${s.speakerName}`);
    });

    return {
      answer: lines.join("\n"),
      intent: "extractive",
      dataSource: "transcript",
      evidence: relevantSnippets[0].content,
    };
  } else if (snippets.length > 0 && snippets[0].matchType === "proper_noun") {
    console.log(`[SingleMeeting] GUARDRAIL: proper_noun-only matches (${snippets.length} chunks) - refusing to answer with unrelated content`);
  }

  return {
    answer: UNCERTAINTY_RESPONSE,
    intent: "extractive",
    dataSource: "not_found",
  };
}

export async function handleAggregativeIntent(
  ctx: SingleMeetingContext,
  question: string,
  contract?: AnswerContract
): Promise<SingleMeetingResult> {
  const startTime = Date.now();

  console.log(`[SingleMeeting] Aggregative handler: contract=${contract}`);

  const customerQuestions = await lookupQAPairs(ctx.meetingId);
  const actionItems = await getMeetingActionItems(ctx.meetingId);
  console.log(`[SingleMeeting] Aggregative data fetch: ${Date.now() - startTime}ms (qa=${customerQuestions.length}, actions=${actionItems.length})`);

  if (customerQuestions.length === 0 && actionItems.length === 0) {
    return {
      answer: UNCERTAINTY_RESPONSE,
      intent: "aggregative",
      dataSource: "not_found",
    };
  }

  const lines: string[] = [];

  if (customerQuestions.length > 0) {
    lines.push(`*Customer Questions from the meeting with ${ctx.companyName}:*`);
    customerQuestions.slice(0, 10).forEach(q => {
      lines.push(`\u2022 "${q.questionText}"${q.askedByName ? ` \u2014 ${q.askedByName}` : ""}`);
      if (q.answerEvidence) {
        lines.push(`  _Answer: ${q.answerEvidence}_`);
      }
    });
    if (customerQuestions.length > 10) {
      lines.push(`_...and ${customerQuestions.length - 10} more_`);
    }
    lines.push("\n---");
    lines.push("_Would you like me to check these answers for correctness against our product knowledge? Just say \"check for correctness\" and I'll review them._");
  }

  if (actionItems.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`*Action Items from the meeting with ${ctx.companyName}:*`);
    actionItems.forEach(item => {
      lines.push(`\u2022 ${item.action} \u2014 ${item.owner}`);
    });
  }

  return {
    answer: lines.join("\n"),
    intent: "aggregative",
    dataSource: customerQuestions.length > 0 ? "qa_pairs" : "action_items",
    promptVersions: {
      CUSTOMER_QUESTIONS_EXTRACTION_PROMPT: PROMPT_VERSIONS.CUSTOMER_QUESTIONS_EXTRACTION_PROMPT,
      RAG_ACTION_ITEMS_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_ACTION_ITEMS_SYSTEM_PROMPT
    }
  };
}

export async function handleDraftingIntent(
  ctx: SingleMeetingContext,
  question: string,
  contract?: AnswerContract
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeeting] Drafting handler: contract=${contract}`);

  const dateSuffix = getMeetingDateSuffix(ctx);

  console.log(`[SingleMeeting] Drafting: fetching all context for meeting ${ctx.meetingId}`);

  const [customerQuestions, actionItems, chunks, productKnowledge] = await Promise.all([
    lookupQAPairs(ctx.meetingId),
    getMeetingActionItems(ctx.meetingId),
    storage.getChunksForTranscript(ctx.meetingId, 50),
    getComprehensiveProductKnowledge(),
  ]);

  const contextParts: string[] = [];

  if (chunks.length > 0) {
    const transcriptPreview = chunks
      .slice(0, 20)
      .map(c => `[${c.speakerName || "Unknown"}]: ${c.content.substring(0, 200)}`)
      .join("\n");
    contextParts.push("MEETING DISCUSSION PREVIEW:");
    contextParts.push(transcriptPreview);
    contextParts.push("");
  }

  if (customerQuestions.length > 0) {
    contextParts.push("CUSTOMER Q&A FROM THE MEETING:");
    customerQuestions.forEach(cq => {
      contextParts.push(`- "${cq.questionText}"${cq.askedByName ? ` (asked by ${cq.askedByName})` : ""}`);
      if (cq.answerEvidence) {
        contextParts.push(`  Answer: ${cq.answerEvidence}`);
      }
    });
    contextParts.push("");
  }

  if (actionItems.length > 0) {
    contextParts.push("ACTION ITEMS / NEXT STEPS FROM THE MEETING:");
    actionItems.forEach(item => {
      contextParts.push(`- ${item.action} (owner: ${item.owner})`);
    });
    contextParts.push("");
  }

  if (productKnowledge) {
    const formattedProduct = formatProductKnowledgeForPrompt(productKnowledge);
    if (formattedProduct) {
      contextParts.push("PITCREW PRODUCT INFORMATION (from Airtable):");
      contextParts.push(formattedProduct);
      contextParts.push("");
    }
  }

  if (contextParts.length === 0) {
    return {
      answer: `I couldn't find enough meeting content${dateSuffix} to draft this email. Try asking for a specific type of email (e.g., "draft an email about the next steps" or "draft an email about our features").`,
      intent: "drafting",
      dataSource: "not_found",
    };
  }

  const meetingContext = contextParts.join("\n");

  const response = await getOpenAI().chat.completions.create({
    model: MODEL_ASSIGNMENTS.SINGLE_MEETING_RESPONSE,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You are drafting a professional follow-up email for Leverege sales team.

MEETING CONTEXT:
- Company: ${ctx.companyName}
- Date: ${ctx.meetingDate || "recent meeting"}

${meetingContext}

DRAFTING RULES:
1. Write a professional, warm follow-up email
2. Address the specific questions or concerns raised in the meeting
3. Reference action items if relevant
4. If product information is provided, use it to answer customer questions accurately
5. For pricing questions: mention "per-store flat monthly fee" model but defer specific dollar amounts to a follow-up call
6. Keep it concise but thorough
7. End with a clear next step or call to action
8. Use the customer's name if known from the context
9. Sign as "[Your name]" - let the sender fill in

Format the email with:
- Subject line (prefix with "Subject:")
- Greeting
- Body (2-3 short paragraphs)
- Closing with next step
- Signature placeholder`,
      },
      {
        role: "user",
        content: question,
      },
    ],
  });

  const draft = response.choices[0]?.message?.content || "Unable to generate draft.";

  return {
    answer: `Here's a draft follow-up email for ${ctx.companyName}${dateSuffix}:\n\n${draft}`,
    intent: "drafting",
    dataSource: "qa_pairs",
    promptVersions: {
      PRODUCT_KNOWLEDGE_DRAFTING_PROMPT: PROMPT_VERSIONS.PRODUCT_KNOWLEDGE_DRAFTING_PROMPT
    }
  };
}

export async function handleSummaryIntent(
  ctx: SingleMeetingContext
): Promise<SingleMeetingResult> {
  const [transcript, chunks] = await Promise.all([
    storage.getTranscriptById(ctx.meetingId),
    storage.getChunksForTranscript(ctx.meetingId, 100),
  ]);

  if (!transcript) {
    return {
      answer: "I couldn't find any meeting data for this transcript.",
      intent: "summary",
      dataSource: "not_found",
    };
  }

  if (chunks.length === 0) {
    return {
      answer: "I couldn't find any transcript content for this meeting.",
      intent: "summary",
      dataSource: "not_found",
    };
  }

  const meetingDateStr = formatMeetingDate(ctx.meetingDate) ||
    formatMeetingDate(transcript.meetingDate) ||
    formatMeetingDate(transcript.createdAt) ||
    "Date not available";

  const summaryData: MeetingSummaryInput = {
    companyName: ctx.companyName,
    meetingDate: meetingDateStr,
    status: transcript.mainMeetingTakeaways || undefined,
    nextSteps: transcript.nextSteps || undefined,
    leverageTeam: transcript.leverageTeam || undefined,
    customerNames: transcript.customerNames || undefined,
    ingestionTakeaways: transcript.mainMeetingTakeaways || undefined,
    ingestionNextSteps: transcript.nextSteps || undefined,
  };

  const transcriptText = chunks
    .map(c => `[${c.speakerName || "Unknown"}]: ${c.content}`)
    .join("\n\n");

  console.log(`[SingleMeeting] Summary v4: ${chunks.length} chunks, transcript-only extraction`);

  const userPrompt = buildSingleMeetingSummaryPrompt(summaryData, transcriptText);

  const llmResponse = await generateText({
    model: MODEL_ASSIGNMENTS.MEETING_SUMMARY,
    messages: [
      { role: "system", content: getMeetingSummarySystemPrompt() },
      { role: "user", content: userPrompt },
    ],
  });

  const summary = llmResponse.text || "Unable to generate meeting summary.";

  return {
    answer: summary,
    intent: "summary",
    dataSource: "summary",
    promptVersions: {
      RAG_MEETING_SUMMARY_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_MEETING_SUMMARY_SYSTEM_PROMPT
    }
  };
}

export async function generateKBAssistedCustomerQuestionAnswers(
  ctx: SingleMeetingContext,
  openQuestions: Array<{ questionText: string; askedByName?: string | null; answerEvidence?: string | null }>,
  answeredQuestions: Array<{ questionText: string; askedByName?: string | null; answerEvidence?: string | null }>
): Promise<SingleMeetingResult> {
  console.log(`[SingleMeeting] Generating KB-assisted answers: ${openQuestions.length} open, ${answeredQuestions.length} answered`);

  const progressParts: string[] = [];
  progressParts.push(`I found ${openQuestions.length + answeredQuestions.length} customer question${openQuestions.length + answeredQuestions.length !== 1 ? 's' : ''} from your ${ctx.companyName} meeting.`);

  if (answeredQuestions.length > 0 && openQuestions.length > 0) {
    progressParts.push(`I'll check the ${answeredQuestions.length} answered question${answeredQuestions.length !== 1 ? 's' : ''} for accuracy and provide suggested answers for the ${openQuestions.length} open one${openQuestions.length !== 1 ? 's' : ''}.`);
  } else if (answeredQuestions.length > 0) {
    progressParts.push(`I'll assess the ${answeredQuestions.length} answered question${answeredQuestions.length !== 1 ? 's' : ''} for correctness against our product knowledge.`);
  } else if (openQuestions.length > 0) {
    progressParts.push(`I'll provide suggested answers for the ${openQuestions.length} open question${openQuestions.length !== 1 ? 's' : ''} using our product knowledge.`);
  }

  const progressMessage = progressParts.join(' ');

  let productKnowledge = "";
  try {
    const pkResult = await getComprehensiveProductKnowledge();
    productKnowledge = formatProductKnowledgeForPrompt(pkResult);
    console.log(`[SingleMeeting] Product knowledge loaded for assessment (${productKnowledge.length} chars)`);
  } catch (err) {
    console.error(`[SingleMeeting] Failed to load product knowledge:`, err);
    productKnowledge = "Product knowledge unavailable - provide best-effort answers.";
  }

  const questionsForAssessment: string[] = [];

  if (answeredQuestions.length > 0) {
    questionsForAssessment.push("## Questions Answered in Meeting (assess for correctness):");
    answeredQuestions.forEach((q, i) => {
      const answer = q.answerEvidence || "[Answer not recorded]";
      questionsForAssessment.push(`${i + 1}. Q: "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
      questionsForAssessment.push(`   A (from meeting): ${answer}`);
    });
  }

  if (openQuestions.length > 0) {
    questionsForAssessment.push("\n## Open Questions (provide answers from product knowledge):");
    openQuestions.forEach((q, i) => {
      questionsForAssessment.push(`${i + 1}. Q: "${q.questionText}"${q.askedByName ? ` — ${q.askedByName}` : ""}`);
    });
  }

  const systemPrompt = buildCustomerQuestionsAssessmentPrompt(productKnowledge);

  try {
    const response = await getOpenAI().chat.completions.create({
      model: MODEL_ASSIGNMENTS.SINGLE_MEETING_RESPONSE,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: questionsForAssessment.join("\n") },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const answer = response.choices[0]?.message?.content || "Unable to generate KB-assisted answers.";
    const dateSuffix = getMeetingDateSuffix(ctx);

    const header = `*Customer Questions Review — ${ctx.companyName}${dateSuffix}*\n\n`;

    return {
      answer: header + answer,
      intent: "extractive",
      dataSource: "qa_pairs",
      progressMessage,
      promptVersions: {
        RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT: PROMPT_VERSIONS.RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT
      }
    };
  } catch (err) {
    console.error(`[SingleMeeting] LLM error in KB-assisted answers:`, err);
    return {
      answer: "I encountered an error while generating KB-assisted answers. Please try again.",
      intent: "extractive",
      dataSource: "not_found",
    };
  }
}

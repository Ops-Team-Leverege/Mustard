/**
 * LLM ROUTING MODULE (MCP ONLY)
 *
 * Purpose:
 * This file uses an LLM strictly to ROUTE user requests to the correct MCP capability
 * and extract structured arguments for that capability.
 *
 * What this file IS:
 * - An orchestration helper for MCP
 * - Responsible only for intent classification and parameter extraction
 * - Allowed to use LLM tool/function calling for control flow
 *
 * What this file is NOT:
 * - NOT responsible for summarization, analysis, or interpretation
 * - NOT a RAG composer
 * - NOT allowed to reason over domain data or retrieved content
 *
 * Important architectural rule:
 * - LLM usage here is limited to "decide what capability to call"
 * - Any LLM-based interpretation of retrieved data MUST live in the RAG composer layer
 */

import { MODEL_ASSIGNMENTS } from "../config/models";
import { MCP_ROUTING_PROMPT } from "../config/prompts";

/**
 *   (see server/rag/composers.ts)
 *
 * Rationale:
 * Separating LLM-for-routing (MCP) from LLM-for-reasoning (RAG)
 * keeps responsibilities clear, prevents accidental coupling,
 * and allows each use of the LLM to evolve independently.
 */

import { OpenAI } from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

export type CapabilityDescriptor = {
  name: string;
  description: string;
  parameters: z.ZodType<any>; // Zod schema
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function decideCapability({
  text,
  capabilities,
}: {
  text: string;
  capabilities: CapabilityDescriptor[];
}) {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = capabilities.map(c => {
    // Convert Zod schema to JSON Schema for OpenAI
    const jsonSchema = zodToJsonSchema(c.parameters, { target: "openApi3" });
    // Remove $schema wrapper that zodToJsonSchema adds
    const { $schema, ...schemaWithoutMeta } = jsonSchema as Record<string, unknown>;
    
    return {
      type: "function" as const,
      function: {
        name: c.name,
        description: c.description,
        parameters: schemaWithoutMeta,
      },
    };
  });

   const response = await openai.chat.completions.create({
     model: MODEL_ASSIGNMENTS.INTENT_CLASSIFICATION,
     messages: [
       { role: "system", content: MCP_ROUTING_PROMPT },
       { role: "user", content: text },
     ],
     tools,
     tool_choice: "auto",
     temperature: 0,
   });

   const message = response.choices[0]?.message;
   const toolCall = message?.tool_calls?.[0];

   if (!toolCall || toolCall.type !== "function") {
     // No capability matched - return helpful fallback response
     return {
       name: "__fallback__",
       args: { 
         response: message?.content || "I can help you query our database. Try asking about companies, insights, or feedback." 
       },
     };
   }

   return {
     name: toolCall.function.name,
     args: JSON.parse(toolCall.function.arguments),
   };
 }

// NOTE:
// We intentionally use chat.completions here.
// responses.create() is the newer API, but tool-call routing is currently
// less stable and harder to extract deterministically.
// This can be revisited once the responses tooling matures.
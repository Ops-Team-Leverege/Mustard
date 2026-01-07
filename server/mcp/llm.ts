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
     model: "gpt-4o-mini",
     messages: [
       { role: "system", content: "You route user requests to the correct capability." },
       { role: "user", content: text },
     ],
     tools,
     tool_choice: "auto",
   });

   const message = response.choices[0]?.message;
   const toolCall = message?.tool_calls?.[0];

   if (!toolCall || toolCall.type !== "function") {
     throw new Error("No capability selected by LLM");
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
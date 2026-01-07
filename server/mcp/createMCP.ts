import type { MCPContext } from "./types";
import { decideCapability } from "./llm";
import { capabilities } from "./capabilities";

export function createMCP(ctx: MCPContext) {
  async function run(name: string, input: unknown) {
    const capability = capabilities.find(c => c.name === name);
    if (!capability) throw new Error(`Unknown capability: ${name}`);

    const parsedInput = capability.inputSchema.parse(input);
    return capability.handler(ctx, parsedInput);
  }

  async function runFromText(text: string) {
    const descriptors = capabilities.map(c => ({
      name: c.name,
      description: c.description,
      parameters: c.inputSchema,
    }));

    const { name, args } = await decideCapability({
      text,
      capabilities: descriptors,
    });

    // Handle fallback when no capability was selected
    if (name === "__fallback__") {
      return args.response;
    }

    return run(name, args);
  }

  return { run, runFromText };
}


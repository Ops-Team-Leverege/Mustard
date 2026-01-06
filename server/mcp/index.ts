// server/mcp/index.ts
import type { MCPContext } from "./types";
import { capabilities } from "./capabilities";

export function createMCP(ctx: MCPContext) {
  return {
    async run(name: string, input: unknown) {
      const capability = capabilities.find(c => c.name === name);

      if (!capability) {
        throw new Error(`Unknown capability: ${name}`);
      }

      const parsedInput = capability.inputSchema.parse(input);
      return capability.handler(ctx, parsedInput);
    },

    list() {
      return capabilities.map(c => ({
        name: c.name,
        description: c.description,
        inputSchema: c.inputSchema,
      }));
    },
  };
}

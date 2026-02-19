import { readFileSync } from "fs";
import { resolve } from "path";

export interface DataSourceConfig {
  name: string;
  description: string;
  intents: string[];
}

export interface CapabilityConfig {
  label: string;
  description: string;
  examples: string[];
  contracts: string[];
}

export interface CapabilitiesConfig {
  botName: string;
  intro: string;
  closing: string;
  dataSources: Record<string, DataSourceConfig>;
  capabilities: Record<string, CapabilityConfig>;
}

const configPath = resolve(process.cwd(), "config/capabilities.json");
const raw = readFileSync(configPath, "utf-8");
export const CAPABILITIES_CONFIG: CapabilitiesConfig = JSON.parse(raw);

export function getCapability(intentKey: string): CapabilityConfig | undefined {
  return CAPABILITIES_CONFIG.capabilities[intentKey];
}

export function getIntentContractMapping(): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};
  for (const [intent, cap] of Object.entries(CAPABILITIES_CONFIG.capabilities)) {
    mapping[intent] = cap.contracts;
  }
  mapping["CLARIFY"] = ["CLARIFY"];
  return mapping;
}

export function getIntentLabel(intentKey: string): string {
  return CAPABILITIES_CONFIG.capabilities[intentKey]?.label ?? intentKey;
}

export function getIntentDescription(intentKey: string): string {
  return CAPABILITIES_CONFIG.capabilities[intentKey]?.description ?? "";
}

export function buildIntentListForPrompt(): string {
  return Object.entries(CAPABILITIES_CONFIG.capabilities)
    .map(([key, cap]) => `- ${key}: ${cap.description}`)
    .join("\n");
}

export function buildContractListForPrompt(): string {
  return Object.entries(CAPABILITIES_CONFIG.capabilities)
    .map(([key, cap]) => `- ${key}: ${cap.contracts.join(", ")}`)
    .join("\n");
}

export function buildCapabilitiesPrompt(): string {
  const { botName, intro, dataSources, capabilities } = CAPABILITIES_CONFIG;

  const dataSourcesSection = Object.values(dataSources)
    .map(ds => `**${ds.name}**: ${ds.description}\n  Examples: ${ds.intents.map(i => capabilities[i]?.examples?.[0]).filter(Boolean).map(ex => `"${ex}"`).join(", ")}`)
    .join("\n\n");

  const capabilitiesSection = Object.entries(capabilities)
    .map(([key, cap]) => {
      const relatedSources = Object.entries(dataSources)
        .filter(([, ds]) => ds.intents.includes(key))
        .map(([, ds]) => ds.name);
      return `**${cap.label}**: ${cap.description}\n  Examples: ${cap.examples.map(ex => `"${ex}"`).join(", ")}${relatedSources.length ? `\n  Data Sources: ${relatedSources.join(", ")}` : ""}`;
    })
    .join("\n\n");

  return `# ${botName} Capabilities

## What I Can Do

${intro} I help you work with customer meeting data, product information, and external research to support your sales efforts.

## My Data Sources

${dataSourcesSection}

## My Capabilities

${capabilitiesSection}

## How to Use Me

- **Be specific**: Instead of "tell me about meetings," try "what did Les Schwab say about pricing?"
- **Ask follow-ups**: I maintain context within conversations, so you can ask follow-up questions
- **Combine requests**: I can research external companies and connect findings to PitCrew value props
- **Request formats**: I can provide summaries, detailed analysis, bullet points, or draft responses`;
}

import { buildCapabilitiesPrompt, CAPABILITIES_CONFIG } from "./capabilities";

export const DATA_SOURCES = Object.values(CAPABILITIES_CONFIG.dataSources);
export const CAPABILITIES = Object.entries(CAPABILITIES_CONFIG.capabilities).map(([key, cap]) => ({
  name: cap.label,
  description: cap.description,
  examples: cap.examples,
  dataSourcesUsed: Object.entries(CAPABILITIES_CONFIG.dataSources)
    .filter(([, ds]) => ds.intents.includes(key))
    .map(([, ds]) => ds.name),
}));

export function getAssistantCapabilitiesPrompt(): string {
  return buildCapabilitiesPrompt();
}

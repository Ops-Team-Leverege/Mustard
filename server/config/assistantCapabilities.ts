/**
 * PitCrew Sauce Assistant Capabilities
 * 
 * Defines what PitCrew Sauce can do and what data sources it's connected to.
 * Used to answer questions like "what can you do?" or "what are your capabilities?"
 */

export interface DataSource {
    name: string;
    description: string;
    examples: string[];
}

export interface Capability {
    name: string;
    description: string;
    examples: string[];
    dataSourcesUsed: string[];
}

export const DATA_SOURCES: DataSource[] = [
    {
        name: "Customer Meeting Transcripts",
        description: "Transcripts from sales calls and customer meetings with companies like Les Schwab, ACE Hardware, Jiffy Lube, etc.",
        examples: [
            "What did Les Schwab say about pricing?",
            "Find all meetings where customers mentioned ROI",
            "What questions did ACE Hardware ask?"
        ]
    },
    {
        name: "PitCrew Product Database",
        description: "Complete product information including features, value propositions, pricing, and integrations",
        examples: [
            "What is PitCrew pricing?",
            "Does PitCrew integrate with POS systems?",
            "What are PitCrew's safety features?"
        ]
    },
    {
        name: "External Research",
        description: "Public information about companies including earnings calls, news, market position, and industry trends",
        examples: [
            "Research Costco's recent priorities",
            "Find Valvoline's latest earnings call",
            "What are quick lube industry trends?"
        ]
    },
    {
        name: "Company Contacts & Attendees",
        description: "Contact information and meeting attendees from customer interactions",
        examples: [
            "Who attended the Les Schwab meeting?",
            "Find Tyler Wiggins' contact info",
            "What meetings did Randy attend?"
        ]
    }
];

export const CAPABILITIES: Capability[] = [
    {
        name: "Meeting Analysis",
        description: "Analyze individual customer meetings for summaries, action items, quotes, and specific questions",
        examples: [
            "Summarize the last Les Schwab meeting",
            "What were the next steps from the ACE meeting?",
            "What did the customer say about pricing?"
        ],
        dataSourcesUsed: ["Customer Meeting Transcripts", "Company Contacts & Attendees"]
    },
    {
        name: "Cross-Meeting Insights",
        description: "Find patterns, trends, and insights across multiple customer meetings",
        examples: [
            "What are common customer concerns across all meetings?",
            "Find all meetings that mention integration challenges",
            "Compare feedback from tire shops vs quick lube centers"
        ],
        dataSourcesUsed: ["Customer Meeting Transcripts", "Company Contacts & Attendees"]
    },
    {
        name: "Product Information",
        description: "Provide detailed information about PitCrew features, pricing, integrations, and value propositions",
        examples: [
            "What is PitCrew pricing?",
            "Explain PitCrew's safety features",
            "Does PitCrew work with Shopify POS?"
        ],
        dataSourcesUsed: ["PitCrew Product Database"]
    },
    {
        name: "Customer Research",
        description: "Research external companies to understand their business, priorities, and market position",
        examples: [
            "Research Costco's recent strategic priorities",
            "Find Valvoline's latest earnings highlights",
            "What challenges do quick lube chains face?"
        ],
        dataSourcesUsed: ["External Research"]
    },
    {
        name: "Sales Support",
        description: "Help draft responses, create value propositions, and prepare for customer interactions",
        examples: [
            "Draft a response to customer pricing questions",
            "Create value props for tire shops",
            "Help me prepare for the Costco meeting"
        ],
        dataSourcesUsed: ["Customer Meeting Transcripts", "PitCrew Product Database", "External Research"]
    }
];

export function getAssistantCapabilitiesPrompt(): string {
    const dataSourcesSection = DATA_SOURCES.map(ds =>
        `**${ds.name}**: ${ds.description}\n  Examples: ${ds.examples.map(ex => `"${ex}"`).join(", ")}`
    ).join("\n\n");

    const capabilitiesSection = CAPABILITIES.map(cap =>
        `**${cap.name}**: ${cap.description}\n  Examples: ${cap.examples.map(ex => `"${ex}"`).join(", ")}\n  Data Sources: ${cap.dataSourcesUsed.join(", ")}`
    ).join("\n\n");

    return `# PitCrew Sauce Assistant Capabilities

## What I Can Do

I'm PitCrew Sauce, your AI sales assistant. I help you work with customer meeting data, product information, and external research to support your sales efforts.

## My Data Sources

${dataSourcesSection}

## My Capabilities

${capabilitiesSection}

## How to Use Me

- **Be specific**: Instead of "tell me about meetings," try "what did Les Schwab say about pricing?"
- **Ask follow-ups**: I maintain context within conversations, so you can ask follow-up questions
- **Combine requests**: I can research external companies and connect findings to PitCrew value props
- **Request formats**: I can provide summaries, detailed analysis, bullet points, or draft responses

## Getting Started

Try asking me:
- "What can you tell me about our last meeting with [Company]?"
- "What are common customer concerns about pricing?"
- "Research [Company] and suggest relevant PitCrew value props"
- "What PitCrew features would help with [specific challenge]?"`;
}
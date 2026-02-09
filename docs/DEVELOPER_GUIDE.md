# Developer Guide - PitCrew Meeting Intelligence Platform

## Table of Contents
1. [Codebase Overview](#codebase-overview)
2. [Architecture Layers](#architecture-layers)
3. [Key Files & Their Purpose](#key-files--their-purpose)
4. [Common Maintenance Tasks](#common-maintenance-tasks)
5. [Adding New Features](#adding-new-features)
6. [Testing & Debugging](#testing--debugging)
7. [Deployment & Operations](#deployment--operations)

---

## Codebase Overview

### Project Structure
```
pitcrew/
├── client/                    # React frontend (Web Dashboard)
│   └── src/
│       ├── components/        # UI components
│       ├── pages/            # Route pages
│       └── lib/              # Utilities
├── server/                    # Node.js backend (Express + AI)
│   ├── decisionLayer/        # Intent routing & orchestration
│   ├── openAssistant/        # Multi-meeting & product knowledge
│   ├── meeting/              # Single meeting operations
│   ├── rag/                  # AI extraction & chunking
│   ├── slack/                # Slack bot integration
│   ├── airtable/             # Product knowledge sync
│   ├── config/               # Prompts & configuration
│   ├── services/             # Business logic services
│   └── storage.ts            # Database access layer
├── shared/                    # Shared types & schemas
│   └── schema.ts             # Database schema (Drizzle ORM)
├── docs/                      # Documentation
└── config/                    # JSON configuration files
```

### Technology Stack
- **Frontend**: React 18, TypeScript, Wouter (routing), TanStack Query
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI (GPT-4o, GPT-5), Google Gemini
- **Integrations**: Slack API, Airtable API, Replit Auth

---

## Architecture Layers

### Layer 1: User Interface
**Purpose**: Multi-channel access to meeting intelligence

**Web Dashboard** (`client/src/`):
- Single Page Application (SPA) with client-side routing
- Real-time updates via TanStack Query
- Authenticated via Replit OAuth

**Slack Bot** (`server/slack/`):
- Event-driven webhook processing
- Real-time streaming responses
- Document generation and file uploads

### Layer 2: Decision Layer (Intent Router)
**Purpose**: Classify user intent and route to appropriate handler

**Files**:
- `server/decisionLayer/index.ts` - Main orchestrator
- `server/decisionLayer/intent.ts` - Intent classification
- `server/decisionLayer/contextLayers.ts` - Context computation
- `server/decisionLayer/answerContracts.ts` - Contract selection

**Flow**:
```
User Question → Intent Classification → Context Layers → Answer Contract → Route to Handler
```

### Layer 3: AI Processing Pipeline
**Purpose**: Execute contracts and generate responses

**Single Meeting Handler** (`server/meeting/`):
- Direct artifact access for specific meetings
- Fast path for meeting-specific queries
- Evidence-based responses with citations

**Open Assistant Handler** (`server/openAssistant/`):
- Multi-meeting analysis and aggregation
- Product knowledge queries
- External research integration
- Document generation

**Transcript Analyzer** (`server/rag/`):
- AI-powered extraction from transcripts
- Product insights, Q&A pairs, action items
- Semantic chunking for RAG

### Layer 4: Data Layer
**Purpose**: Persistent storage and retrieval

**Database** (`shared/schema.ts`):
- PostgreSQL with Drizzle ORM
- Optimized queries with connection pooling
- Audit logging for all interactions

**Storage Layer** (`server/storage.ts`):
- Abstraction over database operations
- Reusable query patterns
- Transaction management

---

## Key Files & Their Purpose

### Decision Layer Files

#### `server/decisionLayer/index.ts`
**Purpose**: Main orchestrator for intent classification and routing

**Key Functions**:
- `runDecisionLayer(question, threadContext)` - Main entry point
- Returns: `DecisionLayerResult` with intent, contract, context layers

**When to modify**:
- Adding new intent types
- Changing routing logic
- Adding scope clarification rules

#### `server/decisionLayer/intent.ts`
**Purpose**: Classify user intent using LLM + pattern matching

**Key Functions**:
- `classifyIntent(question, threadContext)` - Classify user intent
- Returns: `IntentClassificationResult` with intent and metadata

**Intent Types**:
```typescript
enum Intent {
  SINGLE_MEETING,      // "What did we discuss in the last Acme meeting?"
  MULTI_MEETING,       // "What have customers said about pricing?"
  PRODUCT_KNOWLEDGE,   // "What features does PitCrew offer?"
  EXTERNAL_RESEARCH,   // "Research this company's recent news"
  SLACK_SEARCH,        // "Search Slack for discussions about pricing"
  GENERAL_HELP,        // "How can you help me?"
  REFUSE,              // Out of scope requests
  CLARIFY              // Ambiguous queries
}
```

**When to modify**:
- Adding new intent types
- Updating LLM classification prompts
- Adding fast-path patterns

#### `server/decisionLayer/contextLayers.ts`
**Purpose**: Compute data access permissions based on intent

**Key Functions**:
- `computeContextLayers(intent)` - Determine what data to access
- Returns: `ContextLayers` object with boolean flags

**Context Layers**:
```typescript
type ContextLayers = {
  product_identity: boolean;    // PitCrew context (always true)
  product_ssot: boolean;        // Access product knowledge
  single_meeting: boolean;      // Access specific meeting
  multi_meeting: boolean;       // Search across meetings
  slack_search: boolean;        // Search Slack messages
}
```

**When to modify**:
- Adding new data sources
- Changing access permissions
- Adding new context types

#### `server/decisionLayer/answerContracts.ts`
**Purpose**: Define response shapes and execution contracts

**Key Concepts**:
- **Answer Contract**: Defines how to respond (summary, list, draft, etc.)
- **Contract Chain**: Ordered sequence of contracts for complex queries
- **SSOT Mode**: Authority level (authoritative, descriptive, none)

**Contract Categories**:
```typescript
// Single Meeting Contracts
MEETING_SUMMARY, NEXT_STEPS, ATTENDEES, CUSTOMER_QUESTIONS

// Multi-Meeting Contracts  
PATTERN_ANALYSIS, COMPARISON, TREND_SUMMARY

// Product Knowledge Contracts
PRODUCT_EXPLANATION, FEATURE_VERIFICATION, FAQ_ANSWER

// Document Contracts
DRAFT_RESPONSE, DRAFT_EMAIL, SALES_DOCS_PREP

// General Contracts
GENERAL_RESPONSE, CLARIFY, REFUSE
```

**When to modify**:
- Adding new contract types
- Changing contract selection logic
- Updating contract constraints

### AI Processing Files

#### `server/openAssistant/openAssistantHandler.ts`
**Purpose**: Main handler for multi-meeting and product knowledge queries

**Key Functions**:
- `handleOpenAssistant(question, context)` - Main entry point
- Routes to specific handlers based on intent
- Manages streaming responses and document generation

**When to modify**:
- Adding new intent handlers
- Changing response generation logic
- Adding new document types

#### `server/openAssistant/singleMeetingOrchestrator.ts`
**Purpose**: Execute contracts for single meeting queries

**Key Functions**:
- `handleSingleMeetingQuestion(context, question, hasPendingOffer, contract)` - Main entry point
- Executes specific contract (summary, Q&A, action items, etc.)
- Returns structured response with evidence

**When to modify**:
- Adding new single-meeting contracts
- Changing extraction logic
- Adding new artifact types

#### `server/rag/composer.ts`
**Purpose**: AI-powered extraction from transcripts

**Key Functions**:
- `extractMeetingActionStates(chunks, attendees)` - Extract action items
- `generateMeetingSummary(chunks, attendees)` - Create summary
- `selectRelevantQuotes(chunks, question)` - Find relevant quotes
- `extractiveAnswer(chunks, question)` - Answer from transcript

**When to modify**:
- Adding new extraction types
- Changing AI prompts
- Updating confidence thresholds

#### `server/rag/transcriptAnalyzer.ts`
**Purpose**: Analyze uploaded transcripts and extract insights

**Key Functions**:
- `analyzeTranscript(transcriptId)` - Main analysis pipeline
- Extracts: product insights, Q&A pairs, POS systems, action items
- Creates semantic chunks for RAG

**When to modify**:
- Adding new extraction types
- Changing analysis pipeline
- Updating categorization logic

### Data Layer Files

#### `shared/schema.ts`
**Purpose**: Database schema definition using Drizzle ORM

**Key Tables**:
```typescript
// Core entities
transcripts          // Meeting records
companies            // Customer accounts
contacts             // Meeting attendees
transcriptChunks     // Semantic chunks for RAG

// Extracted intelligence
productInsights      // Feature mentions
qaDatabase           // Q&A pairs
customerQuestions    // High-trust questions
actionItems          // Commitments & tasks

// Organization
categories           // Topic organization
pitcrewAirtableFeatures  // Product knowledge

// Audit & tracking
interactionLogs      // User interactions
```

**When to modify**:
- Adding new tables
- Adding columns to existing tables
- Changing relationships

#### `server/storage.ts`
**Purpose**: Database access layer with reusable queries

**Key Functions**:
- `createTranscript()`, `getTranscript()`, `updateTranscript()`
- `createProductInsight()`, `getProductInsights()`
- `createCustomerQuestion()`, `getCustomerQuestions()`
- `rawQuery()` - Execute custom SQL

**When to modify**:
- Adding new query patterns
- Optimizing existing queries
- Adding transaction support

### Slack Integration Files

#### `server/slack/events.ts`
**Purpose**: Main Slack event handler and webhook processor

**Key Functions**:
- `slackEventsHandler(req, res)` - Main webhook handler
- Processes @mentions, DMs, and thread messages
- Manages streaming responses and progress updates

**Flow**:
```
Slack Event → Verify Signature → Deduplicate → Decision Layer → Handler → Response
```

**When to modify**:
- Adding new Slack event types
- Changing response formatting
- Adding new progress messages

#### `server/slack/handlers/`
**Purpose**: Specialized handlers for specific scenarios

**Files**:
- `ambiguityHandler.ts` - Detect ambiguous prep questions
- `binaryQuestionHandler.ts` - Fast path for yes/no questions
- `clarificationHandler.ts` - Handle clarification responses
- `capabilitiesHandler.ts` - Respond to "what can you do?" questions

**When to modify**:
- Adding new specialized handlers
- Changing detection logic
- Adding new fast paths

---

## Common Maintenance Tasks

### Task 1: Add a New Intent

**Example**: Add `PRICING_INQUIRY` intent for pricing-related questions

**Step 1**: Define the intent in `server/decisionLayer/intent.ts`
```typescript
export enum Intent {
  // ... existing intents
  PRICING_INQUIRY = "PRICING_INQUIRY",
}
```

**Step 2**: Add fast-path patterns (optional)
```typescript
const PRICING_PATTERNS = [
  /\b(pricing|price|cost|pricing model|how much)\b/i,
  /\b(subscription|license|fee)\b/i,
];
```

**Step 3**: Update LLM classification prompt in `server/config/prompts/decisionLayer.ts`
```typescript
export const INTENT_CLASSIFICATION_PROMPT = `
...
- PRICING_INQUIRY: Questions about pricing, costs, or subscription models
...
`;
```

**Step 4**: Add context layers in `server/decisionLayer/contextLayers.ts`
```typescript
export function computeContextLayers(intent: Intent): ContextLayersMetadata {
  const layers: ContextLayers = {
    // ... existing layers
  };

  if (intent === Intent.PRICING_INQUIRY) {
    layers.product_ssot = true;
    layers.multi_meeting = true; // To find pricing discussions
  }
  
  return { layers, reasoning: "..." };
}
```

**Step 5**: Add handler in `server/openAssistant/openAssistantHandler.ts`
```typescript
async function handlePricingInquiry(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  // Implementation
}
```

**Step 6**: Route to handler in main switch statement
```typescript
if (decisionLayerResult.intent === Intent.PRICING_INQUIRY) {
  return handlePricingInquiry(text, context, classification);
}
```

### Task 2: Add a New Answer Contract

**Example**: Add `PRICING_COMPARISON` contract for comparing pricing across customers

**Step 1**: Define contract in `server/decisionLayer/answerContracts.ts`
```typescript
export enum AnswerContract {
  // ... existing contracts
  PRICING_COMPARISON = "PRICING_COMPARISON",
}
```

**Step 2**: Add contract constraints
```typescript
export const CONTRACT_CONSTRAINTS: Record<AnswerContract, AnswerContractConstraints> = {
  // ... existing constraints
  [AnswerContract.PRICING_COMPARISON]: {
    requiresEvidence: true,
    requiresCitation: true,
    allowsSpeculation: false,
    ssotMode: "descriptive",
    outputFormat: "structured_comparison",
    maxTokens: 2000,
  },
};
```

**Step 3**: Add contract selection logic
```typescript
const TASK_KEYWORDS: TaskKeyword[] = [
  // ... existing keywords
  {
    task: "compare_pricing",
    pattern: /\b(compare|comparison|versus|vs|difference)\b.*\b(pricing|price|cost)\b/i,
    intent: [Intent.PRICING_INQUIRY, Intent.MULTI_MEETING],
    contract: AnswerContract.PRICING_COMPARISON,
  },
];
```

**Step 4**: Implement contract executor in `server/openAssistant/contractExecutor.ts`
```typescript
async function executePricingComparison(
  userMessage: string,
  meetings: Meeting[],
  topic?: string
): Promise<string> {
  // Implementation
}
```

**Step 5**: Add to contract chain execution
```typescript
case AnswerContract.PRICING_COMPARISON:
  return executePricingComparison(userMessage, meetings, topic);
```

### Task 3: Add a New Extraction Type

**Example**: Add "Competitive Mentions" extraction to transcripts

**Step 1**: Add database table in `shared/schema.ts`
```typescript
export const competitiveMentions = pgTable("competitive_mentions", {
  id: serial("id").primaryKey(),
  transcriptId: text("transcript_id").notNull().references(() => transcripts.id),
  competitorName: text("competitor_name").notNull(),
  context: text("context").notNull(),
  sentiment: text("sentiment"), // positive, negative, neutral
  evidence: text("evidence").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

**Step 2**: Run database migration
```bash
npm run db:push
```

**Step 3**: Add extraction function in `server/rag/composer.ts`
```typescript
export async function extractCompetitiveMentions(
  chunks: TranscriptChunk[],
  attendees?: { leverageTeam?: string; customerNames?: string }
): Promise<CompetitiveMention[]> {
  const prompt = `Extract all mentions of competitors...`;
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify(chunks) }
    ],
    temperature: 0,
  });
  
  return JSON.parse(response.choices[0].message.content);
}
```

**Step 4**: Add to transcript analysis pipeline in `server/rag/transcriptAnalyzer.ts`
```typescript
export async function analyzeTranscript(transcriptId: string) {
  // ... existing extractions
  
  // Extract competitive mentions
  const competitiveMentions = await extractCompetitiveMentions(chunks, attendees);
  
  // Store in database
  for (const mention of competitiveMentions) {
    await storage.createCompetitiveMention({
      transcriptId,
      ...mention,
    });
  }
}
```

**Step 5**: Add storage functions in `server/storage.ts`
```typescript
export async function createCompetitiveMention(data: NewCompetitiveMention) {
  return db.insert(competitiveMentions).values(data).returning();
}

export async function getCompetitiveMentions(transcriptId: string) {
  return db.select().from(competitiveMentions)
    .where(eq(competitiveMentions.transcriptId, transcriptId));
}
```

**Step 6**: Add UI component in `client/src/components/CompetitiveMentions.tsx`
```typescript
export function CompetitiveMentions({ transcriptId }: Props) {
  const { data: mentions } = useQuery({
    queryKey: [`/api/transcripts/${transcriptId}/competitive-mentions`],
  });
  
  return (
    <div>
      {mentions?.map(mention => (
        <Card key={mention.id}>
          <h3>{mention.competitorName}</h3>
          <p>{mention.context}</p>
          <Badge>{mention.sentiment}</Badge>
        </Card>
      ))}
    </div>
  );
}
```

### Task 4: Update AI Prompts

**Example**: Improve product insight extraction quality

**Step 1**: Locate prompt in `server/config/prompts/transcript.ts`
```typescript
export const RAG_PRODUCT_INSIGHTS_SYSTEM_PROMPT = `...`;
```

**Step 2**: Update prompt with better instructions
```typescript
export const RAG_PRODUCT_INSIGHTS_SYSTEM_PROMPT = `
You are analyzing a meeting transcript to extract product insights.

EXTRACTION RULES:
1. Only extract explicit mentions of product features or capabilities
2. Include direct customer quotes when available
3. Categorize by product area (Analytics, Reporting, Integration, etc.)
4. Note customer sentiment (positive, negative, neutral, question)
5. Provide context (why was this mentioned?)

OUTPUT FORMAT:
{
  "insights": [
    {
      "feature": "Dashboard Analytics",
      "category": "Analytics",
      "context": "Customer asked about real-time visibility",
      "quote": "We need to see what's happening right now",
      "sentiment": "question",
      "speaker": "John Smith (Customer)"
    }
  ]
}
`;
```

**Step 3**: Test with sample transcript
```bash
# Use the retry button in Web UI to reprocess a transcript
# Or run the extraction script
npm run extract-transcript -- --id=<transcript-id>
```

**Step 4**: Monitor quality metrics
- Check extraction accuracy in Web UI
- Review customer questions for relevance
- Verify categorization is correct

### Task 5: Add New Slack Command

**Example**: Add `/pitcrew-stats` command to show usage statistics

**Step 1**: Add command handler in `server/slack/commands/`
```typescript
// server/slack/commands/statsCommand.ts
export async function handleStatsCommand(
  userId: string,
  channelId: string
): Promise<string> {
  const stats = await storage.getUserStats(userId);
  
  return `
📊 Your PitCrew Usage Stats
- Questions asked: ${stats.questionsAsked}
- Transcripts analyzed: ${stats.transcriptsAnalyzed}
- Documents generated: ${stats.documentsGenerated}
- Most active day: ${stats.mostActiveDay}
  `;
}
```

**Step 2**: Register command in Slack app settings
- Go to Slack App settings
- Add slash command: `/pitcrew-stats`
- Set request URL: `https://your-domain.com/api/slack/commands`

**Step 3**: Add route handler in `server/slack/events.ts`
```typescript
app.post("/api/slack/commands", async (req, res) => {
  const { command, user_id, channel_id } = req.body;
  
  if (command === "/pitcrew-stats") {
    const response = await handleStatsCommand(user_id, channel_id);
    return res.json({ text: response });
  }
  
  res.json({ text: "Unknown command" });
});
```

---

## Adding New Features

### Feature: Multi-Language Support

**Requirements**:
- Detect transcript language
- Translate questions to English for processing
- Translate responses back to user's language

**Implementation Steps**:

1. **Add language detection**:
```typescript
// server/services/languageDetector.ts
export async function detectLanguage(text: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "Detect the language of this text. Return ISO 639-1 code." },
      { role: "user", content: text }
    ],
  });
  return response.choices[0].message.content.trim();
}
```

2. **Add translation service**:
```typescript
// server/services/translator.ts
export async function translate(
  text: string,
  targetLanguage: string
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: `Translate to ${targetLanguage}` },
      { role: "user", content: text }
    ],
  });
  return response.choices[0].message.content;
}
```

3. **Update transcript analyzer**:
```typescript
// server/rag/transcriptAnalyzer.ts
export async function analyzeTranscript(transcriptId: string) {
  const transcript = await storage.getTranscript(transcriptId);
  
  // Detect language
  const language = await detectLanguage(transcript.text);
  
  // Translate if not English
  let textToAnalyze = transcript.text;
  if (language !== 'en') {
    textToAnalyze = await translate(transcript.text, 'en');
  }
  
  // Continue with analysis...
}
```

4. **Update response generation**:
```typescript
// server/openAssistant/openAssistantHandler.ts
async function generateResponse(
  answer: string,
  userLanguage: string
): Promise<string> {
  if (userLanguage !== 'en') {
    return translate(answer, userLanguage);
  }
  return answer;
}
```

### Feature: Email Notifications

**Requirements**:
- Notify users when transcript processing completes
- Send daily digest of new insights
- Alert on high-priority action items

**Implementation Steps**:

1. **Add email service**:
```typescript
// server/services/emailService.ts
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  await transporter.sendMail({
    from: 'PitCrew <noreply@pitcrew.com>',
    to,
    subject,
    html,
  });
}
```

2. **Add notification preferences table**:
```typescript
// shared/schema.ts
export const notificationPreferences = pgTable("notification_preferences", {
  userId: text("user_id").primaryKey(),
  transcriptComplete: boolean("transcript_complete").default(true),
  dailyDigest: boolean("daily_digest").default(false),
  actionItemAlerts: boolean("action_item_alerts").default(true),
  email: text("email").notNull(),
});
```

3. **Send notification on transcript complete**:
```typescript
// server/rag/transcriptAnalyzer.ts
export async function analyzeTranscript(transcriptId: string) {
  // ... analysis logic
  
  // Send notification
  const prefs = await storage.getNotificationPreferences(userId);
  if (prefs.transcriptComplete) {
    await sendEmail(
      prefs.email,
      'Transcript Analysis Complete',
      `Your transcript for ${companyName} has been analyzed.`
    );
  }
}
```

---

## Testing & Debugging

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- server/__tests__/decisionLayer.test.ts

# Run with coverage
npm test -- --coverage
```

### Debugging Slack Events
```bash
# Enable debug logging
export LOG_LEVEL=debug

# Check correlation IDs in logs
grep "correlation_id=abc123" logs/app.log

# Test webhook locally with ngrok
ngrok http 5000
# Update Slack app webhook URL to ngrok URL
```

### Debugging AI Responses
```typescript
// Add logging to see LLM inputs/outputs
console.log('[AI Request]', {
  model: 'gpt-4o',
  prompt: systemPrompt,
  userMessage,
});

const response = await openai.chat.completions.create({...});

console.log('[AI Response]', {
  content: response.choices[0].message.content,
  tokens: response.usage,
});
```

### Database Debugging
```bash
# Connect to database
psql $DATABASE_URL

# Check transcript processing status
SELECT id, company_name, status, created_at 
FROM transcripts 
WHERE status = 'PENDING' 
ORDER BY created_at DESC;

# Check interaction logs
SELECT * FROM interaction_logs 
WHERE correlation_id = 'abc123';
```

---

## Deployment & Operations

### Environment Variables
```bash
# Required
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
REPLIT_DOMAINS=your-domain.replit.dev

# Optional
GEMINI_API_KEY=...
AIRTABLE_API_KEY=...
LOG_LEVEL=info
NODE_ENV=production
```

### Health Monitoring
```bash
# Check system health
curl https://your-domain.com/health

# Monitor logs
tail -f logs/app-$(date +%Y-%m-%d).log

# Check database connections
SELECT count(*) FROM pg_stat_activity;
```

### Performance Optimization
- Monitor response times via correlation IDs
- Check cache hit rates for product knowledge
- Optimize slow queries with EXPLAIN ANALYZE
- Scale database connections if needed

### Backup & Recovery
```bash
# Backup database
pg_dump $DATABASE_URL > backup-$(date +%Y-%m-%d).sql

# Restore database
psql $DATABASE_URL < backup-2026-02-09.sql
```

---

## Best Practices

### Code Organization
- Keep files focused on single responsibility
- Use TypeScript for type safety
- Document complex logic with comments
- Follow existing naming conventions

### AI Prompt Engineering
- Use temperature=0 for deterministic outputs
- Provide clear examples in prompts
- Validate LLM outputs with schemas
- Handle errors gracefully

### Database Operations
- Use transactions for multi-step operations
- Index frequently queried columns
- Avoid N+1 queries with joins
- Monitor query performance

### Error Handling
- Log errors with correlation IDs
- Provide user-friendly error messages
- Implement retry logic for transient failures
- Monitor error rates and patterns

---

This developer guide provides comprehensive information for maintaining and extending the PitCrew platform. For specific questions or issues, refer to the inline code documentation or reach out to the development team.

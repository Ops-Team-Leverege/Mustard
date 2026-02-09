# PitCrew Maintenance Guide - For Vibecoding 🎨

> **What is vibecoding?** It's when you understand the vibe of the code and can make changes without being a hardcore programmer. This guide is for YOU!

## 📖 Table of Contents
1. [How The System Works (The Big Picture)](#how-the-system-works)
2. [The Decision-Making Flow](#the-decision-making-flow)
3. [What You'll Actually Do](#what-youll-actually-do)
4. [Step-by-Step Guides](#step-by-step-guides)

---

## 🎬 How The System Works (The Big Picture)

### The Journey of a Question

Let's follow what happens when someone asks: **"What did Acme Corp say about our dashboard?"**

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER ASKS QUESTION                                           │
│    "What did Acme Corp say about our dashboard?"                │
│    (via Slack @mention or Web UI)                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. DECISION LAYER (The Brain 🧠)                                │
│    Location: server/decisionLayer/                              │
│                                                                  │
│    Step A: "What does the user want?" (Intent Classification)   │
│    → Analyzes question with AI (GPT-4o)                         │
│    → Decides: SINGLE_MEETING (they mentioned specific company)  │
│                                                                  │
│    Step B: "What data do I need?" (Context Layers)              │
│    → single_meeting: true (need specific meeting data)          │
│    → product_ssot: false (not asking about product features)    │
│                                                                  │
│    Step C: "How should I respond?" (Answer Contract)            │
│    → Picks: EXTRACTIVE_FACT (extract specific info)            │
│    → Could also pick: MEETING_SUMMARY, CUSTOMER_QUESTIONS, etc. │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. FIND THE MEETING                                             │
│    Location: server/meeting/meetingResolver.ts                  │
│                                                                  │
│    → Searches database for "Acme Corp" meetings                 │
│    → Finds most recent meeting                                  │
│    → Gets meeting ID: "abc123"                                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. EXECUTE THE CONTRACT (The Worker 🤖)                         │
│    Location: server/openAssistant/singleMeetingOrchestrator.ts │
│                                                                  │
│    Contract: EXTRACTIVE_FACT                                    │
│    → Gets transcript chunks for meeting "abc123"                │
│    → Searches for mentions of "dashboard"                       │
│    → Uses AI to extract relevant quotes                         │
│    → Formats response with evidence links                       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. SEND RESPONSE                                                │
│    Location: server/slack/events.ts                             │
│                                                                  │
│    Response: "In the meeting on Feb 5, Acme Corp said:         │
│    'We love the dashboard but need real-time updates'           │
│    [Link to transcript]"                                        │
│                                                                  │
│    → Posts to Slack thread                                      │
│    → Logs interaction for audit                                 │
└─────────────────────────────────────────────────────────────────┘
```

### The Three Key Players

#### 1. **Decision Layer** (The Brain 🧠)
**What it does**: Figures out what the user wants and how to respond

**Files**:
- `server/decisionLayer/intent.ts` - Classifies what user wants
- `server/decisionLayer/contextLayers.ts` - Decides what data to access
- `server/decisionLayer/answerContracts.ts` - Picks response format

**Think of it as**: A smart receptionist who reads your question and routes you to the right department

#### 2. **Handlers** (The Workers 🤖)
**What they do**: Actually do the work to answer the question

**Files**:
- `server/openAssistant/singleMeetingOrchestrator.ts` - Answers about specific meetings
- `server/openAssistant/openAssistantHandler.ts` - Answers complex questions
- `server/rag/composer.ts` - Extracts info from transcripts

**Think of it as**: The actual employees who look up information and write the response

#### 3. **Storage** (The Filing Cabinet 🗄️)
**What it does**: Stores and retrieves all the data

**Files**:
- `shared/schema.ts` - Defines what data we store
- `server/storage.ts` - Functions to save/get data

**Think of it as**: A well-organized filing system where everything is stored

---

## 🎯 The Decision-Making Flow

### Who Decides What Happens Next?

```
User Question
     ↓
┌────────────────────────────────────────────────────────────┐
│ DECISION LAYER decides:                                    │
│ 1. Intent (what user wants)                                │
│ 2. Context Layers (what data to access)                    │
│ 3. Answer Contract (how to respond)                        │
└────────────────────────────────────────────────────────────┘
     ↓
┌────────────────────────────────────────────────────────────┐
│ ROUTER sends to appropriate handler:                       │
│ - Single Meeting Handler (for specific meetings)           │
│ - Open Assistant Handler (for complex questions)           │
│ - External Research Handler (for web research)             │
└────────────────────────────────────────────────────────────┘
     ↓
┌────────────────────────────────────────────────────────────┐
│ HANDLER executes the contract:                             │
│ - Gets data from database                                  │
│ - Uses AI to process/format                                │
│ - Returns structured response                              │
└────────────────────────────────────────────────────────────┘
     ↓
Response to User
```

### What Are Intents?

**Intents** = What the user wants to know

**Current Intents**:
```typescript
SINGLE_MEETING      // "What did we discuss in the Acme meeting?"
MULTI_MEETING       // "What have all customers said about pricing?"
PRODUCT_KNOWLEDGE   // "What features does PitCrew offer?"
EXTERNAL_RESEARCH   // "Research this company's recent news"
DOCUMENT_SEARCH     // "Find the proposal we sent"
GENERAL_HELP        // "What can you help me with?"
CLARIFY             // "I don't understand, can you clarify?"
REFUSE              // "I can't help with that"
```

**How it's decided**:
1. **Fast path**: Pattern matching (e.g., "last meeting" → SINGLE_MEETING)
2. **Smart path**: AI analyzes the question (GPT-4o)
3. **Context aware**: Looks at previous messages in thread

### What Are Contracts?

**Contracts** = How to format the response

**Think of contracts as templates**:
- `MEETING_SUMMARY` = "Give me a summary of the meeting"
- `CUSTOMER_QUESTIONS` = "List all questions the customer asked"
- `NEXT_STEPS` = "What are the action items?"
- `EXTRACTIVE_FACT` = "Find specific information"
- `DRAFT_EMAIL` = "Write an email based on the meeting"

**Example**:
```
Question: "Summarize the Acme meeting"
Intent: SINGLE_MEETING
Contract: MEETING_SUMMARY

Question: "What questions did Acme ask?"
Intent: SINGLE_MEETING
Contract: CUSTOMER_QUESTIONS

Question: "Draft a follow-up email for Acme"
Intent: SINGLE_MEETING
Contract: DRAFT_EMAIL
```

### What Are Chained Contracts?

**Chained Contracts** = Multiple steps to answer complex questions

**Example**: "Compare what Acme and Costco said about pricing"

```
Step 1: PATTERN_ANALYSIS
  → Search all meetings for pricing mentions
  → Extract relevant quotes

Step 2: COMPARISON
  → Compare Acme's feedback vs Costco's feedback
  → Identify similarities and differences

Step 3: DRAFT_RESPONSE
  → Format as a comparison table
  → Add recommendations
```

**In code**:
```typescript
// This creates a chain of contracts
const contractChain = [
  AnswerContract.PATTERN_ANALYSIS,
  AnswerContract.COMPARISON,
  AnswerContract.DRAFT_RESPONSE
];

// Each contract executes in order
// Output of one becomes input to next
```

**When to use chains**:
- Complex questions requiring multiple steps
- When you need to analyze before drafting
- When combining data from multiple sources

---

## 🎯 What You'll Actually Do

Most of the time, you'll be doing one of these:

1. **"Users want to ask about X"** → Add a new intent
2. **"The bot should respond differently for Y"** → Add a new contract
3. **"We need to extract Z from transcripts"** → Add a new extraction
4. **"The AI response isn't good"** → Update a prompt
5. **"We want to use a different AI model"** → Change LLM configuration

Let's learn how to do each one!

---

## 📁 Where Everything Lives (The Map)

```
pitcrew/
├── server/
│   ├── decisionLayer/          ← 🧠 The brain (routing questions)
│   │   ├── intent.ts           ← What users want to know
│   │   ├── answerContracts.ts  ← How to respond
│   │   └── index.ts            ← Puts it all together
│   │
│   ├── config/prompts/         ← 💬 What we tell the AI
│   │   ├── decisionLayer.ts    ← Intent classification prompts
│   │   ├── transcript.ts       ← Extraction prompts
│   │   └── singleMeeting.ts    ← Meeting-specific prompts
│   │
│   ├── openAssistant/          ← 🤖 The responder
│   │   └── openAssistantHandler.ts  ← Main response logic
│   │
│   ├── rag/                    ← 📝 Transcript analysis
│   │   ├── composer.ts         ← Extract stuff from transcripts
│   │   └── transcriptAnalyzer.ts ← Process uploaded transcripts
│   │
│   └── slack/                  ← 💬 Slack bot stuff
│       └── events.ts           ← Handle Slack messages
│
└── shared/
    └── schema.ts               ← 🗄️ Database tables
```

---

## 🎨 Task 1: Add a New Intent (What Users Want)

### When to do this:
- Users want to ask about something new (e.g., "pricing", "competitors", "roadmap")
- You want the bot to recognize a new type of question

### Example: Let's add "COMPETITOR_ANALYSIS" intent

#### Step 1: Open `server/decisionLayer/intent.ts`

Find this section (around line 20):
```typescript
export enum Intent {
  SINGLE_MEETING = "SINGLE_MEETING",
  MULTI_MEETING = "MULTI_MEETING",
  PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE",
  // ... more intents
}
```

#### Step 2: Add your new intent
```typescript
export enum Intent {
  SINGLE_MEETING = "SINGLE_MEETING",
  MULTI_MEETING = "MULTI_MEETING",
  PRODUCT_KNOWLEDGE = "PRODUCT_KNOWLEDGE",
  COMPETITOR_ANALYSIS = "COMPETITOR_ANALYSIS",  // ← ADD THIS LINE
  // ... rest of intents
}
```

#### Step 3: Open `server/config/prompts/decisionLayer.ts`

Find the `INTENT_CLASSIFICATION_PROMPT` (around line 50). Add your intent to the list:

```typescript
export const INTENT_CLASSIFICATION_PROMPT = `
You are classifying user questions into intents.

INTENTS:
- SINGLE_MEETING: Questions about a specific meeting
- MULTI_MEETING: Questions across multiple meetings
- PRODUCT_KNOWLEDGE: Questions about PitCrew features
- COMPETITOR_ANALYSIS: Questions about competitors mentioned in meetings  ← ADD THIS
...
`;
```

#### Step 4: Tell it what data to access

Open `server/decisionLayer/contextLayers.ts` and find the `computeContextLayers` function:

```typescript
export function computeContextLayers(intent: Intent): ContextLayersMetadata {
  const layers: ContextLayers = {
    product_ssot: false,
    single_meeting: false,
    multi_meeting: false,
    document_repository: false,
    slack_search: false,
  };

  // Add this block:
  if (intent === Intent.COMPETITOR_ANALYSIS) {
    layers.multi_meeting = true;  // Search across all meetings
    return {
      layers,
      reasoning: "Need to search all meetings for competitor mentions"
    };
  }
  
  // ... rest of the function
}
```

#### Step 5: Add a handler for your intent

Open `server/openAssistant/openAssistantHandler.ts` and find the main routing section (around line 700):

```typescript
// Add this new handler function at the top of the file:
async function handleCompetitorAnalysis(
  userMessage: string,
  context: OpenAssistantContext,
  classification: IntentClassification
): Promise<OpenAssistantResult> {
  // Search for competitor mentions across all meetings
  const competitors = await storage.rawQuery(`
    SELECT DISTINCT 
      pi.insight_text,
      t.company_name,
      t.meeting_date
    FROM product_insights pi
    JOIN transcripts t ON pi.transcript_id = t.id
    WHERE pi.insight_text ILIKE '%competitor%'
       OR pi.insight_text ILIKE '%competition%'
    ORDER BY t.meeting_date DESC
    LIMIT 20
  `);

  // Format the response
  const answer = `Here's what customers have said about competitors:\n\n${
    competitors.map(c => 
      `• ${c.company_name} (${c.meeting_date}): ${c.insight_text}`
    ).join('\n')
  }`;

  return {
    answer,
    intent: "competitor_analysis",
    intentClassification: classification,
    decisionLayerIntent: Intent.COMPETITOR_ANALYSIS,
    answerContract: AnswerContract.GENERAL_RESPONSE,
    dataSource: "meeting_artifacts",
    delegatedToSingleMeeting: false,
  };
}

// Then add routing to it (around line 750):
if (decisionLayerResult.intent === Intent.COMPETITOR_ANALYSIS) {
  return handleCompetitorAnalysis(text, context, classification);
}
```

#### Step 6: Test it!

1. Go to Slack
2. @mention the bot: `@PitCrew what have customers said about competitors?`
3. See if it works!

**If it doesn't work:**
- Check the logs for errors
- Make sure you saved all files
- Restart the server if needed

---

## 🎨 Task 2: Add a New Answer Contract (How to Respond)

### When to do this:
- You want a specific format for responses (e.g., bullet list, comparison table, email draft)
- You want to control how the AI structures its answer

### Example: Let's add "COMPETITOR_COMPARISON" contract

#### Step 1: Open `server/decisionLayer/answerContracts.ts`

Find the enum (around line 97):
```typescript
export enum AnswerContract {
  MEETING_SUMMARY = "MEETING_SUMMARY",
  NEXT_STEPS = "NEXT_STEPS",
  // ... more contracts
  COMPETITOR_COMPARISON = "COMPETITOR_COMPARISON",  // ← ADD THIS
}
```

#### Step 2: Define how it should behave

Find `CONTRACT_CONSTRAINTS` (around line 200) and add:

```typescript
export const CONTRACT_CONSTRAINTS: Record<AnswerContract, AnswerContractConstraints> = {
  // ... existing contracts
  
  [AnswerContract.COMPETITOR_COMPARISON]: {
    requiresEvidence: true,        // Must cite sources
    requiresCitation: true,         // Must link to transcripts
    allowsSpeculation: false,       // No guessing
    ssotMode: "descriptive",        // Not authoritative
    outputFormat: "structured_comparison",  // Specific format
    maxTokens: 2000,               // Response length limit
  },
};
```

#### Step 3: Tell it when to use this contract

Find `TASK_KEYWORDS` (around line 600) and add:

```typescript
const TASK_KEYWORDS: TaskKeyword[] = [
  // ... existing keywords
  
  {
    task: "compare_competitors",
    pattern: /\b(compare|comparison|versus|vs|difference)\b.*\b(competitor|competition)\b/i,
    intent: [Intent.COMPETITOR_ANALYSIS, Intent.MULTI_MEETING],
    contract: AnswerContract.COMPETITOR_COMPARISON,
  },
];
```

#### Step 4: Implement the contract

Open `server/openAssistant/contractExecutor.ts` and add:

```typescript
async function executeCompetitorComparison(
  userMessage: string,
  meetings: Meeting[],
  topic?: string
): Promise<string> {
  // Get competitor mentions from meetings
  const mentions = await storage.rawQuery(`
    SELECT 
      pi.insight_text,
      t.company_name,
      t.meeting_date
    FROM product_insights pi
    JOIN transcripts t ON pi.transcript_id = t.id
    WHERE t.id = ANY($1)
      AND (pi.insight_text ILIKE '%competitor%' 
           OR pi.insight_text ILIKE '%competition%')
  `, [meetings.map(m => m.meetingId)]);

  // Use AI to create comparison
  const prompt = `
Create a comparison table of competitors mentioned in these meetings.

Format:
| Competitor | Mentioned By | Context | Our Advantage |
|------------|--------------|---------|---------------|

Data: ${JSON.stringify(mentions)}
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userMessage }
    ],
  });

  return response.choices[0].message.content;
}

// Add to the switch statement:
case AnswerContract.COMPETITOR_COMPARISON:
  return executeCompetitorComparison(userMessage, meetings, topic);
```

#### Step 5: Test it!

Ask: `@PitCrew compare what customers said about our competitors`

---

## 🎨 Task 3: Add a New Extraction (Get Info from Transcripts)

### When to do this:
- You want to extract something new from meeting transcripts
- Examples: pricing discussions, feature requests, pain points, competitor mentions

### Example: Let's extract "Pricing Discussions"

#### Step 1: Add a database table

Open `shared/schema.ts` and add:

```typescript
export const pricingDiscussions = pgTable("pricing_discussions", {
  id: serial("id").primaryKey(),
  transcriptId: text("transcript_id").notNull().references(() => transcripts.id),
  pricePoint: text("price_point"),           // e.g., "$500/month"
  context: text("context").notNull(),        // What was being discussed
  customerReaction: text("customer_reaction"), // positive, negative, neutral
  evidence: text("evidence").notNull(),      // Exact quote
  createdAt: timestamp("created_at").defaultNow(),
});

export type PricingDiscussion = typeof pricingDiscussions.$inferSelect;
export type NewPricingDiscussion = typeof pricingDiscussions.$inferInsert;
```

#### Step 2: Push to database

Run this command:
```bash
npm run db:push
```

This creates the new table in your database.

#### Step 3: Create the extraction function

Open `server/rag/composer.ts` and add:

```typescript
export async function extractPricingDiscussions(
  chunks: TranscriptChunk[],
  attendees?: { leverageTeam?: string; customerNames?: string }
): Promise<PricingDiscussion[]> {
  const prompt = `
Extract all pricing discussions from this meeting transcript.

For each pricing mention, extract:
- price_point: The specific price mentioned (e.g., "$500/month", "enterprise pricing")
- context: What was being discussed when price came up
- customer_reaction: How did the customer react? (positive, negative, neutral, question)
- evidence: The exact quote from the transcript

Return JSON array:
[
  {
    "price_point": "$500/month",
    "context": "Customer asked about basic plan pricing",
    "customer_reaction": "question",
    "evidence": "Customer: How much does the basic plan cost?"
  }
]

Transcript chunks: ${JSON.stringify(chunks)}
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "Extract pricing discussions" }
    ],
    temperature: 0,  // Deterministic
  });

  const result = JSON.parse(response.choices[0].message.content);
  return result;
}
```

#### Step 4: Add to transcript analysis pipeline

Open `server/rag/transcriptAnalyzer.ts` and find the `analyzeTranscript` function:

```typescript
export async function analyzeTranscript(transcriptId: string) {
  // ... existing code ...
  
  // Add this after other extractions:
  console.log('[Transcript Analyzer] Extracting pricing discussions...');
  try {
    const pricingDiscussions = await extractPricingDiscussions(chunks, attendees);
    
    // Save to database
    for (const discussion of pricingDiscussions) {
      await storage.createPricingDiscussion({
        transcriptId,
        pricePoint: discussion.price_point,
        context: discussion.context,
        customerReaction: discussion.customer_reaction,
        evidence: discussion.evidence,
      });
    }
    
    console.log(`[Transcript Analyzer] Extracted ${pricingDiscussions.length} pricing discussions`);
  } catch (error) {
    console.error('[Transcript Analyzer] Failed to extract pricing discussions:', error);
    // Don't fail the whole analysis if this fails
  }
  
  // ... rest of the function ...
}
```

#### Step 5: Add storage functions

Open `server/storage.ts` and add:

```typescript
export async function createPricingDiscussion(data: NewPricingDiscussion) {
  return db.insert(pricingDiscussions).values(data).returning();
}

export async function getPricingDiscussions(transcriptId: string) {
  return db.select()
    .from(pricingDiscussions)
    .where(eq(pricingDiscussions.transcriptId, transcriptId));
}

export async function getAllPricingDiscussions() {
  return db.select()
    .from(pricingDiscussions)
    .innerJoin(transcripts, eq(pricingDiscussions.transcriptId, transcripts.id))
    .orderBy(desc(transcripts.meetingDate));
}
```

#### Step 6: Test it!

1. Upload a transcript that mentions pricing
2. Wait for processing to complete
3. Check the database:
```sql
SELECT * FROM pricing_discussions;
```

---

## 🎨 Task 4: Update AI Prompts (Make Responses Better)

### Understanding Prompts

**What is a prompt?** = Instructions you give to the AI

**Think of it like**: Telling a new employee exactly how to do their job

**Example**:
```typescript
// Bad prompt (vague)
"Extract insights from the meeting"

// Good prompt (specific)
"Extract product insights from this meeting transcript.
For each insight, include:
- The feature mentioned
- What the customer said (exact quote)
- Whether it's positive, negative, or a question
Only extract explicit mentions, don't guess."
```

### Where Prompts Live

```
server/config/prompts/
├── decisionLayer.ts      ← Intent classification prompts
├── transcript.ts         ← Extraction prompts (insights, Q&A, etc.)
├── singleMeeting.ts      ← Meeting-specific prompts
├── system.ts             ← General system prompts
└── external.ts           ← External research prompts
```

### When to do this:
- The AI isn't extracting what you want
- Responses are too long/short
- Quality isn't good enough
- You want to add new fields to extraction

### Example: Improve product insight extraction

#### Step 1: Find the prompt

Open `server/config/prompts/transcript.ts` and find `RAG_PRODUCT_INSIGHTS_SYSTEM_PROMPT`:

```typescript
export const RAG_PRODUCT_INSIGHTS_SYSTEM_PROMPT = `
You are analyzing a meeting transcript to extract product insights.

WHAT TO EXTRACT:
- Feature mentions (what features were discussed?)
- Customer feedback (what did they like/dislike?)
- Pain points (what problems do they have?)
- Feature requests (what do they want?)

RULES:
1. Only extract explicit mentions
2. Include direct quotes when possible
3. Note the speaker (customer vs our team)
4. Categorize by product area

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

#### Step 2: Identify what's wrong

**Common issues**:
- ❌ AI extracts too much (not specific enough)
- ❌ AI misses important things (rules not clear)
- ❌ Format is inconsistent (output format not strict)
- ❌ Quality varies (no examples provided)

#### Step 3: Make it better

**Technique 1: Add more specific rules**
```typescript
RULES:
1. Only extract explicit mentions (not implied or assumed)
2. Include direct quotes when possible (verbatim from transcript)
3. Note the speaker (customer vs our team)
4. Categorize by product area (Analytics, Reporting, Integration, etc.)
5. Ignore small talk and pleasantries  ← NEW
6. Focus on actionable feedback  ← NEW
```

**Technique 2: Add examples**
```typescript
EXAMPLES:

Good extraction:
{
  "feature": "Real-time Dashboard",
  "category": "Analytics",
  "context": "Customer needs to see live data instead of waiting for daily reports",
  "quote": "We need to see what's happening right now, not yesterday",
  "sentiment": "pain_point",
  "speaker": "John Smith (Customer)"
}

Bad extraction (too vague):
{
  "feature": "Dashboard",
  "context": "They talked about it",
  "sentiment": "positive"
}
```

**Technique 3: Be more specific about output**
```typescript
OUTPUT FORMAT (STRICT):
{
  "insights": [
    {
      "feature": string,           // Specific feature name
      "category": string,          // Must be one of: Analytics, Reporting, Integration, Security, Performance
      "context": string,           // Why was this mentioned? What led to it? (min 20 words)
      "quote": string,             // Exact quote from transcript (required)
      "sentiment": string,         // Must be one of: positive, negative, question, pain_point, feature_request
      "speaker": string,           // Name and role (e.g., "John Smith (Customer)")
      "priority": string           // Must be one of: high, medium, low
    }
  ]
}
```

#### Step 4: Test your changes

**Option 1: Reprocess a transcript**
1. Go to Web UI
2. Find a transcript
3. Click "Retry" button
4. Check if extraction improved

**Option 2: Test with a sample**
```typescript
// Add this temporarily to test
const testChunks = [
  {
    text: "Customer: We really need real-time analytics. Right now we have to wait 24 hours for reports.",
    speaker: "John Smith",
    role: "customer"
  }
];

const result = await extractProductInsights(testChunks);
console.log('Test result:', JSON.stringify(result, null, 2));
```

#### Step 5: Tune the temperature

**Temperature** = How creative the AI should be

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [...],
  temperature: 0,  // ← Change this
});
```

**Temperature guide**:
- `0` = Deterministic, consistent, factual (use for extraction)
- `0.3` = Slightly creative but mostly consistent
- `0.7` = Balanced creativity and consistency (use for drafting)
- `1.0` = Very creative, varied outputs

**When to use what**:
```typescript
// Extraction (facts only)
temperature: 0

// Summarization (some creativity okay)
temperature: 0.3

// Drafting emails/documents (more creative)
temperature: 0.7

// Brainstorming (very creative)
temperature: 1.0
```

---

## 🎨 Task 5: Edit Outputs (Change Response Format)

### Understanding Output Control

You can control outputs at **three levels**:

#### Level 1: Prompt Instructions (Easiest)
Change what you tell the AI in the prompt

```typescript
// Before: Generic output
"Provide a summary of the meeting"

// After: Specific format
"Provide a summary in this format:
## Key Topics
- Topic 1
- Topic 2

## Decisions Made
- Decision 1
- Decision 2

## Next Steps
- Action 1 (Owner: Name)
- Action 2 (Owner: Name)"
```

#### Level 2: Contract Constraints (Medium)
Change the contract's output format

Open `server/decisionLayer/answerContracts.ts`:

```typescript
export const CONTRACT_CONSTRAINTS: Record<AnswerContract, AnswerContractConstraints> = {
  [AnswerContract.MEETING_SUMMARY]: {
    requiresEvidence: true,
    requiresCitation: true,
    allowsSpeculation: false,
    ssotMode: "descriptive",
    outputFormat: "structured_summary",  // ← Change this
    maxTokens: 1500,  // ← Or this (response length)
  },
};
```

**Output format options**:
- `"text"` = Plain text paragraph
- `"list"` = Bullet point list
- `"structured"` = Sections with headers
- `"table"` = Markdown table
- `"json"` = JSON object

#### Level 3: Handler Logic (Advanced)
Change how the handler processes and formats the response

Open the handler file (e.g., `server/openAssistant/singleMeetingOrchestrator.ts`):

```typescript
// Find the contract execution
case AnswerContract.MEETING_SUMMARY:
  const summary = await generateMeetingSummary(chunks, attendees);
  
  // Add custom formatting here
  const formatted = `
📋 Meeting Summary

**Date**: ${meeting.meetingDate}
**Company**: ${meeting.companyName}

${summary}

---
💡 Want more details? Ask me about specific topics!
  `;
  
  return formatted;
```

### Example: Change Meeting Summary Format

**Current output**:
```
The meeting covered three main topics: pricing, features, and timeline.
Customer expressed interest in the analytics dashboard...
```

**Desired output**:
```
📋 MEETING SUMMARY

🎯 KEY TOPICS
• Pricing discussion
• Feature requests
• Implementation timeline

💬 CUSTOMER FEEDBACK
• Positive: "Love the analytics dashboard"
• Concern: "Pricing seems high"

✅ NEXT STEPS
• Send pricing proposal (Owner: Sarah)
• Schedule demo (Owner: Mike)
```

**How to do it**:

**Step 1**: Update the prompt in `server/config/prompts/singleMeeting.ts`:

```typescript
export function buildMeetingSummaryPrompt(params: {
  meetingContext: string;
  threadContext?: string;
}) {
  return `
Generate a meeting summary in this EXACT format:

📋 MEETING SUMMARY

🎯 KEY TOPICS
• [Topic 1]
• [Topic 2]
• [Topic 3]

💬 CUSTOMER FEEDBACK
• Positive: "[Quote]"
• Concern: "[Quote]"
• Question: "[Quote]"

✅ NEXT STEPS
• [Action item] (Owner: [Name])
• [Action item] (Owner: [Name])

Meeting context: ${params.meetingContext}
${params.threadContext || ''}
  `;
}
```

**Step 2**: Test it by asking for a summary in Slack

---

## 🎨 Task 6: Change the LLM (Switch AI Models)

### Understanding Model Configuration

**Current models used**:
- **GPT-4o**: Main model for most tasks (fast, good quality)
- **GPT-5**: Premium model for complex tasks (slower, best quality)
- **Gemini**: Google's model for specific use cases

**Where models are configured**: `server/config/models.ts`

### Model Assignment System

Open `server/config/models.ts`:

```typescript
export const MODEL_ASSIGNMENTS = {
  // Intent classification (needs to be fast)
  intent_classification: {
    provider: "openai",
    model: "gpt-4o",
    fallback: "gpt-4o-mini"
  },
  
  // Transcript analysis (needs to be thorough)
  transcript_analysis: {
    provider: "openai",
    model: "gpt-4o",
    fallback: "gpt-4o-mini"
  },
  
  // Meeting summaries (balance speed and quality)
  meeting_summary: {
    provider: "openai",
    model: "gpt-4o",
    fallback: "gpt-4o-mini"
  },
  
  // Complex reasoning (use best model)
  complex_reasoning: {
    provider: "openai",
    model: "gpt-5",
    fallback: "gpt-4o"
  },
};
```

### When to Change Models

**Use GPT-4o-mini when**:
- Speed is critical
- Task is simple (classification, extraction)
- Cost is a concern

**Use GPT-4o when**:
- Need good quality
- Moderate complexity
- Most common use case

**Use GPT-5 when**:
- Need best quality
- Complex reasoning required
- Cost is not a concern

### How to Change a Model

#### Option 1: Change for specific task

```typescript
// In the file where you call the AI
const response = await openai.chat.completions.create({
  model: "gpt-4o",  // ← Change this
  messages: [...],
});

// Change to:
model: "gpt-4o-mini",  // Faster, cheaper
// or
model: "gpt-5",  // Better quality
```

#### Option 2: Change globally for a task type

Open `server/config/models.ts`:

```typescript
export const MODEL_ASSIGNMENTS = {
  // Change this:
  transcript_analysis: {
    provider: "openai",
    model: "gpt-4o",  // ← Change to "gpt-5" for better quality
    fallback: "gpt-4o-mini"
  },
};
```

Then use it in your code:

```typescript
import { MODEL_ASSIGNMENTS } from "../config/models";

const response = await openai.chat.completions.create({
  model: MODEL_ASSIGNMENTS.transcript_analysis.model,  // Uses config
  messages: [...],
});
```

#### Option 3: Add a new model provider (e.g., Claude)

**Step 1**: Install the SDK
```bash
npm install @anthropic-ai/sdk
```

**Step 2**: Add to model config
```typescript
export const MODEL_ASSIGNMENTS = {
  // Add new provider
  draft_email: {
    provider: "anthropic",
    model: "claude-3-opus",
    fallback: "gpt-4o"
  },
};
```

**Step 3**: Add provider logic
```typescript
// In your handler
if (MODEL_ASSIGNMENTS.draft_email.provider === "anthropic") {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });
  
  const response = await anthropic.messages.create({
    model: MODEL_ASSIGNMENTS.draft_email.model,
    messages: [...],
  });
}
```

### Testing Model Changes

**Step 1**: Test with a sample
```typescript
// Add temporary logging
console.log('[Model Test] Using model:', model);
const response = await openai.chat.completions.create({...});
console.log('[Model Test] Response:', response.choices[0].message.content);
console.log('[Model Test] Tokens used:', response.usage);
```

**Step 2**: Compare quality
- Test same question with different models
- Check response quality
- Check response time
- Check token usage (cost)

**Step 3**: Monitor in production
- Check logs for errors
- Monitor response times
- Track token usage
- Get user feedback

---

## 🎨 Task 7: Add a Chained Contract

### Understanding Contract Chains

**What is a chain?** = Multiple contracts executed in sequence

**Why use chains?** = Complex questions need multiple steps

**Example**: "Compare what Acme and Costco said about pricing and draft a response"

```
Step 1: PATTERN_ANALYSIS
  Input: "pricing" + all meetings
  Output: List of pricing mentions from both companies

Step 2: COMPARISON  
  Input: Pricing mentions from step 1
  Output: Comparison table showing differences

Step 3: DRAFT_RESPONSE
  Input: Comparison from step 2
  Output: Professional email with recommendations
```

### When to Use Chains

✅ **Use chains when**:
- Question requires multiple steps
- Need to analyze before drafting
- Combining data from multiple sources
- Building complex documents

❌ **Don't use chains when**:
- Simple question (one step is enough)
- Speed is critical (chains are slower)
- User wants quick answer

### How to Create a Chain

#### Step 1: Define the contracts you need

Think about the steps:
1. What data do I need to gather?
2. What analysis do I need to do?
3. What format should the final output be?

Example: "Create a competitive analysis report"
1. `PATTERN_ANALYSIS` - Find all competitor mentions
2. `COMPARISON` - Compare our features vs theirs
3. `SALES_DOCS_PREP` - Format as a professional report

#### Step 2: Add chain logic to `answerContracts.ts`

Find the `buildContractChain` function:

```typescript
export function buildContractChain(
  userMessage: string,
  intent: Intent,
  scope: ChainBuildScope
): ContractChain {
  const contracts: AnswerContract[] = [];
  
  // Add your chain logic
  if (userMessage.includes("competitive analysis")) {
    contracts.push(AnswerContract.PATTERN_ANALYSIS);
    contracts.push(AnswerContract.COMPARISON);
    contracts.push(AnswerContract.SALES_DOCS_PREP);
    
    return {
      contracts,
      primaryContract: contracts[0],
      selectionMethod: "keyword"
    };
  }
  
  // ... rest of function
}
```

#### Step 3: Implement chain execution

Open `server/openAssistant/contractExecutor.ts`:

```typescript
export async function executeContractChain(
  chain: ContractChain,
  userMessage: string,
  meetings: Meeting[],
  topic?: string
): Promise<ContractChainResult> {
  let intermediateResults: any[] = [];
  let finalOutput = "";
  
  // Execute each contract in sequence
  for (const contract of chain.contracts) {
    console.log(`[Chain] Executing contract: ${contract}`);
    
    switch (contract) {
      case AnswerContract.PATTERN_ANALYSIS:
        const patterns = await executePatternAnalysis(
          userMessage, 
          meetings, 
          topic
        );
        intermediateResults.push(patterns);
        break;
        
      case AnswerContract.COMPARISON:
        const comparison = await executeComparison(
          userMessage,
          intermediateResults[0]  // Use output from previous step
        );
        intermediateResults.push(comparison);
        break;
        
      case AnswerContract.SALES_DOCS_PREP:
        finalOutput = await executeSalesDocsPrep(
          userMessage,
          intermediateResults[1]  // Use comparison from previous step
        );
        break;
    }
  }
  
  return {
    finalOutput,
    intermediateResults,
    contractsExecuted: chain.contracts
  };
}
```

#### Step 4: Test the chain

Ask a question that triggers your chain:
```
@PitCrew create a competitive analysis report based on recent meetings
```

Check the logs to see each step executing:
```
[Chain] Executing contract: PATTERN_ANALYSIS
[Chain] Executing contract: COMPARISON
[Chain] Executing contract: SALES_DOCS_PREP
```

---

## 🎨 Task 5: Add a New Slack Command

### When to do this:
- You want users to trigger something with a slash command
- Example: `/pitcrew-stats`, `/pitcrew-help`, `/pitcrew-export`

### Example: Add `/pitcrew-summary` command

#### Step 1: Create the handler

Create a new file `server/slack/commands/summaryCommand.ts`:

```typescript
import { storage } from "../../storage";

export async function handleSummaryCommand(
  userId: string,
  channelId: string,
  text: string  // Any text after the command
): Promise<string> {
  // Get user's recent activity
  const recentTranscripts = await storage.rawQuery(`
    SELECT 
      t.company_name,
      t.meeting_date,
      COUNT(pi.id) as insight_count
    FROM transcripts t
    LEFT JOIN product_insights pi ON t.id = pi.transcript_id
    WHERE t.created_at > NOW() - INTERVAL '7 days'
    GROUP BY t.id, t.company_name, t.meeting_date
    ORDER BY t.meeting_date DESC
    LIMIT 5
  `);

  if (recentTranscripts.length === 0) {
    return "📊 No recent activity in the last 7 days.";
  }

  const summary = recentTranscripts.map(t => 
    `• ${t.company_name} (${t.meeting_date}): ${t.insight_count} insights`
  ).join('\n');

  return `📊 Your Recent Activity (Last 7 Days)\n\n${summary}`;
}
```

#### Step 2: Register the command in Slack

1. Go to https://api.slack.com/apps
2. Select your PitCrew app
3. Go to "Slash Commands"
4. Click "Create New Command"
5. Fill in:
   - Command: `/pitcrew-summary`
   - Request URL: `https://your-domain.com/api/slack/commands`
   - Short Description: "Show your recent PitCrew activity"
6. Save

#### Step 3: Add the route handler

Open `server/slack/events.ts` and add:

```typescript
import { handleSummaryCommand } from "./commands/summaryCommand";

// Add this route (around line 100):
app.post("/api/slack/commands", async (req, res) => {
  const { command, user_id, channel_id, text } = req.body;
  
  // Verify it's from Slack
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];
  // ... verification code ...
  
  if (command === "/pitcrew-summary") {
    const response = await handleSummaryCommand(user_id, channel_id, text);
    return res.json({ 
      response_type: "ephemeral",  // Only visible to user
      text: response 
    });
  }
  
  res.json({ text: "Unknown command" });
});
```

#### Step 4: Test it!

1. Go to Slack
2. Type `/pitcrew-summary`
3. See your summary!

---

## 🐛 Debugging Tips (When Things Break)

### "The bot isn't responding!"

**Check 1**: Is the server running?
```bash
# In Replit, check the console
# Look for "Server listening on port 5000"
```

**Check 2**: Check the logs
```bash
# Look for errors in the console
# Search for "ERROR" or "Failed"
```

**Check 3**: Is Slack connected?
```bash
# Check environment variables
echo $SLACK_BOT_TOKEN
echo $SLACK_SIGNING_SECRET
```

### "The AI response is weird!"

**Check 1**: Look at the prompt
- Find the prompt in `server/config/prompts/`
- Is it clear what you want?
- Are there examples?

**Check 2**: Check the temperature
```typescript
// Lower temperature = more consistent
temperature: 0,  // Deterministic

// Higher temperature = more creative
temperature: 0.7,  // Creative
```

**Check 3**: Look at the actual AI request/response
```typescript
// Add logging:
console.log('[AI Request]', { prompt, userMessage });
const response = await openai.chat.completions.create({...});
console.log('[AI Response]', response.choices[0].message.content);
```

### "Database error!"

**Check 1**: Did you run migrations?
```bash
npm run db:push
```

**Check 2**: Check the database connection
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

**Check 3**: Look at the actual query
```typescript
// Add logging:
console.log('[SQL Query]', query, params);
const result = await db.execute(query);
console.log('[SQL Result]', result);
```

### "Transcript processing failed!"

**Check 1**: Look at the transcript status
```sql
SELECT id, company_name, status, error_message 
FROM transcripts 
WHERE status = 'FAILED';
```

**Check 2**: Check OpenAI API quota
- Go to https://platform.openai.com/usage
- Make sure you have credits

**Check 3**: Try reprocessing
- Click "Retry" button in Web UI
- Or run: `npm run retry-transcript -- --id=<transcript-id>`

---

## 📝 Quick Reference - Copy-Paste Templates

### Template: New Intent
```typescript
// 1. Add to enum in server/decisionLayer/intent.ts
export enum Intent {
  MY_NEW_INTENT = "MY_NEW_INTENT",
}

// 2. Add to prompt in server/config/prompts/decisionLayer.ts
- MY_NEW_INTENT: Description of when to use this

// 3. Add context layers in server/decisionLayer/contextLayers.ts
if (intent === Intent.MY_NEW_INTENT) {
  layers.multi_meeting = true;
  return { layers, reasoning: "Why we need this data" };
}

// 4. Add handler in server/openAssistant/openAssistantHandler.ts
async function handleMyNewIntent(...) {
  // Your logic here
  return { answer, intent, ... };
}

if (decisionLayerResult.intent === Intent.MY_NEW_INTENT) {
  return handleMyNewIntent(...);
}
```

### Template: New Extraction
```typescript
// 1. Add table in shared/schema.ts
export const myNewData = pgTable("my_new_data", {
  id: serial("id").primaryKey(),
  transcriptId: text("transcript_id").notNull(),
  extractedField: text("extracted_field"),
  createdAt: timestamp("created_at").defaultNow(),
});

// 2. Run: npm run db:push

// 3. Add extraction in server/rag/composer.ts
export async function extractMyNewData(chunks: TranscriptChunk[]) {
  const prompt = `Extract X from transcript...`;
  const response = await openai.chat.completions.create({...});
  return JSON.parse(response.choices[0].message.content);
}

// 4. Add to pipeline in server/rag/transcriptAnalyzer.ts
const myData = await extractMyNewData(chunks);
for (const item of myData) {
  await storage.createMyNewData({ transcriptId, ...item });
}

// 5. Add storage functions in server/storage.ts
export async function createMyNewData(data) {
  return db.insert(myNewData).values(data).returning();
}
```

### Template: Update Prompt
```typescript
// Find prompt in server/config/prompts/
export const MY_PROMPT = `
Clear instructions for the AI.

RULES:
1. Rule one
2. Rule two

OUTPUT FORMAT:
{
  "field": "value"
}
`;
```

---

## 🎓 Learning Resources

### Understanding the Code
- **Intent**: What the user wants (e.g., "tell me about a meeting")
- **Contract**: How to respond (e.g., "give a summary")
- **Context Layers**: What data to access (e.g., "search all meetings")
- **Extraction**: Getting info from transcripts (e.g., "find action items")

### Key Concepts
- **LLM**: Large Language Model (the AI, like GPT-4)
- **Prompt**: Instructions we give to the AI
- **Temperature**: How creative the AI should be (0 = consistent, 1 = creative)
- **RAG**: Retrieval Augmented Generation (search + AI)
- **Semantic**: Understanding meaning, not just keywords

### When to Ask for Help
- Database migrations aren't working
- Slack webhook isn't connecting
- OpenAI API errors
- Complex TypeScript errors

---

## ✅ Checklist Before Deploying Changes

- [ ] Tested locally in Replit
- [ ] Checked logs for errors
- [ ] Tested in Slack (if Slack-related)
- [ ] Ran `npm run db:push` (if database changes)
- [ ] Committed changes to git
- [ ] Pushed to main branch
- [ ] Verified in production

---

You got this! 🚀 Remember: vibecoding is about understanding the patterns and copying what works. Don't be afraid to experiment - you can always undo changes with git!

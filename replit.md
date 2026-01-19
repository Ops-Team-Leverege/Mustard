# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application that uses AI to analyze Business Development call transcripts. Its primary goal is to extract, categorize, and organize product insights and customer Q&A into searchable tables. This empowers sales and product teams with actionable intelligence, improving product development and refining sales strategies. The application features a dark-mode-first UI and real-time categorization. The project aims to provide a streamlined way for businesses to derive value from customer interactions, enhancing decision-making and market responsiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

### OpenAI Integration Changes (CRITICAL)
**Always ask where the impact should be reflected before making OpenAI-related changes.**

This application has multiple features using OpenAI with different models and settings:

| Feature | File | Model | Temperature | Purpose |
|---------|------|-------|-------------|---------|
| Transcript Analyzer | `server/transcriptAnalyzer.ts` | gpt-5 | default (1) | Extract insights/Q&A from transcripts |
| MCP Router | `server/mcp/llm.ts` | gpt-4o-mini | 0 | Route Slack questions to capabilities |
| RAG Composer | `server/rag/composer.ts` | gpt-4o-mini / gpt-4o | 0 | Extract answers, commitments, quotes |
| Customer Questions | `server/extraction/extractCustomerQuestions.ts` | gpt-4o | 0 | Extract verbatim customer questions |

**Model constraints:**
- gpt-5 does NOT support temperature=0 (only default value of 1)
- gpt-4o-mini and gpt-4o support temperature=0 for deterministic output

**Before changing any LLM settings, confirm with the user which features should be affected.**

## System Architecture

### Core Design Principles
The system is built as a Single-Page Application (SPA) using React and Vite, featuring client-side routing with Wouter. It emphasizes asynchronous transcript processing, where AI analysis runs in the background, allowing users to track progress. End-to-end type safety is achieved using Zod and shared schema definitions. The architecture supports a multi-product environment (PitCrew, AutoTrace, WorkWatch, ExpressLane) with complete data separation via a `product` column in the database.

### Frontend
The frontend is built with React and TypeScript, leveraging Shadcn/ui (New York style), Radix UI, and Tailwind CSS for a dark-mode-first UI inspired by Linear/Notion aesthetics. State management is handled by TanStack Query for server state and React hooks for local state. Custom CSS variables and the Inter font define the design system.

### Backend
The backend uses Express.js with TypeScript, providing a RESTful JSON API. Data is managed with PostgreSQL and Drizzle ORM, with Zod for schema validation. OpenAI API (GPT-5) is integrated for AI tasks, utilizing structured prompt engineering for analysis and categorization, with batching for large transcripts. Authentication is handled via Replit Auth (OpenID Connect), restricting access to specific email domains. The database schema supports various entities including `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, and `users`.

### Key Features
Key functionalities include a transcript detail view, meeting date support, and dashboard analytics for companies and categories. Contact management includes smart duplicate prevention, while transcript management offers full list views, search, edit, and delete options. The system supports company stage management, service tagging, and tracking of POS systems, including automatic detection from transcripts. It also allows for meeting notes and supporting materials during upload. A critical architectural invariant is the preservation of speaker identity in transcripts. The system differentiates between `qa_pairs` (interpreted Q&A) and `customer_questions` (verbatim, evidence-based extraction) to ensure data trust and integrity. The Slack Single-Meeting Orchestrator handles user questions scoped to a single meeting, with strict rules for capabilities and uncertainty communication, ensuring no inference or hallucination.

## External Dependencies

### AI Services
- **OpenAI API (GPT-5)**

### Database
- **PostgreSQL**
- **Drizzle ORM**
- **Neon**

### UI Component Libraries
- **Radix UI**
- **Shadcn/ui**
- **Tailwind CSS**
- **Lucide React**

### Build & Development Tools
- **Vite**
- **esbuild**
- **tsx**

### State & Data Fetching
- **TanStack Query**
- **React Hook Form**
- **Zod**

### Supporting Libraries
- **wouter**
- **date-fns**
- **clsx & tailwind-merge**
- **cmdk**
- **embla-carousel-react**
- **Recharts**
- **mammoth**
- **pdf-parse**
- **multer**

### Integrations
- **Replit Auth**
- **Jira Integration**

## Slack Single-Meeting Orchestrator

**Purpose:** Handles Slack user questions scoped to a single meeting with strict behavioral guarantees.

**Core Invariants:**
- One thread = one meeting
- Summaries are opt-in only (never a fallback)
- No inference or hallucination
- Uncertainty must be communicated honestly
- Only Tier-1 capabilities allowed for single-meeting answers

**Capability Trust Matrix:**

| Tier | Capabilities | Usage |
|------|-------------|-------|
| Tier 1 (Allowed) | attendees, customer_questions, next_steps/commitments, raw transcript | Single-meeting answers |
| Tier 2 (Summary Only) | meeting_summaries, GPT-5 | Explicit opt-in only |
| Tier 3 (Blocked) | qa_pairs, searchQuestions, searchCompanyFeedback, getCompanyInsights | NOT allowed in single-meeting flow |

**Intent Classification:**

1. **Extractive** (Specific Fact):
   - Examples: "What issue did Brian experience?", "Who attended?", "Was pricing discussed?"
   - Behavior: Query Tier-1 sources only, return with evidence

2. **Aggregative** (General but Directed):
   - Examples: "What issues came up?", "What concerns did the customer raise?"
   - Behavior: Return curated list from Tier-1 data (no narrative)

3. **Summary** (Explicit Only):
   - Examples: "Summarize the meeting", "Give me an overview"
   - Behavior: Generate summary using GPT-5 (only when explicitly requested)

**Extractive Search Order (LOCKED):**

| Priority | Source | What it answers |
|----------|--------|-----------------|
| 1 | Attendees | Who was present |
| 2 | Customer questions | What customers asked (high-trust, verbatim) |
| 3 | Action items / commitments | Explicit issues, follow-ups, and named events |
| 4 | Transcript snippets | Last resort, verbatim evidence |

**RULE:** Action items are checked whenever the question asks about issues, problems, blockers, errors, or incidents — regardless of whether the user says "next steps".

**Answer Framing for Action Items:**
When the answer comes from an action item, the response must be honest about what was documented vs. what was discussed:
- Good: "The meeting notes include a follow-up to investigate X (owned by Y), but the specific cause wasn't discussed."
- Bad: "The issue was X because Y." (overclaiming)

**Uncertainty Response:**
When no extractive or aggregative answer is found:
```
I don't see this explicitly mentioned in the meeting.
If you'd like, I can share what was discussed instead.
```

**Monitoring:**
- All Slack interactions are logged to `interaction_logs` table
- Single-meeting mode logs include additional fields in `resolvedEntities`:
  - `intentClassification`: "extractive" | "aggregative" | "summary"
  - `dataSource`: "attendees" | "customer_questions" | "action_items" | "transcript" | "summary" | "not_found"
  - `isSingleMeetingMode`: boolean flag for filtering
- Use these fields to monitor intent classification accuracy and identify patterns

**Activation:**
- Single-meeting mode activates when Slack thread has resolved `meetingId` + `companyId`
- File: `server/mcp/singleMeetingOrchestrator.ts`
- Integrated via: `server/slack/events.ts`
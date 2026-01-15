# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application designed to leverage AI for analyzing Business Development call transcripts. Its core purpose is to extract, categorize, and organize product insights and customer Q&A into searchable tables. This provides sales and product teams with actionable intelligence, streamlining insight discovery from customer interactions, enhancing product development, and refining sales strategies. The application features a dark-mode-first UI and real-time categorization.

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

**Model constraints:**
- gpt-5 does NOT support temperature=0 (only default value of 1)
- gpt-4o-mini and gpt-4o support temperature=0 for deterministic output

**Before changing any LLM settings, confirm with the user which features should be affected.**

## System Architecture

### Core Design Principles
- **Single-Page Application (SPA)**: Client-side routing with Wouter.
- **Asynchronous Transcript Processing**: Transcripts are uploaded and immediately marked pending. AI analysis runs in the background with status updates, allowing users to track progress and retry failed analyses.
- **Type Safety**: End-to-end type safety achieved with shared schema definitions and Zod.
- **Multi-Product Architecture**: Supports four distinct products (PitCrew, AutoTrace, WorkWatch, ExpressLane) with complete data separation using a `product` column for isolation within a single database.

### Frontend
- **Framework**: React with TypeScript (Vite).
- **UI/UX**: Shadcn/ui (New York style), Radix UI, Tailwind CSS, CVA. Dark-mode-first with light mode support, inspired by Linear/Notion aesthetics.
- **State Management**: TanStack Query for server state; React hooks for local state.
- **Navigation**: Tab navigation with dropdowns for "Databases" (Product Insights, Q&A Database, Transcripts).
- **Design System**: Custom CSS variables for color, Inter font.

### Backend
- **Framework**: Express.js with TypeScript.
- **API**: RESTful JSON API (`/api`), centralized error handling.
- **Data Layer**: PostgreSQL with Drizzle ORM, Zod for schema validation. Neon for production.
- **AI Integration**: OpenAI API (GPT-5) for transcript analysis, structured prompt engineering for insight/Q&A extraction and categorization. Handles large transcripts via batching.
- **Authentication**: Replit Auth (OpenID Connect) with session-based PostgreSQL store. Access restricted to `@leverege.com` emails.
- **Database Schema**: Includes tables for `transcripts`, `categories`, `product_insights`, `qa_pairs`, `companies`, `contacts`, `users`, `sessions`, `features`, `pos_systems`, `pos_system_companies`.

### Key Features
- **Transcript Detail View**: Dedicated page for individual transcripts showing filtered insights/Q&A.
- **Meeting Date Support**: Optional meeting date input during transcript upload.
- **Dashboard Analytics**: Companies page shows recent meetings and "Companies by Stage" pie chart. Categories page shows bar charts of insights/Q&A by unique company mentions.
- **Contact Management**: Smart duplicate prevention and a "Merge Duplicates" feature for contacts.
- **Transcript Management**: Full list view, search, edit, delete with cascade for associated data.
- **Service Tagging**: Companies can be tagged with service categories.
- **Company Stage Management**: Tracks company progression through stages (Prospect, Pilot, Rollout, Scale).
- **Temporal Context**: Product insights and Q&A tables include "Transcript Date."
- **Features Management**: CRUD operations for tracking product features, linking them to categories, and displaying related insights.
- **Rich Text Support**: `mainMeetingTakeaways` field supports multi-line text and bullet points.
- **Q&A Star Feature**: Q&A pairs can be starred/favorited for quick reference.
- **POS Systems Database**: Tracks Point of Sale systems with company relationships.
- **Automatic POS System Detection**: AI automatically identifies and links POS systems mentioned in transcripts to companies.
- **Meeting Notes Support**: Toggle for "Add Meeting Notes" mode, optimizing AI prompts for condensed notes.
- **Supporting Materials**: Optional section in upload form for file references or URLs for supplementary materials.

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

## Architectural Invariants

### Speaker Identity Preservation (CRITICAL)
**Transcript formatting must never drop speaker identity.**

This is a hard contract between ingestion → composer:
- Transcript chunks MUST include `speakerName` when available
- `formatTranscript()` MUST preserve speaker names in the output sent to LLMs
- Generic role labels ("Leverege", "Customer") are fallbacks ONLY when speakerName is missing

Enforcement: `assertSpeakerNamesPreserved()` in `server/rag/composer.ts` validates this invariant at runtime.

### Action-State Next Steps Extraction (Quality Standard)
**Next steps extraction targets Google Meet "Suggested next steps" quality or better.**

Design principles:
- Think like a senior operations assistant: "What actions now exist in the world because of this meeting?"
- Precision > recall (false positives are worse than omissions)
- Actions are extracted, not inferred
- All actions must be grounded in transcript evidence

Action types captured:
- `commitment`: Explicit "I will" / "We will" statements
- `request`: "Can you..." / "Please..." that imply follow-up
- `blocker`: "We can't proceed until..." dependencies
- `plan`: "The plan is to..." / decided course of action
- `scheduling`: Meeting coordination, follow-up calls

Processing pipeline:
1. Three-phase LLM reasoning: Green Room Filter → Extract atomic actions → Consolidate
2. Meeting Start Detection ("Green Room" filter): Ignore pre-meeting chatter
3. Immediate Resolution Check ("Just Now" filter): Discard actions resolved during the call
4. Deterministic post-processing: Name normalization against canonical attendee list
5. Two-tier confidence output: Primary (≥0.85) + Secondary (0.70-0.85)

Green Room filter (Meeting Start Detection):
- Scan for actual meeting start (e.g., "Hi everyone," "Let's get started")
- IGNORE any commitments made before this point (pre-meeting chatter)
- Examples of pre-meeting chatter to ignore: "Can you hear me?", "I'll admit them", "Waiting for Bob"

Resolution check:
- Before adding a candidate, scan subsequent ~20 turns
- Discard if question was answered or action completed during the call
- Example: "Are TVs installed?" → "Yep" = resolved in-call, not a next step

Priority heuristic (imperative detection):
- "Permission to proceed" = Command: "You've got the green light to share X" → Share X
- Imperative instructions = Command: "You need to chat with Randy" → Chat with Randy
- Enablement grants = Command: "Feel free to let them know" → Inform them

Obligation triggers (HIGH-CONFIDENCE when directed at a specific person):
- "You/We need to..." → Extract as commitment (0.95)
- "You/We have to..." → Extract as commitment (0.95)
- "You/We must..." → Extract as commitment (0.95)
- Example: "You need to figure out the pricing" → [Action: Determine pricing strategy]

System features vs. human tasks (critical anti-pattern):
- Do NOT extract tasks where a user describes what the SOFTWARE will do
- Anti-Pattern: "The system provides daily reports" → NOT a task
- Anti-Pattern: "Every user will have their own login" → NOT a task
- Pattern: "I will email you the report" → Extract (human action)
- Explaining what software does is NOT a task for the person explaining it

Decision dependencies (always extract):
- "Chat/Sync/Discussion" is MANDATORY if goal is to make a decision or configure settings
- Example: "Chat with Randy about alert thresholds" → Extract (decision required)
- NOT a social nicety if it affects business logic

Distinct deliverables (do not over-merge):
- Multiple distinct assets promised = separate tasks
- Example: "Send login info AND start guide" → TWO separate tasks

Consolidation rules:
- Merge micro-actions when same owner + same timeframe + same operational goal
- Never merge across different owners
- Never paraphrase evidence into new facts
- Never infer unspoken commitments

Evidence cleanup (mandatory):
- Remove filler words ("um", "uh", "like") for readability
- Do NOT change meaning or paraphrase facts
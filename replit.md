# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application designed to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts using AI. It provides actionable intelligence for sales and product teams, aiming to improve product development and refine sales strategies. The application features a dark-mode-first UI and real-time categorization, facilitating enhanced decision-making and market responsiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

### OpenAI Integration Changes (CRITICAL)
**Always ask where the impact should be reflected before making OpenAI-related changes.**

## OpenAI Prompt Inventory

**19 OpenAI calls across 13 files:**

| File | Line | Model | Temp | Purpose |
|------|------|-------|------|---------|
| `server/transcriptAnalyzer.ts` | 197 | gpt-5 | 1 (default) | Extract insights/Q&A from transcripts |
| `server/slack/semanticAnswerSingleMeeting.ts` | 336 | gpt-5 | 1 (default) | Semantic answers for complex Slack questions |
| `server/mcp/singleMeetingOrchestrator.ts` | 967 | gpt-5 | 1 (default) | Single-meeting intent classification |
| `server/mcp/llm.ts` | 82 | gpt-4o-mini | 0 | Route Slack questions to MCP capabilities |
| `server/mcp/meetingResolver.ts` | 63 | gpt-4o-mini | 0 | Semantic meeting reference classifier (LLM fallback) |
| `server/rag/composer.ts` | 200 | gpt-4o-mini | 0 | Extract answers from context |
| `server/rag/composer.ts` | 300 | gpt-4o-mini | 0 | Extract commitments |
| `server/rag/composer.ts` | 366 | gpt-4o-mini | 0 | Extract quotes |
| `server/rag/composer.ts` | 518 | gpt-4o | 0 | Extract action items (higher quality) |
| `server/extraction/extractCustomerQuestions.ts` | 214 | gpt-4o | 0 | Extract verbatim customer questions |
| `server/extraction/extractCustomerQuestionsFromText.ts` | 65 | gpt-4o | 0 | Extract questions from raw text |
| `server/ingestion/resolveCustomerQuestionAnswers.ts` | 123 | gpt-4o | 0 | Verify Q&A answers from transcript |
| `server/openAssistant/intentClassifier.ts` | 90 | gpt-5 | 1 (default) | Classify user intent (Open Assistant) |
| `server/openAssistant/externalResearch.ts` | 103 | gpt-5 | 1 (default) | General knowledge fallback |
| `server/openAssistant/externalResearch.ts` | 192 | gpt-5 | 1 (default) | Synthesize web search results |
| `server/openAssistant/openAssistantHandler.ts` | 184 | gpt-5 | 1 (default) | General assistance responses |
| `server/openAssistant/openAssistantHandler.ts` | 274 | gpt-5 | 1 (default) | Hybrid response synthesis |
| `server/openAssistant/semanticArtifactSearch.ts` | 145 | gpt-4o-mini | 0 | Semantic artifact embedding |
| `server/openAssistant/semanticArtifactSearch.ts` | 205 | gpt-4o-mini | 0 | Artifact relevance check |

**By Model:**

| Model | Count | Use Cases |
|-------|-------|-----------|
| gpt-5 | 8 | User-facing features (transcripts, semantic answers, intent, Open Assistant) |
| gpt-4o | 4 | High-quality extraction (questions, actions, verification) |
| gpt-4o-mini | 7 | Routing, meeting detection, lightweight extraction, semantic matching |

**Model Constraints:**
- gpt-5 does NOT support temperature=0 (only default value of 1)
- gpt-4o-mini and gpt-4o support temperature=0 for deterministic output

**Before changing any LLM settings, confirm with the user which features should be affected.**

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React and Vite, using Wouter for client-side routing. It emphasizes asynchronous AI transcript processing, allowing background analysis and user progress tracking. End-to-end type safety is achieved with Zod and shared schema definitions. It supports a multi-product environment with complete data separation via a `product` column in the database.

### Frontend
The frontend uses React, TypeScript, Shadcn/ui (New York style), Radix UI, and Tailwind CSS for a dark-mode-first UI. State management utilizes TanStack Query for server state and React hooks for local state, with custom CSS variables and the Inter font defining the design system.

### Backend
The backend is built with Express.js and TypeScript, exposing a RESTful JSON API. Data is managed using PostgreSQL and Drizzle ORM, with Zod for schema validation. OpenAI API (GPT-5) is integrated for AI tasks, employing structured prompt engineering and batching for large transcripts. Authentication is handled via Replit Auth (OpenID Connect), restricted to specific email domains. The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, `meeting_action_items`, and `users`.

### Key Features
The application includes a transcript detail view, meeting date support, and dashboard analytics. Contact management features smart duplicate prevention, while transcript management offers full list views, search, edit, and delete. It supports company stage management, service tagging, and automatic POS system detection from transcripts. Meeting notes and supporting materials can be uploaded. A critical invariant is the preservation of speaker identity in transcripts. The system differentiates between `qa_pairs` (interpreted Q&A) and `customer_questions` (verbatim extraction). The Slack Single-Meeting Orchestrator handles user questions scoped to a single meeting with strict rules for capabilities and uncertainty communication, ensuring no inference or hallucination.

The Slack Single-Meeting Orchestrator deterministically resolves the target meeting (thread context, explicit reference, temporal language) before intent classification. It has a Capability Trust Matrix, allowing Tier 1 (attendees, customer_questions, meeting_action_items, raw transcript) for single-meeting answers, Tier 2 (summaries) with explicit opt-in, and blocking Tier 3 capabilities. Tier-1 artifacts are extracted once during transcript ingestion, making Slack Q&A read-only. An automated test mode with the `X-Pitcrew-Test-Run: true` header allows testing without real Slack interactions, bypassing API calls and logging structured metadata.

### Meeting Detection Metrics
The temporal meeting reference detection uses a regex-first strategy with LLM fallback:
- **Regex fast path**: 10+ temporal patterns (e.g., "last meeting", "yesterday's call") checked first
- **LLM fallback**: gpt-4o-mini classifier invoked only when regex fails
- **Metrics captured**: `meeting_detection` field in `interaction_logs.resolved_entities` tracks `regex_result`, `llm_called`, `llm_result`, and `llm_latency_ms`
- **Monitoring**: `scripts/meeting-detection-metrics.sql` computes fallback % and latency distribution
- **Scope**: Metrics cover only questions using temporal detection; preflight paths (ambiguity clarification, existence checks) are excluded

### Transcript Search Relevance
The `searchTranscriptSnippets` function returns chunks with a `matchType` field for caller filtering:
- **Priority 1 ("both")**: Chunks matching BOTH proper nouns AND keywords - most relevant for topic+entity queries
- **Priority 2 ("keyword")**: Chunks matching keywords only - topic-relevant even without entity
- **Priority 3 ("proper_noun")**: Chunks matching proper nouns only - valid for existence queries like "Did they mention X?"

The caller (`handleExtractiveIntent`) filters on matchType:
- Returns results for "both" or "keyword" matches (topic-relevant)
- Falls through to "not found" for "proper_noun"-only matches (prevents false confident answers)

Binary questions use `handleBinaryQuestion` which searches both Tier-1 data AND transcript, returning proper yes/no answers with evidence.

## External Dependencies

### AI Services
- OpenAI API (GPT-5)

### Database
- PostgreSQL
- Drizzle ORM
- Neon

### UI Component Libraries
- Radix UI
- Shadcn/ui
- Tailwind CSS
- Lucide React

### Build & Development Tools
- Vite
- esbuild
- tsx

### State & Data Fetching
- TanStack Query
- React Hook Form
- Zod

### Supporting Libraries
- wouter
- date-fns
- clsx & tailwind-merge
- cmdk
- embla-carousel-react
- Recharts
- mammoth
- pdf-parse
- multer

### Integrations
- Replit Auth
- Jira Integration
- Airtable (PitCrew Product Database)

## Open Assistant Expansion

### Overview
The Open Assistant expands the Slack bot capabilities beyond single-meeting queries to support broader, ChatGPT-like usage while preserving trust in meeting-derived artifacts.

### Design Principle (CRITICAL)
The assistant is **fully open-ended** in what it helps with. We do NOT enumerate or route by task types (e.g., write email, prepare call, draft slides).

The ONLY constraints are:
- **Which evidence sources** may be used for a response
- **What claims** may be made based on those sources

### Evidence Source Classification
Uses GPT-5 to classify which evidence sources are appropriate:
- **meeting_data**: Claims must be backed by meeting artifacts (Tier-1 data or transcript)
- **external_research**: Claims must be backed by fetched sources with explicit citations
- **general_assistance**: General knowledge (with appropriate disclaimers when needed)
- **hybrid**: Combines meeting data + external sources (each claim traced to its source)

### Routing Rules
1. When meeting is resolved → Single-Meeting Orchestrator (preserves all guardrails)
2. When no meeting resolved → Evidence-source-driven routing via Open Assistant
3. Default to general_assistance when source requirements are unclear (low friction)
4. Only ask for clarification when user clearly references specific interaction but context is missing

### Key Files
- `server/openAssistant/intentClassifier.ts` - Intent classification using GPT-5
- `server/openAssistant/externalResearch.ts` - External research (web search integration pending)
- `server/openAssistant/semanticArtifactSearch.ts` - Semantic matching over deterministic artifacts
- `server/openAssistant/openAssistantHandler.ts` - Main orchestrator

### External Research Status
- Web search integration is **pending** (no external provider configured yet)
- Currently provides general knowledge with clear disclaimer
- When integrated, will provide explicit citations (source, URL, date, snippet)
- Never fabricates citations - honest about capabilities

### Critical Constraints
- Deterministic artifacts (customer_questions, meeting_action_items, meeting_summaries) are NEVER re-derived
- When web search is available, external research provides explicit citations (source, URL, date, snippet)
- When web search is unavailable, responses include clear disclaimer about limitations
- Single-meeting guardrails remain intact for meeting_data intent

## Airtable Integration

### Overview
The PitCrew Product Database in Airtable is the source of truth for product knowledge. This integration syncs Airtable data to PostgreSQL for fast, reliable queries. New tables added in Airtable can be synced automatically.

### Database Tables (synced from Airtable)
- **airtable_features**: WHAT PitCrew does (Name, Description, Tier availability, Product Status)
- **airtable_value_propositions**: WHY PitCrew matters (Name, Description, Value Score)
- **airtable_value_themes**: Groups of value propositions
- **airtable_feature_themes**: Groups of features by similarity/function
- **airtable_customer_segments**: Target customer segments
- **airtable_sync_log**: Tracks sync history and status

### Architecture
- **Database-backed storage**: Data is synced from Airtable to PostgreSQL tables
- **Daily refresh**: Hit `/api/airtable/refresh` to pull latest data from Airtable
- **Dynamic schema discovery**: Uses Airtable Metadata API to auto-detect tables and fields
- **No code changes needed**: When you add new tables in Airtable, they're available via dynamic endpoints

### REST Endpoints
**Legacy (typed, for specific tables):**
- `GET /api/airtable/features` - Product features with typed fields
- `GET /api/airtable/value-propositions` - Value propositions with typed fields
- `GET /api/airtable/search?q=...` - Search features and value props

**Dynamic (works with any table):**
- `GET /api/airtable/tables` - List all tables (auto-discovered)
- `GET /api/airtable/schema` - Full schema with all tables and fields
- `GET /api/airtable/tables/:tableName/records` - Get records from any table by name
- `GET /api/airtable/search-all?q=...` - Search across all tables

**Cache Management:**
- `GET /api/airtable/refresh` - Force full cache refresh (hit daily via cron/automation)
- `POST /api/airtable/webhook` - Cache invalidation (supports `action: "schema_change"` for new tables)

### Key Files
- `server/airtable/schema.ts` - Dynamic schema discovery via Metadata API
- `server/airtable/dynamicData.ts` - Generic data access for any table
- `server/airtable/client.ts` - Low-level Airtable API client
- `server/airtable/productData.ts` - Typed data access for known tables
- `server/airtable/webhook.ts` - Webhook handler for cache invalidation

### Webhook Setup
To enable push-based updates from Airtable:
1. Create an Airtable Automation or use Make.com/Zapier
2. Point POST requests to: `https://<your-domain>/api/airtable/webhook`
3. For new table notifications, include `{"action": "schema_change"}` in the payload
4. Optional: Set `AIRTABLE_WEBHOOK_SECRET` and include `x-airtable-secret` header

### Environment Variables
- `AIRTABLE_API_KEY` (required): Airtable personal access token
- `AIRTABLE_BASE_ID` (required): ID of the PitCrew Product Database base
- `AIRTABLE_WEBHOOK_SECRET` (optional): Secret for webhook authentication
# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application that leverages AI to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts. Its primary purpose is to provide actionable intelligence to sales and product teams, thereby improving product development and refining sales strategies. Key capabilities include dark-mode-first UI, real-time categorization, and advanced AI models for semantic understanding and extraction. The project aims to enhance decision-making and market responsiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

### OpenAI Integration Changes (CRITICAL)
**Always ask where the impact should be reflected before making OpenAI-related changes.**

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React, Vite, and Wouter, emphasizing asynchronous AI transcript processing. It features end-to-end type safety using Zod and shared schemas, and supports a multi-product environment with data separation via a `product` column.

### Frontend
The frontend is built with React, TypeScript, Shadcn/ui (New York style), Radix UI, and Tailwind CSS, providing a dark-mode-first user interface. State management is handled by TanStack Query for server state and React hooks for local state, with a design system defined by custom CSS variables and the Inter font.

### Backend
The backend utilizes Express.js and TypeScript, exposing a RESTful JSON API. Data persistence is managed with PostgreSQL and Drizzle ORM, with Zod for schema validation. OpenAI API (GPT-5, GPT-4o, GPT-4o-mini) is integrated for AI tasks, employing structured prompt engineering and batching. Authentication is handled via Replit Auth (OpenID Connect), restricted to specific email domains. The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, `meeting_action_items`, and `users`.

### Key Features
The application includes a transcript detail view, meeting date support, and dashboard analytics. It offers smart duplicate prevention for contacts, comprehensive transcript management (list, search, edit, delete), company stage management, service tagging, and automatic POS system detection. The system preserves speaker identity in transcripts and differentiates between interpreted `qa_pairs` and verbatim `customer_questions`.

### Control Plane Architecture (Intent-Based Routing)
The system uses an Intent → Context Layers → Answer Contract flow instead of tier-based logic:

**Intent Classification** (keyword fast-paths + LLM fallback via gpt-4o-mini):
- SINGLE_MEETING: Questions about a specific meeting (entity detection for Les Schwab, Tyler, etc.)
- MULTI_MEETING: Cross-meeting analysis
- PRODUCT_KNOWLEDGE: PitCrew product features, pricing, capabilities
- DOCUMENT_SEARCH: Looking for specific documents
- GENERAL_HELP: General assistance, email drafting, etc.
- REFUSE: Out-of-scope queries (weather, stocks, personal info)
- CLARIFY: Multi-intent requests that need splitting

**Classification Priority** (actions over entities):
1. REFUSE patterns (weather, stocks, jokes)
2. Multi-intent detection (triggers CLARIFY)
3. MULTI_MEETING patterns
4. SINGLE_MEETING patterns (temporal references, "what did X say")
5. PRODUCT_KNOWLEDGE keywords (pricing, features, integrations)
6. GENERAL_HELP keywords (drafting, writing actions) - BEFORE entity detection
7. DOCUMENT_SEARCH keywords
8. Entity detection (known companies/contacts → SINGLE_MEETING)
9. LLM fallback for ambiguous queries

**Context Layers** (intent-gated):
- product_identity: Always on (PitCrew company/product context)
- product_ssot: Product knowledge from Airtable (Pro/Advanced/Enterprise tiers)
- single_meeting: Current meeting artifacts (action items, customer questions, attendees)
- multi_meeting: Cross-meeting search capabilities
- document_context: Document search and retrieval

**Answer Contracts** (selected after layers determined):
- SINGLE_MEETING: MEETING_SUMMARY, NEXT_STEPS, ATTENDEES, CUSTOMER_QUESTIONS, EXTRACTIVE_FACT, AGGREGATIVE_LIST
- MULTI_MEETING: PATTERN_ANALYSIS, COMPARISON, TREND_SUMMARY, CROSS_MEETING_QUESTIONS
- PRODUCT: PRODUCT_EXPLANATION, FEATURE_VERIFICATION, FAQ_ANSWER
- GENERAL: DRAFT_RESPONSE, DRAFT_EMAIL, VALUE_PROPOSITION
- TERMINAL: REFUSE, CLARIFY, NOT_FOUND
- Contracts define response shape and SSOT mode (descriptive/authoritative/none)

**Contract Chaining** (Ordered Execution Plans):
- A contract chain is an ordered execution plan within a SINGLE intent and scope
- Control plane decides the chain (not the LLM)
- Chains selected based on minimum set of tasks required to satisfy the request

Predefined chains:
- SINGLE_MEETING: CUSTOMER_QUESTIONS → DRAFT_RESPONSE ("help me answer the questions")
- MULTI_MEETING: CROSS_MEETING_QUESTIONS → PATTERN_ANALYSIS ("questions and patterns")
- MULTI_MEETING: COMPARISON → TREND_SUMMARY ("compare over time")

Restriction rules:
1. All contracts must share the same intent and scope (otherwise → CLARIFY)
2. Contracts must be orderable: Extraction → Analysis → Drafting
3. Authority must not escalate accidentally (Extractive → Authoritative ❌)
4. Contracts are task-shaped, not topic-shaped

Chain length: 1-2 common, 3 acceptable, 4+ is a smell

**Scope Types** (identical structure, different scope size):
- SingleMeetingScope: { type, meetingId, companyId?, companyName? }
- MultiMeetingScope: { type, meetingIds, filters?: { company?, topic?, timeRange? } }

### Slack Single-Meeting Orchestrator
Handles user questions scoped to a single meeting with read-only artifact access. Internal sub-intent classification:
- extractive: Specific fact questions ("who attended?", "did they mention X?")
- aggregative: General directed questions ("what issues came up?")
- summary: Explicit summary requests only ("summarize the meeting")

### Open Assistant
Expands Slack bot capabilities to broader ChatGPT-like usage, classifying evidence sources (meeting_data, external_research, general_assistance, hybrid) with GPT-5 to ensure claims are backed by appropriate sources and citations.

Meeting detection uses a regex-first strategy with LLM fallback (gpt-4o-mini) for temporal references. Transcript search relevance prioritizes chunks matching both proper nouns and keywords. Customer question extraction uses gpt-4o with temperature=0 for verbatim extraction and deterministic speaker resolution.

**Meeting Search (when no meeting resolved)**:
When a meeting_data query mentions a person/company but no specific meeting is resolved:
1. Extract search terms: proper nouns (Tyler Wiggins), all-caps acronyms (ACE, HVAC, POS), multi-word names (Les Schwab)
2. Search companies and contacts tables for matches
3. Fallback: ILIKE search on significant words when entity extraction fails
4. Common acronyms filtered: ROI, TV, API, IT (not company names)
5. Single match → delegate to SingleMeetingOrchestrator; multiple matches → aggregate results

## External Dependencies

### AI Services
- OpenAI API (GPT-5, GPT-4o, GPT-4o-mini)

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
- Airtable (PitCrew Product Database for product knowledge sync)

### Airtable Webhook
**Endpoint**: `POST https://mustard.leverege.com/api/airtable/webhook`

**Authentication**: Header `X-Airtable-Secret` with secret value (stored in `AIRTABLE_WEBHOOK_SECRET`)

**Behavior**: 
- Waits for sync to complete before responding (ensures Autoscale doesn't kill the process)
- Auto-discovers new tables and creates database tables
- Auto-adds new columns when Airtable schema changes

**Trigger**: Zapier automation on Airtable record changes
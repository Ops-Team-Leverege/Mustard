# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application that utilizes AI to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts. Its main goal is to provide actionable intelligence to sales and product teams, improving product development and refining sales strategies. Key capabilities include a dark-mode-first UI, real-time categorization, and advanced AI models for semantic understanding and extraction, ultimately enhancing decision-making and market responsiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

### OpenAI Integration Changes (CRITICAL)
**Always ask where the impact should be reflected before making OpenAI-related changes.**

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React, Vite, and Wouter, designed for asynchronous AI transcript processing. It features end-to-end type safety using Zod and shared schemas, supporting a multi-product environment with data separation via a `product` column.

### Frontend
The frontend uses React, TypeScript, Shadcn/ui (New York style), Radix UI, and Tailwind CSS, featuring a dark-mode-first interface. State management is handled by TanStack Query for server state and React hooks for local state, with a design system defined by custom CSS variables and the Inter font.

### Backend
The backend is built with Express.js and TypeScript, exposing a RESTful JSON API. Data is persisted using PostgreSQL and Drizzle ORM, with Zod for schema validation. OpenAI API (GPT-5, GPT-4o, GPT-4o-mini) is integrated for AI tasks, employing structured prompt engineering and batching. Authentication uses Replit Auth (OpenID Connect), restricted to specific email domains. The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, `meeting_action_items`, and `users`.

### Key Features
The application includes a transcript detail view, meeting date support, and dashboard analytics. It offers smart duplicate prevention for contacts, comprehensive transcript management (list, search, edit, delete), company stage management, service tagging, and automatic POS system detection. The system preserves speaker identity in transcripts and differentiates between interpreted `qa_pairs` and verbatim `customer_questions`. It also includes a Document Output Feature for generating .docx files for long-form content and specific contract types, with configurable trigger conditions and customizable Slack messages.

### Control Plane Architecture (LLM-First Intent Routing)

**CRITICAL: The system uses LLM-FIRST classification, NOT keyword matching.**

The Control Plane classifies intent using an LLM (gpt-4o-mini) that understands semantic meaning. This ensures requests like "research Costco and create a slide deck" correctly route to EXTERNAL_RESEARCH, not based on keyword matching but on understanding the full request.

**Architecture Principles:**
- **LLM classifies ALL intents** - The LLM prompt includes examples for each intent type
- **NO keyword-based intent detection** - Keywords are ONLY used for contract selection AFTER intent is classified
- **Semantic understanding** - "search all calls about Ivy Lane" → MULTI_MEETING (not single-meeting)

**Early Fast Paths (Pre-Control Plane):**
- Briefing/prep ambiguity detection (handled before intent classification)
- Binary existence questions (short-circuit for quick responses)

**Routing Flow:**
1. **Control Plane LLM classifies intent** - Uses gpt-4o-mini with full message context
2. **CLARIFY intent** → Ask user for clarification
3. **SINGLE_MEETING + resolved meeting** → SingleMeetingOrchestrator for artifact access
4. **SINGLE_MEETING without meeting** → Ask which meeting
5. **EXTERNAL_RESEARCH** → Gemini web research + product knowledge chaining
6. **MULTI_MEETING, PRODUCT_KNOWLEDGE, etc.** → Open Assistant with appropriate handlers

**Intent Types:** SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE, EXTERNAL_RESEARCH, DOCUMENT_SEARCH, GENERAL_HELP, REFUSE, CLARIFY

**Contract Chains:**
Contracts are task-level operations that can be chained. Both EXTERNAL_RESEARCH and PRODUCT_KNOWLEDGE are available as:
- **Standalone intents** - When that's the primary task
- **Chainable contracts** - When other intents need to incorporate that data

Example chains:
- `EXTERNAL_RESEARCH` intent → `[EXTERNAL_RESEARCH, PRODUCT_KNOWLEDGE, SALES_DECK_PREP]`
- `SINGLE_MEETING` intent → `[CUSTOMER_QUESTIONS, PRODUCT_KNOWLEDGE, DRAFT_RESPONSE]`

The control plane dynamically builds contract chains based on user messages, ensuring ordered execution (Extraction → Analysis → Drafting) and enforcing restriction rules. Safety constraints are enforced at multiple levels with evidence-based enforcement.

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
**Authentication**: Header `X-Airtable-Secret`
**Behavior**: Waits for sync, auto-discovers new tables, and auto-adds new columns.
**Trigger**: Zapier automation on Airtable record changes.

## Recent Changes (January 2026)

### Performance Improvements
- **Streaming Responses**: Integrated OpenAI streaming for PRODUCT_KNOWLEDGE and GENERAL_RESPONSE paths. Slack messages now update progressively as the LLM generates content, reducing perceived latency.
- **Model Optimization**: Switched GPT-5 → gpt-4o for product knowledge and general assistance paths (2-3x faster).
- **Parallel Execution**: Multi-meeting search now uses `Promise.all` for concurrent processing.

### Bug Fixes
- **SQL DISTINCT Fix**: Fixed PostgreSQL error 42P10 in `meetingResolver.ts` - queries using `SELECT DISTINCT` with `ORDER BY COALESCE(t.meeting_date, t.created_at)` now include the COALESCE expression as `sort_date` in the SELECT clause.
- **Intent Classification Fix**: FAQ/website copy update requests now correctly route to `PRODUCT_KNOWLEDGE` instead of `MULTI_MEETING`. Added keywords: "frequently asked questions", "faq", "update copy", "value props" to product knowledge patterns. Removed overly generic "frequently" keyword from multi-meeting patterns.

### Security Hardening
- **Website Verification**: Domain allowlist for SSRF protection (leverege.com), HTTPS-only, 20+ word minimum content validation for website analysis.
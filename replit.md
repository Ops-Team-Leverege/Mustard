# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application that leverages AI to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts. Its primary goal is to provide actionable intelligence to sales and product teams, thereby enhancing product development and refining sales strategies. Key capabilities include a dark-mode-first UI, real-time categorization, and advanced AI models for semantic understanding and extraction, ultimately improving decision-making and market responsiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

### OpenAI Integration Changes (CRITICAL)
**Always ask where the impact should be reflected before making OpenAI-related changes.**

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React, Vite, and Wouter, designed for asynchronous AI transcript processing. It features end-to-end type safety using Zod and shared schemas, supporting a multi-product environment with data separation via a `product` column. The UI features a dark-mode-first interface using Shadcn/ui (New York style), Radix UI, and Tailwind CSS.

### Technical Implementations
The frontend uses React, TypeScript, and Tailwind CSS, with state management handled by TanStack Query for server state and React hooks for local state. The backend is built with Express.js and TypeScript, exposing a RESTful JSON API. Data is persisted using PostgreSQL and Drizzle ORM, with Zod for schema validation. Authentication uses Replit Auth (OpenID Connect), restricted to specific email domains. The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, `meeting_action_items`, and `users`.

### Feature Specifications
The application includes a transcript detail view, meeting date support, and dashboard analytics. It offers smart duplicate prevention for contacts, comprehensive transcript management (list, search, edit, delete), company stage management, service tagging, and automatic POS system detection. The system preserves speaker identity in transcripts and differentiates between interpreted `qa_pairs` and verbatim `customer_questions`. It also includes a Document Output Feature for generating .docx files and a markdown formatting system that supports multiple output targets (Slack, standard, plaintext).

### Control Plane Architecture (LLM-First Intent Routing)
The system uses LLM-FIRST classification for intent routing, meaning an LLM (gpt-4o-mini) classifies all intents based on semantic understanding rather than keyword matching. This involves a routing flow where the Control Plane LLM classifies intent, leading to actions such as clarification, single or multi-meeting orchestration, external research, product knowledge retrieval, document search, or general assistance. Intent types include `SINGLE_MEETING`, `MULTI_MEETING`, `PRODUCT_KNOWLEDGE`, `EXTERNAL_RESEARCH`, `DOCUMENT_SEARCH`, `GENERAL_HELP`, `REFUSE`, and `CLARIFY`. Contract chains are dynamically built based on user messages, ensuring ordered execution and enforcing safety constraints.

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

## Recent Architectural Improvements

### Markdown Formatting System
- **Flexible Formatter**: `server/utils/markdownFormatter.ts` with extensible format system supporting multiple output targets.
- **Runtime Extension**: Use `registerFormat(name, rules)` to add new formats or `extendFormat(name, rules)` to extend existing ones.
- **Pre-configured Formats**: 'slack' (converts `**bold**` → `*bold*`), 'standard' (no changes), 'plaintext' (strips formatting).

### Follow-Up Detection Service
- **Extracted to Service**: `server/services/followUpDetector.ts` - standalone, testable service for detecting follow-up/refinement messages.
- **Configurable Patterns**: Pattern rules and intent inference rules can be extended at runtime via `registerFollowUpPatterns()` and `registerIntentInferenceRules()`.
- **Separation of Concerns**: Intent classifier delegates to the service, reducing complexity in `intent.ts`.

### Database-Backed Deduplication
- **Scalable Architecture**: `server/services/eventDeduplicator.ts` using PostgreSQL for cross-instance deduplication.
- **Atomic INSERT**: Uses `INSERT ... ON CONFLICT DO NOTHING RETURNING id` for race-condition-safe duplicate detection.
- **Empty ID Guard**: Filters out empty/undefined event IDs to prevent false positives.
- **Schema Addition**: `slack_event_dedupe` table with index on `processed_at` for efficient cleanup.
- **Automatic Cleanup**: Runs on startup and every 100 requests via `maybeCleanup()`.
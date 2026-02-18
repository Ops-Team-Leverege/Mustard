# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application that leverages AI to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts. Its primary goal is to provide actionable intelligence to sales and product teams, thereby enhancing product development and refining sales strategies. Key capabilities include a dark-mode-first UI, real-time categorization, and advanced AI models for semantic understanding and extraction. The project aims to empower teams with actionable intelligence to drive product innovation and improve sales effectiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

Always ask where the impact should be reflected before making OpenAI-related changes.

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React, Vite, and Wouter, optimized for asynchronous AI transcript processing. It features a dark-mode-first UI using Shadcn/ui (New York style), Radix UI, and Tailwind CSS. End-to-end type safety is enforced using Zod and shared schemas, supporting a multi-product environment.

### Technical Implementations
The frontend uses React, TypeScript, and Tailwind CSS, with state managed by TanStack Query. The backend is an Express.js and TypeScript application providing a RESTful JSON API. Data is stored in PostgreSQL via Drizzle ORM, with Zod for schema validation. Authentication is handled by Replit Auth (OpenID Connect). The database schema includes `transcripts`, `categories`, `product_insights`, `qa_pairs`, `meeting_action_items`, and `users`.

### Feature Specifications
The application supports a transcript detail view, meeting date management, dashboard analytics, smart duplicate prevention for contacts, and comprehensive transcript management. It includes company stage management, service tagging, automatic POS system detection, preserves speaker identity in transcripts, and utilizes `qa_pairs` for all Q&A data. A Document Output Feature generates .docx files, and a markdown formatting system supports multiple output targets.

### Decision Layer Architecture (LLM-First Intent Routing)
The system employs an **LLM-FIRST classification** approach for intent routing, primarily using `gpt-4o-mini` for semantic understanding. The Decision Layer is the **sole authority** for contract selection, guiding the Intent Router to classify user intent. The Orchestrator computes context layers and selects an answer contract, which the Execution Layer then processes deterministically via `server/openAssistant/singleMeeting/` module. Contracts define data sources, with processing types determined by question analysis. Multi-step requests are handled by LLM-proposed contract chains executed sequentially.

### Key Architectural Improvements
The system features coordinated progress message handling, a flexible markdown formatting system, and database-backed deduplication. All LLM prompts are centralized and typed. Thread context preservation and aggregate specificity checks prevent redundant clarifications. Contract-aware semantic processing ensures consistent output. LLM-determined flags (`requiresSemantic`, `requiresProductKnowledge`, `requiresStyleMatching`) have replaced brittle regex-based detection for various processing needs. A unified General Help fallback chain utilizes multiple LLMs. Customer-specific deployment routing prioritizes `SINGLE_MEETING` for relevant queries, and an aggregate fallback mechanism (`qa_pairs_first`) addresses broad queries. Offers have expiration times to prevent stale interactions. Legacy Slack handlers that bypassed the Decision Layer have been removed to enforce LLM-first classification and consolidate intent routing. Prompt version tracking is now applied to all LLM call sites for full auditability. Every bot response automatically seeds thumbs-up and thumbs-down reactions for feedback. A unified `server/llm/client.ts` provides a provider-agnostic LLM client for auto-routing to OpenAI, Gemini, or Claude based on model names, decoupling model configuration from client code. The monolithic `singleMeetingOrchestrator.ts` has been decomposed into modular `helpers.ts`, `handlers.ts`, and `index.ts` files within `server/openAssistant/singleMeeting/` to improve maintainability and enforce contract-only routing.

### Prompt Update Procedure
Prompt modifications involve editing prompt text, bumping the version in `server/config/prompts/versions.ts`, adding an entry to `PROMPT_CHANGE_LOG`, and inserting the new version into the database via `npx tsx server/migrations/backfillPromptVersions.ts`. Verification ensures the prompt is tracked in `interaction_logs.prompt_versions`.

### Database Schema for Prompt Version Control & Feedback
The system relies on three database objects for prompt version control and feedback: `prompt_versions` table, `interaction_feedback` table, and a `prompt_versions` JSONB column on `interaction_logs`. An index `interaction_logs_message_ts_idx` supports fast reaction lookup. These are synced via `npm run db:push` or created directly via SQL.

## External Dependencies

### AI Services
-   OpenAI API (GPT-5, GPT-4o, GPT-4o-mini)
-   Anthropic Claude Opus 4.6
-   Google Gemini 3 Pro
-   Google Gemini 2.5 Flash

### Database
-   PostgreSQL
-   Drizzle ORM
-   Neon

### UI Component Libraries
-   Radix UI
-   Shadcn/ui
-   Tailwind CSS
-   Lucide React

### Build & Development Tools
-   Vite

### State & Data Fetching
-   TanStack Query
-   React Hook Form
-   Zod

### Supporting Libraries
-   wouter
-   date-fns
-   clsx & tailwind-merge
-   cmdk
-   embla-carousel-react
-   Recharts
-   mammoth
-   pdf-parse
-   multer

### Integrations
-   Replit Auth
-   Jira Integration
-   Airtable (PitCrew Product Database)
-   Zapier (for Airtable and Zendesk webhooks)

### Webhooks
-   **Airtable Webhook**: `POST https://mustard.leverege.com/api/airtable/webhook`
-   **Zendesk Webhook**: `POST https://mustard.leverege.com/api/zendesk/webhook`
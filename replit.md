# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application designed to empower sales and product teams. It uses AI to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts. The core purpose is to provide actionable intelligence, thereby enhancing product development and refining sales strategies. Key capabilities include a dark-mode-first UI, real-time categorization, and advanced AI models for semantic understanding and extraction.

## User Preferences
Preferred communication style: Simple, everyday language.

Always ask where the impact should be reflected before making OpenAI-related changes.

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React, Vite, and Wouter, optimized for asynchronous AI transcript processing. It enforces end-to-end type safety using Zod and shared schemas, supporting a multi-product environment. The UI adopts a dark-mode-first approach, leveraging Shadcn/ui (New York style), Radix UI, and Tailwind CSS.

### Technical Implementations
The frontend utilizes React, TypeScript, and Tailwind CSS, with state managed by TanStack Query and React hooks. The backend is an Express.js and TypeScript application, exposing a RESTful JSON API. Data is persisted in PostgreSQL using Drizzle ORM, with Zod for schema validation. Authentication is handled via Replit Auth (OpenID Connect). The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `meeting_action_items`, and `users`.

### Feature Specifications
The application offers a transcript detail view, meeting date support, dashboard analytics, smart duplicate prevention for contacts, and comprehensive transcript management. It includes company stage management, service tagging, automatic POS system detection, preserves speaker identity in transcripts, and uses `qa_pairs` for all Q&A data. A Document Output Feature generates .docx files and a markdown formatting system supports multiple output targets.

### Decision Layer Architecture (LLM-First Intent Routing)
The system employs **true LLM-FIRST classification** for intent routing, primarily using `gpt-4o-mini` for semantic understanding. Minimal fast-paths handle absolute certainties, while the LLM handles semantic classification for all other intents. LLM validation is applied only for weak detection methods. The Decision Layer is the **sole authority** for contract selection.

**Key Components:**
-   **Intent Router**: Classifies user intent using LLM semantic understanding.
-   **Orchestrator**: Manages flow and selects answer contracts.
-   **Execution Layer**: Executes contracts deterministically.

**Routing Flow:**
The Intent Router classifies intent, the Orchestrator computes context layers and selects an answer contract, and the Execution Layer executes the contract chain. Contract chains are dynamically built based on user messages.

**Data Source vs Processing Type:**
Contracts define WHERE to get data (data source), not HOW to process it. Processing types (artifact return vs LLM semantic) are determined by question analysis.

**Contract Selection Strategy (LLM-First):**
The Decision Layer selects contracts based on LLM proposals, with keyword and LLM classification fallbacks. All LLM-proposed contracts flow through `proposedInterpretation.contracts` in `IntentClassificationResult`.

**Contract Chains (Multi-Step Requests):**
The LLM can propose multiple contracts for multi-step requests, executed sequentially.

### Key Architectural Improvements
The system has seen significant advancements including coordinated progress message handling, a flexible markdown formatting system, a follow-up detection service, database-backed deduplication, and product knowledge enrichment. All LLM prompts are centralized and typed. Thread context preservation and aggregate specificity checks prevent redundant clarification. Contract-aware semantic processing ensures consistent output, and `customer_questions` table has been removed in favor of `qa_pairs`. LLM-determined flags (`requiresSemantic`, `requiresProductKnowledge`, `requiresStyleMatching`) have replaced brittle regex-based detection for semantic processing, product knowledge, and style matching. Legacy intents like `DOCUMENT_SEARCH/DOCUMENT_ANSWER` have been removed. All intent handlers consistently pass thread context to LLM calls. A unified General Help fallback chain uses multiple LLMs. A multi-source search pattern offers Slack search after meeting-based responses. Customer-specific deployment routing prioritizes `SINGLE_MEETING` for relevant queries. An aggregate fallback mechanism (`qa_pairs_first`) addresses broad queries by searching `qa_pairs` first, with adaptive offers for meeting searches and explicit meeting detection. Offers have expiration times to prevent stale interactions.

**Legacy Handler Removal (2026-02-17):** Four legacy Slack handlers that bypassed the Decision Layer with hardcoded regex patterns have been removed: `ambiguityHandler` (prep questions), `binaryQuestionHandler` (existence checks), `clarificationHandler` (follow-up responses), and `answerQuestionsHandler` (Q&A drafting). These ran before the Decision Layer at steps 7.5-8.7 in `events.ts`, short-circuiting the pipeline with `legacyIntent` strings. The Decision Layer's LLM-first classification with full thread context now handles all these cases: ambiguity → CLARIFY intent, binary questions → SINGLE_MEETING/EXTRACTIVE_FACT, follow-ups → thread context inference, Q&A drafting → PRODUCT_KNOWLEDGE chain. This enforces the architectural principle that the Decision Layer is the sole authority for intent routing, ensures prompt version tracking on every interaction, and simplifies the event pipeline. The `server/slack/handlers/` directory has been removed.

**Full-Pipeline Prompt Version Tracking (2026-02-17):** Prompt version tracking expanded from Decision Layer only (~20% coverage) to all LLM call sites (~100%). Each downstream function now returns `promptVersions` in its result, merged at the logging point in `events.ts` via `mergePromptVersionRecords()`. Tracked prompts: Decision Layer (INTENT_CLASSIFICATION_PROMPT, CONTRACT_SELECTION_PROMPT), RAG Composer (RAG_MEETING_SUMMARY_SYSTEM_PROMPT, RAG_QUOTE_SELECTION_SYSTEM_PROMPT, RAG_EXTRACTIVE_ANSWER_SYSTEM_PROMPT, RAG_ACTION_ITEMS_SYSTEM_PROMPT), Semantic Answer (SEMANTIC_ANSWER_PROMPT), MCP Routing (MCP_ROUTING_PROMPT). Architecture uses "return-and-merge" pattern — no tracker threading through function signatures.

**Feedback Reaction Acknowledgment (2026-02-17):** When users react to bot messages with feedback emojis, the bot now adds a checkmark reaction to acknowledge receipt. Added `addSlackReaction()` to `server/slack/slackApi.ts`. Failures are logged silently (no user-facing warnings). Requires `reactions:write` bot token scope.

### Prompt Update Procedure
When modifying any LLM prompt in the system, follow these steps in order:

1. **Edit the prompt text** in the appropriate file under `server/config/prompts/` (e.g., `decisionLayer.ts`, `transcript.ts`, `singleMeeting.ts`, `external.ts`, `extraction.ts`).
2. **Bump the version** in `server/config/prompts/versions.ts`:
   - Update the version string in `PROMPT_VERSIONS` for the changed prompt (use `getNextVersion()` helper or manually increment: `YYYY-MM-DD-NNN`).
   - Add a new entry to `PROMPT_CHANGE_LOG` with the version, reason for change, and date.
3. **Insert the new version into the database** by running: `npx tsx server/migrations/backfillPromptVersions.ts` (this records the full prompt text in `prompt_versions` table for auditability).
4. **Verify** that the prompt is being tracked during interactions — the `PromptVersionTracker` (`server/utils/promptVersionTracker.ts`) accumulates versions used per interaction and stores them in `interaction_logs.prompt_versions`.

**Key files:**
- Prompt text: `server/config/prompts/*.ts`
- Version registry: `server/config/prompts/versions.ts`
- Version tracker: `server/utils/promptVersionTracker.ts`
- Backfill migration: `server/migrations/backfillPromptVersions.ts`
- Feature flag (safety gate): `server/utils/featureFlags.ts`
- Feedback handler (reactions): `server/slack/feedbackHandler.ts`
- Feedback config (emoji lists): `config/feedback.json`

**Important:** If adding a brand new prompt (not just editing an existing one), also add its name to the `PromptVersions` type in `versions.ts` and add its text mapping in `backfillPromptVersions.ts`.

### Database Schema for Prompt Version Control & Feedback
The prompt version control and feedback system requires three database objects. These are already created in production, but if the database is ever reset or rebuilt, apply them:

1. **`prompt_versions` table** — stores full prompt text for each version for auditability.
2. **`interaction_feedback` table** — stores Slack reaction feedback (positive/negative) linked to interactions.
3. **`prompt_versions` column on `interaction_logs`** — JSONB column tracking which prompt versions were used per interaction.
4. **Index `interaction_logs_message_ts_idx`** — enables fast reaction-to-interaction lookup.

**How to apply:** Run `npm run db:push` to sync the Drizzle schema (`shared/schema.ts`) to the database. If the interactive prompt gets stuck, create the objects directly via SQL:
```sql
-- prompt_versions table
CREATE TABLE IF NOT EXISTS prompt_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  prompt_name VARCHAR NOT NULL,
  version VARCHAR NOT NULL,
  prompt_text TEXT NOT NULL,
  change_reason TEXT,
  changed_by VARCHAR
);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_name_version_idx ON prompt_versions (prompt_name, version);

-- interaction_feedback table
CREATE TABLE IF NOT EXISTS interaction_feedback (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  interaction_id VARCHAR NOT NULL,
  slack_message_ts VARCHAR NOT NULL,
  user_id VARCHAR NOT NULL,
  emoji VARCHAR NOT NULL,
  sentiment VARCHAR NOT NULL,
  intent VARCHAR,
  answer_contract VARCHAR,
  prompt_versions JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS interaction_feedback_unique_reaction ON interaction_feedback (interaction_id, user_id, emoji);

-- prompt_versions column on interaction_logs
ALTER TABLE interaction_logs ADD COLUMN IF NOT EXISTS prompt_versions JSONB;
CREATE INDEX IF NOT EXISTS interaction_logs_message_ts_idx ON interaction_logs (slack_message_ts);
```

After creating the tables, run the backfill migration to seed prompt version records:
```
npx tsx server/migrations/backfillPromptVersions.ts
```

**Verification:** The feature flag in `server/utils/featureFlags.ts` automatically checks if these tables exist at runtime. If they don't, the feedback system gracefully disables itself without crashing.

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
-   Airtable (PitCrew Product Database for product knowledge sync)
-   Zapier (for Airtable and Zendesk webhooks)

### Webhooks
-   **Airtable Webhook**: `POST https://mustard.leverege.com/api/airtable/webhook` (authenticates with `X-Airtable-Secret`, triggered by Zapier, syncs Airtable data).
-   **Zendesk Webhook**: `POST https://mustard.leverege.com/api/zendesk/webhook` (authenticates with `X-Zendesk-Secret`, triggered by Zapier, syncs Zendesk Help Center articles).
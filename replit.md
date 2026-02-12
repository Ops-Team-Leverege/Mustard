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
The frontend utilizes React, TypeScript, and Tailwind CSS, with state managed by TanStack Query and React hooks. The backend is an Express.js and TypeScript application, exposing a RESTful JSON API. Data is persisted in PostgreSQL using Drizzle ORM, with Zod for schema validation. Authentication is handled via Replit Auth (OpenID Connect). The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, `meeting_action_items`, and `users`.

### Feature Specifications
The application offers a transcript detail view, meeting date support, dashboard analytics, smart duplicate prevention for contacts, and comprehensive transcript management. It includes company stage management, service tagging, automatic POS system detection, preserves speaker identity in transcripts, and differentiates between interpreted `qa_pairs` and verbatim `customer_questions`. A Document Output Feature generates .docx files and a markdown formatting system supports multiple output targets.

### Decision Layer Architecture (LLM-First Intent Routing)
The system employs **true LLM-FIRST classification** for intent routing, primarily using `gpt-4o-mini` for semantic understanding. Minimal fast-paths handle absolute certainties (e.g., entity detection via database lookups or high-confidence regex). LLM validation is applied only for weak detection methods like keyword detection.

**Classification Strategy:**
1.  **Minimal fast-paths**: Handles REFUSE, MULTI_INTENT, simple greetings, and product knowledge signals only. Entity detection (company/contact names) is used for observability logging but does NOT fast-path to any intent — all entity-containing queries are classified by the LLM.
2.  **LLM semantic classification**: For all other intents (including entity-containing queries), using a dedicated intent classification prompt.
3.  **LLM validation**: Only for weak heuristic matches.

**Key Components:**
-   **Intent Router**: Classifies user intent using LLM semantic understanding.
-   **Orchestrator**: Manages flow and selects answer contracts.
-   **Execution Layer**: Executes contracts deterministically.

**Routing Flow:**
The Intent Router classifies intent, the Orchestrator computes context layers and selects an answer contract, and the Execution Layer executes the contract chain. LLM-determined scope (e.g., "all customers") is propagated downstream to avoid redundant detection. Contract chains are dynamically built based on user messages.

**Data Source vs Processing Type (Important Distinction):**
Contracts define WHERE to get data (data source), not HOW to process it:
-   **Data Source Type** (contract level): meeting evidence only (`ssotMode: "none"`) vs Product SSOT (`ssotMode: "authoritative"`)
-   **Processing Type** (question analysis): artifact return (simple extraction) vs LLM semantic (judgment/filtering)

Example: `NEXT_STEPS` contract is extractive (meeting evidence only), but questions like "what should we mention" require LLM judgment even with available artifacts. The `isSemanticQuestion()` function detects judgment patterns independently of contract type.

**Contract Selection Strategy (LLM-First):**
The Decision Layer is the **sole authority** for contract selection. The execution layer (OpenAssistant) does not have its own fallback contract selection — it throws an error if no contract is provided.

Within the Decision Layer's `selectAnswerContract()`:
1. **LLM-proposed contracts (primary)**: Utilizes `proposedInterpretation.contracts` (single source of truth) proposed by the LLM during intent classification.
2. **Keyword fallback**: Used when the LLM does not propose contracts.
3. **LLM classification fallback**: Engaged if neither LLM proposal nor keyword matching yields a result.

**Single Source of Truth**: All LLM-proposed contracts flow through `proposedInterpretation.contracts` in `IntentClassificationResult`. This consolidates contract selection and avoids redundant fields.

**Contract Chains (Multi-Step Requests):**
The LLM can propose multiple contracts for multi-step requests, executed sequentially (e.g., `["EXTERNAL_RESEARCH", "SALES_DOCS_PREP"]`).

### Recent Architectural Improvements
-   **Progress Message Coordination**: Two message types exist: **Progress** (separate thread posts like "Retrieving notes...") and **Stream** (placeholder updates with actual content). `events.ts` uses `responseSent` flag + `canPostProgress()` check to prevent async progress from posting after responses. `clearProgressTimer()` is called in ALL paths (early returns, main response, error handler) before response is sent. All progress-posting sites gate on `canPostProgress()` AND do a double-check of `responseSent` right before the Slack API call (to handle LLM generation delays). `progressManager.ts` provides `canPost()` and `markResponseSent()` for centralized coordination.
-   **Markdown Formatting System**: Flexible `markdownFormatter.ts` supporting multiple output targets.
-   **Follow-Up Detection Service**: `followUpDetector.ts` for detecting follow-up/refinement messages.
-   **Database-Backed Deduplication**: `eventDeduplicator.ts` uses PostgreSQL for scalable deduplication.
-   **Product Knowledge Enrichment**: Interim solution in `openAssistantHandler.ts` for product knowledge using Airtable.
-   **Centralized Prompts System**: All LLM prompts are organized in `server/config/prompts/` with typed builders.
-   **Thread Context Preservation**: Company names extracted from messages are preserved when CLARIFY intent is returned, preventing redundant clarification.
-   **Aggregate Specificity Check with Thread Context**: `checkAggregateSpecificity` now uses full thread context to prevent redundant clarification requests.
-   **Specific Company Scope Resolution**: Improved scope detection to accurately distinguish and filter meeting searches based on `scopeType` (`"all"`, `"specific"`, `"none"`).
-   **Contract-Aware Semantic Processing**: Artifact-complete contracts (NEXT_STEPS, ATTENDEES, CUSTOMER_QUESTIONS) return formatted artifacts directly, even if the question uses "should mention" phrasing. LLM semantic processing is only used when: (1) artifacts not found, or (2) question requires true filtering (e.g., "which action items about cameras"). This ensures consistent output format between new threads and follow-ups asking for the same data.
-   **LLM-Determined Semantic Processing (requiresSemantic)**: Replaced brittle regex-based `isSemanticQuestion()` with LLM-determined `requiresSemantic` flag in `IntentClassificationResult`. The LLM already understands the question's meaning during intent classification, so it simultaneously determines if semantic transcript processing is needed. For entity fast-paths that bypass LLM classification, `requiresSemantic` defaults to `true` (safe default since artifact-complete contracts have their own guard). This eliminates keyword creep.
-   **LLM-Determined Product Knowledge & Style Matching (requiresProductKnowledge, requiresStyleMatching)**: Replaced three regex-based detection functions (`detectProductKnowledgeEnrichment`, `detectStyleMatchingRequest`, `detectPitCrewContext`) with two LLM-determined flags in `IntentClassificationResult`. The LLM determines during intent classification whether the response needs enrichment with PitCrew's internal product data from Airtable (`requiresProductKnowledge`) and/or should match PitCrew's existing feature description style (`requiresStyleMatching`). These flags apply to ALL intents, not just EXTERNAL_RESEARCH. Defaults to `false` when not set. Removes the "ARCHITECTURAL EXCEPTION" TODOs about contract chain migration.
-   **Removed DOCUMENT_SEARCH/DOCUMENT_ANSWER**: Legacy intent and contract removed. Document-related requests now route through GENERAL_HELP intent with appropriate contracts (DRAFT_RESPONSE, GENERAL_RESPONSE, etc.).
-   **Consistent Thread Context Passing**: All intent handlers now pass thread context (`buildThreadContextSection()`) to their LLM calls, ensuring follow-up messages like "research them" or "link me to this conversation" resolve correctly. EXTERNAL_RESEARCH and SLACK_SEARCH were previously missing thread context. SLACK_SEARCH also uses Decision Layer's `extractedCompany`/`keyTopics`/`conversationContext` to build context-aware search queries for referential follow-ups.
-   **Unified General Help Fallback Chain**: `callGeneralHelpWithFallback()` in `openAssistantHandler.ts` provides a single LLM invocation helper with ordered fallback (Claude Opus → Gemini 3 Pro → OpenAI GPT-4o). All model references go through `MODEL_ASSIGNMENTS` (including `GENERAL_HELP_FALLBACK_1` and `GENERAL_HELP_FALLBACK_2`), eliminating hardcoded model strings. The `streamingCompleted` flag is normalized: `false` for Claude/Gemini (non-streaming), `!!slackStreaming` for OpenAI.

## External Dependencies

### AI Services
-   OpenAI API (GPT-5, GPT-4o, GPT-4o-mini)
-   Anthropic Claude Opus 4.6 (GENERAL_HELP responses, with Gemini 3 Pro and OpenAI as fallbacks)
-   Google Gemini 3 Pro (GENERAL_HELP responses, external research, website analysis)
-   Google Gemini 2.5 Flash (semantic transcript analysis with 1M token window)

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

### Airtable Webhook
-   **Endpoint**: `POST https://mustard.leverege.com/api/airtable/webhook`
-   **Authentication**: Header `X-Airtable-Secret`
-   **Behavior**: Waits for sync, auto-discovers new tables, and auto-adds new columns.
-   **Trigger**: Zapier automation on Airtable record changes.

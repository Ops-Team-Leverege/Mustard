# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application that utilizes AI to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts. Its main purpose is to provide actionable intelligence to sales and product teams, enhancing product development and refining sales strategies. Key capabilities include a dark-mode-first UI, real-time categorization, and advanced AI models for semantic understanding and extraction.

## User Preferences
Preferred communication style: Simple, everyday language.

Always ask where the impact should be reflected before making OpenAI-related changes.

## System Architecture

### Core Design Principles
The system is a Single-Page Application (SPA) built with React, Vite, and Wouter, designed for asynchronous AI transcript processing. It features end-to-end type safety using Zod and shared schemas, supporting a multi-product environment. The UI features a dark-mode-first interface using Shadcn/ui (New York style), Radix UI, and Tailwind CSS.

### Technical Implementations
The frontend uses React, TypeScript, and Tailwind CSS, with state management handled by TanStack Query and React hooks. The backend is built with Express.js and TypeScript, exposing a RESTful JSON API. Data is persisted using PostgreSQL and Drizzle ORM, with Zod for schema validation. Authentication uses Replit Auth (OpenID Connect). The database schema supports `transcripts`, `categories`, `product_insights`, `qa_pairs`, `customer_questions`, `meeting_action_items`, and `users`.

### Feature Specifications
The application includes a transcript detail view, meeting date support, dashboard analytics, smart duplicate prevention for contacts, and comprehensive transcript management. It offers company stage management, service tagging, automatic POS system detection, preserves speaker identity in transcripts, and differentiates between interpreted `qa_pairs` and verbatim `customer_questions`. It also includes a Document Output Feature for generating .docx files and a markdown formatting system that supports multiple output targets.

### Decision Layer Architecture (LLM-First Intent Routing)
The system employs **true LLM-FIRST classification** for intent routing, using gpt-4o-mini for semantic understanding. Minimal fast-paths handle only absolute certainties (e.g., entity detection via database lookups or high-confidence regex). LLM validation is reserved for weak detection methods like keyword detection, never overriding authoritative sources like database-backed entity detection.

**Classification Strategy:**
1.  **Minimal fast-paths**: Handles REFUSE patterns, MULTI_INTENT patterns, simple greetings, and entity detection (database lookups).
2.  **LLM semantic classification**: For all other intents, using `INTENT_CLASSIFICATION_PROMPT`.
3.  **LLM validation**: Only for weak heuristic matches.

**Key Components:**
-   **Intent Router**: Classifies user intent using LLM semantic understanding.
-   **Orchestrator**: Manages flow and selects answer contracts.
-   **Execution Layer**: Executes contracts deterministically.
-   **Shared Meeting Module**: Centralized types and utilities for meeting scope.

**Routing Flow:**
The Intent Router classifies intent, the Orchestrator computes context layers and selects an answer contract, and the Execution Layer executes the contract chain. LLM-determined scope (e.g., "all customers") is propagated downstream to avoid redundant detection. Contract chains are dynamically built based on user messages.

**Contract Selection Strategy (LLM-First):**
1. **LLM-proposed contracts (primary)**: If LLM interpretation proposed contracts during intent classification, use them
2. **Keyword fallback**: Only when LLM didn't propose contracts (legacy paths or absolute certainties)
3. **LLM classification fallback**: If no LLM proposal and no keyword match, run separate contract selection LLM call

**Intent-First Meeting Resolution (Feb 2026):**
Meeting resolution (hasTemporalMeetingReference, resolveMeetingFromSlackMessage) only runs AFTER intent classification, and only when intent is SINGLE_MEETING or MULTI_MEETING. This saves ~1.5s for non-meeting requests (60% of traffic).

**Contract Chains (Multi-Step Requests):**
LLM can propose multiple contracts for multi-step requests (e.g., "research X then write feature description"):
- `ProposedInterpretation.contracts: ["EXTERNAL_RESEARCH", "SALES_DOCS_PREP"]`
- First contract is primary, chain is executed in order
- Examples: `["EXTERNAL_RESEARCH", "SALES_DOCS_PREP"]`, `["MEETING_SUMMARY", "DRAFT_EMAIL"]`

### Recent Architectural Improvements
-   **Markdown Formatting System**: Flexible `markdownFormatter.ts` supporting multiple output targets (slack, standard, plaintext).
-   **Follow-Up Detection Service**: `followUpDetector.ts` provides a standalone, testable service for detecting follow-up/refinement messages with configurable patterns.
-   **Database-Backed Deduplication**: `eventDeduplicator.ts` uses PostgreSQL for scalable, cross-instance deduplication with atomic `INSERT ... ON CONFLICT DO NOTHING` and automatic cleanup.
-   **Product Knowledge Enrichment**: Interim solution in `openAssistantHandler.ts` to detect and chain product knowledge enrichment for various intents using Airtable SSOT.
-   **MCP Folder Structure**: `server/mcp/` strictly contains Model Context Protocol plumbing and tool definitions.
-   **Slack Module Organization**: `server/slack/` is organized into `handlers/`, `context/`, and root files for core event handling and API.
-   **Standardized Error Handling**: `errorHandler.ts` provides centralized error handling with custom error classes, unified response format, ZodError support, and logging.
-   **Centralized Prompts System**: All LLM prompts are organized in `server/config/prompts/` with typed builders for dynamic parameters.
-   **Thread Context Company Preservation (Feb 2026)**: Company names extracted from messages (e.g., "Ivy Lane") are now preserved when CLARIFY intent is returned, preventing redundant "which customer?" clarification requests on follow-ups. The `companyMentioned` extraction happens BEFORE meeting resolution so it's available for all intent paths.

## External Dependencies

### AI Services
-   OpenAI API (GPT-5, GPT-4o, GPT-4o-mini)

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
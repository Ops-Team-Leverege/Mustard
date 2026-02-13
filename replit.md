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
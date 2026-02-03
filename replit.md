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

**Meeting-Aware Product Knowledge**: When PRODUCT_KNOWLEDGE intent is triggered within a meeting thread, the system enriches responses with meeting context by fetching customer questions from that meeting via `buildMeetingContextForProductKnowledge()`. This allows product knowledge responses to address specific customer concerns raised in the meeting.

### Decision Layer Architecture (LLM-First Intent Routing)
The system uses **true LLM-FIRST classification** for intent routing. The LLM (gpt-4o-mini) handles semantic understanding while minimal fast-paths handle only absolute certainties.

**CRITICAL ARCHITECTURAL PRINCIPLE - Detection Method Trust Levels:**
```
TRUSTED (no LLM validation needed):
- Entity detection: Database lookup of known customers/contacts → AUTHORITATIVE
- Pattern detection: High-confidence regex (REFUSE, MULTI_INTENT) → AUTHORITATIVE

WEAK (needs LLM validation):
- Keyword detection: Heuristic pattern matching → MAY BE WRONG
```

**Why this matters:** When someone types a known customer name like "Les Schwab", entity detection finds it in the database and returns SINGLE_MEETING. This is AUTHORITATIVE - the database knows this is a customer. Do NOT add LLM validation that can override this. LLM validation is only for weak heuristic matches.

**DO NOT:**
- Add regex patterns to handle edge cases (LLM handles semantic nuance)
- Add LLM validation for entity detection (database is authoritative)
- Override entity detection with LLM interpretation

**Classification Strategy:**
1. **Minimal fast-paths** (no LLM cost, TRUSTED):
   - REFUSE patterns: Weather, jokes, personal info (out of scope)
   - MULTI_INTENT patterns: Multi-step requests needing clarification
   - Simple greetings: "hello", "thanks", etc.
   - Entity detection: Known company/contact names from database → meeting intent (TRUSTED, no LLM override)
2. **LLM semantic classification** (everything else):
   - Uses `INTENT_CLASSIFICATION_PROMPT` in `server/config/prompts/decisionLayer.ts`
   - Handles SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE, EXTERNAL_RESEARCH, etc.
3. **LLM validation** (only for WEAK detection methods):
   - Only validates keyword detection matches
   - NEVER validates entity detection (database is authoritative)

**Key Components:**
- **Intent Router** (`server/decisionLayer/intent.ts`): Classifies user intent using LLM semantic understanding
- **Orchestrator** (`server/decisionLayer/index.ts`): Manages flow and selects answer contracts
- **Execution Layer** (`server/openAssistant/`): Executes contracts deterministically
  - `contractExecutor.ts`: Multi-meeting contract chain execution
  - `singleMeetingOrchestrator.ts`: Single-meeting question handling
  - `meetingResolver.ts`: Meeting lookup and scope resolution
- **Shared Meeting Module** (`server/meeting/`): Centralized types and utilities for meeting scope
  - `types.ts`: SingleMeetingContext, MeetingResolutionResult, MeetingThreadContext
  - `utils.ts`: TEMPORAL_PATTERNS, formatMeetingDate, wantsAllCustomers, extractTopic

**Routing Flow:**
1. Intent Router classifies intent → SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE, EXTERNAL_RESEARCH, DOCUMENT_SEARCH, GENERAL_HELP, REFUSE, or CLARIFY
2. Orchestrator computes context layers and selects answer contract
3. **Scope Detection (MULTI_MEETING)**: LLM determines if "all customers" scope is implied (e.g., "our meetings", "we've had", "3 most recent"). This scope is passed downstream via `DecisionLayerResult.scope` to avoid regex re-detection.
4. Execution Layer executes contract chain with evidence enforcement

**Why LLM-First?** Complex regex patterns and keyword lists create conflicts (e.g., "What does PitCrew do?" matching both PRODUCT_KNOWLEDGE and EXTERNAL_RESEARCH). The LLM handles these semantic distinctions naturally.

**Scope Propagation**: The Decision Layer's LLM-determined scope (`allCustomers`, `hasTimeRange`) is passed through `ScopeOverride` to `findRelevantMeetings()`. This eliminates the need for brittle regex patterns to detect scope in the meeting resolver. The LLM handles semantic understanding of phrases like "meetings we've had" → all customers.

Contract chains are dynamically built based on user messages, ensuring ordered execution and enforcing safety constraints.

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

### Product Knowledge Enrichment (Interim Pattern)
**Architecture Gap**: EXTERNAL_RESEARCH intent doesn't use contract chain execution (only MULTI_MEETING does). This causes product knowledge enrichment to be ad-hoc rather than chain-based.

**Interim Solution** (`server/openAssistant/openAssistantHandler.ts`):
- `detectProductKnowledgeEnrichment()`: Detects when user wants PitCrew context (e.g., "PitCrew's value props", "based on PitCrew", "our value").
- `chainProductKnowledgeEnrichment()`: Fetches Airtable SSOT and synthesizes with external research.
- **Data Source**: Returns `"product_ssot"` when enrichment is applied.

**TASK_KEYWORDS Pattern** (`server/decisionLayer/answerContracts.ts`):
- Pattern: `/value\s*prop|pitcrew['']?s?\s+value|our\s+value|based\s+on\s+pitcrew|.../i`
- Triggers PRODUCT_KNOWLEDGE contract for intents: EXTERNAL_RESEARCH, GENERAL_HELP, SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE.

**TODO**: Refactor EXTERNAL_RESEARCH to use proper contract chain execution via `executeContractChain()` like MULTI_MEETING does.

### MCP Folder Structure
The `server/mcp/` folder contains ONLY MCP (Model Context Protocol) plumbing and tool definitions:
- `context.ts`: MCP context management
- `toolRouter.ts`: Routes questions to appropriate MCP tools via LLM-based intent classification
- `index.ts`: MCP exports (simple run interface)
- `llm.ts`: LLM utilities for MCP
- `types.ts`: MCP type definitions
- `tools/`: MCP tool definitions

**Note**: Application-level orchestration logic lives in `server/openAssistant/` (Execution Layer), Slack-specific handlers in `server/slack/handlers/`, Slack context utilities in `server/slack/context/`, and shared meeting utilities in `server/meeting/`. Do not add business logic or orchestration to the MCP folder.

### Slack Module Organization
The `server/slack/` folder is organized into specialized subfolders:

**handlers/** - Specialized question/response handlers:
- `ambiguityHandler.ts`: Handles aggregate query clarification
- `binaryQuestionHandler.ts`: Handles yes/no binary questions
- `clarificationHandler.ts`: Handles next-steps and proposed interpretation follow-ups
- `answerQuestionsHandler.ts`: Handles "answer those questions" follow-up requests

**context/** - Thread and meeting context resolution:
- `meetingResolver.ts`: Slack-specific meeting resolution with thread context awareness
- `threadResolver.ts`: Thread context retrieval and caching
- `progressManager.ts`: Progress message timing and display

**Root files** - Core event handling and Slack API:
- `events.ts`: Main event orchestration (~966 lines, reduced from 1376)
- `slackApi.ts`: Slack API wrapper functions
- `logInteraction.ts`: Interaction logging utilities

### Standardized Error Handling
- **Error Handler Utilities**: `server/utils/errorHandler.ts` provides centralized error handling for API routes.
- **Custom Error Classes**: `ValidationError` (400), `NotFoundError` (404), `AuthenticationError` (401), `AuthorizationError` (403), `ExternalServiceError` (502), `RateLimitError` (429).
- **Unified Response Format**: All routes return `{ error: message }` with appropriate HTTP status codes.
- **ZodError Support**: Automatically extracts readable messages from Zod validation errors.
- **Logging**: Server errors (500+) are logged with context; client errors (4xx) are not logged.
- **Usage Pattern**: `throw new NotFoundError("Resource")` in route handlers, caught by `handleRouteError(res, error, "CONTEXT")`.
- **Test Coverage**: 19 unit tests in `server/__tests__/errorHandler.test.ts` cover all utilities.

### Centralized Prompts System
All LLM prompts are centralized in `server/config/prompts/` for maintainability:

**File Organization:**
- `system.ts`: Base system prompts, shared context (AMBIENT_PRODUCT_CONTEXT, formatting instructions)
- `decisionLayer.ts`: Intent classification, contract selection, validation prompts + typed builders
- `extraction.ts`: Customer questions extraction, transcript analysis prompts
- `singleMeeting.ts`: Single meeting handler prompts
- `multiMeeting.ts`: Multi-meeting analysis prompts + typed builders
- `transcript.ts`: RAG composition prompts
- `external.ts`: External research and MCP routing prompts
- `index.ts`: Re-exports all prompts for easy importing

**Usage Pattern:**
```typescript
import { INTENT_CLASSIFICATION_PROMPT, buildIntentValidationPrompt } from "../config/prompts";
```

**Typed Prompt Builders:** For prompts requiring dynamic parameters, use builder functions:
```typescript
const prompt = buildIntentValidationPrompt(deterministicIntent, reason, signals);
```
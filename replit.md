# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application designed to extract, categorize, and organize product insights and customer Q&A from Business Development call transcripts using AI. It provides actionable intelligence for sales and product teams, aiming to improve product development and refine sales strategies. The application features a dark-mode-first UI and real-time categorization, facilitating enhanced decision-making and market responsiveness.

## User Preferences
Preferred communication style: Simple, everyday language.

### OpenAI Integration Changes (CRITICAL)
**Always ask where the impact should be reflected before making OpenAI-related changes.**

This application has multiple features using OpenAI with different models and settings:

| Feature | File | Model | Temperature | Purpose |
|---------|------|-------|-------------|---------|
| Transcript Analyzer | `server/transcriptAnalyzer.ts` | gpt-5 | default (1) | Extract insights/Q&A from transcripts |
| MCP Router | `server/mcp/llm.ts` | gpt-4o-mini | 0 | Route Slack questions to capabilities |
| RAG Composer | `server/rag/composer.ts` | gpt-4o-mini / gpt-4o | 0 | Extract answers, commitments, quotes |
| Customer Questions | `server/extraction/extractCustomerQuestions.ts` | gpt-4o | 0 | Extract verbatim customer questions |

**Model constraints:**
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
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

The Slack Single-Meeting Orchestrator handles user questions scoped to a single meeting, resolving the target meeting deterministically and applying a Capability Trust Matrix for responses (Tier 1 artifacts are read-only). The Open Assistant expands Slack bot capabilities to broader, ChatGPT-like usage, classifying evidence sources (meeting_data, external_research, general_assistance, hybrid) with GPT-5 to ensure claims are backed by appropriate sources and citations.

Meeting detection uses a regex-first strategy with LLM fallback (gpt-4o-mini) for temporal references. Transcript search relevance prioritizes chunks matching both proper nouns and keywords. Customer question extraction uses gpt-4o with temperature=0 for verbatim extraction and deterministic speaker resolution.

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
- Responds immediately with `{ success: true, message: "Webhook received, sync started in background." }`
- Triggers full dynamic sync of all Airtable tables in background
- Auto-discovers new tables and creates database tables
- Auto-adds new columns when Airtable schema changes

**Trigger**: Zapier automation on Airtable record changes
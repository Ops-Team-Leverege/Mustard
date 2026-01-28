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
The system uses an LLM-first architecture where Control Plane runs to classify intent from the full message, then routes based on the classified intent. This ensures semantic understanding (e.g., "search all calls about Ivy Lane" correctly routes as MULTI_MEETING, not single-meeting).

**Early Fast Paths (Pre-Control Plane):**
- Briefing/prep ambiguity detection (handled before intent classification)
- Binary existence questions (short-circuit for quick responses)

**Routing Flow:**
1. **Control Plane classifies intent** - Using keyword fast-paths + LLM fallback (gpt-4o-mini)
2. **CLARIFY intent** → Ask user for clarification
3. **SINGLE_MEETING + resolved meeting** → SingleMeetingOrchestrator for artifact access
4. **SINGLE_MEETING without meeting** → Ask which meeting
5. **MULTI_MEETING, PRODUCT_KNOWLEDGE, etc.** → Open Assistant with appropriate handlers

**Intent Types:** SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE, DOCUMENT_SEARCH, GENERAL_HELP, REFUSE, CLARIFY

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
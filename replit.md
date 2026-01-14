# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application designed to leverage AI for analyzing Business Development call transcripts. Its core purpose is to extract, categorize, and organize product insights and customer Q&A into searchable tables. This provides sales and product teams with actionable intelligence, streamlining insight discovery from customer interactions, enhancing product development, and refining sales strategies. The application features a dark-mode-first UI and real-time categorization.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Core Design Principles
- **Single-Page Application (SPA)**: Client-side routing with Wouter.
- **Asynchronous Transcript Processing**: Transcripts are uploaded and immediately marked pending. AI analysis runs in the background with status updates, allowing users to track progress and retry failed analyses.
- **Type Safety**: End-to-end type safety achieved with shared schema definitions and Zod.
- **Multi-Product Architecture**: Supports four distinct products (PitCrew, AutoTrace, WorkWatch, ExpressLane) with complete data separation using a `product` column for isolation within a single database.

### Frontend
- **Framework**: React with TypeScript (Vite).
- **UI/UX**: Shadcn/ui (New York style), Radix UI, Tailwind CSS, CVA. Dark-mode-first with light mode support, inspired by Linear/Notion aesthetics.
- **State Management**: TanStack Query for server state; React hooks for local state.
- **Navigation**: Tab navigation with dropdowns for "Databases" (Product Insights, Q&A Database, Transcripts).
- **Design System**: Custom CSS variables for color, Inter font.

### Backend
- **Framework**: Express.js with TypeScript.
- **API**: RESTful JSON API (`/api`), centralized error handling.
- **Data Layer**: PostgreSQL with Drizzle ORM, Zod for schema validation. Neon for production.
- **AI Integration**: OpenAI API (GPT-5) for transcript analysis, structured prompt engineering for insight/Q&A extraction and categorization. Handles large transcripts via batching.
- **Authentication**: Replit Auth (OpenID Connect) with session-based PostgreSQL store. Access restricted to `@leverege.com` emails.
- **Database Schema**: Includes tables for `transcripts`, `categories`, `product_insights`, `qa_pairs`, `companies`, `contacts`, `users`, `sessions`, `features`, `pos_systems`, `pos_system_companies`.

### Key Features
- **Transcript Detail View**: Dedicated page for individual transcripts showing filtered insights/Q&A.
- **Meeting Date Support**: Optional meeting date input during transcript upload.
- **Dashboard Analytics**: Companies page shows recent meetings and "Companies by Stage" pie chart. Categories page shows bar charts of insights/Q&A by unique company mentions.
- **Contact Management**: Smart duplicate prevention and a "Merge Duplicates" feature for contacts.
- **Transcript Management**: Full list view, search, edit, delete with cascade for associated data.
- **Service Tagging**: Companies can be tagged with service categories.
- **Company Stage Management**: Tracks company progression through stages (Prospect, Pilot, Rollout, Scale).
- **Temporal Context**: Product insights and Q&A tables include "Transcript Date."
- **Features Management**: CRUD operations for tracking product features, linking them to categories, and displaying related insights.
- **Rich Text Support**: `mainMeetingTakeaways` field supports multi-line text and bullet points.
- **Q&A Star Feature**: Q&A pairs can be starred/favorited for quick reference.
- **POS Systems Database**: Tracks Point of Sale systems with company relationships.
- **Automatic POS System Detection**: AI automatically identifies and links POS systems mentioned in transcripts to companies.
- **Meeting Notes Support**: Toggle for "Add Meeting Notes" mode, optimizing AI prompts for condensed notes.
- **Supporting Materials**: Optional section in upload form for file references or URLs for supplementary materials.

## External Dependencies

### AI Services
- **OpenAI API (GPT-5)**

### Database
- **PostgreSQL**
- **Drizzle ORM**
- **Neon**

### UI Component Libraries
- **Radix UI**
- **Shadcn/ui**
- **Tailwind CSS**
- **Lucide React**

### Build & Development Tools
- **Vite**
- **esbuild**
- **tsx**

### State & Data Fetching
- **TanStack Query**
- **React Hook Form**
- **Zod**

### Supporting Libraries
- **wouter**
- **date-fns**
- **clsx & tailwind-merge**
- **cmdk**
- **embla-carousel-react**
- **Recharts**
- **mammoth**
- **pdf-parse**
- **multer**

### Integrations
- **Replit Auth**
- **Jira Integration**
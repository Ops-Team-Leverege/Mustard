# PitCrew Customer Transcript Analyzer

## Overview
The PitCrew Customer Transcript Analyzer is a SaaS application designed to analyze Business Development call transcripts using AI. Its primary purpose is to extract product insights and customer Q&A pairs, organizing them into searchable, categorized tables. The application aims to provide a modern, AI-powered solution for sales and product teams to gain valuable intelligence from their customer interactions, featuring real-time categorization and a dark-mode-first user interface. The business vision is to streamline the process of gleaning actionable insights from conversations, thereby enhancing product development and sales strategies.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React with TypeScript, Vite for bundling.
- **UI**: Shadcn/ui (New York style) built on Radix UI, styled with Tailwind CSS and CVA. Dark mode first with light mode support, inspired by Linear/Notion aesthetics.
- **State Management**: TanStack Query for server state and caching; React hooks for local component state.
- **Routing**: Wouter for client-side routing.
- **Design System**: Custom color palette via CSS variables, Inter font family, emphasis on data clarity.

### Backend
- **Framework**: Express.js with TypeScript.
- **API**: RESTful JSON API under `/api`, centralized error handling.
- **Data Layer**: PostgreSQL database with Drizzle ORM, Zod for schema validation. Neon serverless driver for production.
- **AI Integration**: OpenAI API (GPT-5) for transcript analysis, structured prompt engineering for insight/Q&A extraction and categorization.
- **Authentication**: Replit Auth (OpenID Connect) for user authentication (Google, GitHub, X, Apple, email/password), session-based with PostgreSQL session store. Access restricted to `@leverege.com` email addresses.
- **Database Schema**: `transcripts`, `categories`, `product_insights`, `qa_pairs`, `companies`, `contacts`, `users`, `sessions`.

### Key Architectural Decisions
- **Single-Page Application (SPA)**: Client-side routing with Wouter.
- **AI-First Workflow**: Transcript analysis precedes database persistence; results dictate saved data.
- **Type Safety**: Shared schema definitions (`shared/schema.ts`) and Zod for end-to-end type safety.
- **Session Management**: Express sessions with PostgreSQL store.
- **Development Experience**: Replit-specific plugins, HMR, separate dev/prod configs.
- **Data Linkage**: Q&A pairs linked to contacts for richer customer data.
- **Timestamp Tracking**: `createdAt` timestamps for product insights and Q&A pairs.

## External Dependencies

### AI Services
- **OpenAI API (GPT-5)**: Used for AI-powered transcript analysis.

### Database
- **PostgreSQL**: Primary data store.
- **Drizzle ORM**: Database toolkit and query builder.
- **Neon**: Serverless PostgreSQL driver.

### UI Component Libraries
- **Radix UI**: Accessible, unstyled UI components.
- **Shadcn/ui**: Pre-styled component system.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.

### Build & Development Tools
- **Vite**: Frontend build tool.
- **esbuild**: Backend bundler.
- **tsx**: TypeScript execution for development.

### State & Data Fetching
- **TanStack Query**: Async state management.
- **React Hook Form**: Form state management with Zod.
- **Zod**: Schema validation.

### Supporting Libraries
- **wouter**: Lightweight routing.
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: CSS class utilities.
- **cmdk**: Command palette component.
- **embla-carousel-react**: Carousel functionality.

### Integrations
- **Replit Auth**: User authentication system.
- **Jira Integration**: Links product insights to Jira tickets by posting comments via Jira REST API.
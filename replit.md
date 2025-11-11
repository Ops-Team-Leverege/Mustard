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
- **Navigation**: Organized tab navigation with dropdown support; Product Insights, Q&A Database, and Transcripts grouped under a "Databases" dropdown for cleaner navigation structure. Uses Radix DropdownMenu with proper keyboard accessibility (Tab, arrow keys, Enter/Space).
- **Design System**: Custom color palette via CSS variables, Inter font family, emphasis on data clarity.

### Backend
- **Framework**: Express.js with TypeScript.
- **API**: RESTful JSON API under `/api`, centralized error handling.
- **Data Layer**: PostgreSQL database with Drizzle ORM, Zod for schema validation. Neon serverless driver for production.
- **AI Integration**: OpenAI API (GPT-5) for transcript analysis, structured prompt engineering for insight/Q&A extraction and categorization. Automatic transcript batching for transcripts over 15,000 characters to prevent timeout errors.
- **Authentication**: Replit Auth (OpenID Connect) for user authentication (Google, GitHub, X, Apple, email/password), session-based with PostgreSQL session store. Access restricted to `@leverege.com` email addresses.
- **Database Schema**: `transcripts`, `categories`, `product_insights`, `qa_pairs`, `companies`, `contacts`, `users`, `sessions`, `features`, `pos_systems`, `pos_system_companies`.

### Key Architectural Decisions
- **Single-Page Application (SPA)**: Client-side routing with Wouter.
- **AI-First Workflow**: Transcript analysis precedes database persistence; results dictate saved data.
- **Type Safety**: Shared schema definitions (`shared/schema.ts`) and Zod for end-to-end type safety.
- **Session Management**: Express sessions with PostgreSQL store.
- **Development Experience**: Replit-specific plugins, HMR, separate dev/prod configs.
- **Data Linkage**: Q&A pairs linked to contacts for richer customer data; product insights and Q&A pairs linked to transcripts via `transcriptId`.
- **Timestamp Tracking**: `createdAt` timestamps for product insights and Q&A pairs; transcripts support custom meeting dates via optional date input on upload form.
- **Transcript Detail View**: Dedicated page (`/transcripts/:id`) shows individual transcript with filtered insights/Q&A from that specific call, accessible by clicking transcript rows on company pages.
- **Meeting Date Support**: Transcript upload form includes optional meeting date field to set custom date for when meeting occurred; if not provided, defaults to current timestamp.
- **Dashboard Analytics**: Companies page features dashboard cards showing (1) Recent Meetings from last 7 days with clickable links to transcript details, and (2) Companies by Stage pie chart visualization using Recharts, with color-coded stages (Prospect: slate, Pilot: blue, Rollout: orange, Scale: green). Categories page includes bar chart visualizations showing insights and Q&A pairs by unique company mentions (if one company has 5 insights in a category, it counts as 1, not 5).
- **Contact Management**: Smart duplicate prevention when adding transcripts (checks existing contacts by name and nameInTranscript); dedicated "Merge Duplicates" feature on company pages to consolidate duplicate contacts while preserving the newest non-null metadata (job titles, transcript aliases) and maintaining Q&A pair references.
- **Transcript Management**: Dedicated Transcripts page (`/transcripts`) with full list view, search by name/company, edit/delete capabilities with confirmation dialogs, and cascade deletion of associated insights and Q&A pairs.
- **Service Tagging**: Companies can be tagged with service categories ("tire services", "oil & express services", "commercial truck services", "full services") via checkbox selection in edit mode; tags displayed as badges in view mode for quick service identification.
- **Company Stage Management**: All new companies automatically default to "Prospect" stage upon creation. Companies can be progressed through stages (Prospect → Pilot → Rollout → Scale) via the company edit interface. Stage information is visualized in dashboard pie charts.
- **Temporal Context**: Product insights and Q&A tables include "Transcript Date" column showing when the associated meeting occurred, enabling users to identify when insights were spoken and track conversation timelines.
- **Features Management**: Dedicated Features page (`/features`) allows tracking existing product features with demo video links and help guide links. Features can optionally be linked to categories for organization. All CRUD operations (create, read, update, delete) are supported with proper form validation using react-hook-form and zodResolver. Feature detail page (`/features/:id`) displays individual feature information with description supporting multi-line text and bullet points, plus related product insights from the linked category for deeper context.
- **Rich Text Support**: Transcript upload form includes mainMeetingTakeaways field supporting multi-line text with bullet points and formatted lists. Field uses standard textarea for input and whitespace-pre-wrap CSS for display preservation on transcript detail pages, maintaining original formatting including newlines and manual bullet characters (•, -, *).
- **Q&A Star Feature**: Q&A pairs can be starred/favorited for quick reference. Star toggle button appears in the first column of the Q&A table, with filled yellow star for starred items and empty star for unstarred. Star status persists in database (isStarred text field, default 'false') and syncs across all views via TanStack Query cache invalidation.
- **POS Systems Database**: Dedicated database for tracking Point of Sales systems with name, website link, description, and multi-company relationships. Accessible via Databases dropdown in navigation. Supports full CRUD operations with multi-select company associations using checkbox-based selection interface. Uses junction table (`pos_system_companies`) for many-to-many relationship between POS systems and companies.
- **Automatic POS System Detection**: During transcript analysis, AI automatically detects mentions of POS systems (e.g., Square, Toast, Clover) and either creates a new POS system entry or links to an existing one. If a POS system is mentioned in the conversation, it's automatically associated with the company without manual data entry. System uses case-insensitive name matching to prevent duplicates.
- **Meeting Notes Support**: Transcript upload form includes a toggle to switch between "Add Transcript" and "Add Meeting Notes" modes. In notes mode, users can upload brief, informal, or fragmented onsite meeting notes instead of full transcripts. The AI analyzer uses specialized prompts optimized for extracting insights and questions from condensed notes. Notes are stored in the mainMeetingTakeaways field, and the contentType field ("transcript" or "notes") tracks the input type. Both modes support full AI analysis including POS system detection, insight extraction, and Q&A pair generation.
- **Supporting Materials**: Transcript upload form includes an optional "Supporting Materials" section where users can upload file references or add URLs that supplement the call transcript or meeting notes. File uploads store the filename as a reference, and URL inputs save the link directly. Supporting materials are stored in the `transcripts.supportingMaterials` field for reference purposes, allowing users to track related documents like presentation decks, product specifications, or technical materials alongside the conversation record without extracting or analyzing their content.
- **Multi-Product Architecture**: Application supports four distinct products (PitCrew, AutoTrace, WorkWatch, ExpressLane) with complete data separation. Users can switch between products via a dropdown in the header navigation. Each product maintains its own isolated dataset - companies, transcripts, insights, Q&A pairs, categories, features, contacts, and POS systems are scoped by product. All database tables include a `product` column (enum: "PitCrew" | "AutoTrace" | "WorkWatch" | "ExpressLane") with default "PitCrew" for backward compatibility. Backend routes use a `getUserAndProduct()` helper to retrieve the user's currently selected product from the session, then pass it to all storage methods for filtering and creation. Product preference is stored per-user in the `users.currentProduct` field. When switching products, the frontend invalidates all TanStack Query caches to refetch data for the new product context. This single-database approach with product-scoped data provides better scalability, performance, and maintenance compared to separate databases per product.

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
- **Recharts**: Data visualization library for charts and graphs.
- **mammoth**: DOCX file parsing for supporting materials.
- **pdf-parse**: PDF file parsing for supporting materials.
- **multer**: File upload handling for supporting materials.

### Integrations
- **Replit Auth**: User authentication system.
- **Jira Integration**: Integration supporting linking product insights to Jira tickets by posting comments via Jira REST API, with automatic credential management through Replit's secure connection system.
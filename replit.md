# PitCrew Customer Transcript Analyzer

## Overview

PitCrew Customer Transcript Analyzer is a SaaS application for analyzing Business Development call transcripts using AI. The application extracts product insights and customer Q&A pairs from transcripts, organizing them into searchable, categorized tables. Built with a modern tech stack, it features AI-powered analysis via OpenAI's GPT-5, real-time categorization, and a polished dark-mode-first interface.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- React with TypeScript for type safety and developer experience
- Vite as the build tool and development server for fast HMR and optimized production builds
- Wouter for lightweight client-side routing (no React Router)
- Path aliases configured (`@/` for client components, `@shared/` for shared types)

**UI Component Strategy**
- Shadcn/ui components (New York style) for consistent, accessible UI primitives
- Radix UI headless components as the foundation for all interactive elements
- Tailwind CSS for styling with custom design system variables
- Class Variance Authority (CVA) for component variant management

**State Management**
- TanStack Query (React Query) for server state management, caching, and data fetching
- Local component state with React hooks for UI-specific state
- No global state management library (Redux/Zustand) needed due to server-state-first approach

**Design System**
- Dark mode as primary theme with light mode support
- Modern SaaS aesthetic inspired by Linear, Notion, and Carbon Design
- Custom color palette defined in CSS variables for theme consistency
- Inter font family for all typography
- Emphasis on data clarity, whitespace, and visual hierarchy for dense tabular information

### Backend Architecture

**Server Framework**
- Express.js as the HTTP server
- TypeScript throughout for type safety across frontend and backend
- ESM modules (not CommonJS) for modern JavaScript
- Vite integration in development for seamless HMR

**API Design**
- RESTful API endpoints under `/api` prefix
- JSON request/response format
- Centralized error handling middleware
- Request/response logging for debugging

**Data Layer**
- Drizzle ORM for database interactions with PostgreSQL
- Schema-first approach with Zod validation via drizzle-zod
- In-memory storage fallback (MemStorage class) for development/testing
- Neon serverless Postgres driver for production database connectivity

**AI Integration**
- OpenAI API integration for transcript analysis (GPT-5 model)
- Structured prompt engineering to extract product insights and Q&A pairs
- Category matching during AI analysis for automatic insight classification
- Error handling for AI service failures

**Database Schema**
- `transcripts`: Stores raw call transcripts with company and participant metadata
- `categories`: User-defined categories for organizing product insights and Q&A pairs (includes usage count aggregation)
- `product_insights`: Feature requests extracted from transcripts with category assignment
- `qa_pairs`: Question-answer pairs from BD calls with category assignment
- `companies`: Normalized company records with slug for routing
- `contacts`: Customer contacts with name, job title, and company association
- `users`: User authentication records (from Replit Auth integration)
- `sessions`: Session storage for authenticated users (from Replit Auth integration)

**Authentication System**
- Replit Auth (OpenID Connect) for user authentication
- Supports multiple login methods: Google, GitHub, X (Twitter), Apple, and email/password
- Session-based authentication with PostgreSQL session store
- All API routes protected with authentication middleware
- Landing page for unauthenticated users showcasing app features
- Logout functionality with proper session cleanup

### Key Architectural Decisions

**Single-Page Application (SPA)**
- Client-side routing with Wouter minimizes bundle size vs React Router
- All pages mounted under single root with tab-based navigation
- Sticky header with theme toggle for consistent UX

**AI-First Workflow**
- Transcript analysis happens before database persistence to fail fast
- Analysis results determine what gets saved (no partial data on AI failure)
- Categories pre-fetched and sent to AI for intelligent auto-categorization
- Both product insights and Q&A pairs support category assignment (nullable for manual entries)

**Type Safety Across Stack**
- Shared schema definitions in `shared/schema.ts` used by both client and server
- Zod schemas for runtime validation derived from Drizzle schemas
- TypeScript path aliases ensure clean imports throughout codebase

**Session Management**
- Express sessions with PostgreSQL session store (connect-pg-simple)
- Session-based authentication ready but not yet implemented in current codebase

**Development Experience**
- Replit-specific plugins for enhanced debugging and development
- Separate dev and production build configurations
- Hot module replacement in development with production-optimized builds

## External Dependencies

### AI Services
- **OpenAI API (GPT-5)**: Powers transcript analysis for extracting product insights and Q&A pairs. Requires `OPENAI_API_KEY` environment variable.

### Database
- **PostgreSQL**: Primary database for persistent storage (Neon serverless driver)
- **Drizzle ORM**: Database toolkit and query builder
- **drizzle-kit**: Migration management and schema push utilities
- Requires `DATABASE_URL` environment variable for connection

### UI Component Libraries
- **Radix UI**: Comprehensive collection of unstyled, accessible components (@radix-ui/react-*)
- **Shadcn/ui**: Pre-styled component system built on Radix UI
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library for UI icons

### Build & Development Tools
- **Vite**: Frontend build tool and dev server
- **esbuild**: Backend bundler for production builds
- **tsx**: TypeScript execution for development server
- **PostCSS & Autoprefixer**: CSS processing pipeline

### State & Data Fetching
- **TanStack Query**: Async state management and caching
- **React Hook Form**: Form state management with Zod validation
- **Zod**: Schema validation for forms and API data

### Supporting Libraries
- **wouter**: Lightweight routing library
- **date-fns**: Date manipulation and formatting
- **clsx & tailwind-merge**: Conditional class name utilities
- **cmdk**: Command palette component
- **embla-carousel-react**: Carousel/slider functionality

## Recent Updates (October 2025)

### Category Pages & Navigation
- **Category Pages**: Dedicated pages for viewing category-specific data
  - ID-based routing (`/categories/:id`) for direct category access
  - Clickable category badges in both insights and Q&A tables (except "NEW")
  - Overview shows category name, description, insight count, and Q&A count
  - Filtered views displaying all insights and Q&A pairs for the selected category
  - Consistent navigation pattern matching company pages
  
### Category Analytics Dashboard
- **CategoryAnalytics Component**: Comprehensive analytics view showing category usage statistics
  - Summary cards for total categories, total insights, and most popular category
  - Top 5 categories visualization with usage bars and percentage distribution
  - Real-time updates as insights are added or categories are modified
  - Graceful empty state handling

### Improved Category Management UI
- **Compact Card Layout**: Category cards redesigned for better space utilization
  - Responsive grid: 1 column (mobile), 2 columns (medium), 3 columns (large screens)
  - Reduced card padding and font sizes for denser information display
  - 2-line description limit with text truncation
  - Added hover-elevate interaction for better visual feedback
  
### Searchable Category Selectors
- **Combobox Component**: Implemented searchable dropdown for category selection
  - Replaces basic Select in ProductInsightsTable and QATable edit dialogs
  - Maintains selection state when re-selecting current option
  - Search functionality for quick category lookup
  - "NEW" filter option moved to top of category filter dropdown for visibility
  
### Company-Based Navigation
- **Company Pages**: Dedicated pages for viewing company-specific data
  - Slug-based routing (`/companies/:companySlug`) for shareable URLs
  - Clickable company badges in both insights and Q&A tables
  - Filtered views showing only relevant insights and Q&A pairs per company
  - Company normalization with companyId foreign keys and backwards compatibility

### Add Functionality on Filtered Pages
- **Add Buttons**: Both company and category pages now have "Add Insight" and "Add Q&A Pair" buttons
  - Pre-fills company name when adding from company pages
  - Forms include category selection via searchable combobox
  - Immediate cache invalidation ensures new items appear without page refresh

### Contact Management System
- **Contacts Table**: New database table for tracking customer contacts per company
  - Schema: id (UUID), name (text), jobTitle (text, nullable), companyId (foreign key), createdAt (timestamp)
  - Full CRUD API endpoints: GET, POST, PATCH, DELETE
  - Storage interface methods in both MemStorage and DbStorage implementations
  
- **Company Page Contacts Section**: Comprehensive UI for managing company contacts
  - Displays all contacts for the company with name and job title
  - Add new contacts with inline form (name and job title fields)
  - Edit existing contacts with inline editing mode
  - Delete contacts with confirmation dialog
  - Empty state when no contacts exist
  - Avatar icon for visual representation
  - Responsive design for mobile and desktop
  - All interactive elements include data-testid attributes for testing
  
- **Integration with CompanyOverview**: Contacts included in company overview response
  - CompanyOverview type extended with contacts array
  - Fetched and displayed alongside company details, insights, and Q&A pairs
  - Real-time cache invalidation after contact mutations

### Improved Transcript Form - Customer Input
- **Dynamic Customer List**: Redesigned customer input in Add Transcript form
  - Add customers one by one with name and job title together (no more comma-separated lists)
  - Name and job title fields side by side with "Add" button
  - Press Enter in either field to add customer quickly
  - Visual list shows all added customers with avatar icons
  - Remove button for each customer
  - Job title is optional per customer
  - Backend automatically creates contact records for each customer when transcript is submitted
  - Maintains backward compatibility by generating comma-separated customerNames string

### Q&A Pairs Contact Linkage
- **Contact Integration**: Q&A pairs now linked to contacts table for richer customer data
  - Schema: qaPairs table includes contactId foreign key to contacts
  - Automatic Contact Matching: AI-extracted Q&A pairs automatically matched to contacts by name (case-insensitive)
  - Display Enhancement: Q&A table shows contact name and job title when available
  - Backward Compatibility: asker field retained as fallback when no contact match exists
  - API Support: POST and PATCH endpoints accept optional contactId parameter
  - Smart Workflow: Contacts created first from transcript customers, then matched to Q&A askers

### Timestamp Tracking
- **Created On Column**: Both product insights and Q&A pairs tables now display creation timestamps
  - Database: Added createdAt timestamp fields to productInsights and qaPairs tables with defaultNow()
  - Frontend: New "Created On" column displays timestamps in browser's local timezone
  - Backend: All database queries updated to select and return createdAt field
  - Format: Timestamps displayed using browser's toLocaleString() for automatic timezone conversion

### Replit Auth Integration (October 2, 2025)
- **Authentication System**: Replaced password protection with Replit Auth (OpenID Connect)
  - Database: Added `users` and `sessions` tables for authentication
  - Authentication Methods: Supports Google, GitHub, X (Twitter), Apple, and email/password login
  - Session Management: PostgreSQL-based session storage with 7-day TTL
  - Protected Routes: All API endpoints require authentication via `isAuthenticated` middleware
  - Frontend Components: 
    - `useAuth` hook for checking authentication status
    - `Landing` page for unauthenticated users with feature showcase
    - Logout button in main header for authenticated users
  - User Management: Auto-upsert user records on login with profile data (email, name, profile image)
  - Architecture: Session-based auth with automatic token refresh for seamless experience
  - **Email Domain Restriction**: Only leverege.com email addresses are allowed to access the application
    - Backend validation in `/api/auth/user` endpoint returns 403 for invalid domains
    - Frontend immediately shows Landing page for domain-restricted users (no blank screen)
    - Toast notification informs users of access denial
    - Automatic logout after 2 seconds with query cache cleanup
    - Handles edge cases: missing email, invalid domain, valid domain
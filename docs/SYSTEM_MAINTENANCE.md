# Mustard and PitCrew Sauce System Maintenance Guide

**Last Updated**: February 15, 2026  
**Purpose**: Reference guide for maintaining and understanding the system structure

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Directory Structure](#directory-structure)
3. [Configuration Files](#configuration-files)
4. [Key Components](#key-components)
5. [Environment Variables](#environment-variables)
6. [Common Maintenance Tasks](#common-maintenance-tasks)

---

## System Overview

Mustard is a meeting intelligence platform that transforms customer conversations into searchable business insights using AI. The system processes transcripts, extracts insights, and makes them accessible via web dashboard and Slack bot -PitCrew Sauce.

**Core Flow**:
```
Transcript Upload → AI Analysis → Extraction → Storage → Access (Web/Slack)
```

**Technology Stack**:
- Frontend: React 18 + TypeScript + Wouter
- Backend: Node.js + Express + TypeScript
- Database: PostgreSQL + Drizzle ORM
- AI: OpenAI (GPT-4o, GPT-5), Google Gemini
- Integrations: Slack API, Airtable, Replit Auth

---

## Directory Structure

### Root Level
```
pitcrew/
├── client/          # React frontend (web dashboard)
├── server/          # Node.js backend (API + AI processing)
├── shared/          # Shared types and database schema
├── config/          # JSON configuration files
├── docs/            # Documentation
├── migrations/      # Database migrations
├── scripts/         # Maintenance scripts
└── .kiro/           # Kiro IDE configuration
```

### Client Structure (`client/src/`)

```
client/src/
├── components/      # React components
│   ├── ui/         # shadcn/ui components (buttons, cards, etc.)
│   ├── CategoryAnalytics.tsx
│   ├── CategoryManager.tsx
│   ├── ProductInsightsTable.tsx
│   ├── QATable.tsx
│   ├── TabNavigation.tsx
│   ├── ThemeToggle.tsx
│   └── TranscriptForm.tsx
├── pages/          # Route pages
│   ├── Landing.tsx              # Login page
│   ├── TranscriptInput.tsx      # Upload transcript
│   ├── Transcripts.tsx          # List all transcripts
│   ├── TranscriptDetailPage.tsx # Transcript details
│   ├── Latest.tsx               # Recent activity
│   ├── Companies.tsx            # Company list
│   ├── CompanyPage.tsx          # Company details
│   ├── Categories.tsx           # Category management
│   ├── CategoryPage.tsx         # Category details
│   ├── Features.tsx             # Feature tracking
│   ├── FeatureDetail.tsx        # Feature details
│   ├── ProductInsights.tsx      # Insights database
│   ├── QADatabase.tsx           # Q&A database
│   └── POSSystems.tsx           # POS systems
├── hooks/          # React hooks
│   ├── useAuth.ts              # Authentication
│   ├── use-toast.ts            # Toast notifications
│   └── use-mobile.tsx          # Mobile detection
├── lib/            # Utilities
│   ├── authUtils.ts            # Auth helpers
│   ├── queryClient.ts          # TanStack Query setup
│   └── utils.ts                # General utilities
├── App.tsx         # Main app component with routing
├── main.tsx        # React entry point
└── index.css       # Global styles
```

**Purpose**: Web dashboard for browsing transcripts, insights, companies, and Q&A pairs.

---

### Server Structure (`server/`)

#### Core Files
- `index.ts` - Application entry point, server setup
- `routes.ts` - API route definitions and handlers
- `storage.ts` - Database access layer (abstraction over Drizzle ORM)
- `db.ts` - Database connection setup
- `transcriptAnalyzer.ts` - AI-powered transcript analysis
- `replitAuth.ts` - Replit OAuth authentication
- `vite.ts` - Vite dev server setup
- `textExtractor.ts` - Extract text from files/URLs

#### Decision Layer (`server/decisionLayer/`)
**Purpose**: Routes user questions to appropriate handlers

- `index.ts` - Main orchestrator, runs decision layer
- `intent.ts` - Intent classification (8 intent types)
- `contextLayers.ts` - Determines what data to access
- `answerContracts.ts` - Defines response formats (30+ contracts)
- `llmInterpretation.ts` - LLM-based intent interpretation

**Key Intents**:
- `SINGLE_MEETING` - Questions about specific meetings
- `MULTI_MEETING` - Cross-meeting analysis
- `PRODUCT_KNOWLEDGE` - Product features/capabilities
- `EXTERNAL_RESEARCH` - Web research
- `SLACK_SEARCH` - Search Slack channels
- `GENERAL_HELP` - General assistance
- `CLARIFY` - Ambiguous queries
- `REFUSE` - Out of scope

#### Open Assistant (`server/openAssistant/`)
**Purpose**: Handles complex queries and multi-meeting analysis

- `openAssistantHandler.ts` - Main handler, routes by intent
- `singleMeetingOrchestrator.ts` - Single meeting queries
- `contractExecutor.ts` - Executes contract chains
- `meetingResolver.ts` - Resolves meeting references
- `externalResearch.ts` - Gemini-based web research
- `streamingHelper.ts` - Streaming responses to Slack
- `semanticArtifactSearch.ts` - Semantic search across meetings
- `slackSearchHandler.ts` - Slack channel search
- `types.ts` - Type definitions

#### RAG System (`server/rag/`)
**Purpose**: Retrieval Augmented Generation for transcript processing

- `composer.ts` - AI extraction functions (summaries, quotes, Q&A, action items)
- `retriever.ts` - Semantic search and retrieval
- `types.ts` - Type definitions
- `index.ts` - Main exports

#### Ingestion (`server/ingestion/`)
**Purpose**: Parses transcripts into semantic chunks for RAG

- `ingestTranscriptChunks.ts` - Transcript parsing, speaker role assignment, chunking

**Process**:
1. Parse transcript into turns (speaker + text)
2. Assign speaker roles (leverege/customer/unknown)
3. Generate name variants for matching
4. Create semantic chunks with speaker context

#### Services (`server/services/`)
**Purpose**: Supporting services for core functionality

- `documentGenerator.ts` - Creates Word documents with branding
- `documentResponse.ts` - Handles document generation and Slack upload
- `eventDeduplicator.ts` - Prevents duplicate Slack event processing
- `followUpDetector.ts` - Detects follow-up questions in threads
- `slackSearchService.ts` - Slack channel search configuration

#### Slack Integration (`server/slack/`)
**Purpose**: Slack bot event handling and responses

**Main Files**:
- `events.ts` - Main webhook handler
- `index.ts` - Route registration
- `slackApi.ts` - Slack API client functions
- `verify.ts` - Signature verification
- `acknowledgments.ts` - Acknowledgment messages
- `progressMessages.ts` - Progress updates
- `logInteraction.ts` - Interaction logging
- `interactionMetadata.ts` - Metadata structures
- `sourceAttribution.ts` - Evidence attribution
- `semanticAnswerSingleMeeting.ts` - Single meeting responses

**Context Resolvers** (`server/slack/context/`):
- `companyResolver.ts` - Resolve company from message
- `meetingResolver.ts` - Resolve meeting from message/thread
- `threadResolver.ts` - Thread context management
- `progressManager.ts` - Progress message management

**Handlers** (`server/slack/handlers/`):
- `ambiguityHandler.ts` - Handle ambiguous questions
- `answerQuestionsHandler.ts` - Answer customer questions
- `binaryQuestionHandler.ts` - Yes/no questions
- `clarificationHandler.ts` - Clarification responses

#### MCP System (`server/mcp/`)
**Purpose**: Internal tool system for structured queries

- `index.ts` - Main MCP interface
- `toolRouter.ts` - Routes questions to tools
- `llm.ts` - LLM-based tool selection
- `context.ts` - MCP context management
- `types.ts` - Type definitions

**Tools** (`server/mcp/tools/`):
- `getCompanyOverview.ts` - Company information
- `getCompanyInsights.ts` - Company insights
- `getCompanyQuestions.ts` - Company Q&A
- `searchCompanyFeedback.ts` - Search feedback
- `searchQuestions.ts` - Search questions
- `countCompaniesByTopic.ts` - Topic statistics
- `getLastMeeting.ts` - Recent meeting data
- `getMeetingAttendees.ts` - Meeting attendees

#### Meeting Module (`server/meeting/`)
**Purpose**: Meeting-related utilities

- `index.ts` - Main exports
- `types.ts` - Type definitions
- `utils.ts` - Temporal reference detection, date formatting, topic extraction

#### Middleware (`server/middleware/`)
**Purpose**: Security and validation

- `security.ts` - CSRF protection, rate limiting, origin validation, security headers
- `validation.ts` - Request validation middleware

#### Configuration (`server/config/`)
**Purpose**: System configuration and prompts

**Main Files**:
- `constants.ts` - System constants (timeouts, limits, etc.)
- `models.ts` - AI model assignments
- `capabilities.ts` - Bot capabilities configuration

**Prompts** (`server/config/prompts/`):
- `decisionLayer.ts` - Intent classification prompts
- `singleMeeting.ts` - Single meeting prompts
- `transcript.ts` - Transcript analysis prompts
- `external.ts` - External research prompts
- `slackSearch.ts` - Slack search prompts
- `generalHelp.ts` - General help prompts
- `system.ts` - System prompts
- `utility.ts` - Utility prompts
- `extraction.ts` - Extraction prompts

#### Airtable Integration (`server/airtable/`)
**Purpose**: Product knowledge sync from Airtable

- `client.ts` - Airtable API client
- `productData.ts` - Product knowledge cache
- `sync.ts` - Sync logic
- `webhook.ts` - Webhook handler
- `schema.ts` - Airtable schema definitions
- `types.ts` - Type definitions
- `dynamicData.ts` - Dynamic table access
- `dynamicSync.ts` - Dynamic sync

#### Zendesk Integration (`server/zendesk/`)
**Purpose**: Help article sync from Zendesk

- `webhook.ts` - Webhook handler
- `zendeskSync.ts` - Article sync logic

#### Utilities (`server/utils/`)
**Purpose**: Shared utility functions

- `errorHandler.ts` - Error handling and custom error classes
- `markdownFormatter.ts` - Markdown formatting
- `notFoundMessages.ts` - User-friendly not found messages
- `slackLogger.ts` - Structured logging with correlation IDs

#### Types (`server/types/`)
- `express.d.ts` - Express type extensions

#### Tests (`server/__tests__/`)
- Unit tests for critical components

#### Scripts (`server/scripts/`)
- `backfill-action-items.ts` - Backfill action items for existing transcripts

---

### Shared (`shared/`)

- `schema.ts` - Database schema (Drizzle ORM)

**Key Tables**:
- `transcripts` - Meeting records
- `companies` - Customer accounts
- `contacts` - Meeting attendees
- `categories` - Topic organization
- `features` - Product features
- `productInsights` - Feature mentions from meetings
- `qaDatabase` - Q&A pairs
- `customerQuestions` - High-trust customer questions
- `actionItems` - Meeting action items
- `transcriptChunks` - Semantic chunks for RAG
- `meetingSummaries` - Cached meeting summaries
- `interactionLogs` - Audit trail
- `posSystems` - POS system tracking
- `pitcrewAirtableFeatures` - Airtable product features
- `pitcrewProductSnapshot` - Cached product knowledge

---

## Configuration Files

### JSON Configuration (`config/`)

#### `capabilities.json`
**Purpose**: Defines PitCrew Sauce bot capabilities, intents, and examples

**Structure**:
```json
{
  "botName": "PitCrew Sauce",
  "intro": "I'm PitCrew Sauce, your AI sales assistant.",
  "dataSources": { ... },
  "capabilities": {
    "SINGLE_MEETING": { ... },
    "MULTI_MEETING": { ... },
    "PRODUCT_KNOWLEDGE": { ... },
    "EXTERNAL_RESEARCH": { ... },
    "SLACK_SEARCH": { ... },
    "GENERAL_HELP": { ... },
    "REFUSE": { ... },
    "CLARIFY": { ... }
  }
}
```

**When to modify**: Adding new capabilities or changing PitCrew Sauce bot behavior

#### `acknowledgments.json`
**Purpose**: Slack acknowledgment messages

**When to modify**: Customizing bot acknowledgment messages

#### `progressMessages.json`
**Purpose**: Progress update messages during processing

**When to modify**: Customizing progress messages

#### `streamingMessages.json`
**Purpose**: Streaming response configuration

**Structure**:
```json
{
  "preview": {
    "enabled": true,
    "maxVisibleChars": 350,
    "message": "Full details in the attached document below."
  },
  "updates": {
    "intervalMs": 1500,
    "minContentForUpdate": 100
  }
}
```

**When to modify**: Adjusting streaming behavior

#### `slackSearch.json`
**Purpose**: Slack channel search configuration

**When to modify**: Configuring which channels to search

#### `documents.json`
**Purpose**: Document generation configuration

**When to modify**: Customizing document generation settings

---

## Key Components

### Decision Layer Flow
```
User Question
    ↓
Intent Classification (LLM-based with minimal fast-path patterns)
    ↓  (8 intent types: SINGLE_MEETING, MULTI_MEETING, PRODUCT_KNOWLEDGE,
        EXTERNAL_RESEARCH, SLACK_SEARCH, GENERAL_HELP, REFUSE, CLARIFY)
    ↓
Context Layers (determines what data to access)
    ↓
Answer Contract (30+ response formats)
    ↓
Route to Handler (Single Meeting Orchestrator or Open Assistant)
```

### AI Processing Pipeline (Mustard)
```
Transcript Upload
    ↓
Mustard: AI Analysis (gpt-4o/gpt-5)
    ↓
Extract: Insights, Q&A, POS Systems
    ↓
Chunking (semantic splits)
    ↓
Customer Questions (high-trust)
    ↓
Action Items
    ↓
Store in Database
```

**Note**: "Mustard" is the transcript processing system that handles AI analysis and extraction.

### Slack Bot Flow (PitCrew Sauce)
```
@mention in Slack
    ↓
PitCrew Sauce: Verify Signature
    ↓
Deduplicate Event
    ↓
Decision Layer (Intent Classification)
    ↓
Handler (Single Meeting Orchestrator or Open Assistant)
    ↓
Generate Response
    ↓
Post to Slack (with optional document)
    ↓
Log Interaction
```

**Note**: "PitCrew Sauce" is the Slack bot that handles user interactions and queries.

---

## Environment Variables

### Required

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/database

# Authentication
REPLIT_DOMAINS=your-domain.replit.dev
SESSION_SECRET=your-secure-random-string-32-chars-min
REPL_ID=your-replit-app-id

# AI Services
OPENAI_API_KEY=sk-your-openai-api-key
GEMINI_API_KEY=your-google-gemini-api-key

# Slack Integration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret

# Airtable Integration
AIRTABLE_API_KEY=your-airtable-api-key
AIRTABLE_BASE_ID=your-base-id
```

### Optional

```bash
# External API
EXTERNAL_API_KEY=your-external-api-key

# Zendesk Integration
ZENDESK_API_KEY=your-zendesk-api-key
ZENDESK_SUBDOMAIN=your-subdomain

# Environment
NODE_ENV=production
LOG_LEVEL=info
PORT=5000
```

---

## Common Maintenance Tasks

### 1. Update AI Prompts

**Location**: `server/config/prompts/`

**Files**:
- `decisionLayer.ts` - Intent classification
- `transcript.ts` - Transcript analysis
- `singleMeeting.ts` - Meeting-specific prompts

**Process**:
1. Edit prompt file
2. Test with sample queries
3. Monitor quality in production

### 2. Add New Intent

**Files to modify**:
1. `server/decisionLayer/intent.ts` - Add to enum
2. `server/config/prompts/decisionLayer.ts` - Add to classification prompt
3. `server/decisionLayer/contextLayers.ts` - Define context layers
4. `server/openAssistant/openAssistantHandler.ts` - Add handler

### 3. Add New Answer Contract

**Files to modify**:
1. `server/decisionLayer/answerContracts.ts` - Add to enum and constraints
2. `server/openAssistant/contractExecutor.ts` - Implement executor

### 4. Modify Configuration

**Location**: `config/*.json`

**Process**:
1. Edit JSON file
2. Restart server (configs are cached)
3. Test changes

### 5. Database Migrations

**Process**:
```bash
# 1. Modify schema
# Edit shared/schema.ts

# 2. Generate migration
npm run db:push

# 3. Verify changes
# Check database
```

### 6. Retry Failed Transcripts

**Via Web UI**:
1. Navigate to transcript detail page
2. Click "Retry" button

**Via API**:
```bash
POST /api/transcripts/:id/retry
```

### 7. Monitor System Health

**Logs**:
- Check correlation IDs for request tracing
- Monitor error rates
- Track response times

**Database**:
```sql
-- Check processing status
SELECT processing_status, COUNT(*) 
FROM transcripts 
GROUP BY processing_status;

-- Check recent errors
SELECT * FROM transcripts 
WHERE processing_status = 'failed' 
ORDER BY created_at DESC 
LIMIT 10;
```

### 8. Update Dependencies

```bash
# Update packages
npm update

# Check for security issues
npm audit

# Fix security issues
npm audit fix
```

### 9. Backup Database

```bash
# Backup
pg_dump $DATABASE_URL > backup-$(date +%Y-%m-%d).sql

# Restore
psql $DATABASE_URL < backup-2026-02-13.sql
```

### 10. Clear Caches

**Product Knowledge Cache**:
```bash
# Trigger refresh
GET /api/airtable/refresh
```

**Streaming Config Cache**:
- Restart server to reload config files

---

## Troubleshooting

### Transcript Processing Stuck

**Check**:
1. Processing status in database
2. Processing locks (in-memory)
3. OpenAI API quota

**Fix**:
- Use retry button in UI
- Check logs for errors
- Verify API keys

### Slack Bot Not Responding

**Check**:
1. Webhook signature verification
2. Event deduplication
3. Slack API connectivity

**Fix**:
- Verify `SLACK_SIGNING_SECRET`
- Check logs for errors
- Test webhook endpoint

### AI Responses Poor Quality

**Check**:
1. Prompt configuration
2. Model assignments
3. Temperature settings

**Fix**:
- Update prompts in `server/config/prompts/`
- Adjust model in `server/config/models.ts`
- Test with sample queries

### Database Connection Issues

**Check**:
1. `DATABASE_URL` environment variable
2. Connection pool settings
3. Database availability

**Fix**:
- Verify connection string
- Check database logs
- Restart server

---

## Production Checklist

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] Slack webhook configured
- [ ] Airtable sync configured
- [ ] SSL certificate valid
- [ ] Domain DNS configured
- [ ] Backup system operational
- [ ] Monitoring enabled
- [ ] Error logging configured

---

**Last Updated**: February 13, 2026  
**Maintainer**: Development Team

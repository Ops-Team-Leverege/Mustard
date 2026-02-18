# System Documentation

**Last Updated**: February 13, 2026  

---

## Quick Links

- **[System Maintenance Guide](SYSTEM_MAINTENANCE.md)** - Complete reference for maintaining the system
- **[Visual System Diagrams](VISUAL_SYSTEM_DIAGRAMS.md)** - End-to-end flow diagrams
- **[System Conceptual Map](SYSTEM_CONCEPTUAL_MAP.md)** - Architecture overview
- **[Prompt Version Control](PROMPT_VERSION_CONTROL.md)** - Track prompt changes and user feedback
- **[Feedback System Setup](SETUP_FEEDBACK_SYSTEM.md)** - Setup guide for feedback system
- **[Feedback Quick Reference](FEEDBACK_QUICK_REFERENCE.md)** - Quick commands and queries

---

## What is Mustard and PitCrew Sauce?

Mustard is an AI-powered meeting intelligence platform that transforms customer conversations into searchable business insights. Upload a transcript, and the system automatically extracts product feedback, customer questions, and action items.

**Core Value**: Transforms meeting transcripts into actionable business intelligence  
**Interfaces**: Web dashboard + Slack bot  
**Processing Time**: 30-60 seconds per transcript

---

## System Overview

### Technology Stack
- **Frontend**: React 18 + TypeScript + Wouter
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Drizzle ORM
- **AI**: OpenAI (GPT-4o, GPT-5), Google Gemini
- **Integrations**: Slack API, Airtable, Replit Auth

### Core Capabilities
- ✅ Transcript processing and AI analysis
- ✅ Product insight extraction
- ✅ Customer Q&A database
- ✅ Action item tracking
- ✅ Company intelligence
- ✅ Slack bot integration -PitCrew Sauce
- ✅ Document generation
- ✅ Prompt version control and user feedback tracking

---

## Prompt Version Control & Feedback System

The system tracks which prompt versions generate each answer and collects user feedback via Slack reactions.

### For Users
React to bot messages with:
- 👍 or ✅ = Good answer
- ❌ or ⛔ = Bad answer

Negative feedback triggers notifications to the ops team for review.

### For Developers
- All prompts are versioned using date-based format: `YYYY-MM-DD-NNN`
- Prompt versions are logged with each interaction
- User feedback is stored and linked to prompt versions
- See [Prompt Version Control](PROMPT_VERSION_CONTROL.md) for full details

### Setup
```bash
# Apply database schema
npm run db:push

# Run backfill migration
tsx server/migrations/backfillPromptVersions.ts

# Update Slack app with reactions:read scope
# Subscribe to reaction_added events
```

See [Feedback System Setup](SETUP_FEEDBACK_SYSTEM.md) for complete instructions.

---

## Quick Start

### For Users

**Web Dashboard**:
1. Navigate to your deployed URL
2. Sign in with leverege.com email
3. Click "Add Transcript"
4. Fill in company, attendees, and transcript text
5. View results in 30-60 seconds

**Slack Bot**:
1. @mention @PitCrew in any channel
2. Ask questions like:
   - "What did Acme Corp ask about pricing?"
   - "Summarize the last meeting"
   - "What have customers said about our dashboard?"

### For Developers

**Setup**:
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run db:push

# Start development server
npm run dev
```

**Environment Variables**:
```bash
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
REPLIT_DOMAINS=your-domain.replit.dev
```

---

## Architecture

### Core Flow
```
Transcript Upload → AI Analysis → Extraction → Storage → Access (Web/Slack)
```

### Key Components
1. **Decision Layer**: Routes questions to appropriate handlers
2. **AI Processing**: Extracts insights, Q&A, action items
3. **Data Layer**: PostgreSQL with Drizzle ORM
4. **Services**: Document generation, deduplication, follow-up detection
5. **Integrations**: Slack, Airtable, OpenAI

See [Visual System Diagrams](VISUAL_SYSTEM_DIAGRAMS.md) for detailed flows.

---

## Documentation Structure

### Primary Documentation
- **[SYSTEM_MAINTENANCE.md](SYSTEM_MAINTENANCE.md)** - Complete maintenance guide
  - Directory structure
  - Configuration files
  - Key components
  - Common tasks
  - Troubleshooting

- **[VISUAL_SYSTEM_DIAGRAMS.md](VISUAL_SYSTEM_DIAGRAMS.md)** - Visual flows
  - Transcript upload flow
  - Slack interaction flow
  - System architecture

- **[SYSTEM_CONCEPTUAL_MAP.md](SYSTEM_CONCEPTUAL_MAP.md)** - Architecture overview
  - Core architecture layers
  - Data flow patterns
  - Production design principles

---

## Common Tasks

### Update AI Prompts
```
Location: server/config/prompts/
Files: decisionLayer.ts, transcript.ts, singleMeeting.ts
Process: Edit → Test → Deploy
```

### Retry Failed Transcripts
```
Web UI: Navigate to transcript → Click "Retry"
API: POST /api/transcripts/:id/retry
```

### Monitor System
```bash
# Check processing status
SELECT processing_status, COUNT(*) 
FROM transcripts 
GROUP BY processing_status;

# View recent errors
SELECT * FROM transcripts 
WHERE processing_status = 'failed' 
ORDER BY created_at DESC LIMIT 10;
```

### Database Migrations
```bash
# 1. Edit shared/schema.ts
# 2. Generate migration
npm run db:push
# 3. Verify changes
```

---

## Deployment Instructions for Replit

### Transcript UI Improvements Deployment (February 2026)

This deployment includes multi-company support, service tags bug fix, and Partnerships product features.

#### Prerequisites
- Replit environment with PostgreSQL database
- Access to Replit console
- Database backup recommended before deployment

#### Step 1: Pull Latest Code
```bash
# In Replit Shell
git pull origin main
```

#### Step 2: Install Dependencies
```bash
npm install
```

#### Step 3: Run Database Migrations
**IMPORTANT**: These migrations must be run in order.

```bash
# Migration 1: Create junction tables
# This creates transcript_companies and company_products tables
psql $DATABASE_URL -f migrations/0001_add_junction_tables.sql

# Migration 2: Populate junction tables from existing data
# This backfills data from legacy fields for backward compatibility
psql $DATABASE_URL -f migrations/0002_populate_junction_tables.sql
```

**Verify migrations succeeded**:
```bash
# Check that junction tables exist
psql $DATABASE_URL -c "\dt transcript_companies"
psql $DATABASE_URL -c "\dt company_products"

# Check that data was populated
psql $DATABASE_URL -c "SELECT COUNT(*) FROM transcript_companies;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM company_products;"
```

#### Step 4: Update Schema
```bash
# Push schema changes to database
npm run db:push
```

#### Step 5: Restart Application
In Replit:
1. Click "Stop" button
2. Click "Run" button
3. Wait for application to start

#### Step 6: Verify Deployment

**Backend Verification**:
```bash
# Test multi-company endpoint
curl -X GET "https://your-replit-url.replit.dev/api/companies" \
  -H "Cookie: your-session-cookie"

# Should return companies with proper product filtering
```

**Frontend Verification**:
1. Navigate to the web application
2. Click "Add Transcript"
3. Verify:
   - ✅ Company selector shows multi-select with badges
   - ✅ Meeting Name has red asterisk (required)
   - ✅ Meeting Date has red asterisk (required)
   - ✅ Can select multiple companies
   - ✅ Can remove companies by clicking X on badges

**Partnerships Product Verification**:
1. Switch product to "Partnerships" in product selector
2. Verify:
   - ✅ "Categories" tab is hidden
   - ✅ "Features" tab is hidden
   - ✅ "Product Insights" is hidden in Databases dropdown
   - ✅ Form title changes to "Add Partnership Meeting"
   - ✅ If you navigate to /categories, see empty state message

**Service Tags Verification**:
1. Create a transcript with service tags selected
2. Navigate to the company page
3. Verify:
   - ✅ Service tags appear in company record
   - ✅ Tags are deduplicated (no duplicates)

#### Step 7: Monitor for Issues

**Check logs for errors**:
```bash
# In Replit console, watch for:
# - Database connection errors
# - Migration errors
# - TypeScript compilation errors
# - Runtime errors during transcript creation
```

**Test transcript creation**:
1. Create a test transcript with multiple companies
2. Verify it processes successfully (status: "completed")
3. Check that junction table entries were created:
```bash
psql $DATABASE_URL -c "SELECT * FROM transcript_companies WHERE transcript_id = 'your-transcript-id';"
```

#### Rollback Instructions (If Needed)

If issues occur, rollback:

```bash
# 1. Revert code
git reset --hard HEAD~1

# 2. Drop junction tables (data will be lost)
psql $DATABASE_URL -c "DROP TABLE IF EXISTS transcript_companies CASCADE;"
psql $DATABASE_URL -c "DROP TABLE IF EXISTS company_products CASCADE;"

# 3. Restart application
# Click Stop → Run in Replit
```

#### Known Issues & Considerations

1. **Contacts Association**: Contacts are only created for the primary (first) company in multi-company transcripts. This is by design.

2. **Backward Compatibility**: Legacy single-company transcripts will continue to work. The system queries both legacy fields and junction tables.

3. **Partnerships Product**: Existing data is not affected. Only new transcripts created under Partnerships will skip product insights extraction.

4. **Migration Idempotency**: Migrations can be run multiple times safely. They use `ON CONFLICT DO NOTHING` to prevent duplicates.

#### Post-Deployment Checklist

- [ ] Migrations completed successfully
- [ ] Application restarted without errors
- [ ] Multi-company selector working in UI
- [ ] Required fields enforced (meeting name, date)
- [ ] Partnerships product tabs hidden correctly
- [ ] Service tags syncing to company records
- [ ] Test transcript created and processed successfully
- [ ] No errors in Replit console logs

#### Support

If issues arise:
1. Check Replit console logs for errors
2. Verify database migrations completed: `psql $DATABASE_URL -c "\dt"`
3. Check TypeScript compilation: `npm run check`
4. Review recent commits: `git log --oneline -5`

---

## Support

### Troubleshooting
See [SYSTEM_MAINTENANCE.md](SYSTEM_MAINTENANCE.md#troubleshooting) for common issues and solutions.
---

**Last Updated**: February 15, 2026  

# PitCrew Documentation

**Last Updated**: February 13, 2026  
**Status**: Production (10 users at Leverege)

---

## Quick Links

- **[System Maintenance Guide](SYSTEM_MAINTENANCE.md)** - Complete reference for maintaining the system
- **[Visual System Diagrams](VISUAL_SYSTEM_DIAGRAMS.md)** - End-to-end flow diagrams
- **[System Conceptual Map](SYSTEM_CONCEPTUAL_MAP.md)** - Architecture overview

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

### Additional Documentation
- **[security-implementation.md](../security-implementation.md)** - Security controls
- **[DOCUMENTATION_VALIDATION_REPORT.md](DOCUMENTATION_VALIDATION_REPORT.md)** - Validation results
- **[DOCUMENTATION_GAP_ANALYSIS_CORRECTED.md](DOCUMENTATION_GAP_ANALYSIS_CORRECTED.md)** - Gap analysis

### Archived Documentation
See `docs/archive/` for historical documentation:
- Developer Guide (detailed implementation guide)
- Maintenance Guide (vibecoding style)
- Error Handling Guide
- Various audit and cleanup reports

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

## Performance Metrics

- **Transcript Processing**: 30-60 seconds
- **Slack Response**: 8-20 seconds average
- **Web UI**: Sub-second operations
- **Uptime**: 99.9% target
- **Concurrent Users**: 10 tested, scalable to 25+

---

## Production Checklist

- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Slack webhook configured
- [ ] Airtable sync configured
- [ ] SSL certificate valid
- [ ] Backup system operational
- [ ] Monitoring enabled

---

## Support

### Troubleshooting
See [SYSTEM_MAINTENANCE.md](SYSTEM_MAINTENANCE.md#troubleshooting) for common issues and solutions.

### Contact
- **Development Team**: Internal Leverege team
- **Documentation**: This repository

---

**Last Updated**: February 13, 2026  
**Version**: Production v1.0  
**Status**: ✅ LIVE

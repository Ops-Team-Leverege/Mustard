# PitCrew Meeting Intelligence Platform - Documentation

## Overview

PitCrew is a **production-ready** AI-powered meeting intelligence platform that transforms customer conversations into searchable business insights. The system automatically extracts product feedback, customer questions, action items, and business intelligence from meeting transcripts, making them instantly accessible through web dashboard and Slack bot interfaces.

**Production Status**: ✅ **LIVE** - Deployed for 10 users at Leverege (February 2026)
**Core Value**: Transforms meeting transcripts into actionable business intelligence
**Interfaces**: Web dashboard + Slack bot for real-time meeting intelligence

---

## 📋 Documentation Index

### 🚀 **Production System**
- **[System Architecture Overview](SYSTEM_CONCEPTUAL_MAP.md)** - Complete system architecture and data flow
- **[Visual Process Diagrams](VISUAL_SYSTEM_DIAGRAMS.md)** - User workflows and system processes
- **[Production Readiness Checklist](PRODUCTION_READINESS_CHECKLIST.md)** - Deployment verification and monitoring

### 💼 **Business Processes**
- **[User Workflows](#user-workflows)** - How users interact with the system
- **[Meeting Intelligence Process](#meeting-intelligence-process)** - Transcript to insights pipeline
- **[Slack Bot Capabilities](#slack-bot-capabilities)** - Real-time meeting intelligence

### 🔧 **Technical Implementation**
- **[Security Implementation](../security-implementation.md)** - Security controls and compliance
- **[Design Guidelines](../design_guidelines.md)** - UI/UX standards and patterns
- **[Performance Metrics](#performance-metrics)** - System performance and optimization

---

## 🎯 **What PitCrew Does**

### **Meeting Intelligence Pipeline**
PitCrew transforms raw meeting transcripts into structured business intelligence through an automated AI pipeline:

```
Meeting Transcript Upload
        ↓
AI Analysis & Extraction
        ↓
Searchable Business Intelligence
        ↓
Real-time Access via Web + Slack
```

### **Core Capabilities**
- ✅ **Transcript Processing**: Converts meeting notes into structured insights
- ✅ **Product Intelligence**: Extracts feature requests and customer feedback
- ✅ **Customer Q&A Database**: High-trust extraction of customer questions with evidence
- ✅ **Action Item Tracking**: Identifies commitments and follow-up tasks
- ✅ **Company Intelligence**: Builds comprehensive customer profiles
- ✅ **Slack Integration**: Real-time meeting intelligence via bot
- ✅ **Document Generation**: Creates summaries, comparisons, and follow-up emails

---

## 🎯 **What PitCrew Does - Business Process Diagrams**

### **Meeting Intelligence Transformation Process**

```mermaid
graph TD
    A[Raw Meeting Transcript] --> B[AI Analysis Pipeline]
    B --> C[Product Insights Extraction]
    B --> D[Customer Q&A Generation]
    B --> E[Action Items Detection]
    B --> F[Company Intelligence Building]
    
    C --> G[Feature Mentions with Context]
    C --> H[Customer Feedback & Pain Points]
    C --> I[Direct Customer Quotes]
    
    D --> J[Customer Questions with Evidence]
    D --> K[Answers with Speaker Attribution]
    D --> L[High-Trust Verification Layer]
    
    E --> M[Commitments & Follow-ups]
    E --> N[Deadlines & Owners]
    E --> O[Confidence Scoring]
    
    F --> P[Meeting History & Trends]
    F --> Q[Contact Information & Roles]
    F --> R[Technology Stack Detection]
    
    G --> S[Searchable Business Intelligence]
    H --> S
    I --> S
    J --> S
    K --> S
    L --> S
    M --> S
    N --> S
    O --> S
    P --> S
    Q --> S
    R --> S
    
    S --> T[Web Dashboard Access]
    S --> U[Slack Bot Queries]
    S --> V[Document Generation]
    
    classDef input fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef process fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef output fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef access fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    
    class A input
    class B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R process
    class S output
    class T,U,V access
```

### **User Value Creation Process**

```mermaid
graph TD
    A[Business Meeting Occurs] --> B[User Uploads Transcript]
    B --> C[30-60 Second AI Processing]
    C --> D[Structured Business Intelligence Created]
    
    D --> E[Product Team Benefits]
    D --> F[Sales Team Benefits]
    D --> G[Customer Success Benefits]
    D --> H[Leadership Benefits]
    
    E --> E1[Feature Request Tracking]
    E --> E2[Customer Pain Point Analysis]
    E --> E3[Product Roadmap Insights]
    
    F --> F1[Customer Objection Patterns]
    F --> F2[Competitive Intelligence]
    F --> F3[Value Proposition Refinement]
    
    G --> G1[Customer Health Monitoring]
    G --> G2[Follow-up Task Tracking]
    G --> G3[Relationship History]
    
    H --> H1[Cross-Customer Trend Analysis]
    H --> H2[Market Intelligence]
    H --> H3[Strategic Decision Support]
    
    E1 --> I[Instant Access via Slack & Web]
    E2 --> I
    E3 --> I
    F1 --> I
    F2 --> I
    F3 --> I
    G1 --> I
    G2 --> I
    G3 --> I
    H1 --> I
    H2 --> I
    H3 --> I
    
    I --> J[Business Impact]
    J --> J1[Faster Product Decisions]
    J --> J2[Improved Sales Conversations]
    J --> J3[Better Customer Relationships]
    J --> J4[Data-Driven Strategy]
    
    classDef trigger fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef process fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef benefits fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef access fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef impact fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class A,B trigger
    class C,D process
    class E,F,G,H,E1,E2,E3,F1,F2,F3,G1,G2,G3,H1,H2,H3 benefits
    class I access
    class J,J1,J2,J3,J4 impact
```

### **Real-Time Intelligence Access Process**

```mermaid
graph TD
    A[User Has Business Question] --> B{Access Method?}
    
    B -->|Slack Bot| C[@mention PitCrew in Slack]
    B -->|Web Dashboard| D[Navigate to Web Interface]
    
    C --> E[Decision Layer Classifies Intent]
    D --> F[Browse or Search Interface]
    
    E --> G{Question Type?}
    G -->|Specific Meeting| H[Single Meeting Analysis]
    G -->|Cross-Meeting Pattern| I[Multi-Meeting Analysis]
    G -->|Product Knowledge| J[Product Database Query]
    
    F --> K{Browse Type?}
    K -->|Company Focus| L[Customer Intelligence View]
    K -->|Topic Research| M[Category & Feature Analysis]
    K -->|Recent Activity| N[Latest Meetings & Insights]
    
    H --> O[Extract from Meeting Transcript]
    I --> P[Search Across All Meetings]
    J --> Q[Access Product Knowledge Base]
    
    L --> R[Company Profile & History]
    M --> S[Topic-Based Intelligence]
    N --> T[Recent Activity Feed]
    
    O --> U[Response with Evidence Links]
    P --> U
    Q --> U
    R --> V[Detailed Company View]
    S --> V
    T --> V
    
    U --> W[Slack Thread Response]
    U --> X[Optional Document Generation]
    V --> Y[Web Dashboard Display]
    
    W --> Z[User Can Ask Follow-ups]
    X --> Z
    Y --> Z
    
    Z --> AA[Business Decision Made]
    AA --> AB[Improved Customer Outcome]
    
    classDef user fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef system fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef analysis fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef output fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef impact fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class A,B,C,D user
    class E,F,G,K system
    class H,I,J,L,M,N,O,P,Q,R,S,T analysis
    class U,V,W,X,Y,Z output
    class AA,AB impact
```

---

## 👥 **User Workflows**

### **Workflow 1: Upload & Analyze Meeting**
```mermaid
graph TD
    A[User uploads transcript via Web UI] --> B[System creates transcript record]
    B --> C[Returns 202 Accepted immediately]
    C --> D[Background AI processing starts]
    D --> E[Extract product insights]
    E --> F[Extract Q&A pairs]
    F --> G[Identify action items]
    G --> H[Create searchable chunks]
    H --> I[Results appear in Web UI]
    I --> J[Available for Slack queries]
```

**User Experience**:
1. Navigate to web dashboard
2. Click "Add Transcript" 
3. Fill in company name, attendees, transcript text
4. Click "Analyze Transcript"
5. See processing status and results as they appear
6. Browse insights, Q&A, and action items

### **Workflow 2: Ask Questions via Slack**
```mermaid
graph TD
    A[User @mentions PitCrew bot] --> B[Decision Layer classifies intent]
    B --> C{Intent Type?}
    C -->|Single Meeting| D[Find specific meeting]
    C -->|Multi-Meeting| E[Search across meetings]
    C -->|Product Knowledge| F[Access product database]
    D --> G[Extract relevant information]
    E --> G
    F --> G
    G --> H[Generate response with citations]
    H --> I[Post to Slack thread]
    I --> J[Generate document if needed]
```

**User Experience**:
1. @mention @PitCrew in Slack channel or DM
2. Ask question: "What did Acme Corp ask about pricing?"
3. Bot acknowledges and shows progress
4. Receive answer with links to source transcripts
5. Get Word document for complex responses

### **Workflow 3: Browse Intelligence via Web**
```mermaid
graph TD
    A[User opens web dashboard] --> B{What to explore?}
    B -->|Latest Activity| C[View recent meetings and insights]
    B -->|Company Focus| D[Browse specific customer]
    B -->|Topic Research| E[Search by category or feature]
    B -->|Q&A Database| F[Browse customer questions]
    C --> G[Click for detailed view]
    D --> G
    E --> G
    F --> G
    G --> H[See full context with transcript links]
```

---

## 🤖 **Meeting Intelligence Process**

### **AI Processing Pipeline**
When a transcript is uploaded, PitCrew runs a sophisticated AI analysis pipeline:

```mermaid
graph TD
    A[Transcript Upload] --> B[AI Analysis - gpt-4o]
    B --> C[Product Insights Extraction]
    B --> D[Q&A Pairs Extraction]
    B --> E[POS System Detection]
    
    C --> F[Match to Product Categories]
    D --> G[Link to Contact Records]
    E --> H[Company Profile Update]
    
    F --> I[Transcript Chunking for RAG]
    G --> I
    H --> I
    
    I --> J[Customer Questions - High Trust Layer]
    J --> K[Resolution Pass - Verify Answers]
    K --> L[Action Items Extraction]
    L --> M[Results Available in UI & Slack]
```

### **What Gets Extracted**

**Product Insights**:
- Feature mentions with context
- Customer feedback and pain points
- Direct quotes from customers
- Categorized by product area

**Q&A Database**:
- Customer questions with exact wording
- Answers provided during meeting
- Speaker attribution
- Evidence quotes from transcript

**Action Items**:
- Commitments made by team members
- Customer requests and follow-ups
- Deadlines and owners
- Confidence scores

**Company Intelligence**:
- Meeting history and trends
- Contact information and roles
- Technology stack (POS systems)
- Business context and stage

---

## 💬 **Slack Bot Capabilities**

### **Question Types Supported**

**Single Meeting Queries** (with automatic meeting resolution):
- "What did we discuss in the last Costco meeting?"
- "What action items came out of yesterday's call?"
- "What questions did the customer ask?"
- "Summarize the meeting with Ace Hardware"

**Multi-Meeting Analysis** (cross-meeting intelligence):
- "What have all customers said about our dashboard?"
- "Show me pricing concerns from the last quarter"
- "Compare feedback from retail vs restaurant customers"
- "What patterns are we seeing in customer objections?"

**Product Knowledge** (strategic advice):
- "What features does PitCrew offer for inventory management?"
- "How does our reporting compare to competitors?"
- "What's our value proposition for multi-location businesses?"
- "Help me think through how to approach this customer"

**Document Generation** (automated content creation):
- "Create a summary of the Acme Corp relationship"
- "Draft a follow-up email for the Starbucks meeting"
- "Compare feedback from our last 3 enterprise calls"
- "Prepare a slide deck for the retail prospect"

### **Smart Features**

**LLM-First Intent Classification**:
- Semantic understanding of user questions using GPT-4o
- Fast-path pattern matching for common queries
- Context-aware follow-up detection in threads

**Automatic Meeting Resolution**:
- Thread context awareness (remembers previous meeting discussions)
- Temporal language detection ("last meeting", "most recent call")
- Company name auto-resolution to most recent meeting
- Explicit meeting ID/link recognition

**Intelligent Scope Clarification**:
- Asks for time range when needed ("last month vs all time?")
- Clarifies customer scope ("all customers vs specific company?")
- Suggests specific options to avoid ambiguity
- Provides proposed interpretations for confirmation

**Evidence-Based Responses**:
- Always includes links to source transcripts
- Quotes exact customer statements with speaker attribution
- Shows confidence levels for extracted information
- High-trust verification layer for customer questions

**Streaming & Progress Updates**:
- Real-time response streaming for complex queries
- Personalized progress messages during processing
- Document generation with automatic file uploads
- Thread-based conversation continuity

---

## 📊 **Performance Metrics**

### **Production Performance (10 Users)**
- **Transcript Processing**: 30-60 seconds for AI analysis
- **Slack Response Time**: 8-10 seconds average
- **Product Knowledge**: 2-5 seconds (95%+ cache hit rate)
- **System Uptime**: 99.9% with health monitoring
- **Concurrent Users**: Tested for 10, scalable to 25+

### **AI Accuracy & Quality**
- **Customer Questions**: 95%+ accuracy with evidence verification
- **Product Insights**: Categorized with 90%+ relevance
- **Action Items**: Confidence scoring (0.7-1.0 range)
- **Speaker Attribution**: Automatic contact matching

### **Data Processing Volume**
- **Transcripts**: Handles 10,000+ word transcripts
- **Chunking**: Semantic splitting with speaker preservation
- **Search**: Sub-second retrieval across 100+ meetings
- **Storage**: Optimized PostgreSQL with connection pooling

---

## 👥 **User Onboarding Guide**

### Getting Started (5 minutes)
1. **Access the System**
   - Navigate to your deployed Replit URL
   - Sign in with your leverege.com email address
   - System will automatically authenticate via Replit OAuth

2. **First Transcript Upload**
   - Click "Add New Transcript" in the web dashboard
   - Fill in company name, transcript text, and attendee information
   - Click "Analyze Transcript" - processing takes 30-60 seconds
   - View extracted insights and Q&A pairs in the dashboard

3. **Slack Integration**
   - Add the PitCrew bot to your Slack workspace
   - Ask questions like "What did Acme Corp ask about pricing?"
   - Use @PitCrew for meeting-specific queries and product knowledge

### Key Features for Users
- **Transcript Analysis**: Upload meeting notes or transcripts for AI analysis
- **Product Knowledge**: Ask questions about PitCrew features and capabilities
- **Meeting Intelligence**: Search across all meetings for patterns and insights
- **Q&A Database**: Browse customer questions and responses
- **Category Management**: Organize insights by product features

### Best Practices
- **Transcript Quality**: Include speaker names for better analysis
- **Company Names**: Use consistent naming for better tracking
- **Meeting Context**: Add meeting date and attendee job titles when available
- **Follow-up Questions**: Use Slack for quick queries about specific meetings

---

## 🛠️ **Operational Procedures**

### Daily Operations
- **Health Check**: System automatically monitors via `/health` endpoint
- **Performance**: Monitor response times via structured logs
- **Backup**: Automated daily PostgreSQL backups
- **Updates**: Product knowledge cache rebuilds automatically on Airtable changes

### Troubleshooting Common Issues
1. **Slow Response Times**
   - Check product knowledge cache status
   - Verify Airtable sync is functioning
   - Review correlation IDs in logs for bottlenecks

2. **Authentication Issues**
   - Verify user has leverege.com email address
   - Check Replit OAuth configuration
   - Confirm REPLIT_DOMAINS environment variable

3. **Transcript Processing Failures**
   - Use "Retry" button in dashboard for failed transcripts
   - Check OpenAI API quota and billing
   - Review processing logs with correlation ID

### Monitoring & Alerts
- **Response Time**: Alert if >20 seconds average
- **Error Rate**: Alert if >5% of requests fail
- **Cache Performance**: Alert if hit rate <90%
- **System Health**: Automated uptime monitoring

---

## 📈 **Performance Optimization Results**
### ✅ **Product Knowledge Caching System** (January 29, 2026)
**Impact**: 6-19x performance improvement for product knowledge queries

**Key Changes**:
- New `pitcrewProductSnapshot` table for pre-computed product knowledge
- Response times improved from 30-95 seconds to 2-5 seconds
- Automatic cache rebuilding on Airtable data changes
- Fast path (1 query) vs slow path (5 queries) architecture

### ✅ **Structured Logging Infrastructure** (January 28, 2026)
**Impact**: Complete observability and performance monitoring

**Key Features**:
- Correlation IDs for request tracing
- Stage timing for performance analysis
- Log level filtering via environment variables
- Daily log rotation with structured JSON format

### ✅ **Production Readiness Optimizations** (February 2026)
**Impact**: System ready for 10-user deployment

**Completed**:
- Health check endpoint for monitoring
- Rate limiting on authentication endpoints
- Comprehensive error handling and recovery
- Security hardening with CSRF protection
- Performance monitoring and alerting

---

## 📊 **Production Performance Metrics**

### Production Performance (Optimized for 10 Users)
- **Product Knowledge Queries**: 2-5 seconds (6-19x improvement)
- **Average Response Time**: 8-10 seconds (47% improvement)
- **Cache Hit Rate**: 95%+ for product knowledge
- **Intent Classification**: ~350ms average (59% improvement)
- **System Uptime**: 99.9% with health monitoring
- **Concurrent Users**: Tested for 10, scalable to 25+

### Architecture Highlights
- **Single Instance Deployment**: Optimized for small-scale production use
- **LLM-First Intent Classification**: Semantic understanding with performance optimization
- **Decision Layer Architecture**: Intent Router + Orchestrator with Answer Contracts
- **Performance-Optimized Data Access**: Pre-computed caches with intelligent fallbacks
- **Comprehensive Observability**: Request tracing, stage timing, and performance monitoring
- **Production Security**: CSRF protection, rate limiting, and domain restrictions

---

## 🔍 **Production System Components**

### Decision Layer (Intent Router + Orchestrator)
- **Intent Classification**: GPT-4o powered semantic understanding with fast-path patterns
- **Context Layer Computation**: Determines data access permissions based on intent
- **Answer Contract Selection**: Maps intents to execution contracts with validation
- **LLM-First Architecture**: Semantic understanding with performance optimization

### AI Processing Pipeline
- **Single Meeting Orchestrator**: Direct artifact access for specific meeting queries
- **Open Assistant Handler**: Multi-meeting analysis and product knowledge with streaming
- **External Research Handler**: Web research integration with Google Gemini
- **Transcript Analyzer**: AI-powered extraction of insights, Q&A pairs, and action items

### Data Layer
- **PostgreSQL**: Meeting data with optimized queries and connection pooling
- **Product Knowledge Cache**: Pre-computed snapshots for 6-19x performance improvement
- **Airtable Integration**: Real-time sync with automatic cache rebuilding
- **Semantic Chunking**: RAG-optimized transcript segmentation with speaker preservation

---

## 🛠️ **Production Environment Setup**

### Required Environment Variables
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:port/database

# Authentication
REPLIT_DOMAINS=your-domain.replit.dev,your-custom-domain.com
SESSION_SECRET=your-secure-random-string-32-chars-min
REPL_ID=your-replit-app-id

# AI Services
OPENAI_API_KEY=sk-your-openai-api-key
GEMINI_API_KEY=your-google-gemini-api-key

# External Integrations
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
AIRTABLE_API_KEY=your-airtable-api-key

# Optional Configuration
NODE_ENV=production
LOG_LEVEL=info
PORT=5000
```

### Deployment Checklist
- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] Health check endpoint responding
- [ ] Slack bot permissions configured
- [ ] Airtable webhook configured
- [ ] SSL certificate valid
- [ ] Domain DNS configured
- [ ] Backup system operational

### Health Monitoring
```bash
# Check system health
curl https://your-domain.com/health

# Expected response
{"status":"ok","timestamp":"2026-02-03T10:30:00.000Z"}
```

---

## 📞 **Production Support**

### User Support
- **Getting Started**: Follow the User Onboarding Guide above
- **Common Issues**: Check Operational Procedures section
- **Feature Requests**: Contact development team via Slack

### Technical Support
- **System Status**: Monitor health endpoint and structured logs
- **Performance Issues**: Check correlation IDs and stage timing
- **Data Issues**: Review audit trail in interaction logs
- **Security Concerns**: Verify domain restrictions and authentication

### Emergency Procedures
- **System Down**: Check health endpoint, restart if needed
- **Data Loss**: Restore from automated daily backups
- **Security Incident**: Disable authentication, investigate logs
- **Performance Degradation**: Check cache hit rates and external API status

---

This documentation provides comprehensive guidance for operating PitCrew in production with 10 users. The system is optimized for reliability, performance, and ease of use while maintaining enterprise-grade security and monitoring capabilities.
# Visual System Diagrams - End-to-End Flows

**Last Updated**: February 13, 2026  
**Purpose**: Visual representation of core system flows

---

## Table of Contents
1. [Transcript Upload Flow](#transcript-upload-flow)
2. [Slack User Interaction Flow](#slack-user-interaction-flow)
3. [System Architecture Overview](#system-architecture-overview)

---

## Transcript Upload Flow

### Complete End-to-End Process

```mermaid
graph TB
    Start([User Opens Web Dashboard]) --> Upload[Click 'Add Transcript']
    Upload --> Form[Fill Form:<br/>Company, Attendees, Text]
    Form --> Submit[Click 'Analyze Transcript']
    
    Submit --> API[POST /api/transcripts]
    API --> CreateRecord[Create Transcript Record<br/>Status: PENDING]
    CreateRecord --> Return202[Return 202 Accepted<br/>Redirect to Detail Page]
    
    Return202 --> Background[Background Processing Starts]
    
    Background --> UpdateStatus1[Update Status: PROCESSING]
    UpdateStatus1 --> AIAnalysis[AI Analysis<br/>gpt-4o/gpt-5]
    
    AIAnalysis --> Extract1[Extract Product Insights]
    AIAnalysis --> Extract2[Extract Q&A Pairs]
    AIAnalysis --> Extract3[Detect POS Systems]
    
    Extract1 --> SaveDB1[(Save to Database)]
    Extract2 --> SaveDB1
    Extract3 --> SaveDB1
    
    SaveDB1 --> Chunking[Transcript Chunking<br/>Semantic Splits]
    Chunking --> ParseTurns[Parse Speaker Turns]
    ParseTurns --> AssignRoles[Assign Speaker Roles<br/>leverege/customer/unknown]
    AssignRoles --> CreateChunks[Create Semantic Chunks]
    CreateChunks --> SaveChunks[(Save Chunks to DB)]
    
    SaveChunks --> HighTrust[Customer Questions<br/>High-Trust Extraction]
    HighTrust --> ActionItems[Action Items<br/>Extraction]
    ActionItems --> SaveArtifacts[(Save Artifacts)]
    
    SaveArtifacts --> Complete[Update Status: COMPLETED]
    Complete --> UIUpdate[UI Shows Results]
    UIUpdate --> End([User Views Insights])
    
    classDef user fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef api fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef ai fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef db fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    
    class Start,Upload,Form,Submit,End user
    class API,CreateRecord,Return202,Background,UpdateStatus1,Complete,UIUpdate api
    class AIAnalysis,Extract1,Extract2,Extract3,Chunking,ParseTurns,AssignRoles,CreateChunks,HighTrust,ActionItems ai
    class SaveDB1,SaveChunks,SaveArtifacts db
```

**Key Steps**:
1. **User Input** (1-2 seconds): User fills form and submits
2. **Immediate Response** (< 1 second): System returns 202 Accepted, creates PENDING record
3. **AI Analysis** (20-40 seconds): Extract insights, Q&A, POS systems
4. **Chunking** (5-10 seconds): Parse and create semantic chunks
5. **Artifact Extraction** (10-20 seconds): Customer questions, action items
6. **Completion** (< 1 second): Update status, show results

**Total Time**: 30-60 seconds for complete processing

---

## Slack User Interaction Flow

### Complete End-to-End Process

```mermaid
graph TB
    Start([User @mentions Bot in Slack]) --> Webhook[Slack Webhook Triggered]
    Webhook --> Verify[Verify Signature]
    Verify --> Dedupe{Duplicate<br/>Event?}
    
    Dedupe -->|Yes| Ignore[Ignore Event]
    Dedupe -->|No| Ack[Send Acknowledgment<br/>'On it!']
    
    Ack --> Decision[Decision Layer]
    
    Decision --> Intent[Intent Classification<br/>LLM + Patterns]
    Intent --> Context[Context Layers<br/>What data to access?]
    Context --> Contract[Answer Contract<br/>How to respond?]
    
    Contract --> Route{Route to<br/>Handler}
    
    Route -->|SINGLE_MEETING| Meeting[Single Meeting<br/>Orchestrator]
    Route -->|MULTI_MEETING| Open[Open Assistant<br/>Handler]
    Route -->|PRODUCT_KNOWLEDGE| Open
    Route -->|EXTERNAL_RESEARCH| Open
    Route -->|SLACK_SEARCH| Open
    Route -->|GENERAL_HELP| Open
    Route -->|CLARIFY| Clarify[Ask for<br/>Clarification]
    
    Meeting --> ResolveMeeting[Resolve Meeting<br/>from thread/message]
    ResolveMeeting --> GetData1[(Get Meeting Data)]
    GetData1 --> Execute1[Execute Contract]
    
    Open --> GetData2[(Search/Query Data)]
    GetData2 --> Execute2[Execute Contract Chain]
    
    Execute1 --> Generate[Generate Response]
    Execute2 --> Generate
    Clarify --> Generate
    
    Generate --> Document{Generate<br/>Document?}
    
    Document -->|Yes| CreateDoc[Create Word Doc<br/>with Branding]
    Document -->|No| TextOnly[Text Response Only]
    
    CreateDoc --> Upload[Upload to Slack]
    TextOnly --> Post[Post to Slack Thread]
    Upload --> Post
    
    Post --> Log[Log Interaction<br/>with Correlation ID]
    Log --> End([User Sees Response])
    
    classDef user fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef slack fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef handler fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef output fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class Start,End user
    class Webhook,Verify,Dedupe,Ignore,Ack,Post,Upload slack
    class Decision,Intent,Context,Contract,Route decision
    class Meeting,Open,ResolveMeeting,GetData1,GetData2,Execute1,Execute2,Clarify handler
    class Generate,Document,CreateDoc,TextOnly,Log output
```

**Key Steps**:
1. **Webhook** (< 100ms): Receive event, verify signature, deduplicate
2. **Acknowledgment** (< 200ms): Send "On it!" message to user
3. **Decision Layer** (300-500ms): Classify intent, determine context, select contract
4. **Handler Execution** (5-15 seconds): 
   - Single Meeting: Direct data retrieval
   - Open Assistant: Search, analysis, synthesis
5. **Response Generation** (2-5 seconds): Format response, optionally create document
6. **Delivery** (< 1 second): Post to Slack, log interaction

**Total Time**: 8-20 seconds average (varies by query complexity)

---

## System Architecture Overview

### High-Level Component Interaction

```mermaid
graph TB
    subgraph "User Interfaces"
        Web[Web Dashboard<br/>React + TypeScript]
        Slack[Slack Bot<br/>@mentions & DMs]
    end
    
    subgraph "API Layer"
        Routes[Express Routes<br/>Authentication & Validation]
        Auth[Replit OAuth<br/>leverege.com only]
    end
    
    subgraph "Decision Layer"
        Intent[Intent Classification<br/>8 Intent Types]
        Context[Context Layers<br/>Data Access Control]
        Contract[Answer Contracts<br/>30+ Response Formats]
    end
    
    subgraph "Processing Layer"
        Single[Single Meeting<br/>Orchestrator]
        Multi[Open Assistant<br/>Handler]
        Analyzer[Transcript<br/>Analyzer]
        Ingestion[Ingestion<br/>Chunking System]
    end
    
    subgraph "Services Layer"
        DocGen[Document<br/>Generator]
        Dedupe[Event<br/>Deduplicator]
        FollowUp[Follow-Up<br/>Detector]
        SlackSearch[Slack Search<br/>Service]
    end
    
    subgraph "Data Layer"
        DB[(PostgreSQL<br/>Drizzle ORM)]
        Storage[Storage<br/>Abstraction]
    end
    
    subgraph "External Services"
        OpenAI[OpenAI<br/>gpt-4o, gpt-5]
        Gemini[Google Gemini<br/>Web Research]
        Airtable[Airtable<br/>Product Knowledge]
        SlackAPI[Slack API<br/>Messages & Files]
    end
    
    Web --> Routes
    Slack --> Routes
    Routes --> Auth
    
    Routes --> Intent
    Intent --> Context
    Context --> Contract
    Contract --> Single
    Contract --> Multi
    
    Routes --> Analyzer
    Analyzer --> Ingestion
    
    Single --> Storage
    Multi --> Storage
    Analyzer --> Storage
    Ingestion --> Storage
    
    Multi --> DocGen
    Slack --> Dedupe
    Intent --> FollowUp
    Multi --> SlackSearch
    
    Storage --> DB
    
    Analyzer --> OpenAI
    Single --> OpenAI
    Multi --> OpenAI
    Multi --> Gemini
    Storage --> Airtable
    Slack --> SlackAPI
    DocGen --> SlackAPI
    
    classDef interface fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef core fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef service fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef data fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef external fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class Web,Slack interface
    class Routes,Auth,Intent,Context,Contract,Single,Multi,Analyzer,Ingestion core
    class DocGen,Dedupe,FollowUp,SlackSearch service
    class DB,Storage data
    class OpenAI,Gemini,Airtable,SlackAPI external
```

**Component Responsibilities**:

- **User Interfaces**: Web dashboard and Slack bot for user interaction
- **API Layer**: Authentication, routing, validation
- **Decision Layer**: Intent classification, context determination, contract selection
- **Processing Layer**: Query execution, transcript analysis, data extraction
- **Services Layer**: Supporting services (documents, deduplication, follow-ups)
- **Data Layer**: Database access and storage abstraction
- **External Services**: AI models, product knowledge, Slack API

---

## Data Flow Patterns

### Pattern 1: Transcript Processing
```
Upload → Create Record → Background Job → AI Analysis → Extraction → Chunking → Artifacts → Complete
```

### Pattern 2: Slack Query (Single Meeting)
```
@mention → Decision Layer → Meeting Resolution → Direct Retrieval → Response → Post
```

### Pattern 3: Slack Query (Multi-Meeting)
```
@mention → Decision Layer → Search → Contract Chain → Synthesis → Response → Post
```

### Pattern 4: Product Knowledge
```
Query → Decision Layer → Airtable Cache → Format → Response
```

---

**Last Updated**: February 13, 2026  
**Purpose**: Visual reference for system flows and architecture

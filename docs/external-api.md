# PitCrew Transcript API - Integration Instructions

## Authentication
All requests require an API key in the `x-api-key` header.

## Base URL
`https://pitcrew-transcript-analyzer.replit.app`

---

## Endpoint 1: List Transcripts

**Request:**
```
GET /api/external/transcripts
```

**Headers:**
```
x-api-key: <API_KEY>
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `companyName` | string | No | Filter by company name (partial match, case-insensitive) |
| `companyId` | UUID | No | Filter by exact company ID |
| `status` | string | No | Filter by processingStatus: "pending", "processing", "completed", "failed" |
| `product` | string | No | Product scope (default: "pitcrew") |
| `limit` | integer | No | Max results 1-500 (default: 100) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response:**
```json
{
  "success": true,
  "total": 42,
  "count": 10,
  "offset": 0,
  "limit": 100,
  "transcripts": [
    {
      "id": "uuid",
      "companyId": "uuid",
      "title": "string",
      "status": "completed",
      "meetingDate": "2025-11-13T00:00:00.000Z",
      "createdAt": "2025-11-14T10:30:00.000Z"
    }
  ]
}
```

---

## Endpoint 2: Get Transcript Details

**Request:**
```
GET /api/external/transcripts/:id
```

**Headers:**
```
x-api-key: <API_KEY>
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | UUID | Yes | The transcript ID |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `product` | string | No | Product scope (default: "pitcrew") |

**Response:**
```json
{
  "success": true,
  "transcript": {
    "id": "uuid",
    "companyId": "uuid",
    "title": "Meeting Title",
    "content": "Full transcript text...",
    "status": "completed",
    "meetingDate": "2025-11-13T00:00:00.000Z",
    "createdAt": "2025-11-14T10:30:00.000Z"
  },
  "company": {
    "id": "uuid",
    "name": "Company Name",
    "stage": "prospect"
  },
  "insights": [
    {
      "id": "uuid",
      "content": "Key insight from the meeting",
      "categoryId": "uuid",
      "categoryName": "Feature Request"
    }
  ],
  "qaPairs": [
    {
      "id": "uuid",
      "question": "What was asked?",
      "answer": "What was answered",
      "askedBy": "Customer Name"
    }
  ],
  "customerQuestions": [
    {
      "id": "uuid",
      "questionText": "Verbatim question from customer",
      "askedByName": "Speaker Name",
      "status": "answered",
      "answerEvidence": "Evidence from transcript"
    }
  ],
  "actionItems": [
    {
      "id": "uuid",
      "description": "Action item description",
      "owner": "Person Name",
      "status": "open"
    }
  ],
  "chunks": [
    {
      "chunkIndex": 0,
      "speakerName": "John Doe",
      "speakerRole": "Customer",
      "content": "Transcript segment text..."
    }
  ]
}
```

---

## Example Workflow

### Step 1: Find transcripts for a company
```bash
curl -X GET \
  -H "x-api-key: YOUR_API_KEY" \
  "https://pitcrew-transcript-analyzer.replit.app/api/external/transcripts?companyName=Canadian%20Tire&status=completed"
```

### Step 2: Get full details for a specific transcript
```bash
curl -X GET \
  -H "x-api-key: YOUR_API_KEY" \
  "https://pitcrew-transcript-analyzer.replit.app/api/external/transcripts/2cf1f6a6-14c2-4de7-a9d9-92a8ac428a8b"
```

---

## Error Responses

| Status Code | Meaning |
|-------------|---------|
| 401 | Invalid or missing API key |
| 404 | Transcript not found |
| 400 | Invalid request parameters |
| 500 | Server error |

**Error Response Format:**
```json
{
  "success": false,
  "error": "Error message description"
}
```

---

## Data Definitions

### Transcript Status Values
- `pending` - Awaiting processing
- `processing` - Currently being analyzed
- `completed` - Successfully processed
- `failed` - Processing failed

### Customer Question Status Values
- `answered` - Question was answered in the meeting
- `unanswered` - Question was not answered
- `partial` - Partially answered

### Company Stage Values
- `prospect` - Early stage prospect
- `qualified` - Qualified lead
- `pilot` - In pilot phase
- `customer` - Active customer

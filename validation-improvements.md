# Input Validation Improvements Needed

## Endpoints Missing Validation:

### PATCH Endpoints (High Priority):
- `PATCH /api/transcripts/:id` - No validation on request body
- `PATCH /api/insights/:id` - Manual validation, should use Zod
- `PATCH /api/qa-pairs/:id` - Manual validation, should use Zod  
- `PATCH /api/categories/:id` - Manual validation, should use Zod
- `PATCH /api/features/:id` - Manual validation, should use Zod
- `PATCH /api/companies/:id` - Manual validation, should use Zod
- `PATCH /api/contacts/:id` - Manual validation, should use Zod
- `PATCH /api/pos-systems/:id` - Manual validation, should use Zod

### Query Parameter Validation:
- External API endpoints need query param validation
- Search endpoints need query validation
- Pagination parameters need validation

## Recommended Implementation:

```typescript
// Add to server/middleware/validation.ts
export const updateTranscriptSchema = z.object({
  name: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  mainMeetingTakeaways: z.string().optional(),
  nextSteps: z.string().optional(),
  supportingMaterials: z.array(z.string()).optional(),
  transcript: z.string().optional()
});

// Usage in routes:
app.patch("/api/transcripts/:id", 
  isAuthenticated, 
  validate({ 
    params: commonSchemas.transcriptId,
    body: updateTranscriptSchema 
  }), 
  async (req, res) => {
    // Request is now validated
  }
);
```
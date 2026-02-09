# Error Handling Strategy

## Philosophy

Following "A Philosophy of Software Design" by John Ousterhout:
**Define errors out of existence** - design systems that minimize error cases rather than handling every edge case.

## Current Patterns (What Exists)

### 1. **Throw Errors** - For Critical Failures
Used when the operation cannot continue and caller must handle it.

```typescript
// Example: Missing required data
if (!transcript) {
  throw new Error(`Transcript not found for meeting ${meetingId}`);
}
```

**When to use**: Data integrity issues, configuration errors, unrecoverable states

### 2. **Return Null** - For Optional Data
Used when absence of data is a valid state.

```typescript
// Example: Optional company extraction
const company = await extractCompanyFromMessage(message);
if (!company) {
  // Continue without company context
}
```

**When to use**: Optional lookups, graceful degradation scenarios

### 3. **Return Error Objects** - For Expected Failures
Used when failure is part of normal flow.

```typescript
// Example: Meeting resolution
if (resolution.needsClarification) {
  return { needsClarification: true, message: "Which meeting?" };
}
```

**When to use**: User input validation, ambiguous queries, clarification needed

### 4. **Log and Continue** - For Non-Critical Failures
Used when operation can proceed despite error.

```typescript
// Example: Progress message failure
try {
  await postProgressMessage();
} catch (err) {
  console.error("Progress message failed:", err);
  // Continue - progress messages are nice-to-have
}
```

**When to use**: Telemetry, progress updates, non-essential features

## Guidelines for Maintainers

### Adding New Code

**Ask yourself**: "What happens if this fails?"

1. **Must succeed for system to work?** → Throw error
2. **Optional enhancement?** → Log and continue
3. **User needs to clarify?** → Return error object
4. **Data might not exist?** → Return null

### Debugging Errors

**Check these locations**:
- `server/slack/events.ts` - Main error boundary for Slack events
- `server/openAssistant/openAssistantHandler.ts` - Open Assistant errors
- `server/decisionLayer/index.ts` - Decision Layer errors

**Common issues**:
- Missing environment variables → Check `.env` file
- Database connection → Check `DATABASE_URL`
- API timeouts → Check `server/config/constants.ts` for timeout values

## What NOT to Do

❌ **Don't catch and ignore errors silently**
```typescript
// BAD
try {
  await criticalOperation();
} catch {}  // Silent failure!
```

❌ **Don't add try-catch everywhere "just in case"**
```typescript
// BAD - adds complexity without value
try {
  const x = 1 + 1;  // This can't fail!
} catch (err) {
  console.error(err);
}
```

❌ **Don't create custom error classes for every scenario**
```typescript
// BAD - over-engineering
class TranscriptNotFoundError extends Error {}
class MeetingNotFoundError extends Error {}
class CompanyNotFoundError extends Error {}
// Just use Error with descriptive messages!
```

## Ousterhout's Wisdom Applied

> "The best way to reduce bugs is to make them impossible by design."

**Examples in our codebase**:

1. **TypeScript prevents type errors** - No need to handle wrong types
2. **Database constraints prevent bad data** - No need to validate in code
3. **Decision Layer always provides contract** - No need for fallback logic
4. **Constants file prevents magic numbers** - No need to hunt for values

**The goal**: Write code where errors are rare, not code that handles every possible error.

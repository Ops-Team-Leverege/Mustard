# Design Document

## Introduction

This design document outlines the implementation approach for Phase 2 maintainability improvements, building on the successful constants extraction from Phase 1. The focus is on database query standardization, type safety enhancements, centralized error handling, configuration management, and logging standardization.

## Architecture Overview

The improvements will be implemented across multiple layers:

1. **Database Layer**: Standardize all queries using Drizzle ORM
2. **Type System**: Eliminate `as any` and implement proper type guards
3. **Error Handling**: Centralized error types and middleware
4. **Configuration**: Unified configuration management system
5. **Logging**: Structured logging with consistent patterns

## Design Decisions

### 1. Database Query Standardization

**Approach**: Convert all raw SQL queries to Drizzle ORM equivalents

**Implementation Strategy**:
- Audit all files for `rawQuery()` and `drizzleSql` usage
- Create typed query builders for common patterns
- Implement query performance monitoring
- Maintain backward compatibility during transition

**Files to Update**:
- `server/storage.ts` (primary target - 2,578 lines)
- `server/openAssistant/meetingResolver.ts`
- `server/mcp/capabilities/getLastMeeting.ts`
- Any other files using raw SQL

### 2. Type Safety Enhancement

**Approach**: Replace `as any` with proper type guards and interfaces

**Implementation Strategy**:
- Create type guard functions for external data validation
- Define proper interfaces for database results
- Implement runtime type checking for API responses
- Use discriminated unions for complex types

**Type Guard Pattern**:
```typescript
function isValidTranscript(data: unknown): data is Transcript {
  return typeof data === 'object' && data !== null &&
    typeof (data as any).id === 'string' &&
    typeof (data as any).content === 'string';
}
```

### 3. Centralized Error Handling

**Approach**: Implement typed error classes with middleware

**Error Hierarchy**:
```typescript
export class AppError extends Error {
  constructor(message: string, public code: string, public statusCode = 500) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class DatabaseError extends AppError {
  constructor(operation: string, originalError?: Error) {
    super(`Database ${operation} failed: ${originalError?.message}`, 'DATABASE_ERROR', 500);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, originalError?: Error) {
    super(`${service} failed: ${originalError?.message}`, 'EXTERNAL_SERVICE_ERROR', 502);
  }
}
```

### 4. Configuration Management

**Approach**: Centralize all configuration in a typed system

**Configuration Structure**:
```typescript
export interface AppConfig {
  database: DatabaseConfig;
  openai: OpenAIConfig;
  slack: SlackConfig;
  performance: PerformanceConfig;
}

export const config = loadConfig();
```

**Files to Consolidate**:
- `config/acknowledgments.json`
- `config/documents.json`
- `config/performance.json`
- `config/progress.json`
- Environment variables
- Hardcoded configuration values

### 5. Logging Standardization

**Approach**: Structured logging with consistent metadata

**Logger Interface**:
```typescript
interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, error?: Error, metadata?: LogMetadata): void;
}

interface LogMetadata {
  requestId?: string;
  userId?: string;
  companyId?: string;
  operation?: string;
  duration?: number;
}
```

## Implementation Plan

### Phase 2.1: Database Query Standardization
1. Audit and inventory all raw SQL usage
2. Create Drizzle query builders for common patterns
3. Convert high-impact queries first (storage.ts)
4. Add query performance monitoring
5. Remove raw SQL dependencies

### Phase 2.2: Type Safety Enhancement
1. Audit all `as any` usage
2. Create type guard functions
3. Define proper interfaces for database results
4. Implement API response validation
5. Add compile-time type checking

### Phase 2.3: Error Handling & Configuration
1. Implement error class hierarchy
2. Create error handling middleware
3. Consolidate configuration files
4. Add configuration validation
5. Implement structured logging

## Testing Strategy

### Database Query Testing
- Unit tests for query builders
- Integration tests for database operations
- Performance benchmarks for query optimization
- Property-based tests for query correctness

### Type Safety Testing
- Compile-time type checking
- Runtime type validation tests
- Property-based tests for type guards
- Integration tests for API validation

### Error Handling Testing
- Error propagation tests
- Error formatting tests
- Error logging verification
- Recovery mechanism tests

## Correctness Properties

### Property 1: Database Query Type Safety
**Description**: All database queries must return properly typed results
**Test**: Property-based test that verifies query results match expected types
**Validates**: Requirements 1.1, 1.2, 1.3

### Property 2: Error Handling Consistency
**Description**: All errors must be handled through the centralized error system
**Test**: Property-based test that verifies error propagation and formatting
**Validates**: Requirements 3.1, 3.2, 3.3

### Property 3: Configuration Completeness
**Description**: All configuration values must be validated at startup
**Test**: Property-based test that verifies configuration loading and validation
**Validates**: Requirements 4.1, 4.2, 4.3

### Property 4: Type Guard Correctness
**Description**: Type guards must correctly validate data structures
**Test**: Property-based test with generated invalid data
**Validates**: Requirements 8.1, 8.2, 8.3

### Property 5: Logging Structure Consistency
**Description**: All log messages must follow the structured format
**Test**: Property-based test that verifies log message structure
**Validates**: Requirements 5.1, 5.2, 5.3

## Performance Considerations

### Database Performance
- Query execution time monitoring
- Connection pool optimization
- Query plan analysis for complex operations
- Caching strategies for frequently accessed data

### Type Checking Performance
- Minimize runtime type checking overhead
- Use compile-time checks where possible
- Optimize type guard functions
- Cache validation results when appropriate

### Error Handling Performance
- Minimize error object creation overhead
- Efficient error serialization
- Avoid deep stack trace capture in production
- Optimize error logging performance

## Migration Strategy

### Backward Compatibility
- Maintain existing API contracts during transition
- Use feature flags for gradual rollout
- Provide fallback mechanisms for critical paths
- Document breaking changes clearly

### Rollout Plan
1. **Phase 2.1**: Database standardization (low risk)
2. **Phase 2.2**: Type safety improvements (medium risk)
3. **Phase 2.3**: Error handling and configuration (medium risk)

### Risk Mitigation
- Comprehensive testing before deployment
- Gradual rollout with monitoring
- Quick rollback procedures
- Performance monitoring during transition

## Success Metrics

### Code Quality Metrics
- Reduction in `as any` usage (target: 0)
- Elimination of raw SQL queries (target: 100%)
- Test coverage increase (target: >80%)
- TypeScript strict mode compliance

### Performance Metrics
- Query execution time improvements
- Error handling overhead reduction
- Configuration loading time
- Memory usage optimization

### Maintainability Metrics
- Code duplication reduction
- Documentation coverage increase
- Developer onboarding time reduction
- Bug resolution time improvement
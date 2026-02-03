# Performance Optimization - Phase 1: Tasks

## Task List

### ✅ Phase 0: Logging Infrastructure (COMPLETED)
- [x] 0.1 Implement structured logging with correlation IDs
- [x] 0.2 Add stage timing API (startStage/endStage)
- [x] 0.3 Add log level filtering (LOG_LEVEL environment variable)
- [x] 0.4 Integrate stage timing in events.ts
- [x] 0.5 Add complete stage breakdown to final summary
- [x] 0.6 Test logging infrastructure

**Result**: Production-ready observability platform with:
- Correlation IDs for request tracing
- Stage timing for performance analysis
- Structured JSON logs with daily rotation
- Complete pipeline breakdown in logs

### ✅ Phase 0.5: Product Knowledge Caching System (COMPLETED - January 29, 2026)
- [x] 0.7 Implement `pitcrewProductSnapshot` table schema
- [x] 0.8 Create `rebuildProductSnapshot()` function
- [x] 0.9 Add automatic snapshot rebuilding on Airtable sync
- [x] 0.10 Update `openAssistantHandler.ts` to use snapshot system
- [x] 0.11 Implement fast path (1 query) vs slow path (5 queries) architecture
- [x] 0.12 Add graceful fallback for missing snapshots

**Result**: 6-19x performance improvement for product knowledge queries:
- Response times: 30-95 seconds → 2-5 seconds
- Single database query instead of 5 separate queries
- Pre-computed LLM prompts ready for immediate use
- Automatic cache maintenance on data changes

**Files Modified**:
- `server/airtable/productData.ts` - Snapshot system implementation
- `server/openAssistant/openAssistantHandler.ts` - Cache integration  
- `shared/schema.ts` - New table schema
- `server/airtable/sync.ts` & `webhook.ts` - Auto-rebuild triggers

---

### Phase 1: Preparation & Questions
- [ ] 1. Read requirements.md and design.md thoroughly
- [ ] 2. Answer questions in requirements.md (tag @Silvina)
- [ ] 3. Get approval from Silvina to proceed
- [ ] 4. Verify logging access (logs directory should exist with recent entries)

### Phase 2: Implementation
- [ ] 5. Create feature branch: `git checkout -b perf/skip-llm-validation`
- [ ] 6. Make code changes in `server/controlPlane/intent.ts`
  - [ ] 6.1 Add early return for high-confidence pattern matches
  - [ ] 6.2 Add log message for observability
  - [ ] 6.3 Verify placement (before `needsLLMValidation` check)
- [ ] 7. Run existing test suite: `npm test`
  - [ ] 7.1 Verify all tests pass
  - [ ] 7.2 Fix any broken tests (should be none)
- [ ] 8. Test locally with sample questions
  - [ ] 8.1 "search all recent calls about pricing" → should skip validation
  - [ ] 8.2 "draft an email to Tyler" → should still validate
  - [ ] 8.3 Check logs for "skipping LLM validation" message
- [ ] 9. Commit changes: `git commit -m "perf: Skip LLM validation for high-confidence pattern matches"`

### Phase 3: Staging Deployment
- [ ] 10. Push to staging: `git push origin perf/skip-llm-validation`
- [ ] 11. Deploy to staging environment
- [ ] 12. Test with real Slack messages in staging
  - [ ] 12.1 Send 10 test messages with known intents
  - [ ] 12.2 Verify all are classified correctly
  - [ ] 12.3 Check logs for "skipping LLM validation" messages
  - [ ] 12.4 Measure response times (should be faster)
- [ ] 13. Monitor staging for 2-4 hours
  - [ ] 13.1 Check for any errors
  - [ ] 13.2 Verify classification accuracy
  - [ ] 13.3 Confirm performance improvement

### Phase 4: Production Deployment
- [ ] 14. Create pull request to main
- [ ] 15. Get code review from Silvina
- [ ] 16. Merge to main: `git merge perf/skip-llm-validation`
- [ ] 17. Deploy to production
- [ ] 18. Post in Slack: "Deployed performance optimization - expect faster responses"

### Phase 5: Monitoring (First 48 Hours)
- [ ] 19. Monitor response times using structured logs
  - [ ] 19.1 Check average `totalTimeMs` (should decrease by 150-200ms)
  - [ ] 19.2 Check `stages.control_plane` timing (should be ~50ms for optimized requests vs ~850ms baseline)
  - [ ] 19.3 Compare with baseline (collect from logs before deployment)
- [ ] 20. Monitor classification accuracy
  - [ ] 20.1 Check for misclassifications in logs
  - [ ] 20.2 Monitor user complaints (should be zero)
  - [ ] 20.3 Verify accuracy stays at 90%+
- [ ] 21. Monitor system health
  - [ ] 21.1 Check error rates using `findstr "\"level\":\"error\""` (should stay same)
  - [ ] 21.2 Check OpenAI API call volume (should decrease)
  - [ ] 21.3 Check for any unexpected behavior
- [ ] 22. Analyze structured logs
  - [ ] 22.1 Count "skipping LLM validation" messages (should be ~40% of requests)
  - [ ] 22.2 Verify no new errors via correlation ID tracking
  - [ ] 22.3 Confirm optimization is working via stage breakdown

### Phase 6: Evaluation & Reporting
- [ ] 23. Collect metrics after 48 hours
  - [ ] 23.1 Average response time improvement
  - [ ] 23.2 Percentage of requests skipping validation
  - [ ] 23.3 Classification accuracy
  - [ ] 23.4 Error rates
  - [ ] 23.5 User feedback
- [ ] 24. Document results
  - [ ] 24.1 Create summary document with metrics
  - [ ] 24.2 Note any issues or surprises
  - [ ] 24.3 Document lessons learned
- [ ] 25. Share results with team
  - [ ] 25.1 Post metrics in Slack
  - [ ] 25.2 Celebrate success! 🎉
  - [ ] 25.3 Discuss next optimization

### Phase 7: Next Steps
- [ ] 26. Review results with Silvina
- [ ] 27. Decide if ready for Phase 1.1 (Parallel LLM calls)
- [ ] 28. Update this spec with lessons learned
- [ ] 29. Archive this spec as completed

---

## Rollback Tasks (If Needed)

### If Issues Detected
- [ ] R1. Identify the issue
  - [ ] R1.1 Check logs for errors
  - [ ] R1.2 Check metrics for anomalies
  - [ ] R1.3 Check user feedback
- [ ] R2. Decide if rollback is needed
  - [ ] R2.1 Consult with Silvina
  - [ ] R2.2 Assess severity
  - [ ] R2.3 Consider alternatives (e.g., adjust threshold)
- [ ] R3. Execute rollback
  - [ ] R3.1 Find commit hash: `git log --oneline -5`
  - [ ] R3.2 Revert: `git revert <commit-hash>`
  - [ ] R3.3 Push: `git push origin main`
  - [ ] R3.4 Deploy to production
- [ ] R4. Verify rollback
  - [ ] R4.1 Check logs - "skipping LLM validation" should stop
  - [ ] R4.2 Verify metrics return to baseline
  - [ ] R4.3 Confirm no new errors
- [ ] R5. Post-mortem
  - [ ] R5.1 Document what went wrong
  - [ ] R5.2 Identify why tests didn't catch it
  - [ ] R5.3 Plan how to prevent in future
  - [ ] R5.4 Share learnings with team

---

## Questions to Answer Before Starting

### Infrastructure Questions
1. **Logging Infrastructure**: ✅ COMPLETED
   - [x] Structured logging with correlation IDs
   - [x] Stage timing for performance measurement
   - [x] Log files in `logs/slack-YYYY-MM-DD.log`
   - [x] Complete observability platform ready

2. **Staging Environment**: Do you have a staging environment that mirrors production?
   - [ ] Yes, staging URL: _______________
   - [ ] No, will test in production carefully

3. **Deployment Process**: What's your deployment process?
   - [ ] Automated (CI/CD): _______________
   - [ ] Manual: _______________

4. **Rollback Process**: How do you rollback deployments?
   - [ ] Automated: _______________
   - [ ] Manual git revert + redeploy

### Technical Questions
5. **Confidence Threshold**: Should we use 0.9 or adjust?
   - [ ] Use 0.9 (recommended)
   - [ ] Use different threshold: _______________

6. **Feature Flag**: Should we add a feature flag?
   - [ ] No, deploy directly (recommended for low-risk change)
   - [ ] Yes, add feature flag for safety

7. **Testing**: How many test messages should we send in staging?
   - [ ] 10 messages (recommended)
   - [ ] Different number: _______________

8. **Monitoring Duration**: How long should we monitor before declaring success?
   - [ ] 48 hours (recommended)
   - [ ] Different duration: _______________

### Communication Questions
9. **Team Notification**: Who should be notified about deployment?
   - [ ] Team Slack channel: _______________
   - [ ] Email list: _______________
   - [ ] Other: _______________

10. **Success Criteria**: What metrics define success?
    - [ ] Response time reduced by 150ms+ (recommended)
    - [ ] Zero increase in errors (recommended)
    - [ ] Other: _______________

---

## Timeline Estimate

**Note**: Logging infrastructure (Phase 0) is already complete, reducing overall timeline.

### Optimistic (Everything Goes Smoothly)
- **Day 1**: Implementation + staging deployment (2-3 hours)
- **Day 2**: Staging testing + production deployment (2-3 hours)
- **Day 3-4**: Monitoring with structured logs (passive, 15 min/day)
- **Day 5**: Evaluation + reporting (1 hour)
- **Total**: ~8 hours over 5 days

### Realistic (Some Minor Issues)
- **Day 1**: Implementation + staging deployment (3-4 hours)
- **Day 2**: Staging testing + fixes (3-4 hours)
- **Day 3**: Production deployment (1 hour)
- **Day 4-5**: Monitoring with structured logs (passive, 15 min/day)
- **Day 6**: Evaluation + reporting (1-2 hours)
- **Total**: ~10 hours over 6 days

### Pessimistic (Issues Require Rollback)
- **Day 1**: Implementation + staging deployment (3-4 hours)
- **Day 2**: Staging testing + production deployment (3-4 hours)
- **Day 3**: Issues detected, rollback (2-3 hours)
- **Day 4**: Post-mortem + fixes (3-4 hours)
- **Day 5**: Re-deployment (2-3 hours)
- **Day 6-7**: Monitoring with structured logs (passive, 15 min/day)
- **Day 8**: Evaluation + reporting (1-2 hours)
- **Total**: ~15 hours over 8 days

---

## Success Checklist

### Must Have (Required)
- [ ] ✅ Response time reduced by 150ms+
- [ ] ✅ Zero increase in misclassifications
- [ ] ✅ Zero new errors
- [ ] ✅ Logs show ~40% of requests skipping validation
- [ ] ✅ All tests pass
- [ ] ✅ Staging tests successful
- [ ] ✅ 48-hour monitoring complete

### Nice to Have (Bonus)
- [ ] 🎯 Response time reduced by 200ms+
- [ ] 🎯 OpenAI API costs reduced by 30%+
- [ ] 🎯 User feedback mentions "faster"
- [ ] 🎯 Team celebrates success

### Red Flags (Immediate Action)
- [ ] 🚨 Classification accuracy drops below 85%
- [ ] 🚨 Error rate increases by >10%
- [ ] 🚨 User complaints about wrong answers
- [ ] 🚨 System instability
- [ ] 🚨 Unexpected behavior

---

## Notes & Learnings

### During Implementation
_Add notes here as you work:_
- 
- 
- 

### During Testing
_Add notes here as you test:_
- 
- 
- 

### During Monitoring
_Add notes here as you monitor:_
- 
- 
- 

### Lessons Learned
_Add lessons here after completion:_
- 
- 
- 

---

## Support & Resources

### Need Help?
- **Questions about WHY**: Tag @Kiro in Slack
- **Questions about deployment**: Tag @Silvina in Slack
- **Questions about monitoring**: Check design.md first, then ask

### Useful Commands
```bash
# Check logs for optimization
type logs\slack-2026-01-28.log | findstr "skipping LLM validation"

# Check Control Plane timing (KEY METRIC)
type logs\slack-2026-01-28.log | findstr "Request completed successfully" | findstr "control_plane"
# Look for: "stages":{"meeting_resolution":85,"control_plane":50,"handler":1200}
# Before optimization: control_plane ~850ms
# After optimization: control_plane ~50ms (for high-confidence patterns)

# Check for errors
type logs\slack-2026-01-28.log | findstr "\"level\":\"error\""

# Check correlation IDs for request tracing
type logs\slack-2026-01-28.log | findstr "a1b2c3d4"

# Analyze stage breakdown
type logs\slack-2026-01-28.log | findstr "stages"

# Find commit for rollback
git log --oneline -5

# Revert commit
git revert <commit-hash>
```

### Documentation
- Requirements: `.kiro/specs/performance-optimization-phase1/requirements.md`
- Design: `.kiro/specs/performance-optimization-phase1/design.md`
- Tasks: `.kiro/specs/performance-optimization-phase1/tasks.md` (this file)

---

**Ready to start? Check off tasks as you complete them! 🚀**

# Prompt Version Control & Feedback System - Setup Checklist

Use this checklist to complete the setup of the new feedback system.

## ✅ Code Implementation (COMPLETE)

- [x] Created database schema for `prompt_versions` table
- [x] Created database schema for `interaction_feedback` table
- [x] Added `prompt_versions` column to `interaction_logs`
- [x] Created `config/feedback.json` configuration file
- [x] Implemented `PromptVersionTracker` utility
- [x] Created prompt version management in `versions.ts`
- [x] Implemented feedback handler for Slack reactions
- [x] Updated Slack events handler to process reactions
- [x] Updated storage layer with new methods
- [x] Updated interaction logging to include prompt versions
- [x] Created backfill migration script
- [x] Created helper script for version generation
- [x] Created comprehensive documentation
- [x] No TypeScript errors

## 🔧 Database Setup (TODO)

- [ ] **Apply schema changes**
  ```bash
  npm run db:push
  ```
  Expected: Creates 2 new tables, adds 1 column, creates indexes

- [ ] **Run backfill migration**
  ```bash
  tsx server/migrations/backfillPromptVersions.ts
  ```
  Expected: Creates 12 prompt version records, backfills existing interactions

- [ ] **Verify tables exist**
  ```sql
  SELECT table_name FROM information_schema.tables 
  WHERE table_name IN ('prompt_versions', 'interaction_feedback');
  ```
  Expected: Both tables listed

- [ ] **Verify column added**
  ```sql
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'interaction_logs' AND column_name = 'prompt_versions';
  ```
  Expected: Column exists

## 🤖 Slack App Configuration (TODO)

- [ ] **Add OAuth scope**
  1. Go to https://api.slack.com/apps
  2. Select your PitCrew app
  3. Click "OAuth & Permissions"
  4. Add scope: `reactions:read`
  5. Click "Reinstall to Workspace"
  6. Authorize the new permission

- [ ] **Subscribe to events**
  1. Click "Event Subscriptions"
  2. Ensure "Enable Events" is ON
  3. Add bot events:
     - `reaction_added`
     - `reaction_removed` (optional)
  4. Click "Save Changes"
  5. Wait for Slack to verify your endpoint

- [ ] **Verify bot in notification channel**
  1. Go to `operations-testing_notifications` channel
  2. Invite bot: `/invite @PitCrew`
  3. Or update channel name in `config/feedback.json`

## 🚀 Deployment (TODO)

- [ ] **Commit changes**
  ```bash
  git add .
  git commit -m "Add prompt version control and feedback system"
  git push
  ```

- [ ] **Deploy to production**
  - If using Replit: Changes auto-deploy
  - If using other service: Follow your deployment process

- [ ] **Restart server**
  - Ensure new event handlers are loaded
  - Check logs for any startup errors

## 🧪 Testing (TODO)

### Test 1: Positive Feedback

- [ ] Ask bot a question in Slack
- [ ] React to response with 👍
- [ ] Check server logs for:
  ```
  [Feedback] Reaction added: thumbsup by U123456
  [Feedback] Classified as: positive
  [Feedback] Stored positive feedback
  ```
- [ ] Query database:
  ```sql
  SELECT * FROM interaction_feedback 
  WHERE sentiment = 'positive' 
  ORDER BY created_at DESC LIMIT 1;
  ```
- [ ] Verify record exists with correct data

### Test 2: Negative Feedback

- [ ] Ask bot another question
- [ ] React with ❌
- [ ] Check `operations-testing_notifications` channel
- [ ] Verify notification appears with:
  - User mention
  - Question text
  - Answer text
  - Prompt versions
  - Thread link
- [ ] Query database:
  ```sql
  SELECT * FROM interaction_feedback 
  WHERE sentiment = 'negative' 
  ORDER BY created_at DESC LIMIT 1;
  ```
- [ ] Verify record exists

### Test 3: Duplicate Prevention

- [ ] React to same message with same emoji again
- [ ] Check logs for: "User already reacted"
- [ ] Query database - should still be only 1 record

### Test 4: Prompt Version Tracking

- [ ] Query recent interactions:
  ```sql
  SELECT prompt_versions, COUNT(*) 
  FROM interaction_logs 
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY prompt_versions;
  ```
- [ ] Verify prompt_versions field is populated
- [ ] Should see version numbers like "2026-02-17-001"

### Test 5: Unknown Emoji

- [ ] React with an emoji not in config (e.g., 🎉)
- [ ] Check logs for: "Ignoring unknown emoji"
- [ ] Verify no feedback record created

## 📊 Verification Queries (TODO)

Run these to verify everything is working:

```sql
-- Check prompt versions exist
SELECT prompt_name, version, created_at 
FROM prompt_versions 
ORDER BY created_at DESC;
-- Expected: 12 records

-- Check feedback is being collected
SELECT sentiment, COUNT(*) 
FROM interaction_feedback 
GROUP BY sentiment;
-- Expected: Some positive/negative counts

-- Check interactions have prompt versions
SELECT 
  COUNT(*) as total,
  COUNT(prompt_versions) as with_versions
FROM interaction_logs;
-- Expected: with_versions = total (all backfilled)

-- Check recent interactions
SELECT 
  question_text,
  intent,
  answer_contract,
  prompt_versions
FROM interaction_logs
ORDER BY created_at DESC
LIMIT 5;
-- Expected: Recent questions with prompt version data
```

## 📝 Configuration Review (TODO)

- [ ] **Review `config/feedback.json`**
  - Emoji mappings correct?
  - Notification channel correct?
  - Notification settings as desired?

- [ ] **Review `server/config/prompts/versions.ts`**
  - All prompts have versions?
  - Change log entries complete?
  - Versions follow format YYYY-MM-DD-NNN?

## 📚 Documentation Review (TODO)

- [ ] Read `docs/PROMPT_VERSION_CONTROL.md`
- [ ] Read `docs/SETUP_FEEDBACK_SYSTEM.md`
- [ ] Bookmark `docs/FEEDBACK_QUICK_REFERENCE.md`
- [ ] Share docs with team

## 🎓 Team Training (TODO)

- [ ] **For users**: Explain how to give feedback (👍/❌)
- [ ] **For developers**: Show how to update prompts
- [ ] **For ops**: Explain notification system
- [ ] **For all**: Share quick reference guide

## 🔄 Ongoing Maintenance (TODO)

Set up recurring tasks:

- [ ] **Weekly**: Review negative feedback notifications
- [ ] **Weekly**: Run feedback summary queries
- [ ] **Monthly**: Analyze prompt version performance
- [ ] **Monthly**: Update prompts based on findings

## 🐛 Troubleshooting (If Needed)

If something doesn't work:

1. **Check server logs** for detailed errors
2. **Verify Slack app** has correct scopes and events
3. **Check database** schema was applied correctly
4. **Review configuration** files for typos
5. **Consult documentation** in `docs/` folder

Common issues:
- "No interaction found" → Check interaction_logs has slack_message_ts
- Reactions not working → Verify reactions:read scope
- No notifications → Check bot is in notification channel
- Versions null → Check PromptVersionTracker is being used

## ✅ Completion Checklist

When all above items are checked:

- [ ] System is fully operational
- [ ] Tests pass successfully
- [ ] Team is trained
- [ ] Documentation is accessible
- [ ] Monitoring is in place

## 🎉 Success!

Once complete, you'll have:
- ✅ Full prompt version tracking
- ✅ User feedback collection
- ✅ Quality notifications
- ✅ Analytics capabilities
- ✅ Data-driven prompt improvement process

## Next Steps

1. Monitor feedback for first week
2. Run weekly review of negative feedback
3. Make first prompt update using the system
4. Share learnings with team

---

**Questions?** Check `docs/PROMPT_VERSION_CONTROL.md` or contact the development team.

-- Meeting Detection Metrics (LLM Fallback Usage)
-- Run this periodically to monitor the LLM fallback performance
-- 
-- Usage: Copy/paste into database tool or run via psql
-- 
-- Metrics tracked:
-- - regex_hits: Questions resolved via fast regex path (no LLM)
-- - llm_fallback_calls: Questions requiring LLM classifier
-- - llm_fallback_pct: Percentage of questions using LLM fallback
-- - avg/p50/p95_latency_ms: LLM call latency distribution

WITH detection_stats AS (
  SELECT 
    (resolved_entities->'meeting_detection'->>'regex_result')::boolean as regex_hit,
    (resolved_entities->'meeting_detection'->>'llm_called')::boolean as llm_called,
    (resolved_entities->'meeting_detection'->>'llm_latency_ms')::int as latency_ms
  FROM interaction_logs 
  WHERE resolved_entities->'meeting_detection' IS NOT NULL
  AND created_at >= NOW() - interval '24 hours'
)
SELECT 
  COUNT(*) as total_requests,
  COUNT(*) FILTER (WHERE regex_hit = true) as regex_hits,
  COUNT(*) FILTER (WHERE llm_called = true) as llm_fallback_calls,
  ROUND(100.0 * COUNT(*) FILTER (WHERE llm_called = true) / NULLIF(COUNT(*), 0), 1) as llm_fallback_pct,
  ROUND(AVG(latency_ms) FILTER (WHERE llm_called = true))::int as avg_llm_latency_ms,
  (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE llm_called = true))::int as p50_latency_ms,
  (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE llm_called = true))::int as p95_latency_ms
FROM detection_stats;

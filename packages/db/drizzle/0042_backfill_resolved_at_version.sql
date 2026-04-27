-- Backfill resolved_at_version for issues resolved before the field became required.
-- Without a resolved_at_version, the regression detector in jobs/issue-scan.ts short-circuits
-- and the issue stays resolved no matter what later versions report. Use last_seen_app_version
-- as the best available approximation of the version the issue was last observed in.
-- Rows with null last_seen_app_version stay null (no version data to work with) — they were
-- already not auto-regressing and behavior is unchanged.
UPDATE issues
SET resolved_at_version = last_seen_app_version,
    updated_at = NOW()
WHERE status = 'resolved'
  AND resolved_at_version IS NULL
  AND last_seen_app_version IS NOT NULL;

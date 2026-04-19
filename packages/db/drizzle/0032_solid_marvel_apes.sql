ALTER TABLE "projects" ADD COLUMN "color" varchar(7);

-- Backfill: round-robin a 20-color palette within each team, ordered by created_at.
-- Guarantees no duplicates within a team until the palette is exhausted.
-- The palette below is a one-time snapshot of PROJECT_COLORS in
-- packages/shared/src/project-colors.ts. Future palette edits do not need to
-- propagate here — this migration represents a point in time.
WITH palette AS (
  SELECT * FROM (
    VALUES
      (0,  '#ef4444'), (1,  '#f97316'), (2,  '#f59e0b'), (3,  '#eab308'),
      (4,  '#84cc16'), (5,  '#22c55e'), (6,  '#10b981'), (7,  '#14b8a6'),
      (8,  '#06b6d4'), (9,  '#0ea5e9'), (10, '#3b82f6'), (11, '#6366f1'),
      (12, '#8b5cf6'), (13, '#a855f7'), (14, '#d946ef'), (15, '#ec4899'),
      (16, '#f43f5e'), (17, '#64748b'), (18, '#c2410c'), (19, '#15803d')
  ) AS t(idx, color)
),
ranked AS (
  SELECT id,
         ((row_number() OVER (PARTITION BY team_id ORDER BY created_at) - 1) % 20)::int AS idx
  FROM "projects"
)
UPDATE "projects" p
SET "color" = palette.color
FROM ranked
JOIN palette ON palette.idx = ranked.idx
WHERE p.id = ranked.id;

ALTER TABLE "projects" ALTER COLUMN "color" SET NOT NULL;

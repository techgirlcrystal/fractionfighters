-- ============================================================
-- Fraction Fighters — Database Schema
-- Run this in your Neon SQL Editor:
-- https://console.neon.tech → your project → SQL Editor
-- ============================================================

-- Players table (synced from Clerk on first score save)
CREATE TABLE IF NOT EXISTS players (
  clerk_id    TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  email        TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Scores table (one row per game played)
CREATE TABLE IF NOT EXISTS scores (
  id          SERIAL PRIMARY KEY,
  clerk_id    TEXT NOT NULL REFERENCES players(clerk_id),
  score       INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_clerk_id ON scores(clerk_id);

-- Helpful view: best score per player
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.username,
  p.avatar_url,
  MAX(s.score) AS best_score,
  MAX(s.level) AS highest_level,
  COUNT(s.id) AS games_played,
  MAX(s.created_at) AS last_played
FROM players p
JOIN scores s ON p.clerk_id = s.clerk_id
GROUP BY p.clerk_id, p.username, p.avatar_url
ORDER BY best_score DESC;

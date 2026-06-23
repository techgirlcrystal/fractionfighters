// ============================================================
// Fraction Fighters — Backend Server
// Serves the static game + API for scores/leaderboard
// Connects to Neon Postgres + verifies Clerk tokens
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { createClerkClient, verifyToken } = require('@clerk/backend');

const app = express();
const PORT = process.env.PORT || 8080;

// Neon database connection
const sql = neon(process.env.DATABASE_URL);

// Clerk client for fetching user info
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (the game)
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html']
}));

// ============================================================
// AUTH HELPER — verifies the Clerk token from the frontend
// ============================================================
async function getAuthUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
    return claims;
  } catch (e) {
    console.error('Token verify failed:', e.message);
    return null;
  }
}

// ============================================================
// API: Save a score (requires auth)
// POST /api/scores  { score, level }
// ============================================================
app.post('/api/scores', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { score, level } = req.body;
    if (typeof score !== 'number' || typeof level !== 'number') {
      return res.status(400).json({ error: 'score and level must be numbers' });
    }

    // Fetch user info from Clerk
    const clerkUser = await clerkClient.users.getUser(user.sub);
    const username = clerkUser.username ||
      clerkUser.firstName ||
      clerkUser.emailAddresses[0]?.emailAddress?.split('@')[0] ||
      'Player';
    const email = clerkUser.emailAddresses[0]?.emailAddress || null;
    const avatarUrl = clerkUser.imageUrl || null;

    // Upsert player
    console.log('[scores] upserting player', { clerkId: user.sub, incomingLevel: level });
    const upsertRows = await sql`
      INSERT INTO players (clerk_id, username, email, avatar_url, current_level)
      VALUES (${user.sub}, ${username}, ${email}, ${avatarUrl}, ${level})
      ON CONFLICT (clerk_id)
      DO UPDATE SET username = ${username},
                    email = ${email},
                    avatar_url = ${avatarUrl},
                    current_level = GREATEST(players.current_level, ${level})
      RETURNING current_level
    `;
    console.log('[scores] upsert done — stored current_level =', upsertRows[0]?.current_level);

    // Insert score
    await sql`
      INSERT INTO scores (clerk_id, score, level)
      VALUES (${user.sub}, ${score}, ${level})
    `;

    res.json({ success: true, message: 'Score saved!' });
  } catch (err) {
    console.error('Save score error:', err);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

// ============================================================
// API: Upsert the signed-in player (requires auth)
// POST /api/players  — player record only, no score
// ============================================================
app.post('/api/players', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // Fetch user info from Clerk
    const clerkUser = await clerkClient.users.getUser(user.sub);
    const username = clerkUser.username ||
      clerkUser.firstName ||
      clerkUser.emailAddresses[0]?.emailAddress?.split('@')[0] ||
      'Player';
    const email = clerkUser.emailAddresses[0]?.emailAddress || null;
    const avatarUrl = clerkUser.imageUrl || null;

    // Upsert player
    const rows = await sql`
      INSERT INTO players (clerk_id, username, email, avatar_url)
      VALUES (${user.sub}, ${username}, ${email}, ${avatarUrl})
      ON CONFLICT (clerk_id)
      DO UPDATE SET username = ${username}, email = ${email}, avatar_url = ${avatarUrl}
      RETURNING current_level
    `;
    const currentLevel = rows[0]?.current_level ?? 1;

    res.json({ success: true, message: 'Player saved!', currentLevel });
  } catch (err) {
    console.error('Save player error:', err);
    res.status(500).json({ error: 'Failed to save player' });
  }
});

// ============================================================
// API: Get leaderboard (public — no auth needed)
// GET /api/leaderboard
// ============================================================
app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = await sql`
      SELECT username, avatar_url, best_score, highest_level, games_played
      FROM leaderboard
      ORDER BY best_score DESC
      LIMIT 20
    `;
    res.json(rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ============================================================
// API: Get current user's best score (requires auth)
// GET /api/my-scores
// ============================================================
app.get('/api/my-scores', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const rows = await sql`
      SELECT score, level, created_at
      FROM scores
      WHERE clerk_id = ${user.sub}
      ORDER BY score DESC
      LIMIT 10
    `;
    res.json(rows);
  } catch (err) {
    console.error('My scores error:', err);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

// ============================================================
// API: Health check
// GET /api/health
// ============================================================
app.get('/api/health', async (req, res) => {
  try {
    const [{ ok }] = await sql`SELECT 1 AS ok`;
    res.json({ status: 'ok', database: ok === 1 ? 'connected' : 'error' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: err.message });
  }
});

// Catch-all: serve index.html for any non-API route (SPA fallback)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`⚔️ Fraction Fighters server running on port ${PORT}`);
});

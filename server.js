const express = require('express');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Load .env file
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const app = express();
const PORT = 3000;

// --- Database setup ---
const db = new Database(path.join(__dirname, 'football.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Check if we need to migrate from old schema
const oldTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (oldTable && oldTable.sql.includes('date_of_birth')) {
  // Old schema detected — drop everything and recreate
  db.exec(`
    DROP TABLE IF EXISTS quiz_scores;
    DROP TABLE IF EXISTS quiz_questions;
    DROP TABLE IF EXISTS comments;
    DROP TABLE IF EXISTS duo_votes;
    DROP TABLE IF EXISTS duos;
    DROP TABLE IF EXISTS players;
    DROP TABLE IF EXISTS votes;
    DROP TABLE IF EXISTS users;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dob TEXT,
    gender TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS votes (
    user_id INTEGER PRIMARY KEY,
    player TEXT NOT NULL CHECK(player IN ('messi', 'ronaldo')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Serve static files
app.use(express.static(__dirname));

// --- Google OAuth client ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Serve Google Client ID to frontend
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login required' });
  }
  next();
}

// --- Auth routes ---

// Sign up with email/password
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { firstName, lastName, dob, gender, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'First name, last name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = db.prepare(
      'INSERT INTO users (first_name, last_name, dob, gender, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(firstName, lastName, dob || null, gender || null, email, passwordHash);

    req.session.userId = result.lastInsertRowid;

    res.json({
      user: { id: result.lastInsertRowid, firstName, lastName, email }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login with email/password
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;

    res.json({
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Google Sign-In
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential required' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;
    const firstName = payload.given_name || payload.name || '';
    const lastName = payload.family_name || '';

    // Check if user exists by google_id or email
    let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email);

    if (!user) {
      // Create new user
      const result = db.prepare(
        'INSERT INTO users (first_name, last_name, email, google_id) VALUES (?, ?, ?, ?)'
      ).run(firstName, lastName, email, googleId);
      user = { id: result.lastInsertRowid, first_name: firstName, last_name: lastName, email };
    } else if (!user.google_id) {
      // Link Google account to existing email user
      db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(googleId, user.id);
    }

    req.session.userId = user.id;

    res.json({
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email }
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Get current user
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const user = db.prepare('SELECT id, first_name, last_name, email FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  res.json({
    user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email }
  });
});

// --- Vote routes ---

// Cast a vote
app.post('/api/vote', requireAuth, (req, res) => {
  const { player } = req.body;

  if (!player || !['messi', 'ronaldo'].includes(player)) {
    return res.status(400).json({ error: 'Invalid player. Must be "messi" or "ronaldo"' });
  }

  const existing = db.prepare('SELECT player FROM votes WHERE user_id = ?').get(req.session.userId);
  if (existing) {
    return res.status(409).json({ error: 'You have already voted', vote: existing.player });
  }

  db.prepare('INSERT INTO votes (user_id, player) VALUES (?, ?)').run(req.session.userId, player);

  // Return updated counts
  const counts = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN player = 'messi' THEN 1 ELSE 0 END), 0) AS messi, COALESCE(SUM(CASE WHEN player = 'ronaldo' THEN 1 ELSE 0 END), 0) AS ronaldo FROM votes"
  ).get();

  res.json({ ok: true, vote: player, counts });
});

// Get vote counts
app.get('/api/vote/counts', (req, res) => {
  const counts = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN player = 'messi' THEN 1 ELSE 0 END), 0) AS messi, COALESCE(SUM(CASE WHEN player = 'ronaldo' THEN 1 ELSE 0 END), 0) AS ronaldo FROM votes"
  ).get();

  res.json(counts);
});

// Get current user's vote
app.get('/api/vote/mine', requireAuth, (req, res) => {
  const vote = db.prepare('SELECT player FROM votes WHERE user_id = ?').get(req.session.userId);
  res.json({ vote: vote ? vote.player : null });
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

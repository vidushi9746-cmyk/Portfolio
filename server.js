const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vidushi2025';
const LC_USERNAME = process.env.LC_USERNAME || 'Vidushi1122';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DATABASE ─────────────────────────────────────────────
const db = new Database('portfolio.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS about (
    id        INTEGER PRIMARY KEY,
    name      TEXT DEFAULT 'Vidushi Singh',
    role      TEXT DEFAULT '2nd semester engineering student',
    bio1      TEXT DEFAULT 'I am a 2nd semester engineering student who has not shipped a complete project yet — and I am okay with that.',
    bio2      TEXT DEFAULT 'I started doing DSA on LeetCode recently and I am tracking my progress here.',
    bio3      TEXT DEFAULT 'On weekends I try to build small things to explore different areas.',
    bio4      TEXT DEFAULT 'Before 2nd year starts the goal is simple: explore broadly, learn consistently, build something real.',
    currently TEXT DEFAULT 'Learning arrays and hash maps on LeetCode, exploring web dev on weekends.',
    github    TEXT DEFAULT 'https://github.com/',
    linkedin  TEXT DEFAULT 'https://linkedin.com/',
    leetcode  TEXT DEFAULT 'https://leetcode.com/u/Vidushi1122/',
    email     TEXT DEFAULT 'vidushi@email.com'
  );
  CREATE TABLE IF NOT EXISTS skills (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name     TEXT NOT NULL,
    note     TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    num         INTEGER DEFAULT 0,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    tags        TEXT DEFAULT '[]',
    status      TEXT DEFAULT 'building' CHECK(status IN ('done','building','idea')),
    link        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (date('now'))
  );
  CREATE TABLE IF NOT EXISTS problems (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    num       INTEGER DEFAULT 0,
    name      TEXT NOT NULL,
    diff      TEXT NOT NULL DEFAULT 'easy' CHECK(diff IN ('easy','medium','hard')),
    topics    TEXT DEFAULT '[]',
    status    TEXT DEFAULT 'solved' CHECK(status IN ('solved','review','todo')),
    notes     TEXT DEFAULT '',
    solved_at TEXT DEFAULT (date('now')),
    from_lc   INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS lc_cache (
    id         INTEGER PRIMARY KEY,
    data       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
`);

// Seed defaults
if (db.prepare('SELECT COUNT(*) as c FROM about').get().c === 0)
  db.prepare('INSERT INTO about (id) VALUES (1)').run();

if (db.prepare('SELECT COUNT(*) as c FROM skills').get().c === 0) {
  const ins = db.prepare('INSERT INTO skills (category,name,note) VALUES (?,?,?)');
  [['Languages','C',''],['Languages','Python',''],['Languages','HTML',''],['Languages','CSS',''],
   ['DSA Topics','Arrays',''],['DSA Topics','Strings',''],['DSA Topics','Hash Maps',''],['DSA Topics','Two Pointers',''],
   ['Tools','VS Code',''],['Tools','Git',''],['Tools','GitHub',''],['Tools','LeetCode',''],
  ].forEach(s => ins.run(...s));
}

if (db.prepare('SELECT COUNT(*) as c FROM projects').get().c === 0) {
  const ins = db.prepare('INSERT INTO projects (num,name,description,tags,status,link) VALUES (?,?,?,?,?,?)');
  ins.run(1,'LeetCode DSA Tracker','A personal dashboard to log and track LeetCode progress — problems, difficulty breakdown, topics.',JSON.stringify(['HTML','CSS','JavaScript','Node.js']),'building','');
  ins.run(2,'This Portfolio','My first real web project — a place to put everything I am learning and building.',JSON.stringify(['HTML','CSS','JavaScript','Node.js','SQLite']),'done','');
}

// ── LEETCODE SYNC ────────────────────────────────────────
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchFromLeetCode() {
  const cached = db.prepare('SELECT * FROM lc_cache WHERE id = 1').get();
  if (cached && (Date.now() - cached.fetched_at) < CACHE_TTL) {
    return JSON.parse(cached.data);
  }

  const query = `
    query getUserStats($username: String!) {
      matchedUser(username: $username) {
        username
        profile { ranking }
        submitStatsGlobal {
          acSubmissionNum { difficulty count }
        }
        userCalendar { streak totalActiveDays }
      }
      recentAcSubmissionList(username: $username, limit: 20) {
        id title titleSlug timestamp
      }
    }
  `;

  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
      body: JSON.stringify({ query, variables: { username: LC_USERNAME } }),
    });

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);

    const user     = json.data.matchedUser;
    const stats    = user?.submitStatsGlobal?.acSubmissionNum || [];
    const calendar = user?.userCalendar || {};
    const recent   = json.data.recentAcSubmissionList || [];

    const result = {
      username:        LC_USERNAME,
      ranking:         user?.profile?.ranking || 0,
      streak:          calendar.streak || 0,
      totalActiveDays: calendar.totalActiveDays || 0,
      solved: {
        total:  stats.find(s => s.difficulty === 'All')?.count    || 0,
        easy:   stats.find(s => s.difficulty === 'Easy')?.count   || 0,
        medium: stats.find(s => s.difficulty === 'Medium')?.count || 0,
        hard:   stats.find(s => s.difficulty === 'Hard')?.count   || 0,
      },
      recentSubmissions: recent.map(s => ({
        title:     s.title,
        titleSlug: s.titleSlug,
        timestamp: s.timestamp,
        url:       `https://leetcode.com/problems/${s.titleSlug}/`,
      })),
      fetchedAt: Date.now(),
    };

    // Save to cache
    const str = JSON.stringify(result);
    if (db.prepare('SELECT id FROM lc_cache WHERE id = 1').get()) {
      db.prepare('UPDATE lc_cache SET data=?,fetched_at=? WHERE id=1').run(str, Date.now());
    } else {
      db.prepare('INSERT INTO lc_cache (id,data,fetched_at) VALUES (1,?,?)').run(str, Date.now());
    }

    // Auto-import recent accepted submissions into problems table
    recent.forEach(s => {
      const exists = db.prepare('SELECT id FROM problems WHERE name = ?').get(s.title);
      if (!exists) {
        db.prepare(`INSERT INTO problems (name,diff,topics,status,notes,from_lc,solved_at)
                    VALUES (?,?,?,?,?,?,date('now'))`)
          .run(s.title, 'easy', '[]', 'solved', '⚠️ synced from LC — update difficulty & topics', 1);
      }
    });

    return result;
  } catch (err) {
    console.error('⚠️  LeetCode sync error:', err.message);
    if (cached) return JSON.parse(cached.data); // return stale cache on error
    return null;
  }
}

// ── AUTH ─────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD)
    res.json({ ok: true, token: Buffer.from(ADMIN_PASSWORD).toString('base64') });
  else
    res.status(401).json({ ok: false, error: 'Wrong password' });
});

function auth(req, res, next) {
  const t = req.headers['x-admin-token'];
  if (!t || Buffer.from(t, 'base64').toString() !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── LEETCODE ROUTES ──────────────────────────────────────

app.get('/api/lc/stats', async (req, res) => {
  const data = await fetchFromLeetCode();
  if (!data) return res.status(503).json({ error: 'LeetCode unavailable' });
  res.json(data);
});

app.post('/api/lc/sync', auth, async (req, res) => {
  db.prepare('DELETE FROM lc_cache WHERE id = 1').run(); // bust cache
  const data = await fetchFromLeetCode();
  res.json({ ok: !!data, data });
});

// ── ABOUT ────────────────────────────────────────────────
app.get('/api/about', (req, res) =>
  res.json(db.prepare('SELECT * FROM about WHERE id=1').get()));

app.patch('/api/about', auth, (req, res) => {
  const fields = ['name','role','bio1','bio2','bio3','bio4','currently','github','linkedin','leetcode','email'];
  const updates = Object.fromEntries(fields.filter(f => req.body[f] !== undefined).map(f => [f, req.body[f]]));
  if (Object.keys(updates).length > 0)
    db.prepare(`UPDATE about SET ${Object.keys(updates).map(k=>k+'=?').join(',')} WHERE id=1`).run(...Object.values(updates));
  res.json(db.prepare('SELECT * FROM about WHERE id=1').get());
});

// ── SKILLS ───────────────────────────────────────────────
app.get('/api/skills', (req, res) =>
  res.json(db.prepare('SELECT * FROM skills ORDER BY category,id').all()));

app.post('/api/skills', auth, (req, res) => {
  const { category, name, note } = req.body;
  if (!category || !name) return res.status(400).json({ error: 'category and name required' });
  const r = db.prepare('INSERT INTO skills (category,name,note) VALUES (?,?,?)').run(category, name, note||'');
  res.status(201).json(db.prepare('SELECT * FROM skills WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/skills/:id', auth, (req, res) => {
  db.prepare('DELETE FROM skills WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── PROJECTS ─────────────────────────────────────────────
app.get('/api/projects', (req, res) =>
  res.json(db.prepare('SELECT * FROM projects ORDER BY num ASC').all().map(r => ({...r, tags: JSON.parse(r.tags)}))));

app.post('/api/projects', auth, (req, res) => {
  const { num, name, description, tags, status, link } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = db.prepare('INSERT INTO projects (num,name,description,tags,status,link) VALUES (?,?,?,?,?,?)')
    .run(num||0, name, description||'', JSON.stringify(tags||[]), status||'building', link||'');
  const row = db.prepare('SELECT * FROM projects WHERE id=?').get(r.lastInsertRowid);
  res.status(201).json({...row, tags: JSON.parse(row.tags)});
});

app.patch('/api/projects/:id', auth, (req, res) => {
  const ex = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'Not found' });
  const { num, name, description, tags, status, link } = req.body;
  db.prepare('UPDATE projects SET num=?,name=?,description=?,tags=?,status=?,link=? WHERE id=?')
    .run(num??ex.num, name??ex.name, description??ex.description,
        JSON.stringify(tags??JSON.parse(ex.tags)), status??ex.status, link??ex.link, req.params.id);
  const row = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  res.json({...row, tags: JSON.parse(row.tags)});
});

app.delete('/api/projects/:id', auth, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── PROBLEMS ─────────────────────────────────────────────
app.get('/api/problems', (req, res) =>
  res.json(db.prepare('SELECT * FROM problems ORDER BY num ASC, id ASC').all()
    .map(r => ({...r, topics: JSON.parse(r.topics)}))));

app.get('/api/stats', (req, res) => {
  res.json({
    total:  db.prepare("SELECT COUNT(*) as c FROM problems WHERE status='solved'").get().c,
    easy:   db.prepare("SELECT COUNT(*) as c FROM problems WHERE status='solved' AND diff='easy'").get().c,
    medium: db.prepare("SELECT COUNT(*) as c FROM problems WHERE status='solved' AND diff='medium'").get().c,
    hard:   db.prepare("SELECT COUNT(*) as c FROM problems WHERE status='solved' AND diff='hard'").get().c,
  });
});

app.post('/api/problems', auth, (req, res) => {
  const { num, name, diff, topics, status, notes } = req.body;
  if (!name || !diff) return res.status(400).json({ error: 'name and diff required' });
  const r = db.prepare('INSERT INTO problems (num,name,diff,topics,status,notes) VALUES (?,?,?,?,?,?)')
    .run(num||0, name, diff, JSON.stringify(topics||[]), status||'solved', notes||'');
  const row = db.prepare('SELECT * FROM problems WHERE id=?').get(r.lastInsertRowid);
  res.status(201).json({...row, topics: JSON.parse(row.topics)});
});

app.patch('/api/problems/:id', auth, (req, res) => {
  const ex = db.prepare('SELECT * FROM problems WHERE id=?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'Not found' });
  const { num, name, diff, topics, status, notes } = req.body;
  db.prepare('UPDATE problems SET num=?,name=?,diff=?,topics=?,status=?,notes=? WHERE id=?')
    .run(num??ex.num, name??ex.name, diff??ex.diff,
        JSON.stringify(topics??JSON.parse(ex.topics)), status??ex.status, notes??ex.notes, req.params.id);
  const row = db.prepare('SELECT * FROM problems WHERE id=?').get(req.params.id);
  res.json({...row, topics: JSON.parse(row.topics)});
});

app.delete('/api/problems/:id', auth, (req, res) => {
  db.prepare('DELETE FROM problems WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── SERVE ────────────────────────────────────────────────
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/{*path}', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── START ────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n✅  Portfolio     →  http://localhost:${PORT}`);
  console.log(`🔒  Admin panel   →  http://localhost:${PORT}/admin`);
  console.log(`🔑  Password      →  ${ADMIN_PASSWORD}`);
  console.log(`\n⏳  Syncing LeetCode stats for @${LC_USERNAME}...`);
  const lc = await fetchFromLeetCode();
  if (lc) {
    console.log(`✅  Synced! Solved: ${lc.solved.total} total  (${lc.solved.easy}E / ${lc.solved.medium}M / ${lc.solved.hard}H)`);
    console.log(`    Streak: ${lc.streak} days  |  Recent: ${lc.recentSubmissions.length} submissions imported\n`);
  } else {
    console.log(`⚠️  Could not reach LeetCode — will retry automatically\n`);
  }
});
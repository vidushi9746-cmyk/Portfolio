const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vidushi2025';
const LC_USERNAME = process.env.LC_USERNAME || 'Vidushi1122';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DATABASE ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => { console.error('MongoDB error:', err.message); process.exit(1); });

// ── MODELS ───────────────────────────────────────────────
const About = mongoose.model('About', new mongoose.Schema({
  name: { type: String, default: 'Vidushi Singh' },
  role: { type: String, default: '2nd semester engineering student' },
  bio1: { type: String, default: '' }, bio2: { type: String, default: '' },
  bio3: { type: String, default: '' }, bio4: { type: String, default: '' },
  currently: { type: String, default: '' }, github: { type: String, default: '' },
  linkedin: { type: String, default: '' }, leetcode: { type: String, default: '' },
  email: { type: String, default: '' },
}));

const Skill = mongoose.model('Skill', new mongoose.Schema({
  category: String, name: String, note: { type: String, default: '' },
}));

const Project = mongoose.model('Project', new mongoose.Schema({
  num: { type: Number, default: 0 }, name: String,
  description: { type: String, default: '' }, tags: { type: [String], default: [] },
  status: { type: String, enum: ['done','building','idea'], default: 'building' },
  link: { type: String, default: '' },
}, { timestamps: true }));

const Problem = mongoose.model('Problem', new mongoose.Schema({
  num: { type: Number, default: 0 }, name: String,
  diff: { type: String, enum: ['easy','medium','hard'], default: 'easy' },
  topics: { type: [String], default: [] },
  status: { type: String, enum: ['solved','review','todo'], default: 'solved' },
  notes: { type: String, default: '' }, from_lc: { type: Boolean, default: false },
}, { timestamps: true }));

const LCCache = mongoose.model('LCCache', new mongoose.Schema({
  data: String, fetched_at: Number,
}));

// ── SEED DEFAULTS ────────────────────────────────────────
async function seedDefaults() {
  const aboutCount = await About.countDocuments();
  if (aboutCount === 0) {
    await About.create({
      name: 'Vidushi Singh', role: '2nd semester engineering student',
      bio1: 'I am a 2nd semester engineering student who just shipped my first full stack app.',
      bio2: 'I started doing DSA on LeetCode recently and I am tracking my progress here.',
      bio3: 'On weekends I try to build small things to explore different areas.',
      bio4: 'Before 2nd year starts the goal is simple: explore broadly, learn consistently, build something real.',
      currently: 'Learning arrays and hash maps on LeetCode, exploring web dev on weekends.',
      github: 'https://github.com/vidushi9746-cmyk',
      linkedin: 'https://linkedin.com/',
      leetcode: 'https://leetcode.com/u/Vidushi1122/',
      email: 'vidushi@email.com'
    });
  }

  const skillCount = await Skill.countDocuments();
  if (skillCount === 0) {
    await Skill.insertMany([
      { category: 'Languages', name: 'C' }, { category: 'Languages', name: 'Python' },
      { category: 'Languages', name: 'JavaScript' }, { category: 'Languages', name: 'HTML' },
      { category: 'Languages', name: 'CSS' },
      { category: 'DSA Topics', name: 'Arrays' }, { category: 'DSA Topics', name: 'Strings' },
      { category: 'DSA Topics', name: 'Hash Maps' }, { category: 'DSA Topics', name: 'Two Pointers' },
      { category: 'Tools', name: 'Node.js' }, { category: 'Tools', name: 'Express' },
      { category: 'Tools', name: 'MongoDB' }, { category: 'Tools', name: 'VS Code' },
      { category: 'Tools', name: 'Git' }, { category: 'Tools', name: 'GitHub' },
    ]);
  }

  const projCount = await Project.countDocuments();
  if (projCount === 0) {
    await Project.insertMany([
      { num: 1, name: 'Expense Tracker', description: 'Full stack expense tracking app with user auth, JWT, and MongoDB.', tags: ['Node.js','Express','MongoDB','JWT','Netlify','Railway'], status: 'done', link: 'https://vidushi-expense-app.netlify.app' },
      { num: 2, name: 'Portfolio', description: 'My personal portfolio with admin panel, LeetCode sync, and MongoDB.', tags: ['Node.js','Express','MongoDB','Railway'], status: 'done', link: 'https://portfolio-production-9bdf.up.railway.app' },
    ]);
  }
}

// ── LEETCODE SYNC ────────────────────────────────────────
const CACHE_TTL = 10 * 60 * 1000;

async function fetchFromLeetCode() {
  const cached = await LCCache.findOne();
  if (cached && (Date.now() - cached.fetched_at) < CACHE_TTL) return JSON.parse(cached.data);

  const query = `query getUserStats($username: String!) {
    matchedUser(username: $username) {
      username profile { ranking }
      submitStatsGlobal { acSubmissionNum { difficulty count } }
      userCalendar { streak totalActiveDays }
    }
    recentAcSubmissionList(username: $username, limit: 20) { id title titleSlug timestamp }
  }`;

  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://leetcode.com' },
      body: JSON.stringify({ query, variables: { username: LC_USERNAME } }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);

    const user = json.data.matchedUser;
    const stats = user?.submitStatsGlobal?.acSubmissionNum || [];
    const calendar = user?.userCalendar || {};
    const recent = json.data.recentAcSubmissionList || [];

    const result = {
      username: LC_USERNAME, ranking: user?.profile?.ranking || 0,
      streak: calendar.streak || 0, totalActiveDays: calendar.totalActiveDays || 0,
      solved: {
        total: stats.find(s => s.difficulty === 'All')?.count || 0,
        easy: stats.find(s => s.difficulty === 'Easy')?.count || 0,
        medium: stats.find(s => s.difficulty === 'Medium')?.count || 0,
        hard: stats.find(s => s.difficulty === 'Hard')?.count || 0,
      },
      recentSubmissions: recent.map(s => ({
        title: s.title, titleSlug: s.titleSlug, timestamp: s.timestamp,
        url: `https://leetcode.com/problems/${s.titleSlug}/`,
      })),
      fetchedAt: Date.now(),
    };

    const str = JSON.stringify(result);
    if (cached) await LCCache.findByIdAndUpdate(cached._id, { data: str, fetched_at: Date.now() });
    else await LCCache.create({ data: str, fetched_at: Date.now() });

    for (const s of recent) {
      const exists = await Problem.findOne({ name: s.title });
      if (!exists) await Problem.create({ name: s.title, diff: 'easy', status: 'solved', notes: '⚠️ synced from LC — update difficulty & topics', from_lc: true });
    }

    return result;
  } catch (err) {
    console.error('⚠️ LeetCode sync error:', err.message);
    if (cached) return JSON.parse(cached.data);
    return null;
  }
}

// ── AUTH ─────────────────────────────────────────────────
app.post('/api/auth', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD)
    res.json({ ok: true, token: Buffer.from(ADMIN_PASSWORD).toString('base64') });
  else res.status(401).json({ ok: false, error: 'Wrong password' });
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
  await LCCache.deleteMany();
  const data = await fetchFromLeetCode();
  res.json({ ok: !!data, data });
});

// ── ABOUT ────────────────────────────────────────────────
app.get('/api/about', async (req, res) => {
  const about = await About.findOne();
  res.json(about);
});

app.patch('/api/about', auth, async (req, res) => {
  const fields = ['name','role','bio1','bio2','bio3','bio4','currently','github','linkedin','leetcode','email'];
  const updates = Object.fromEntries(fields.filter(f => req.body[f] !== undefined).map(f => [f, req.body[f]]));
  const about = await About.findOneAndUpdate({}, updates, { new: true });
  res.json(about);
});

// ── SKILLS ───────────────────────────────────────────────
app.get('/api/skills', async (req, res) => {
  const skills = await Skill.find().sort({ category: 1 });
  res.json(skills);
});

app.post('/api/skills', auth, async (req, res) => {
  const { category, name, note } = req.body;
  if (!category || !name) return res.status(400).json({ error: 'category and name required' });
  const skill = await Skill.create({ category, name, note: note || '' });
  res.status(201).json(skill);
});

app.delete('/api/skills/:id', auth, async (req, res) => {
  await Skill.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── PROJECTS ─────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  const projects = await Project.find().sort({ num: 1 });
  res.json(projects);
});

app.post('/api/projects', auth, async (req, res) => {
  const { num, name, description, tags, status, link } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const project = await Project.create({ num: num||0, name, description: description||'', tags: tags||[], status: status||'building', link: link||'' });
  res.status(201).json(project);
});

app.patch('/api/projects/:id', auth, async (req, res) => {
  const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  await Project.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── PROBLEMS ─────────────────────────────────────────────
app.get('/api/problems', async (req, res) => {
  const problems = await Problem.find().sort({ num: 1 });
  res.json(problems);
});

app.get('/api/stats', async (req, res) => {
  const [total, easy, medium, hard] = await Promise.all([
    Problem.countDocuments({ status: 'solved' }),
    Problem.countDocuments({ status: 'solved', diff: 'easy' }),
    Problem.countDocuments({ status: 'solved', diff: 'medium' }),
    Problem.countDocuments({ status: 'solved', diff: 'hard' }),
  ]);
  res.json({ total, easy, medium, hard });
});

app.post('/api/problems', auth, async (req, res) => {
  const { num, name, diff, topics, status, notes } = req.body;
  if (!name || !diff) return res.status(400).json({ error: 'name and diff required' });
  const problem = await Problem.create({ num: num||0, name, diff, topics: topics||[], status: status||'solved', notes: notes||'' });
  res.status(201).json(problem);
});

app.patch('/api/problems/:id', auth, async (req, res) => {
  const problem = await Problem.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!problem) return res.status(404).json({ error: 'Not found' });
  res.json(problem);
});

app.delete('/api/problems/:id', auth, async (req, res) => {
  await Problem.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── SERVE ────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── START ────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n✅  Portfolio     →  http://localhost:${PORT}`);
  console.log(`🔒  Admin panel   →  http://localhost:${PORT}/admin`);
  await seedDefaults();
  const lc = await fetchFromLeetCode();
  if (lc) console.log(`✅  LC Synced! Solved: ${lc.solved.total} total`);
  else console.log(`⚠️  Could not reach LeetCode`);
});
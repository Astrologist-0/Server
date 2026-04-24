// Load .env in development — in production env vars are injected by the platform
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const cors    = require('cors');
const { randomUUID } = require('crypto');
const { saveChart, getChart, listCharts, deleteChart } = require('./db');
const { searchAstrology } = require('./search');

const app  = express();
const PORT = process.env.PORT || 3001;

// Allow all origins explicitly
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    // Add your Vercel URLs here after deploying:
    // 'https://astrologist.vercel.app',
    // 'https://astrologist-admin.vercel.app',
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
  ];
  if (!origin || origin.startsWith('http://localhost') || allowed.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json());

// ── Health check ──
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Astrology web search ──
// POST /api/search
app.post('/api/search', async (req, res) => {
  try {
    const { question, chartContext } = req.body;
    if (!question) return res.status(400).json({ error: 'question is required' });
    const result = await searchAstrology(question, chartContext || {});
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sanitize value for DynamoDB — round floats, remove undefined/NaN
function sanitize(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (!isFinite(val) || isNaN(val)) return 0;
    return Math.round(val * 10000) / 10000; // 4 decimal places
  }
  if (typeof val === 'string') return val;
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.map(sanitize);
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      const s = sanitize(v);
      if (s !== null && s !== undefined) out[k] = s;
    }
    return out;
  }
  return val;
}

// ── Save / update chart ──
// POST /api/charts
app.post('/api/charts', async (req, res) => {
  try {
    const body = req.body;
    console.log('POST /api/charts body:', JSON.stringify(body, null, 2));
    if (!body.birthDate) return res.status(400).json({ error: 'birthDate is required' });

    const data = {
      customerId: body.customerId || randomUUID(),
      name:       body.name       || '',
      location:   body.location   || '',
      lat:        sanitize(parseFloat(body.lat)  || 0),
      lon:        sanitize(parseFloat(body.lon)  || 0),
      birthDate:  body.birthDate,
      lagnaSign:  sanitize(body.lagnaSign),
      ayanamsa:   sanitize(body.ayanamsa),
      planets:    sanitize(body.planets   || {}),
      panchanga:  sanitize(body.panchanga || {}),
    };

    const saved = await saveChart(data);
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    console.error('POST /api/charts error:', err.message, err.__type, JSON.stringify(err.$metadata));
    res.status(500).json({ error: err.message });
  }
});

// ── Get single chart ──
// GET /api/charts/:id
app.get('/api/charts/:id', async (req, res) => {
  try {
    const item = await getChart(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, data: item });
  } catch (err) {
    console.error('GET /api/charts/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── List all charts ──
// GET /api/charts?limit=20&lastKey=...
app.get('/api/charts', async (req, res) => {
  try {
    const limit   = parseInt(req.query.limit) || 50;
    const lastKey = req.query.lastKey ? JSON.parse(decodeURIComponent(req.query.lastKey)) : null;
    const result  = await listCharts(limit, lastKey);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('GET /api/charts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Update chart (partial) ──
// PATCH /api/charts/:id
app.patch('/api/charts/:id', async (req, res) => {
  try {
    const existing = await getChart(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const body = req.body;
    const updated = await saveChart({
      ...existing,
      ...sanitize({
        name:      body.name      !== undefined ? body.name      : existing.name,
        location:  body.location  !== undefined ? body.location  : existing.location,
        lat:       body.lat       !== undefined ? parseFloat(body.lat)  : existing.lat,
        lon:       body.lon       !== undefined ? parseFloat(body.lon)  : existing.lon,
        birthDate: body.birthDate !== undefined ? body.birthDate : existing.birthDate,
      }),
      customerId: req.params.id,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('PATCH /api/charts/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// DELETE /api/charts/:id
app.delete('/api/charts/:id', async (req, res) => {
  try {
    await deleteChart(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/charts/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Astrologist API running on http://localhost:${PORT}`);
});

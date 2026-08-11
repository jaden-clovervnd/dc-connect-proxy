// dc-connect proxy server
//
// Why this exists: Even Hub apps run inside a Flutter WebView, so the app's
// fetch() is subject to CORS and cannot set a Referer header. dcinside sends no
// CORS headers and blocks image hotlinking. This server sits in between:
//   - it adds permissive CORS headers so the WebView app can read the response,
//   - it talks to dcinside server-side with the right UA / Referer / cookies,
//   - it converts images to the glasses' 1-bit format.
import express from 'express';
import { getList, getPost } from './src/dcinside.js';
import { loadSource } from './src/image.js';

const app = express();
const PORT = process.env.PORT || 8787;
const DEFAULT_GALLERY = process.env.GALLERY || 'automata';

// Permissive CORS for the WebView app. Tighten origin in production if desired.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const asyncH = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message, status });
  });

app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /img?url=<encoded dcinside image url>
// Pass-through image proxy: fetches the original bytes server-side WITH a
// dcinside Referer (defeats the 403 hotlink block) and re-serves them with
// permissive CORS. This is what the glasses app loads into a <canvas> via
// `new Image(crossOrigin='anonymous')` so it can run the proven cover-flow
// tone-map/quantize pipeline in the WebView. (No conversion here.)
app.get(
  '/img',
  asyncH(async (req, res) => {
    const url = req.query.url;
    if (!url || !/^https?:\/\/[^/]*dcinside/.test(url)) {
      return res.status(400).json({ error: 'valid dcinside image url required' });
    }
    const { buffer, contentType } = await loadSource(url);
    // dcinside serves images as application/octet-stream; normalise so the
    // WebView <canvas> decodes reliably.
    const ct = contentType && contentType.startsWith('image/') ? contentType : 'image/jpeg';
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  }),
);

// GET /api/list?id=automata&page=1
app.get(
  '/api/list',
  asyncH(async (req, res) => {
    const id = req.query.id || DEFAULT_GALLERY;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const mode = req.query.mode === 'recommend' ? 'recommend' : 'all';
    const data = await getList(id, page, mode);
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  }),
);

// GET /api/post?id=automata&no=916219
app.get(
  '/api/post',
  asyncH(async (req, res) => {
    const id = req.query.id || DEFAULT_GALLERY;
    const no = String(req.query.no || '').replace(/[^\d]/g, '');
    if (!no) return res.status(400).json({ error: 'no is required' });
    const data = await getPost(id, no);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  }),
);

app.listen(PORT, () => {
  console.log(`dc-connect proxy listening on http://localhost:${PORT}`);
  console.log(`  GET /api/list?id=${DEFAULT_GALLERY}&page=1`);
  console.log(`  GET /api/post?id=${DEFAULT_GALLERY}&no=<postNo>`);
});

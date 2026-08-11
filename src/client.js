// Low-level HTTP client for dcinside.
// Handles the two defenses observed on dcinside:
//   1) page fetch  -> requires a browser User-Agent (mobile UA gives the lightest HTML)
//   2) image fetch -> requires a Referer header (hotlink protection: 403 without it)
// We also keep a tiny in-memory cookie jar because the desktop board ties the
// article view to a session cookie set by the list page. The mobile board is
// looser, but we warm cookies anyway to stay robust.

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const DEFAULT_TIMEOUT_MS = 15000;

// Minimal cookie jar: host -> "k=v; k2=v2"
const jar = new Map();

function mergeSetCookie(host, res) {
  // Node's fetch exposes getSetCookie() on Headers (Node 20+).
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  if (!raw.length) return;
  const cur = new Map(
    (jar.get(host) || '')
      .split('; ')
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), p.slice(i + 1)];
      }),
  );
  for (const line of raw) {
    const first = line.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) cur.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  jar.set(
    host,
    [...cur.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
  );
}

function cookieFor(host) {
  return jar.get(host) || '';
}

async function rawFetch(url, { referer, accept, timeoutMs } = {}) {
  const u = new URL(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': MOBILE_UA,
        Accept:
          accept ||
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        ...(referer ? { Referer: referer } : {}),
        ...(cookieFor(u.host) ? { Cookie: cookieFor(u.host) } : {}),
      },
    });
    mergeSetCookie(u.host, res);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Warm the mobile board so we hold a session cookie before hitting a post.
const warmed = new Set();
async function warm(galleryId) {
  if (warmed.has(galleryId)) return;
  try {
    await rawFetch(`https://m.dcinside.com/board/${galleryId}`, {
      referer: 'https://m.dcinside.com/',
    });
    warmed.add(galleryId);
  } catch {
    /* best effort */
  }
}

export async function fetchHtml(url, referer) {
  const res = await rawFetch(url, { referer });
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), {
      status: res.status,
    });
  }
  return res.text();
}

export async function fetchBinary(url, referer) {
  const res = await rawFetch(url, {
    referer,
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  });
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), {
      status: res.status,
    });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, contentType: res.headers.get('content-type') || '' };
}

export { warm, MOBILE_UA };

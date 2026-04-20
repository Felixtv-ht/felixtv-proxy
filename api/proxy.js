/**
 * FelixTV — Vercel Serverless Proxy
 */

const ALLOWED_ORIGIN = '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-cache, no-store',
};

const CT_MAP = {
  ts:   'video/mp2t',
  aac:  'audio/aac',
  mp3:  'audio/mpeg',
  mp4:  'video/mp4',
  m3u8: 'application/vnd.apple.mpegurl',
  m3u:  'application/vnd.apple.mpegurl',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
};

function toAbsolute(url, base) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//'))      return 'https:' + url;
  if (url.startsWith('/')) {
    const b = new URL(base);
    return b.origin + url;
  }
  return base + url;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const target = req.query.url;

  if (!target) {
    res.writeHead(400, corsHeaders);
    res.end('Paramètre url manquant');
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400, corsHeaders);
    res.end('URL invalide');
    return;
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    res.writeHead(400, corsHeaders);
    res.end('Schéma invalide');
    return;
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept':     '*/*',
        'Referer':    targetUrl.origin + '/',
      },
      redirect: 'follow',
    });
  } catch (e) {
    res.writeHead(502, corsHeaders);
    res.end('Impossible de joindre la ressource : ' + e.message);
    return;
  }

  if (!upstream.ok) {
    res.writeHead(upstream.status, corsHeaders);
    res.end('Erreur upstream : ' + upstream.status);
    return;
  }

  const ct     = upstream.headers.get('content-type') || '';
  const extRaw = target.split('?')[0].split('.').pop().toLowerCase();

  const isM3U8 = ct.includes('mpegurl') || ct.includes('x-mpegurl')
               || extRaw === 'm3u8' || extRaw === 'm3u';

  if (isM3U8) {
    const body = await upstream.text();

    if (!body.includes('#EXTM3U') && !body.includes('#EXT-X-')) {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end(body);
      return;
    }

    const basePath   = target.substring(0, target.lastIndexOf('/') + 1);
    const workerBase = `https://${req.headers.host}/api/proxy`;

    const rewritten = body
      .split('\n')
      .map(line => {
        const trimmed = line.trim();

        if (trimmed.startsWith('#')) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => {
            return `URI="${workerBase}?url=${encodeURIComponent(toAbsolute(uri, basePath))}"`;
          });
        }

        if (!trimmed) return line;

        return `${workerBase}?url=${encodeURIComponent(toAbsolute(trimmed, basePath))}`;
      })
      .join('\n');

    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(rewritten);
    return;
  }

  // Binaire — stream direct
  const finalCt = (ct && !ct.includes('octet-stream')) ? ct : (CT_MAP[extRaw] || 'application/octet-stream');
  res.writeHead(200, { ...corsHeaders, 'Content-Type': finalCt });

  const { Readable } = await import('stream');
  Readable.fromWeb(upstream.body).pipe(res);
}

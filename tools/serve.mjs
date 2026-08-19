/**
 * Minimal static server for local review.
 *
 * Deliberately case-sensitive on lookup: GitHub Pages serves from Linux, so a
 * path that only works because Windows ignores case must fail here too, rather
 * than passing locally and 404ing in production.
 *
 * Usage: npm run serve [-- --port 8899]
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 8899;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Walk the path segment by segment, matching case exactly. */
async function resolveCaseSensitive(relPath) {
  const segments = relPath.split('/').filter(Boolean);
  let current = ROOT;
  for (const segment of segments) {
    const entries = await fs.readdir(current);
    if (!entries.includes(segment)) return null;
    current = path.join(current, segment);
  }
  return current;
}

const server = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(url.parse(req.url).pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (pathname.includes('..')) {
      res.writeHead(400).end('Bad request');
      return;
    }

    const abs = await resolveCaseSensitive(pathname);
    if (!abs) {
      console.log(`404 ${pathname}`);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }

    const body = await fs.readFile(abs);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Atlas of Arda serving at http://127.0.0.1:${PORT}/  (case-sensitive, Ctrl+C to stop)`);
});

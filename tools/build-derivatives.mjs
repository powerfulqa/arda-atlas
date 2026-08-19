/**
 * Generates the display-size images the atlas pages actually use.
 *
 * The masters are full scan resolution (2765x3960 and up, 2-4 MB each) but the
 * compare slider is at most ~700 CSS px wide, so shipping masters to the slider
 * wastes ~90% of every byte. Each rendition therefore gets a small ladder:
 *
 *   narrow (700w)  - what a 1x display actually needs
 *   large  (1400 box) - what a 2x/3x display needs
 *
 * each in AVIF (preferred, ~40% smaller) and WebP (fallback for the ~5% of
 * browsers without AVIF). The page picks with <picture> + srcset; masters are
 * only fetched when the full-resolution viewer is opened.
 *
 * Re-runs are incremental: a variant newer than its master is left alone.
 *
 * Usage: npm run derivatives [-- --force]
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAPS = path.join(ROOT, 'maps');
const ASSETS = path.join(ROOT, 'assets');

const LONG_EDGE = 1400;
const NARROW_WIDTH = 700;
const WEBP_QUALITY = 82;
/** AVIF q58 lands close to WebP q82 perceptually while staying ~40% smaller. */
const AVIF_QUALITY = 58;
const FORCE = process.argv.includes('--force');

/**
 * The variant ladder. `suffix` becomes part of the filename, so the set on disk
 * is self-describing: display-remaster-700.avif, display-remaster.webp, etc.
 *
 * The narrow tier is sized BY WIDTH because srcset descriptors are widths; the
 * large tier fits inside a box, which is why a portrait map's large variant is
 * only ~984 px wide. Deliberately kept that way: regenerating the large tier by
 * width would push high-DPR visitors from 6.3 MB to ~7.3 MB.
 */
const VARIANTS = [
  { suffix: '-700', resize: { width: NARROW_WIDTH, withoutEnlargement: true } },
  {
    suffix: '',
    resize: { width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true },
  },
];

const FORMATS = [
  { ext: 'avif', apply: (p) => p.avif({ quality: AVIF_QUALITY }) },
  { ext: 'webp', apply: (p) => p.webp({ quality: WEBP_QUALITY }) },
];

const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'maps.json'), 'utf8'));
const KINDS = manifest.renditions.map((r) => r.basename);

/** The map whose newest rendition becomes the social card. */
const SOCIAL_CARD_SOURCE = 'continent-1/stormwind-district';

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Find every map directory: maps/continent-N/slug. */
async function findMapDirs() {
  const out = [];
  for (const continent of await fs.readdir(MAPS, { withFileTypes: true })) {
    if (!continent.isDirectory() || !continent.name.startsWith('continent-')) continue;
    const cDir = path.join(MAPS, continent.name);
    for (const slug of await fs.readdir(cDir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      out.push({ rel: `${continent.name}/${slug.name}`, dir: path.join(cDir, slug.name) });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Locate the master file for a kind, whatever its extension. */
async function findMaster(dir, kind) {
  const entries = await fs.readdir(dir);
  // Never treat an already-generated display-* file as a master.
  return (
    entries
      .filter((f) => !f.startsWith('display-'))
      .map((f) => ({ f, base: path.basename(f, path.extname(f)) }))
      .find((e) => e.base === kind)?.f ?? null
  );
}

async function isStale(src, dest) {
  if (FORCE || !(await exists(dest))) return true;
  const [s, d] = await Promise.all([fs.stat(src), fs.stat(dest)]);
  return s.mtimeMs > d.mtimeMs;
}

async function main() {
  const dirs = await findMapDirs();
  if (!dirs.length) {
    console.error('No maps/continent-*/<slug> directories found.');
    process.exit(1);
  }

  const totals = {}; // "avif-700" -> bytes
  let masterBytes = 0;
  let written = 0;
  let skipped = 0;
  const missing = [];
  const rows = [];

  for (const { rel, dir } of dirs) {
    for (const kind of KINDS) {
      const master = await findMaster(dir, kind);
      if (!master) {
        // Expected while a new rendition is only part-way rolled out.
        missing.push({ map: rel, kind });
        continue;
      }
      const src = path.join(dir, master);
      masterBytes += (await fs.stat(src)).size;
      const row = { map: rel, kind, sizes: {} };

      for (const variant of VARIANTS) {
        for (const fmt of FORMATS) {
          const name = `display-${kind}${variant.suffix}.${fmt.ext}`;
          const dest = path.join(dir, name);

          if (await isStale(src, dest)) {
            await fmt.apply(sharp(src).resize(variant.resize)).toFile(dest);
            written++;
          } else {
            skipped++;
          }

          const size = (await fs.stat(dest)).size;
          const key = `${fmt.ext}${variant.suffix || '-large'}`;
          totals[key] = (totals[key] ?? 0) + size;
          row.sizes[key] = size;
          if (fmt.ext === 'webp' && !variant.suffix) {
            row.dims = await sharp(dest).metadata().then((m) => `${m.width}x${m.height}`);
          }
        }
      }
      rows.push(row);
    }
  }

  // Social card for og:image, from the newest rendition available.
  await fs.mkdir(ASSETS, { recursive: true });
  const cardDir = path.join(MAPS, SOCIAL_CARD_SOURCE);
  let cardSrc = null;
  for (const kind of KINDS) {
    const found = await findMaster(cardDir, kind);
    if (found) cardSrc = path.join(cardDir, found);
  }
  const cardDest = path.join(ASSETS, 'social-card.jpg');
  if (cardSrc && (await isStale(cardSrc, cardDest))) {
    await sharp(cardSrc)
      .resize({ width: 1200, height: 630, fit: 'cover', position: 'top' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(cardDest);
    console.log(
      `social card -> assets/social-card.jpg from ${path.basename(cardSrc)} (${kb(
        (await fs.stat(cardDest)).size
      )})`
    );
  }

  console.log('');
  console.log(
    `  ${'map'.padEnd(32)} ${'kind'.padEnd(10)} ${'dims'.padEnd(11)} ` +
    `${'avif 700'.padStart(9)} ${'webp 700'.padStart(9)} ${'avif lg'.padStart(9)} ${'webp lg'.padStart(9)}`
  );
  for (const r of rows) {
    console.log(
      `  ${r.map.padEnd(32)} ${r.kind.padEnd(10)} ${(r.dims ?? '').padEnd(11)} ` +
      `${kb(r.sizes['avif-700']).padStart(9)} ${kb(r.sizes['webp-700']).padStart(9)} ` +
      `${kb(r.sizes['avif-large']).padStart(9)} ${kb(r.sizes['webp-large']).padStart(9)}`
    );
  }

  if (missing.length) {
    const byKind = {};
    for (const m of missing) (byKind[m.kind] ??= []).push(m.map);
    console.log('');
    for (const [kind, maps] of Object.entries(byKind)) {
      console.log(`  not yet present: ${kind} on ${maps.length} map(s) - rendition still rolling out`);
    }
  }

  console.log('');
  console.log(`  variants written: ${written}   up to date: ${skipped}`);
  console.log(`  all masters:      ${mb(masterBytes)}   (viewer only, never on page load)`);
  console.log('');
  console.log('  Display tier totals across every rendition on disk:');
  for (const key of ['avif-700', 'webp-700', 'avif-large', 'webp-large']) {
    console.log(`    ${key.padEnd(11)} ${mb(totals[key] ?? 0)}`);
  }
  const saving = (a, b) => `${((1 - totals[a] / totals[b]) * 100).toFixed(0)}%`;
  console.log('');
  console.log(`  AVIF is ${saving('avif-700', 'webp-700')} smaller at 700w, ${saving(
    'avif-large',
    'webp-large'
  )} smaller at the large tier.`);
  console.log('  A 1x display takes the 700 tier; a 2x/3x display takes the large one.');
  console.log('  Browsers without AVIF fall back to WebP automatically.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

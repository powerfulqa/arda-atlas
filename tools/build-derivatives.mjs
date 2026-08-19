/**
 * Generates the display-size images the atlas pages actually use.
 *
 * The masters are full scan resolution (2765x3960 and up, 2-4 MB each) but the
 * compare slider is at most ~700 CSS px wide, so shipping masters to the slider
 * wastes ~90% of every byte. This writes a 1400px-long-edge WebP next to each
 * master - 1400 covers a 700px slider at 2x DPR - and the masters are then only
 * fetched by the lightbox, on an explicit user action.
 *
 * Re-runs are incremental: a derivative newer than its master is left alone.
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
const WEBP_QUALITY = 82;
const FORCE = process.argv.includes('--force');

/** Master basenames we derive from, in the order they appear on a page. */
const KINDS = ['original', 'remaster'];

/** The map whose remaster becomes the social card. */
const SOCIAL_CARD_SOURCE = 'continent-1/stormwind-district';

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
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
  // Never treat an already-generated display-*.webp as a master.
  const match = entries.find((f) => {
    const base = path.basename(f, path.extname(f));
    return base === kind;
  });
  return match ? path.join(dir, match) : null;
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

  let masterBytes = 0;
  let displayBytes = 0;
  let written = 0;
  let skipped = 0;
  const rows = [];

  for (const { rel, dir } of dirs) {
    for (const kind of KINDS) {
      const src = await findMaster(dir, kind);
      if (!src) {
        console.warn(`  ! ${rel}: no ${kind}.* master found - skipping`);
        continue;
      }
      const dest = path.join(dir, `display-${kind}.webp`);
      const srcSize = (await fs.stat(src)).size;
      masterBytes += srcSize;

      if (await isStale(src, dest)) {
        await sharp(src)
          .resize({
            width: LONG_EDGE,
            height: LONG_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: WEBP_QUALITY })
          .toFile(dest);
        written++;
      } else {
        skipped++;
      }

      const destSize = (await fs.stat(dest)).size;
      displayBytes += destSize;
      const meta = await sharp(dest).metadata();
      rows.push({
        map: rel,
        kind,
        dims: `${meta.width}x${meta.height}`,
        master: srcSize,
        display: destSize,
        cut: 1 - destSize / srcSize,
      });
    }
  }

  // Social card for og:image.
  await fs.mkdir(ASSETS, { recursive: true });
  const cardSrc = await findMaster(path.join(MAPS, SOCIAL_CARD_SOURCE), 'remaster');
  const cardDest = path.join(ASSETS, 'social-card.jpg');
  if (cardSrc && (await isStale(cardSrc, cardDest))) {
    await sharp(cardSrc)
      .resize({ width: 1200, height: 630, fit: 'cover', position: 'top' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(cardDest);
    console.log(`social card -> assets/social-card.jpg (1200x630, ${kb((await fs.stat(cardDest)).size)})`);
  }

  console.log('');
  for (const r of rows) {
    console.log(
      `  ${r.map.padEnd(34)} ${r.kind.padEnd(9)} ${r.dims.padEnd(11)} ` +
      `${kb(r.master).padStart(9)} -> ${kb(r.display).padStart(8)}  (-${(r.cut * 100).toFixed(0)}%)`
    );
  }

  console.log('');
  console.log(`  derivatives written: ${written}   up to date: ${skipped}`);
  console.log(`  masters total:  ${mb(masterBytes)}`);
  console.log(`  display total:  ${mb(displayBytes)}`);
  console.log(`  slider payload reduced by ${((1 - displayBytes / masterBytes) * 100).toFixed(1)}%`);
  console.log('');
  console.log(`  full-scroll page weight is now the display total (${mb(displayBytes)});`);
  console.log(`  masters are fetched only when the lightbox is opened.`);
  const perMonth = Math.round((100 * 1024 ** 3) / displayBytes);
  console.log(`  full-scroll views per month before the 100 GB Pages soft limit: ~${perMonth.toLocaleString('en-GB')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

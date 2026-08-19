/**
 * Post-build checks on the generated index.html.
 *
 * Uses sharp for dimensions because System.Drawing (and most Windows tooling)
 * cannot read WebP - an earlier validator silently reported every display-tier
 * image as a mismatch for that reason alone.
 *
 * Usage: npm run verify   (exit code 1 on any failure)
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');

const failures = [];
const note = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

/** Every file under a directory, with true on-disk casing, repo-relative. */
async function walk(dir, base = dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(abs, base, out);
    else out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return out;
}

console.log('Asset references');
const onDisk = new Set([...(await walk(path.join(ROOT, 'maps'))), ...(await walk(path.join(ROOT, 'assets')))]);
// srcset holds "url 700w, url 1400w", so it needs splitting rather than a
// single-value match - otherwise the narrow tier reads as orphaned.
const srcsetRefs = [...html.matchAll(/srcset="([^"]+)"/g)].flatMap((m) =>
  m[1].split(',').map((c) => c.trim().split(/\s+/)[0])
);
const refs = [
  ...new Set([
    ...[...html.matchAll(/(?:src|href|data-view)="((?:maps|assets)\/[^"]+)"/g)].map((m) => m[1]),
    ...srcsetRefs,
  ]),
];
const broken = refs.filter((r) => !onDisk.has(r));
note(broken.length === 0, `${refs.length} referenced assets resolve case-sensitively`, broken.join(', '));

const unreferenced = [...onDisk].filter((f) => !refs.includes(f) && !f.endsWith('social-card.jpg'));
note(unreferenced.length === 0, `no orphaned files on disk`, unreferenced.join(', '));

console.log('\nImage dimensions declared in HTML');
let dimOk = 0;
const dimBad = [];
for (const m of html.matchAll(/src="((?:maps|assets)\/[^"]+)"[^>]*?width="(\d+)" height="(\d+)"/g)) {
  const [, rel, w, h] = m;
  const meta = await sharp(path.join(ROOT, rel)).metadata();
  if (meta.width === +w && meta.height === +h) dimOk++;
  else dimBad.push(`${rel} says ${w}x${h}, is ${meta.width}x${meta.height}`);
}
note(dimBad.length === 0, `${dimOk} width/height attributes match real pixels`, dimBad.join('; '));

console.log('\nCompare slider integrity');
const panes = [
  ...html.matchAll(
    /id="([a-z0-9-]+)" style="--ar:([\d.]+)"[\s\S]*?<img class="img-base" src="([^"]+)"[\s\S]*?<div class="img-after">\s*<img src="([^"]+)"/g
  ),
];
note(panes.length === 9, `found ${panes.length} compare panes`);

const arBad = [];
const layerBad = [];
for (const [, id, ar, baseSrc, overlaySrc] of panes) {
  const meta = await sharp(path.join(ROOT, baseSrc)).metadata();
  const actual = meta.width / meta.height;
  if (Math.abs(+ar - actual) > 0.002) arBad.push(`${id}: --ar ${ar} vs ${actual.toFixed(3)}`);
  // Base must be the remaster and the overlay the original, so the overlay
  // grows from the left and sits under the "Original" label.
  if (!baseSrc.includes('display-remaster') || !overlaySrc.includes('display-original')) {
    layerBad.push(`${id}: base=${path.basename(baseSrc)} overlay=${path.basename(overlaySrc)}`);
  }
}
note(arBad.length === 0, `all --ar values match their base image ratio`, arBad.join('; '));
note(layerBad.length === 0, `base=remaster, overlay=original on every pane`, layerBad.join('; '));

console.log('\nResponsive images');
const imgTags = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const responsive = imgTags.filter((t) => /srcset=/.test(t));
const sliderAndHero = imgTags.filter((t) => /display-[a-z]+\.webp/.test(t));
note(
  responsive.length === sliderAndHero.length && responsive.length > 0,
  `all ${sliderAndHero.length} display-tier images carry srcset`,
  `${responsive.length} have it`
);
// Without sizes, a w-descriptor srcset makes the browser assume 100vw and pick
// the largest candidate - which would silently undo the whole optimisation.
note(
  responsive.every((t) => /sizes="/.test(t)),
  'every srcset is paired with a sizes attribute'
);

const descriptorBad = [];
for (const tag of responsive) {
  const set = tag.match(/srcset="([^"]+)"/)[1];
  for (const cand of set.split(',').map((s) => s.trim())) {
    const [rel, desc] = cand.split(/\s+/);
    if (!onDisk.has(rel)) {
      descriptorBad.push(`${rel} missing on disk`);
      continue;
    }
    const meta = await sharp(path.join(ROOT, rel)).metadata();
    const declared = parseInt(desc, 10);
    if (meta.width !== declared) descriptorBad.push(`${rel} declared ${declared}w, is ${meta.width}w`);
  }
}
note(descriptorBad.length === 0, 'every srcset descriptor matches the real file width', descriptorBad.join('; '));

const narrowCount = [...html.matchAll(/display-[a-z]+-700\.webp/g)].length;
note(narrowCount > 0, `narrow 700w tier referenced ${narrowCount} times`);

console.log('\nImage tier routing');
const sliderMasters = [...html.matchAll(/class="img-base" src="([^"]+)"|<div class="img-after">\s*<img src="([^"]+)"/g)]
  .map((m) => m[1] ?? m[2])
  .filter((s) => !s.includes('display-'));
note(sliderMasters.length === 0, 'sliders use only the display tier', sliderMasters.join(', '));

const viewerTargets = [...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
const viewerWrong = viewerTargets.filter((t) => t.includes('display-'));
note(
  viewerWrong.length === 0 && viewerTargets.length === 18,
  `viewer opens ${viewerTargets.length} masters, none display-tier`,
  viewerWrong.join(', ')
);

console.log('\nDocument structure');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
note(dupes.length === 0, `all ${ids.length} ids unique`, dupes.join(', '));

// Tag balance, ignoring void elements, style/script bodies and comments.
const stripped = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<script[\s\S]*?<\/script>/g, '');
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'rect', 'svg']);
const stack = [];
const mismatches = [];
for (const m of stripped.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
  const [, closing, tag, self] = m;
  const t = tag.toLowerCase();
  if (VOID.has(t) || self === '/') continue;
  if (closing) {
    if (stack.pop() !== t) mismatches.push(t);
  } else stack.push(t);
}
note(stack.length === 0 && mismatches.length === 0, 'tags balanced', `unclosed: ${stack.join(', ')} mismatched: ${mismatches.join(', ')}`);

console.log('\nGenerated-file guard');
note(/GENERATED FILE - DO NOT EDIT BY HAND/.test(html), 'index.html carries the generated-file banner');

console.log('\nAnalytics');
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'maps.json'), 'utf8'));
if (!manifest.analytics) {
  console.log('  SKIP  no analytics block in the manifest');
} else {
  const tag = html.match(/<script data-goatcounter="([^"]+)" src="([^"]+)"[^>]*><\/script>/);
  note(!!tag, 'analytics tag present');
  if (tag) {
    note(tag[1] === manifest.analytics.endpoint, `endpoint matches the manifest`, tag[1]);
    // Serving from our own origin is the point: the gc.zgo.at CDN is blocked by
    // Pi-hole and the common blocklists, which undercounts silently.
    note(!/^https?:|^\/\//.test(tag[2]), 'script served from our own origin, not a CDN', tag[2]);
    note(onDisk.has(tag[2]), 'vendored script exists on disk', tag[2]);
    const vendored = await fs.readFile(path.join(ROOT, tag[2]), 'utf8');
    note(/window\.goatcounter/.test(vendored) && /\}\)\(\);?\s*$/.test(vendored.trim() + ''), 'vendored count.js looks complete');
  }
  const events = [...html.matchAll(/data-event="([^"]+)"/g)].map((m) => m[1]);
  const viewButtons = [...html.matchAll(/data-view="/g)].length;
  note(
    events.length === viewButtons,
    `every one of the ${viewButtons} viewer buttons carries an event name`,
    `${events.length} events`
  );
  note(new Set(events).size === events.length, 'event names unique');
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');

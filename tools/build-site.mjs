/**
 * Renders index.html from data/maps.json.
 *
 * Every per-map number that has to agree with the image bytes - the compare
 * slider's aspect ratio and the width/height attributes - is read from the
 * files here rather than typed into the manifest, so those values cannot drift
 * out of sync with the images the way hand-maintained ones did.
 *
 * Usage: npm run build
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAPS_DIR = path.join(ROOT, 'maps');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/** Read dimensions and byte size for one image. */
async function imageInfo(absPath, relPath) {
  const [meta, stat] = await Promise.all([sharp(absPath).metadata(), fs.stat(absPath)]);
  return { rel: relPath, w: meta.width, h: meta.height, bytes: stat.size };
}

/**
 * Resolve every rendition that actually exists for a map: its master plus the
 * two display tiers. Renditions are discovered on disk rather than listed per
 * map, so a new art pass rolls out one map at a time with no manifest edit.
 * Returns them in the manifest's configured order, oldest first.
 */
async function resolveRenditions(continentId, map, renditionConfig) {
  const dir = path.join(MAPS_DIR, continentId, map.slug);
  const relBase = `maps/${continentId}/${map.slug}`;
  const entries = await fs.readdir(dir);
  const out = [];

  for (const cfg of renditionConfig) {
    const masterFile = entries.find(
      (f) => path.basename(f, path.extname(f)) === cfg.basename
    );
    if (!masterFile) continue; // rendition not produced for this map yet

    // Four variants per rendition: two widths x two formats.
    const want = {
      webpLarge: `display-${cfg.basename}.webp`,
      webpNarrow: `display-${cfg.basename}-700.webp`,
      avifLarge: `display-${cfg.basename}.avif`,
      avifNarrow: `display-${cfg.basename}-700.avif`,
    };
    const absent = Object.values(want).filter((f) => !entries.includes(f));
    if (absent.length) {
      throw new Error(
        `${relBase}: ${masterFile} is missing ${absent.join(', ')}. Run: npm run derivatives`
      );
    }

    const [master, display, narrowImg, avifLarge, avifNarrow] = await Promise.all([
      imageInfo(path.join(dir, masterFile), `${relBase}/${masterFile}`),
      imageInfo(path.join(dir, want.webpLarge), `${relBase}/${want.webpLarge}`),
      imageInfo(path.join(dir, want.webpNarrow), `${relBase}/${want.webpNarrow}`),
      imageInfo(path.join(dir, want.avifLarge), `${relBase}/${want.avifLarge}`),
      imageInfo(path.join(dir, want.avifNarrow), `${relBase}/${want.avifNarrow}`),
    ]);
    out.push({ ...cfg, master, display, narrow: narrowImg, avifLarge, avifNarrow });
  }
  return out;
}

/**
 * srcset for one image, narrow tier plus large tier.
 *
 * `sizes` has to describe the real layout or this achieves nothing: with w
 * descriptors and no sizes the browser assumes 100vw and picks the LARGEST
 * candidate, which is exactly the behaviour we are trying to stop.
 *
 * Slider: the atlas-page grid gives the visual column ~700 CSS px at desktop
 * widths (measured 696-699, and .wrap caps at 1320 so it does not grow), and
 * below 980px the layout is single-column at roughly 100vw - 80px.
 */
const SLIDER_SIZES = '(max-width: 980px) calc(100vw - 80px), 700px';
const HERO_SIZES = '(max-width: 980px) calc(100vw - 80px), 520px';

function srcsetAttr(narrow, large) {
  // Skip the large candidate when the master was too small to exceed the narrow
  // tier, otherwise the descriptors would tie or invert.
  const parts =
    large.w > narrow.w
      ? [`${narrow.rel} ${narrow.w}w`, `${large.rel} ${large.w}w`]
      : [`${narrow.rel} ${narrow.w}w`];
  return parts.join(', ');
}

// ---------------------------------------------------------------- templates

function comparePane(map, rends) {
  const base = rends.find((r) => r.role === 'base');
  const versions = rends.filter((r) => r.role !== 'base');
  // Newest art wins the slider by default; older passes stay one click away.
  const active = versions[versions.length - 1];

  /**
   * <picture> so AVIF is offered first with WebP as the fallback. srcset alone
   * cannot do format negotiation - the browser picks purely on width and DPR,
   * so an AVIF candidate would simply break on a browser that cannot decode it.
   */
  const picture = (r, alt, cls) => `<picture>
                <source type="image/avif" srcset="${esc(
                  srcsetAttr(r.avifNarrow, r.avifLarge)
                )}" sizes="${esc(SLIDER_SIZES)}">
                <img${cls ? ` class="${cls}"` : ''} src="${esc(r.display.rel)}"
                     srcset="${esc(srcsetAttr(r.narrow, r.display))}"
                     sizes="${esc(SLIDER_SIZES)}"
                     alt="${esc(alt)}" width="${r.display.w}" height="${
    r.display.h
  }" loading="lazy" decoding="async">
              </picture>`;

  // Everything the switcher needs to repoint the slider and the viewer button.
  const versionButtons = versions
    .map(
      (r) => `              <button class="rend${r.id === active.id ? ' is-active' : ''}" type="button"
                      data-rend="${esc(r.id)}"
                      data-label="${esc(r.label)}"
                      data-src="${esc(r.display.rel)}"
                      data-srcset="${esc(srcsetAttr(r.narrow, r.display))}"
                      data-avif="${esc(srcsetAttr(r.avifNarrow, r.avifLarge))}"
                      data-w="${r.display.w}" data-h="${r.display.h}"
                      data-ar="${(r.display.w / r.display.h).toFixed(3)}"
                      data-master="${esc(r.master.rel)}"
                      data-master-dims="${r.master.w}&#215;${r.master.h}"
                      data-master-size="${kb(r.master.bytes)}"
                      data-event="view-${esc(map.slug)}-${esc(r.id)}"
                      aria-pressed="${r.id === active.id}">${esc(r.label)}</button>`
    )
    .join('\n');

  const switcher =
    versions.length > 1
      ? `
            <div class="rend-switch" role="group" aria-label="Choose which version of ${esc(
              map.title
            )} to compare">
              <span class="rend-hint">Compare against</span>
${versionButtons}
            </div>`
      : '';

  return `
          <div class="page-visual">
            <div class="compare-wrap" id="cmp-${esc(map.slug)}">
              ${picture(active, `${active.label} map of ${map.title}`, 'img-base')}
              <div class="img-after">
                ${picture(base, `Original hand-drawn ${map.title} map scan`)}
              </div>
              <div class="compare-divider">
                <div class="compare-handle">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/></svg>
                </div>
              </div>
              <span class="compare-label orig">${esc(base.label)}</span>
              <span class="compare-label remas" data-active-label>${esc(active.label)}</span>
            </div>${switcher}
            <div class="actions">
              <button class="btn primary" type="button" data-view="${esc(
                active.master.rel
              )}" data-alt="${esc(active.label)} map of ${esc(map.title)}" data-dims="${
    active.master.w
  }&#215;${active.master.h}" data-size="${kb(active.master.bytes)}" data-event="view-${esc(
    map.slug
  )}-${esc(active.id)}" data-open-active><span data-active-noun>Open ${esc(
    active.label.toLowerCase()
  )}</span></button>
              <button class="btn" type="button" data-view="${esc(
                base.master.rel
              )}" data-alt="Original hand-drawn ${esc(map.title)} map scan" data-dims="${
    base.master.w
  }&#215;${base.master.h}" data-size="${kb(base.master.bytes)}" data-event="view-${esc(
    map.slug
  )}-${esc(base.id)}">Open original</button>
            </div>
          </div>`;
}

function factRow(label, value) {
  if (!value) return '';
  const strong = label === 'Location';
  return `\n              <div><div class="label">${esc(label)}</div>${
    strong ? `<strong>${esc(value)}</strong>` : `<span>${esc(value)}</span>`
  }</div>`;
}

/**
 * Height estimate for contain-intrinsic-size, per map.
 *
 * A single shared estimate is wrong for both orientations at once - a landscape
 * map is roughly half the height of a portrait one - and the error shows up as
 * the scrollbar jumping while you scroll. One value for nine maps drifted
 * ~1,000px; at 400 maps that would be tens of thousands.
 *
 * Mirrors the real layout: the visual column is min(700, 96vh * ar) wide at a
 * nominal 900px viewport, so its height is that over ar, plus the actions row
 * and card padding. The facing meta column can be the taller of the two on a
 * short landscape map, so take whichever wins.
 */
function intrinsicHeight(map, ar, hasSwitcher) {
  const prose = ((map.onMap ?? '') + (map.lore ?? '')).length;

  // --- desktop: two columns, so the card is as tall as the taller one ---
  const NOMINAL_VH = 900;
  const visualWidth = Math.min(700, 0.96 * NOMINAL_VH * ar);
  // Measured against real rendered heights: 60 actions + 48 padding alone
  // under-shot every map by 60-150px, so the tags row and gaps get 40px too.
  const chrome = 60 + 48 + 40 + (hasSwitcher ? 52 : 0);
  const visual = visualWidth / ar + chrome;
  const meta = 510 + Math.ceil(prose / 55) * 27 + chrome;
  const desktop = Math.round(Math.max(visual, meta));

  // --- mobile: one column, so the two stack and the card is their sum ---
  // Below 980px the compare wrap is 100vw - 82px, measured 332px at a 414px
  // viewport, and text wraps at roughly 38 characters. Constants fitted against
  // the real heights of all nine maps; residual is under ~50px each.
  const MOBILE_WRAP = 332;
  const mVisual = MOBILE_WRAP / ar + 59 + (hasSwitcher ? 96 : 0);
  const mMeta = 670 + Math.ceil(prose / 38) * 29;
  const mobile = Math.round(mVisual + mMeta + 73);

  return { desktop, mobile };
}

function mapArticle(map, rends) {
  const active = rends.filter((r) => r.role !== 'base').at(-1);
  const ar = (active.display.w / active.display.h).toFixed(3);
  const pageNo = String(map.page).padStart(3, '0');
  const cis = intrinsicHeight(map, +ar, rends.length > 2);
  const tagAttr = map.tags.join('|');

  const description = map.onMap
    ? `\n            <p class="page-prose"><strong>On the map:</strong> ${esc(map.onMap)}</p>`
    : '';
  const lore = map.lore ? `\n            <p class="page-prose">${esc(map.lore)}</p>` : '';
  const pending = map.lorePending
    ? `\n            <p><span class="pending">Lore awaiting author notes</span></p>`
    : '';

  return `
        <!-- ${map.title.toUpperCase()} -->
        <article class="atlas-page" id="${esc(map.slug)}" style="--ar:${ar};--cis:${cis.desktop}px;--cis-m:${cis.mobile}px" data-tags="${esc(tagAttr)}" data-title="${esc(map.title)}">${comparePane(map, rends)}
          <div class="page-meta">
            <div class="page-no"><a href="#${esc(map.slug)}">Page ${pageNo} - ${esc(map.title)}</a></div>
            <div>
              <h3>${esc(map.title)}</h3>
              <p class="page-summary">${esc(map.summary)}</p>
            </div>
            <div class="location">${factRow('Location', map.location)}${factRow('Region', map.region)}${factRow(
    'Landmark',
    map.landmark
  )}${factRow('Type', map.type)}${factRow('Status', map.status)}
            </div>
            <div class="tags">
${map.tags.map((t) => `              <span class="tag">${esc(t)}</span>`).join('\n')}
            </div>${description}${lore}${pending}
          </div>
        </article>`;
}

function continentIndex(continent) {
  const tagCounts = new Map();
  for (const m of continent.maps) {
    for (const t of m.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  // Only tags that actually group maps earn a chip. A chip matching one map is
  // a worse version of the index link directly above it, and with 40 tags over
  // 9 maps an unfiltered union renders 41 chips of mostly noise. The threshold
  // self-populates as the archive grows.
  const all = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tags = all.filter(([, n]) => n >= 2);
  const singletons = all.length - tags.length;

  const rows = continent.maps
    .map(
      (m) => `            <li><a href="#${esc(m.slug)}" data-index-for="${esc(m.slug)}">
              <span class="ix-no">${String(m.page).padStart(3, '0')}</span>
              <span class="ix-name">${esc(m.title)}</span>
              <span class="ix-type">${esc(m.type ?? '')}</span>
            </a></li>`
    )
    .join('\n');

  const chips = tags
    .map(
      ([t, n]) =>
        `            <button class="chip" type="button" data-filter="${esc(t)}">${esc(t)} <span class="chip-n">${n}</span></button>`
    )
    .join('\n');

  return `
        <div class="atlas-index" data-index-scope="${esc(continent.id)}">
          <div class="index-head">
            <div class="label">Index - ${esc(continent.name)}</div>
            <p class="index-note">${continent.maps.length} maps charted. Jump to a page, or filter by tag.</p>
          </div>
          <ol class="index-list">
${rows}
          </ol>
          <div class="filters" role="group" aria-label="Filter maps by tag">
            <button class="chip is-active" type="button" data-filter="all">All <span class="chip-n">${continent.maps.length}</span></button>
${chips}
          </div>${
            singletons
              ? `\n          <p class="index-note">Chips cover tags shared by more than one map. A further ${singletons} tags appear on a single map each - find those through the index above.</p>`
              : ''
          }
          <p class="filter-empty" hidden>No maps match that tag.</p>
        </div>`;
}

// ------------------------------------------------------------------- styles

const STYLES = `
    :root,[data-theme="light"]{--text-xs:clamp(.75rem,.7rem + .25vw,.875rem);--text-sm:clamp(.875rem,.8rem + .35vw,1rem);--text-base:clamp(1rem,.95rem + .25vw,1.125rem);--text-lg:clamp(1.125rem,1rem + .75vw,1.5rem);--text-xl:clamp(1.5rem,1.2rem + 1.25vw,2.25rem);--text-2xl:clamp(2rem,1.2rem + 2.5vw,3.5rem);--space-2:.5rem;--space-3:.75rem;--space-4:1rem;--space-5:1.25rem;--space-6:1.5rem;--space-8:2rem;--space-10:2.5rem;--space-12:3rem;--space-16:4rem;--radius-sm:.375rem;--radius-md:.75rem;--radius-lg:1rem;--radius-xl:1.5rem;--color-bg:#efe5d2;--color-surface:#f8f1e4;--color-surface-2:#f3ead9;--color-border:#c9b89d;--color-text:#302417;--color-text-muted:#6e5f4c;--color-primary:#7b4c1f;--color-primary-hover:#5d3916;--shadow-sm:0 8px 24px rgba(62,41,18,.10);--shadow-lg:0 25px 70px rgba(62,41,18,.18);--font-display:'Cormorant Garamond', Georgia, serif;--font-body:'Inter', Arial, sans-serif}
    [data-theme="dark"]{--color-bg:#15110d;--color-surface:#211a14;--color-surface-2:#2a2119;--color-border:#4b3b2e;--color-text:#f0e4cf;--color-text-muted:#baa98f;--color-primary:#c29158;--color-primary-hover:#ddb37f;--shadow-sm:0 8px 24px rgba(0,0,0,.25);--shadow-lg:0 25px 70px rgba(0,0,0,.4)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at top,rgba(194,145,88,.10),transparent 30%),var(--color-bg);color:var(--color-text);font:400 var(--text-base)/1.65 var(--font-body)}img{display:block;max-width:100%;height:auto}a{color:inherit}button{font:inherit}
    .skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;background:var(--color-surface);padding:.75rem 1rem;border-radius:.5rem;z-index:100}
    .wrap{max-width:1320px;margin:0 auto;padding:0 var(--space-4)}
    /* Scoped to the site header only. A bare \`header\` selector would also catch
       the <header> inside each .continent block and make it a second sticky bar. */
    body > header{position:sticky;top:0;z-index:25;background:color-mix(in srgb,var(--color-bg) 80%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
    .nav{display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);padding:var(--space-4) 0}
    .brand{display:flex;align-items:center;gap:var(--space-3);text-decoration:none}
    .brand strong{font:700 var(--text-lg)/1 var(--font-display);letter-spacing:.04em}
    .brand svg{width:38px;height:38px;color:var(--color-primary)}
    .nav-links{display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center}
    .nav-links a,.theme-toggle{min-height:44px;padding:0 .95rem;display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);text-decoration:none}
    h1,h2,h3{font-family:var(--font-display);line-height:1.05;margin:0}
    h1{font-size:var(--text-2xl);margin:var(--space-4) 0}
    .eyebrow{display:inline-flex;align-items:center;gap:var(--space-2);padding:.3rem .75rem;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface-2);color:var(--color-text-muted);font-size:var(--text-sm)}
    .lead{max-width:56ch;color:var(--color-text-muted)}
    .hero{padding:var(--space-12) 0 var(--space-8)}
    .hero-book{display:grid;grid-template-columns:1.05fr .95fr;gap:var(--space-8);align-items:center;background:linear-gradient(180deg,color-mix(in srgb,var(--color-surface) 92%,white 8%),var(--color-surface));border:1px solid var(--color-border);box-shadow:var(--shadow-lg);border-radius:var(--radius-xl);overflow:hidden}
    .hero-copy{padding:clamp(1.5rem,3vw,3rem)}
    .hero-aside{padding:clamp(1rem,2vw,1.5rem);background:repeating-linear-gradient(90deg,transparent,transparent 28px,rgba(0,0,0,.03) 28px,rgba(0,0,0,.03) 29px),var(--color-surface-2);height:100%;display:flex;align-items:center;justify-content:center}
    .hero-aside picture{display:block;width:100%;max-width:520px}
    .hero-aside img{width:100%;max-width:520px;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius-lg);border:1px solid var(--color-border);box-shadow:var(--shadow-sm)}
    .intro-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4);margin-top:var(--space-6)}
    .intro-card{padding:var(--space-4);background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-lg)}
    section{padding:var(--space-8) 0}
    .section-top{display:flex;justify-content:space-between;gap:var(--space-4);align-items:end;margin-bottom:var(--space-6)}
    .section-top p{margin:0;max-width:58ch;color:var(--color-text-muted)}
    .atlas-shelf{display:grid;gap:var(--space-8)}
    /* Sundering / continent overview */
    .sunder{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.8fr);gap:var(--space-8);align-items:center;padding:var(--space-6);background:linear-gradient(180deg,color-mix(in srgb,var(--color-surface) 94%,white 6%),var(--color-surface));border:1px solid var(--color-border);border-radius:var(--radius-xl);box-shadow:var(--shadow-sm)}
    .sunder blockquote{margin:var(--space-4) 0 0;padding-left:var(--space-4);border-left:3px solid var(--color-primary);font:600 var(--text-lg)/1.35 var(--font-display);color:var(--color-text)}
    .sunder blockquote cite{display:block;margin-top:var(--space-2);font:400 var(--text-sm)/1.5 var(--font-body);font-style:normal;color:var(--color-text-muted)}
    .muted{color:var(--color-text-muted)}
    .continent-list{display:grid;gap:var(--space-2);margin:0;padding:0;list-style:none}
    .continent-list li{display:flex;align-items:center;gap:var(--space-3);padding:.55rem .75rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface-2);font-size:var(--text-sm)}
    .continent-list .num{flex:0 0 2.1rem;height:2.1rem;display:grid;place-items:center;border-radius:999px;border:1px solid var(--color-border);font:600 var(--text-xs)/1 var(--font-body);letter-spacing:.04em;color:var(--color-text-muted)}
    .continent-list li[data-charted] .num{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
    .continent-list li[data-charted]{border-color:var(--color-primary)}
    .continent-list .unknown{color:var(--color-text-muted);font-style:italic}
    /* Continent grouping inside the atlas */
    .continent{display:grid;gap:var(--space-6)}
    .continent + .continent{margin-top:var(--space-12)}
    .continent-head{display:grid;gap:var(--space-3);padding:var(--space-5) var(--space-6);background:var(--color-surface-2);border:1px solid var(--color-border);border-left:4px solid var(--color-primary);border-radius:var(--radius-lg)}
    .continent-head h3{font-size:var(--text-xl)}
    .continent-head p{margin:0;max-width:70ch;color:var(--color-text-muted)}
    .continent-head .eyebrow{justify-self:start}
    .pending{font-size:var(--text-xs);letter-spacing:.1em;text-transform:uppercase;color:var(--color-text-muted);border:1px dashed var(--color-border);border-radius:999px;padding:.2rem .6rem;display:inline-block}
    /* Index + tag filters */
    .atlas-index{display:grid;gap:var(--space-4);padding:var(--space-5) var(--space-6);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg)}
    .index-head{display:flex;flex-wrap:wrap;gap:var(--space-3);justify-content:space-between;align-items:baseline}
    .index-note{margin:0;color:var(--color-text-muted);font-size:var(--text-sm)}
    .index-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--space-2)}
    .index-list a{display:grid;grid-template-columns:2.6rem 1fr;gap:.2rem var(--space-3);align-items:baseline;padding:.5rem .7rem;border:1px solid transparent;border-radius:var(--radius-md);text-decoration:none}
    .index-list a:hover,.index-list a:focus-visible{border-color:var(--color-border);background:var(--color-surface-2)}
    .ix-no{font-size:var(--text-xs);letter-spacing:.12em;color:var(--color-text-muted)}
    .ix-name{font-weight:600}
    .ix-type{grid-column:2;font-size:var(--text-xs);color:var(--color-text-muted)}
    .index-list a[data-dimmed]{opacity:.32}
    .filters{display:flex;flex-wrap:wrap;gap:var(--space-2)}
    .chip{min-height:36px;padding:0 .8rem;display:inline-flex;align-items:center;gap:.4rem;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface-2);color:inherit;cursor:pointer;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.08em}
    .chip:hover{border-color:var(--color-primary)}
    .chip.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
    .chip-n{opacity:.65;font-variant-numeric:tabular-nums}
    .filter-empty{margin:0;color:var(--color-text-muted)}
    .atlas-page{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:var(--space-6);padding:var(--space-6);background:linear-gradient(180deg,color-mix(in srgb,var(--color-surface) 94%,white 6%),var(--color-surface));border:1px solid var(--color-border);border-radius:var(--radius-xl);box-shadow:var(--shadow-sm);position:relative;overflow:hidden;--ar:1.333}
    .atlas-page::before{content:"";position:absolute;top:0;bottom:0;left:calc(58% - 12px);width:24px;background:linear-gradient(90deg,rgba(0,0,0,.09),rgba(255,255,255,.06) 35%,rgba(0,0,0,.10));opacity:.22;pointer-events:none}
    /* Skip layout, paint and decoded-image memory for maps that are off screen.
       The page is ~12,000px tall at 9 maps, and every map holds two large
       decoded bitmaps, which is what makes a long atlas heavy on a phone rather
       than the transfer size. contain-intrinsic-size keeps the scrollbar and
       anchor offsets stable while a page is skipped, and the auto keyword lets
       the real size take over once it has been rendered. Content stays findable
       and anchor-linkable, unlike display:none. */
    .atlas-page{content-visibility:auto;contain-intrinsic-size:auto var(--cis,1100px)}
    /* align-content:start stops the auto rows from stretching when the facing
       meta column is taller than the map - otherwise .compare-wrap grows past
       the image and the Original/Remastered labels float in dead space. */
    .page-visual{display:grid;gap:var(--space-4);align-content:start}
    /* --ar is written per page by the build from the image's real pixel ratio,
       so portrait and landscape maps both display whole. The vh cap stops tall
       portrait maps from running off the screen. */
    .compare-wrap{position:relative;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--color-border);background:var(--color-surface-2);touch-action:pan-y;user-select:none;-webkit-user-select:none;width:100%;max-width:min(100%, calc(96vh * var(--ar)));margin-inline:auto}
    /* Descendant selectors, not direct-child: each image sits inside a <picture>
       so AVIF can be offered ahead of WebP. picture is inline by default, which
       would leave a baseline gap under the map, hence display:block. */
    .compare-wrap picture{display:block}
    .compare-wrap img.img-base{display:block;width:100%;aspect-ratio:var(--ar);object-fit:cover;pointer-events:none}
    .img-after{position:absolute;top:0;left:0;bottom:0;width:50%;overflow:hidden}
    .img-after img{display:block;width:100%;aspect-ratio:var(--ar);object-fit:cover;max-width:none;pointer-events:none}
    .compare-divider{position:absolute;top:0;bottom:0;left:50%;width:3px;background:rgba(255,255,255,.88);transform:translateX(-50%);cursor:ew-resize;z-index:5;box-shadow:0 0 8px rgba(0,0,0,.45)}
    .compare-handle{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:999px;background:rgba(255,255,255,.92);border:2px solid var(--color-border);display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-sm);cursor:ew-resize;color:#2b2118}
    .compare-label{position:absolute;bottom:var(--space-3);padding:.25rem .6rem;border-radius:999px;font-size:var(--text-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;pointer-events:none;z-index:6}
    .compare-label.orig{left:var(--space-3);background:rgba(30,20,10,.72);color:#fff}
    .compare-label.remas{right:var(--space-3);background:rgba(194,145,88,.85);color:#fff}
    /* Rendition switcher - only rendered when a map has more than one art pass */
    .rend-switch{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}
    .rend-hint{font-size:var(--text-xs);letter-spacing:.14em;text-transform:uppercase;color:var(--color-text-muted)}
    .rend{min-height:36px;padding:0 .8rem;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface-2);color:inherit;cursor:pointer;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.08em}
    .rend:hover{border-color:var(--color-primary)}
    .rend.is-active{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
    .page-meta{display:grid;gap:var(--space-4);align-content:start}
    .page-no{font-size:var(--text-xs);letter-spacing:.22em;text-transform:uppercase;color:var(--color-text-muted)}
    .page-no a{text-decoration:none}
    .page-no a:hover,.page-no a:focus-visible{color:var(--color-primary);text-decoration:underline}
    .page-summary{margin:.5rem 0 0;color:var(--color-text-muted)}
    .page-prose{color:var(--color-text-muted)}
    .location{display:grid;gap:var(--space-3);padding:var(--space-4);background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-lg)}
    .label{font-size:var(--text-xs);letter-spacing:.18em;text-transform:uppercase;color:var(--color-text-muted)}
    .tags,.actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
    .tag{padding:.28rem .65rem;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface-2);font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.08em}
    .btn{min-height:44px;padding:0 1rem;border-radius:999px;border:1px solid var(--color-border);background:var(--color-surface);color:inherit;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
    .btn.primary{background:var(--color-primary);border-color:var(--color-primary);color:#fff}
    .btn.primary:hover{background:var(--color-primary-hover)}
    .notes{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-4)}
    .note{padding:var(--space-4);border-radius:var(--radius-lg);border:1px solid var(--color-border);background:var(--color-surface)}
    footer{padding:var(--space-10) 0 var(--space-12);color:var(--color-text-muted)}
    /* Full-resolution viewer */
    .viewer{position:fixed;inset:0;background:rgba(8,6,4,.94);display:none;z-index:60;touch-action:none}
    .viewer.open{display:block}
    .viewer-stage{position:absolute;inset:0;overflow:hidden;cursor:grab}
    .viewer-stage.is-panning{cursor:grabbing}
    .viewer-stage img{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;max-width:none;image-rendering:auto}
    .viewer-bar{position:absolute;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;justify-content:space-between;padding:var(--space-3) var(--space-4);background:linear-gradient(0deg,rgba(8,6,4,.92),transparent);color:#f0e4cf;font-size:var(--text-xs)}
    .viewer-meta{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center;letter-spacing:.06em;text-transform:uppercase}
    .viewer-actions{display:flex;gap:var(--space-2);align-items:center}
    .viewer-btn{min-height:40px;min-width:40px;padding:0 .8rem;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(24,18,12,.85);color:#f0e4cf;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.4rem}
    .viewer-btn:hover{border-color:var(--color-primary);color:#fff}
    .viewer-close{position:absolute;top:var(--space-4);right:var(--space-4);z-index:2}
    .viewer-hint{position:absolute;top:var(--space-4);left:var(--space-4);padding:.4rem .7rem;border-radius:999px;background:rgba(24,18,12,.8);color:#baa98f;font-size:var(--text-xs);letter-spacing:.06em}
    @media(max-width:980px){.hero-book,.atlas-page,.notes,.intro-grid,.sunder{grid-template-columns:1fr}.atlas-page::before{display:none}
    /* single column stacks the two halves, so the card is much taller here */
    .atlas-page{contain-intrinsic-size:auto var(--cis-m,1700px)}}
    @media(max-width:700px){.section-top{display:grid}.nav{align-items:flex-start;flex-direction:column}.nav-links{width:100%}.notes{grid-template-columns:1fr}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;

// ------------------------------------------------------------------- script

const SCRIPT = String.raw`
    (function(){
      const root = document.documentElement;
      const toggle = document.querySelector('[data-theme-toggle]');
      let dark = matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      toggle?.addEventListener('click', () => {
        dark = !dark;
        root.setAttribute('data-theme', dark ? 'dark' : 'light');
      });

      /* ---------- compare sliders ---------- */
      function initCompare(wrap) {
        const afterPanel = wrap.querySelector('.img-after');
        const afterImg   = afterPanel.querySelector('img');
        const divider    = wrap.querySelector('.compare-divider');
        let dragging = false;

        function applyPct(p) {
          const pct = Math.min(100, Math.max(0, p));
          divider.style.left = pct + '%';
          afterPanel.style.width = pct + '%';
          afterImg.style.width = wrap.offsetWidth + 'px';
        }
        function posFromX(clientX) {
          const r = wrap.getBoundingClientRect();
          if (!r.width) return;
          applyPct(((clientX - r.left) / r.width) * 100);
        }
        function initPos() {
          afterImg.style.width = wrap.offsetWidth + 'px';
          applyPct(50);
        }

        /* Sized immediately - the CSS aspect-ratio means the wrap has its final
           width before the image loads, so the overlay is never left squashed
           into the 50% panel while a lazy image is still on the wire. */
        initPos();
        const baseImg = wrap.querySelector('img.img-base');
        if (!baseImg.complete) baseImg.addEventListener('load', initPos);
        window.addEventListener('resize', initPos);

        divider.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
        document.addEventListener('mousemove', e => { if (dragging) posFromX(e.clientX); });
        document.addEventListener('mouseup',   () => { dragging = false; });

        wrap.addEventListener('touchstart', e => { dragging = true; posFromX(e.touches[0].clientX); }, { passive: true });
        wrap.addEventListener('touchmove',  e => { if (!dragging) return; e.preventDefault(); posFromX(e.touches[0].clientX); }, { passive: false });
        wrap.addEventListener('touchend',    () => { dragging = false; });
        wrap.addEventListener('touchcancel', () => { dragging = false; });
      }
      document.querySelectorAll('.compare-wrap').forEach(initCompare);

      /* ---------- rendition switcher ----------
         Repoints the slider's base layer at a different art pass. The overlay
         (the original scan) never changes, so the comparison is always against
         the author's drawing. Only the selected rendition is ever fetched, so
         extra art passes cost page weight only when someone asks for one. */
      document.querySelectorAll('.rend-switch').forEach(group => {
        const page    = group.closest('.atlas-page');
        const wrap    = page.querySelector('.compare-wrap');
        const baseImg = wrap.querySelector('img.img-base');
        /* The AVIF <source> wins over the img's own srcset, so swapping only
           the img would leave an AVIF-capable browser showing the old art. */
        const baseAvif = baseImg.closest('picture')?.querySelector('source[type="image/avif"]');
        const label   = wrap.querySelector('[data-active-label]');
        const openBtn = page.querySelector('[data-open-active]');
        const noun    = openBtn?.querySelector('[data-active-noun]');
        const buttons = [...group.querySelectorAll('.rend')];

        buttons.forEach(btn => btn.addEventListener('click', () => {
          if (btn.classList.contains('is-active')) return;
          const d = btn.dataset;

          buttons.forEach(b => {
            const on = b === btn;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', String(on));
          });

          /* AVIF source first, then the img's own srcset, then src - the
             browser re-runs selection once the whole set is consistent. */
          if (baseAvif) baseAvif.srcset = d.avif;
          baseImg.srcset = d.srcset;
          baseImg.src    = d.src;
          baseImg.width  = d.w;
          baseImg.height = d.h;
          baseImg.alt    = d.label + ' map of ' + (page.dataset.title || '');
          page.style.setProperty('--ar', d.ar);
          if (label) label.textContent = d.label;

          if (openBtn) {
            openBtn.dataset.view  = d.master;
            openBtn.dataset.alt   = d.label + ' map of ' + (page.dataset.title || '');
            openBtn.dataset.dims  = d.masterDims;
            openBtn.dataset.size  = d.masterSize;
            openBtn.dataset.event = d.event;
            /* One text node, not "Open " + span: .btn is inline-flex, and a
               whitespace-only text node between flex items is dropped, which
               rendered as "Openretouched". */
            if (noun) noun.textContent = 'Open ' + d.label.toLowerCase();
          }

          /* The overlay width is derived from the wrap, which the new aspect
             ratio may have resized. */
          window.dispatchEvent(new Event('resize'));
        }));
      });

      /* ---------- full-resolution viewer ---------- */
      const viewer   = document.getElementById('viewer');
      const stage    = viewer.querySelector('.viewer-stage');
      const vImg     = document.getElementById('viewerImage');
      const vDims    = document.getElementById('viewerDims');
      const vSize    = document.getElementById('viewerSize');
      const vZoom    = document.getElementById('viewerZoom');
      const vDownload= document.getElementById('viewerDownload');
      const vClose   = document.getElementById('viewerClose');
      const vUpgrade = document.getElementById('viewerUpgrade');

      let scale = 1, fit = 1, tx = 0, ty = 0;
      const pointers = new Map();
      let pinchFrom = null;

      function render() {
        vImg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
        vZoom.textContent = Math.round((scale / fit) * 100) + '%';
      }
      function clamp() {
        const vw = stage.clientWidth, vh = stage.clientHeight;
        const w = vImg.naturalWidth * scale, h = vImg.naturalHeight * scale;
        /* Centre on whichever axis fits; otherwise keep the image covering the stage. */
        tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx));
        ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty));
      }
      function fitToStage() {
        const vw = stage.clientWidth, vh = stage.clientHeight;
        fit = Math.min(vw / vImg.naturalWidth, vh / vImg.naturalHeight);
        scale = fit; clamp(); render();
      }
      function zoomAt(cx, cy, next) {
        const min = fit, max = Math.max(fit * 1.05, 2);
        const k = Math.min(max, Math.max(min, next));
        const r = stage.getBoundingClientRect();
        const px = cx - r.left, py = cy - r.top;
        tx = px - ((px - tx) * k) / scale;
        ty = py - ((py - ty) * k) / scale;
        scale = k; clamp(); render();
      }

      /* On a narrow screen the master is the single most expensive thing on the
         page - up to 4.2 MB for one tap, on the connection least able to afford
         it. Open the display image the page has already downloaded instead:
         instant, zero extra bytes, and enough pixels to zoom usefully on a
         phone. Full resolution stays one deliberate tap away. */
      const NARROW_VIEWPORT = 820;
      const preferPreview = () => window.innerWidth <= NARROW_VIEWPORT;
      let pendingMaster = null;

      function showUpgrade(btn) {
        pendingMaster = {
          src: btn.dataset.view,
          dims: btn.dataset.dims || '',
          size: btn.dataset.size || '',
        };
        vUpgrade.hidden = false;
        vUpgrade.textContent = 'Load full resolution (' + pendingMaster.size + ')';
      }

      function loadMaster() {
        if (!pendingMaster) return;
        const { src, dims, size } = pendingMaster;
        vUpgrade.hidden = true;
        vUpgrade.textContent = 'Loading...';
        pendingMaster = null;
        vImg.addEventListener('load', () => { fitToStage(); reportDims(); }, { once: true });
        vImg.src = src;
        vDims.textContent = dims;
        vSize.textContent = size;
      }

      /* Reuse the exact file the page already downloaded, rather than a fixed
         URL: the browser may have chosen AVIF or WebP, and the narrow or large
         tier, so only currentSrc is guaranteed to be a cache hit. */
      function cachedPreviewFor(btn) {
        const page = btn.closest('.atlas-page');
        if (!page) return null;
        const el = btn.hasAttribute('data-open-active')
          ? page.querySelector('img.img-base')
          : page.querySelector('.img-after img');
        if (!el || !el.currentSrc || !el.naturalWidth) return null;
        /* Only the URL is taken from here. naturalWidth on a srcset-selected
           image is density-corrected to CSS pixels - a 700w file in a 334px
           slot reports 334 - so the real size is read off the viewer's own
           <img>, which has no srcset, once it has loaded. */
        return { src: el.currentSrc };
      }

      /** True file dimensions: the viewer img carries no srcset. */
      function reportDims() {
        if (vImg.naturalWidth) vDims.textContent = vImg.naturalWidth + '×' + vImg.naturalHeight;
      }

      function openViewer(btn) {
        vImg.removeAttribute('src');
        vImg.removeAttribute('srcset');
        vUpgrade.hidden = true;
        pendingMaster = null;

        const preview = preferPreview() ? cachedPreviewFor(btn) : null;

        vImg.alt = btn.dataset.alt || '';
        if (preview) {
          vImg.src = preview.src;
          vDims.textContent = '';
          vSize.textContent = 'preview';
          showUpgrade(btn);
        } else {
          vImg.src = btn.dataset.view;
          vDims.textContent = btn.dataset.dims || '';
          vSize.textContent = btn.dataset.size || '';
        }
        /* The download link always points at the true master, whatever is shown. */
        vDownload.href = btn.dataset.view;

        viewer.classList.add('open');
        viewer.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        if (vImg.complete && vImg.naturalWidth) { fitToStage(); reportDims(); }
        else vImg.addEventListener('load', () => { fitToStage(); reportDims(); }, { once: true });
      }
      function closeViewer() {
        viewer.classList.remove('open');
        viewer.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        vImg.removeAttribute('src');
        vUpgrade.hidden = true;
        pendingMaster = null;
        pointers.clear();
      }

      /* The atlas is one page, so a plain pageview says nothing about which map
         anyone looked at. Counting viewer opens is the useful signal. Guarded
         because count.js is async and may not have executed yet - a missed
         event is acceptable, a broken viewer is not. */
      function countViewerOpen(btn) {
        const name = btn.dataset.event;
        if (!name) return;
        try {
          window.goatcounter?.count?.({ path: name, title: 'Viewer: ' + (btn.dataset.alt || name), event: true });
        } catch {}
      }

      document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => { openViewer(btn); countViewerOpen(btn); });
      });
      vClose.addEventListener('click', closeViewer);
      vUpgrade.addEventListener('click', loadMaster);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && viewer.classList.contains('open')) closeViewer();
      });
      window.addEventListener('resize', () => { if (viewer.classList.contains('open')) fitToStage(); });

      stage.addEventListener('wheel', e => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
      }, { passive: false });

      stage.addEventListener('dblclick', e => {
        zoomAt(e.clientX, e.clientY, Math.abs(scale - fit) < 1e-6 ? 1 : fit);
      });

      stage.addEventListener('pointerdown', e => {
        /* Throws if the pointer is not active (and for synthetic events), which
           must not abort the drag setup below. */
        try { stage.setPointerCapture(e.pointerId); } catch {}
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        stage.classList.add('is-panning');
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchFrom = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
        }
      });
      stage.addEventListener('pointermove', e => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        pointers.set(e.pointerId, cur);

        if (pointers.size === 2 && pinchFrom) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinchFrom.scale * (dist / pinchFrom.dist));
        } else if (pointers.size === 1) {
          tx += cur.x - prev.x; ty += cur.y - prev.y;
          clamp(); render();
        }
      });
      function endPointer(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchFrom = null;
        if (pointers.size === 0) stage.classList.remove('is-panning');
      }
      stage.addEventListener('pointerup', endPointer);
      stage.addEventListener('pointercancel', endPointer);

      /* ---------- tag filters ---------- */
      document.querySelectorAll('.atlas-index').forEach(index => {
        const continent = index.closest('.continent');
        const pages = [...continent.querySelectorAll('.atlas-page')];
        const empty = index.querySelector('.filter-empty');
        const chips = [...index.querySelectorAll('.chip')];

        chips.forEach(chip => chip.addEventListener('click', () => {
          const tag = chip.dataset.filter;
          chips.forEach(c => c.classList.toggle('is-active', c === chip));
          let shown = 0;
          pages.forEach(page => {
            const tags = (page.dataset.tags || '').split('|');
            const match = tag === 'all' || tags.includes(tag);
            page.hidden = !match;
            if (match) shown++;
            const link = index.querySelector('[data-index-for="' + page.id + '"]');
            if (link) link.toggleAttribute('data-dimmed', !match);
          });
          empty.hidden = shown > 0;
        }));
      });
    })();`;

/**
 * Analytics tag. Served from our own origin rather than the gc.zgo.at CDN,
 * which Pi-hole and the common blocklists blackhole - that silently undercounts
 * rather than failing loudly. count.js reads its endpoint from the
 * data-goatcounter attribute, so this behaves identically to the hosted script.
 * Omit the `analytics` block from the manifest to ship no tracking at all.
 */
function analyticsTag(analytics) {
  if (!analytics?.endpoint || !analytics?.script) return '';
  return `  <script data-goatcounter="${esc(analytics.endpoint)}" src="${esc(
    analytics.script
  )}" async></script>\n`;
}

// -------------------------------------------------------------------- render

async function render(manifest) {
  const { site, introCards, world, notes, continents } = manifest;

  // Resolve every image up front so dimensions come from the files.
  for (const continent of continents) {
    for (const map of continent.maps) {
      map._rends = await resolveRenditions(continent.id, map, manifest.renditions);
      const versions = map._rends.filter((r) => r.role !== 'base');
      if (!map._rends.some((r) => r.role === 'base') || !versions.length) {
        throw new Error(
          `${map.slug}: needs the base scan plus at least one rendition, found ` +
            `[${map._rends.map((r) => r.id).join(', ') || 'nothing'}]`
        );
      }
      map._active = versions.at(-1);
    }
  }

  const hero = continents
    .flatMap((c) => c.maps)
    .find((m) => `${continents[0].id}/${m.slug}` === site.heroImage) ?? continents[0].maps[0];

  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const chartedIds = new Set(continents.map((c) => c.id));

  const continentRows = roman
    .map((numeral, i) => {
      const c = continents[i];
      if (c && chartedIds.has(c.id)) {
        return `            <li data-charted><span class="num">${numeral}</span><span><strong>${esc(
          c.name
        )}</strong><br><span class="unknown">${esc(c.tagline ?? 'Home of the humans - seat of the ruling King')}</span></span></li>`;
      }
      return `            <li><span class="num">${numeral}</span><span class="unknown">Uncharted</span></li>`;
    })
    .join('\n');

  const continentBlocks = continents
    .map(
      (c) => `
      <article class="continent" id="${esc(c.id)}">
        <header class="continent-head">
          <span class="eyebrow">${esc(c.eyebrow)}</span>
          <h3>${esc(c.name)}</h3>
          <p>${esc(c.blurb)}${
        c.namePending ? ` <span class="pending">Continent name awaiting the author</span>` : ''
      }</p>
        </header>
${continentIndex(c)}
        <div class="atlas-shelf">
${c.maps.map((m) => mapArticle(m, m._rends)).join('\n')}
        </div>
      </article>`
    )
    .join('\n');

  const html = `<!doctype html>
<!--
  GENERATED FILE - DO NOT EDIT BY HAND.
  Content lives in data/maps.json. Rebuild with:  npm run all
  Editing this file directly means your changes are lost on the next build.
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(site.title)}</title>
  <meta name="description" content="${esc(site.description)}">
  <link rel="canonical" href="${esc(site.url)}">
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(site.title)}">
  <meta property="og:title" content="${esc(site.title)} - ${esc(site.heroHeading)}">
  <meta property="og:description" content="${esc(site.description)}">
  <meta property="og:url" content="${esc(site.url)}">
  <meta property="og:image" content="${esc(site.url)}assets/social-card.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="A remastered map from the world of Arda">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(site.title)}">
  <meta name="twitter:description" content="${esc(site.description)}">
  <meta name="twitter:image" content="${esc(site.url)}assets/social-card.jpg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${STYLES}
  </style>
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header>
    <div class="wrap nav">
      <a class="brand" href="#top" aria-label="${esc(site.title)} home">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M13 14h34a7 7 0 0 1 7 7v28a2 2 0 0 1-3 1.7L41 45H17a7 7 0 0 1-7-7V21a7 7 0 0 1 7-7Z"/><path d="M24 14v31m10-23h10m-10 8h10"/></svg>
        <strong>${esc(site.title)}</strong>
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="#world">The World</a>
        <a href="#atlas">Atlas</a>
        <a href="#notes">Notes</a>
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch theme">Theme</button>
      </nav>
    </div>
  </header>

  <main id="content" class="wrap">
    <section class="hero" id="top">
      <div class="hero-book">
        <div class="hero-copy">
          <span class="eyebrow">${esc(site.heroEyebrow)}</span>
          <h1>${esc(site.heroHeading)}</h1>
          <p class="lead">${esc(site.heroLead)}</p>
          <div class="intro-grid">
${introCards
  .map((c) => `            <div class="intro-card"><strong>${esc(c.title)}</strong><br>${esc(c.body)}</div>`)
  .join('\n')}
          </div>
        </div>
        <div class="hero-aside">
          <picture>
            <source type="image/avif" srcset="${esc(
              srcsetAttr(hero._active.avifNarrow, hero._active.avifLarge)
            )}" sizes="${esc(HERO_SIZES)}">
            <img src="${esc(hero._active.display.rel)}" srcset="${esc(
    srcsetAttr(hero._active.narrow, hero._active.display)
  )}" sizes="${esc(HERO_SIZES)}" alt="${esc(hero._active.label)} map of ${esc(
    hero.title
  )}" width="${hero._active.display.w}" height="${
    hero._active.display.h
  }" loading="eager" fetchpriority="high">
          </picture>
        </div>
      </div>
    </section>

    <section id="world">
      <div class="section-top">
        <div><h2>The sundering of Arda</h2></div>
        <p>Why the atlas is organised by continent, and how much of the world is still uncharted.</p>
      </div>
      <div class="sunder">
        <div>
          <span class="eyebrow">World lore - from the author</span>
          <blockquote>
            ${esc(world.loreQuote)}
            <cite>${esc(world.loreAttribution)}</cite>
          </blockquote>
          <p class="muted">${esc(world.intro)}</p>
        </div>
        <div>
          <div class="label" style="margin-bottom:var(--space-3)">The seven continents</div>
          <ol class="continent-list">
${continentRows}
          </ol>
        </div>
      </div>
    </section>

    <section id="atlas">
      <div class="section-top">
        <div><h2>Atlas pages</h2></div>
        <p>Drag the slider on each map to compare the original hand-drawn scan with the remastered version.</p>
      </div>
${continentBlocks}
    </section>

    <section id="notes">
      <div class="section-top">
        <div><h2>About this atlas</h2></div>
      </div>
      <div class="notes">
${notes.map((n) => `        <div class="note"><strong>${esc(n.title)}</strong><br>${esc(n.body)}</div>`).join('\n')}
      </div>
    </section>
  </main>

  <footer class="wrap">
    ${esc(site.footer)}
  </footer>

  <div class="viewer" id="viewer" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Full-resolution map viewer">
    <div class="viewer-stage">
      <img id="viewerImage" alt="">
    </div>
    <span class="viewer-hint">Scroll or pinch to zoom - drag to pan - double-click to toggle</span>
    <button class="viewer-btn viewer-close" type="button" id="viewerClose" aria-label="Close viewer">&#x2715;</button>
    <div class="viewer-bar">
      <div class="viewer-meta">
        <span id="viewerDims"></span>
        <span id="viewerSize"></span>
        <span>Zoom <span id="viewerZoom">100%</span></span>
      </div>
      <div class="viewer-actions">
        <button class="viewer-btn" type="button" id="viewerUpgrade" hidden>Load full resolution</button>
        <a class="viewer-btn" id="viewerDownload" href="" download>Download full resolution</a>
      </div>
    </div>
  </div>

  <script>${SCRIPT}
  </script>
${analyticsTag(manifest.analytics)}</body>
</html>
`;

  return html;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'maps.json'), 'utf8'));
  const html = await render(manifest);
  const out = path.join(ROOT, 'index.html');
  await fs.writeFile(out, html, 'utf8');

  const mapCount = manifest.continents.reduce((n, c) => n + c.maps.length, 0);
  let display = 0;
  let masters = 0;
  const perRendition = {};
  for (const c of manifest.continents) {
    for (const m of c.maps) {
      for (const r of m._rends) {
        perRendition[r.id] = (perRendition[r.id] ?? 0) + 1;
        masters += r.master.bytes;
      }
      // Only the base scan and the active rendition load on a page view.
      display += m._rends.find((r) => r.role === 'base').display.bytes + m._active.display.bytes;
    }
  }

  console.log(`wrote index.html  (${(html.length / 1024).toFixed(1)} KB, ${html.split('\n').length} lines)`);
  console.log(`  continents: ${manifest.continents.length}   maps: ${mapCount}`);
  console.log(`  renditions found: ${Object.entries(perRendition).map(([k, v]) => `${k} x${v}`).join(', ')}`);
  console.log(`  full-scroll image weight (large tier, active rendition only): ${mb(display)}`);
  console.log(`  all masters held for the viewer only:                        ${mb(masters)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

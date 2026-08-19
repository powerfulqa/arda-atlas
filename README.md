# Atlas of Arda

A book-style fantasy map atlas for the world of Arda.

Each page shows the original hand-drawn D&D map scan alongside a Warcraft-style remastered
version, with location notes, region, lore and tags.

## Live site

https://powerfulqa.github.io/arda-atlas

## The world

> Arda was originally a massive pangaea, but after a night of disaster when the world was
> still young, current-day Arda is now broken up into seven geographically distinct continents.

The archive is organised the same way. Each continent gets its own directory under `maps/`
and its own group of pages on the site.

| Continent | Directory | Status |
|---|---|---|
| One - home of the humans, seat of the ruling King | `maps/continent-1/` | 9 maps charted |
| Two to Seven | - | uncharted |

Continent One has no canonical name yet. When the author supplies one, rename the directory
and update `name` in `data/maps.json`.

---

## `index.html` is generated - do not edit it

All content lives in **`data/maps.json`**. `index.html` is written by the build and any hand
edit is lost on the next run. The file carries a banner saying so.

```
data/maps.json            <- the only file you edit for content
tools/build-derivatives.mjs  <- makes the display-size images
tools/build-site.mjs         <- writes index.html from the manifest
tools/verify.mjs             <- checks the result
tools/serve.mjs              <- local preview server
index.html                <- GENERATED
```

## Setup

```
npm install
```

Requires Node 18+ (developed on 24). The only dependency is `sharp`, for image processing.

## Adding a new map

1. Create `maps/continent-<n>/<location-slug>/` and drop in the masters: the scan as
   `original.<ext>`, plus at least one art pass (`remaster.png`, `retouched.png`, ...).
   See [Art passes](#art-passes-renditions).
2. Add an entry to the continent's `maps` array in `data/maps.json`:

```json
{
  "page": 10,
  "slug": "new-place",
  "title": "New Place",
  "summary": "One line describing the map.",
  "location": "Known settlement",
  "region": "...",
  "landmark": "...",
  "type": "Village - highland",
  "status": "Remastered",
  "tags": ["Village", "Forest"],
  "onMap": "What is visibly drawn on the map.",
  "lore": null,
  "lorePending": true
}
```

3. Run the whole pipeline:

```
npm run all      # derivatives -> build -> verify
npm run serve    # preview at http://127.0.0.1:8899/
```

You never enter image dimensions or aspect ratios. The build reads them from the files, so
they cannot drift out of sync with the images the way hand-typed values did.

### `lore` and `lorePending`

- `lore`: the author's own lore. Renders as a paragraph.
- `lorePending: true`: renders the "Lore awaiting author notes" badge.

Where lore is pending, `onMap` should describe only what is **visibly drawn**, not invented
backstory - the author owns the canon.

### Page numbers

Page numbers are accession numbers: a map keeps the number it was given when it entered the
archive, forever. Never renumber existing pages when inserting a new one - append the next
free number, so any reference to "page 006" stays valid.

## How images are served

Four display variants per rendition (two widths x two formats), plus the master:

| Tier | File | Used by |
|---|---|---|
| Narrow | `display-*-700.avif` / `.webp` | 1x displays |
| Large | `display-*.avif` / `.webp` | 2x and 3x displays |
| Master | `original.*`, `remaster.png`, `retouched.png` | the full-resolution viewer |

AVIF is offered first through `<picture>`; WebP is the fallback for the ~5% of browsers
without AVIF. Masters are never fetched on page load.

Measured full-scroll transfer, at nine maps:

| Visitor | Before any of this | Now |
|---|---|---|
| 1x desktop | 52.4 MB | **1.81 MB** |
| 3x phone | 52.4 MB | **3.65 MB** |

### Why two widths

The compare slider is at most ~700 CSS px wide on desktop (measured 696-699; `.wrap` caps
at 1320 px so it does not grow) and ~334 px on a phone, so a 1x display was being sent an
image roughly twice as wide as it could show.

The narrow tier is generated **by width**, unlike the large tier which fits inside a
1400 px box - `srcset` descriptors are widths, and a portrait map fitted to a 1400 box is
only ~984 px wide. Adding a narrow tier rather than regenerating the large one by width
means high-DPR visitors download exactly what they did before, instead of more.

`sizes` is not optional. With `w` descriptors and no `sizes`, the browser assumes 100vw and
picks the largest candidate, undoing the whole thing. It is set to
`(max-width: 980px) calc(100vw - 80px), 700px`, matching the real grid.

AVIF must go in `<picture><source>`, never as a bare `srcset` candidate: `srcset` selects
on width and DPR only, so a browser without AVIF would pick one it cannot decode and show a
broken image. `npm run verify` fails if any `<img>` points straight at an AVIF.

### Mobile: the viewer opens what is already cached

Tapping a map used to pull the master - up to 4.2 MB, on the connection least able to
afford it. Below 820 px the viewer instead shows the image the page **has already
downloaded**, taken from that slider image's `currentSrc` so it is whatever the browser
actually chose (AVIF or WebP, narrow or large). Measured: **0 KB to open**. Full resolution
is one deliberate tap away, and the Download button always points at the true master.

One subtlety worth knowing if you touch this: `naturalWidth` on a `srcset`-selected image is
density-corrected to CSS pixels - a 700w file in a 334px slot reports 334 - so real file
dimensions are read from the viewer's own `<img>`, which carries no `srcset`.

### Offscreen maps are not rendered

`.atlas-page` uses `content-visibility: auto`, so the browser skips layout, paint and
decoded-image memory for maps that are off screen. On a long atlas that memory, not the
transfer size, is what makes a phone struggle.

`contain-intrinsic-size` is computed **per map, per layout**, from the aspect ratio and the
length of its prose, and emitted as `--cis` / `--cis-m`. One shared estimate drifted ~1,000
px over nine maps as they rendered in; per-map values bring that to 42 px on desktop (0.3%)
and 1.5% on mobile, where the single-column layout makes cards far taller. At 400 maps a
shared estimate would have meant tens of thousands of pixels of scrollbar creep.

### Room left, if it is ever wanted

- **A right-sized hero.** It renders at 520x390 but takes the 700 px tier, so it is still
  ~1.4x oversized. A dedicated 520 px tier would trim roughly 40 KB.
- **Self-hosted fonts** would remove two third-party origins and a render-blocking
  stylesheet from the critical path (currently 83.9 KB from `fonts.gstatic.com`). Worth
  more on mobile, where the extra DNS and TLS round trips cost most.
- **A middle ~1000 px tier.** A 3x phone needs ~1000 px, and for landscape maps it
  currently takes the 1400 px tier. Portrait maps are already close to right, so this only
  helps the minority of landscape maps.

Measured and deliberately **not** done: minifying HTML/CSS/JS (70 KB raw is 15.3 KB
gzipped) and cache tuning (Pages hardcodes `max-age=600` with no override).

### Storage ceiling still to solve

The derivative split fixed bandwidth, not storage. The masters still ship in the published
site so the viewer can reach them, so the site grows about 5.8 MB per map. **GitHub Pages
caps a published site at 1 GB**, which lands somewhere around 170 maps. When that
approaches, move the masters out of the published tree - GitHub Releases or a separate
archive repo - and point the `data-view` URLs at their new home.

## Art passes (renditions)

A map can carry several versions of the art. They are **discovered on disk**, not listed per
map, so a new pass rolls out one map at a time with no JSON to edit.

Configured once, oldest first, in `data/maps.json`:

```json
"renditions": [
  { "id": "original",  "label": "Original",  "basename": "original", "role": "base" },
  { "id": "remaster",  "label": "Remaster",  "basename": "remaster" },
  { "id": "retouched", "label": "Retouched", "basename": "retouched" }
]
```

The build looks for `<basename>.*` in each map directory and includes whatever it finds.

- The `role: "base"` rendition is the author's scan. It is always the **left** side of the
  compare slider and is never swapped.
- The slider defaults to the **newest** rendition present for that map.
- A map with two or more art passes gets a "Compare against" switcher. A map with one does
  not, so partial rollouts look deliberate rather than broken.
- **Only the selected rendition is fetched.** Older passes load on demand, so keeping the
  full history costs no page weight - measured: switching to the older pass fetched
  224 KB at that moment and nothing before.

### Adding a new art pass

1. Drop `retouched.png` into the map directory. **Keep the scan's aspect ratio.**
2. `npm run all`

That is the whole process. Do it for one map or all of them; the site copes with any mix.

### Aspect ratio is load-bearing

`--ar` comes from the selected rendition and is applied to **both** images via
`object-fit: cover`, so a rendition shaped differently from the scan crops the scan.
Current drift is 0.01-0.22%. `npm run verify` **fails the build** if any rendition is more
than 2% off its scan, so this cannot slip through unnoticed. If a future pass genuinely
needs a different shape, the slider needs decoupling first - ask.

### Two traps when replacing or reformatting files

Both are confirmed by test, and both fail *silently*:

- **Timestamps.** Derivatives regenerate only when the master is newer. `cp -p`, a restored
  archive and most sync tools preserve mtimes, so the new art gets committed while the site
  keeps serving the old one. After any bulk swap, finish with `npm run all -- --force`.
- **Mixed extensions.** Masters are matched by basename, and the first hit wins
  alphabetically. Leaving `remaster.png` next to a new `remaster.webp` silently keeps the
  `.png`. Delete the old file when changing format.

### Cost

Each extra rendition adds roughly 3.5 MB per map to the **published site** (the master, plus
its two display tiers). That brings forward the 1 GB Pages ceiling:

| Renditions per map | Published per map | Maps before the 1 GB limit |
|---|---|---|
| 2 (scan + remaster) | 6.9 MB | ~149 |
| 3 (plus retouched) | 11.1 MB | ~92 |

Note that **replacing** a master rather than adding one saves nothing in the repository -
git keeps the old blob forever either way. The only thing replacing saves is published-site
space, at the cost of losing the version history from the site.

## Analytics

GoatCounter, reporting to the same site as the portfolio: **https://powerfulqa.goatcounter.com**.
Both pages live under `powerfulqa.github.io`, so one dashboard covers both and the path
separates them - `/` for the portfolio, `/arda-atlas/` for the atlas.

Configured in `data/maps.json`. Delete the `analytics` block to ship no tracking at all.

```json
"analytics": {
  "provider": "goatcounter",
  "endpoint": "https://powerfulqa.goatcounter.com/count",
  "script": "assets/count.js",
  "countViewerOpens": true
}
```

### Why the script is vendored

`assets/count.js` is a pinned copy of GoatCounter's ISC-licensed script rather than the
hosted `//gc.zgo.at/count.js`. **Pi-hole and the common blocklists blackhole `gc.zgo.at`**,
which undercounts silently instead of failing loudly; `powerfulqa.goatcounter.com` is not on
those lists, so serving the script from our own origin gets materially more accurate counts.
Behaviour is identical - count.js reads its endpoint from the `data-goatcounter` attribute.

To refresh the pinned copy:

```
curl -o assets/count.js https://raw.githubusercontent.com/arp242/goatcounter/master/public/count.js
```

Then re-add the provenance header at the top of the file and run `npm run verify`.

### Excluding your own visits

A side effect of vendoring: if your network previously blocked `gc.zgo.at`, **your own
visits were never counted and now they will be.** To exclude this browser, load:

```
https://powerfulqa.github.io/arda-atlas/#toggle-goatcounter
```

It sets a `skipgc` flag in localStorage and confirms with an alert. Load it again to re-enable.
Per-browser, so repeat on each device.

### Which maps get looked at

The atlas is a single page, so a plain pageview would only ever record `/arda-atlas/` and
tell you nothing about the maps. Opening a map full-resolution therefore sends a GoatCounter
**event** named `view-<slug>-<original|remaster>`, e.g. `view-stormwind-district-remaster`.
These appear under Events in the dashboard, and show which maps people actually inspect and
whether they favour the hand-drawn scans or the remasters - worth passing back to the author.

`npm run verify` asserts the tag is present, points at the manifest's endpoint, is served
from our own origin rather than a CDN, and that all 18 viewer buttons carry unique event names.

### What it does and does not collect

Every request sends exactly: path, referrer, page title, an event flag, screen width, a
bot score, the query string, and a cache-busting random value. Verified against the payload
in a browser, not just the docs:

- **No cookies.** Confirmed empty cookie jar after a full page load.
- No localStorage identifier - the only key is `skipgc`, the opt-out above.
- No fingerprinting.
- Country and browser are derived server-side from IP and User-Agent, then the IP is discarded.

So it answers *how many, from where, via what, and which maps* - **never who**. There is no
per-person identity and no way to follow an individual between visits. That is deliberate on
GoatCounter's part and is why it generally needs no cookie banner.

Local visits are not counted: count.js refuses `localhost`, `127.*`, `192.168.*` and
`file:` URLs, so `npm run serve` never pollutes the stats.

## File naming rules

GitHub Pages serves from a case-sensitive Linux filesystem, so a mismatch that works on
Windows will 404 in production.

- **All lowercase.** `original.jpg`, not `Original.JPG`.
- **No spaces in directory names.** Use hyphens: `west-haven-district`.
- Keep the extension the file actually is.
- `npm run serve` matches paths case-sensitively on purpose, so this class of bug fails
  locally instead of only in production.

## Checks

`npm run verify` asserts that every referenced asset resolves case-sensitively, that no file
is orphaned, that every `width`/`height` matches real pixels, that each `--ar` matches its
base image, that the slider layers are the right way round (base = remaster, overlay =
original, so "Original" labels the left side), that sliders use only the display tier and
the viewer only masters, that ids are unique and tags balanced.

## Known gaps

- **The compare sliders are pointer-only.** There is no keyboard access to the divider.
- The theme choice is not persisted, and light-preference systems see a brief dark flash.
- The viewer does not trap focus or restore it to the triggering button on close.

## Hosting

Hosted via GitHub Pages, deploying from `main` branch root. `index.html` is committed
because Pages serves it as a static file - there is no build step on GitHub's side.

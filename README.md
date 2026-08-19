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

1. Create `maps/continent-<n>/<location-slug>/` and drop in the two masters:
   `original.<ext>` and `remaster.png`.
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
  "lorePending": true,
  "original": "original.jpg",
  "remaster": "remaster.png"
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

Three tiers, which is what keeps the site inside GitHub's limits:

| Tier | File | Used by | Size |
|---|---|---|---|
| Narrow | `display-*-700.webp` | 1x displays, via `srcset` | ~75-285 KB |
| Large | `display-*.webp` | 2x and 3x displays, via `srcset` | ~180-520 KB |
| Master | `original.*`, `remaster.png` | the full-resolution viewer only, on click | 2-4 MB |

The masters are never fetched on page load. Measured full-scroll transfer:

| Visitor | Image bytes |
|---|---|
| Before any of this | 52.4 MB |
| 1x display (most desktops) | **3.1 MB** |
| 2x / 3x display | 6.3 MB |

That is about 33,000 full-scroll views per month for 1x visitors, or 16,000 for high-DPR
ones, against Pages' 100 GB/month soft bandwidth limit.

### Why two display widths

The compare slider is at most ~700 CSS px wide on desktop (measured 696-699; `.wrap` caps
at 1320 px so it does not grow) and ~334 px on a phone. A 1x display was therefore being
sent an image roughly twice as wide as it could possibly show.

The narrow tier is generated **by width**, unlike the large tier which fits inside a
1400 px box - `srcset` descriptors are widths, and a portrait map fitted to a 1400 box is
only ~984 px wide. Adding a narrow tier rather than regenerating the large one by width
means high-DPR visitors download exactly what they did before, instead of more.

`sizes` is not optional here. With `w` descriptors and no `sizes`, the browser assumes
100vw and picks the largest candidate, which would undo the whole thing. It is set to
`(max-width: 980px) calc(100vw - 80px), 700px`, matching the real grid.

WebP quality 82. Re-runs skip anything already up to date; `npm run derivatives -- --force`
rebuilds everything.

### Room left, if it is ever wanted

- **AVIF** alongside WebP would cut a further ~48% (measured: 6.29 MB to 3.17 MB at the
  same dimensions), at ~0.39s per image of build time. This is the main lever left for
  **mobile**, which still gets the large tier because a 3x phone needs ~1000 px.
- **A right-sized hero.** It renders at 520x390 but the narrow tier is 700 px wide, so it
  is still ~2x oversized. A dedicated 520 px tier would take it to 75 KB WebP or 37 KB AVIF.
- **Self-hosted fonts** would remove two third-party origins and a render-blocking
  stylesheet from the critical path (currently 83.9 KB from `fonts.gstatic.com`).
- **`content-visibility: auto`** on `.atlas-page` would let the browser skip layout and
  paint for offscreen maps. Minor at 9 maps, significant at 400.

Measured and deliberately **not** done: minifying the HTML/CSS/JS (70 KB raw is 15.3 KB
gzipped, so there is nothing to win) and cache tuning (Pages hardcodes `max-age=600` and
offers no way to change it).

### Storage ceiling still to solve

The derivative split fixed bandwidth, not storage. The masters still ship in the published
site so the viewer can reach them, so the site grows about 5.8 MB per map. **GitHub Pages
caps a published site at 1 GB**, which lands somewhere around 170 maps. When that
approaches, move the masters out of the published tree - GitHub Releases or a separate
archive repo - and point the `data-view` URLs at their new home.

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

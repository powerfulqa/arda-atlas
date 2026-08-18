# Atlas of Arda

A book-style fantasy map atlas for the world of Arda.

Each page shows the original hand-drawn D&D map scan alongside a Warcraft-style remastered version, with location notes, region, lore and tags.

## Live site

https://powerfulqa.github.io/arda-atlas

## The world

> Arda was originally a massive pangaea, but after a night of disaster when the world was still young, current-day Arda is now broken up into seven geographically distinct continents.

The archive is organised the same way. Each continent gets its own directory under `maps/` and its own group of pages in `index.html`.

| Continent | Directory | Status |
|---|---|---|
| One - home of the humans, seat of the ruling King | `maps/continent-1/` | 9 maps charted |
| Two to Seven | - | uncharted |

Continent One has no canonical name yet. When the author supplies one, rename the directory and update the `#continent-1` heading in `index.html`.

## Structure

```
maps/
  continent-1/
    dragonfall/
      original.webp   - hand-drawn scan
      remaster.png    - Warcraft-style remaster
    dimrock/
    dragonfall-district/
    goregrond-district/
    helmsvard-district/
    stormwind-district/
    truessant-district/
    waveswater/
    west-haven-district/
index.html            - the whole site: styles, pages and compare slider
```

## File naming rules

These are not cosmetic. GitHub Pages serves from a case-sensitive Linux filesystem, so a
mismatch that works locally on Windows will 404 in production.

- **All lowercase.** `original.jpg`, not `Original.JPG`.
- **No spaces in directory names.** Use hyphens: `west-haven-district`, not `west haven district`.
- Keep the extension the file actually is. Do not rename a `.png` to `.jpg`.
- One directory per map, containing exactly `original.<ext>` and `remaster.png`.

## Adding a new map

1. Create `maps/continent-<n>/<location-slug>/` and drop in `original.<ext>` and `remaster.png`.
2. Read the real pixel dimensions of both files.
3. Copy an existing `<article class="atlas-page">` block in `index.html` and update:
   - `id` and the `id` on the inner `.compare-wrap` (`cmp-<slug>`)
   - **`style="--ar:<width/height>"`** on the article - the remaster's width divided by its
     height, to 3 decimal places. This drives the slider's aspect ratio. Get it wrong and the
     map is cropped.
   - both `src` paths and both `data-lightbox` paths
   - `width` and `height` on both `<img>` tags, matching the real pixel dimensions
   - the page number, title, description, location panel and tags
4. Confirm every path resolves before committing.

### Page numbers

Page numbers are accession numbers: a map keeps the number it was given when it entered the
archive, forever. Never renumber existing pages when inserting a new one - append the next
free number instead, so any reference to "page 006" stays valid.

### Aspect ratios in use

| Page | Map | `--ar` |
|---|---|---|
| 001 | Dragonfall | 1.387 (landscape) |
| 002 | Dimrock | 0.849 |
| 003 | Dragonfall District | 0.700 |
| 004 | Goregrond District | 0.725 |
| 005 | Helmsvard District | 0.705 |
| 006 | Stormwind District | 0.703 |
| 007 | Truessant District | 1.420 (landscape) |
| 008 | Waveswater | 0.734 |
| 009 | West Haven District | 0.700 |

## Lore status

Pages showing a "lore awaiting author notes" badge describe only what is visibly drawn on the
map. Replace that badge with the author's own lore as it arrives.

## Hosting

Hosted via GitHub Pages. Enable Pages in repo Settings > Pages > Deploy from main branch root.

# Atlas of Arda

A book-style fantasy map atlas for the world of Arda.

Each page shows the original hand-drawn D&D map scan alongside a Warcraft-style remastered version, with location notes, region, lore and tags.

## Live site

https://powerfulqa.github.io/arda-atlas

## Adding a new map

1. Add the original scan to `maps/<location-name>/original.jpg`
2. Add the remastered version to `maps/<location-name>/remaster.jpg`
3. Copy an existing `<article class="atlas-page">` block in `index.html` and update the content

## Structure

```
maps/
  dragonfall/
    original.jpg   — hand-drawn scan
    remaster.jpg   — Warcraft-style remaster
index.html         — main atlas gallery page
```

## Hosting

Hosted via GitHub Pages. Enable Pages in repo Settings → Pages → Deploy from main branch root.

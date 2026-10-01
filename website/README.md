# Etymon website

Static Astro site for [Etymon](https://github.com/landoncrabtree/etymon).

```bash
# From the repository root
npm ci
npm --prefix website ci
npm --prefix website run dev

# Production build and browser checks
npm --prefix website run format:check
npm --prefix website run check
npm --prefix website run build
npm --prefix website exec playwright install chromium
npm --prefix website test
```

Open `http://127.0.0.1:4321/etymon/`. The supported tool list is generated from the CLI profiles during each build. Run `npm --prefix website run data` to refresh it during development.

The Website workflow checks pull requests and publishes `main` to GitHub Pages. In repository settings, select **GitHub Actions** as the Pages source. The default address is `https://landoncrabtree.github.io/etymon/`.

For a custom domain, set `SITE_URL` to its origin and `BASE_PATH=/` when building, then update the workflow and Pages settings together.

Theme choice follows the system until a visitor selects light or dark. The workflow demo pauses on hover, keyboard focus, hidden tabs, and offscreen sections. Reduced motion shows completed scenes without autoplay. Installation commands and the default demo work without JavaScript.

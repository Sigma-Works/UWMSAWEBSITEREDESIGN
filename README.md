# MSA UW Website

Multi-page site for the University of Washington Muslim Student Association, built with React + Vite. Hosts free on GitHub Pages.

## What's new (redesign)

- **Scroll-driven cherry-blossom hero.** An Apple-style pinned HTML5-canvas sequence (270 WebP frames in `public/hero/`) that scrubs 1:1 with the scrollbar. Uses `requestAnimationFrame` throttling, progressive preloading, retina-aware backing store, responsive `lg`/`sm` source sets, and a static poster fallback under `prefers-reduced-motion`. See `src/components/CanvasHeroSequence.jsx`.
- **Five pages** via a zero-config hash router (safe on GitHub Pages): Home `/`, About `/about`, Prayer `/prayer`, Events `/events`, Community `/community`.
- **Consolidated Settings menu.** Dark/light mode and the falling-petals toggle now live inside the ⚙ Settings dropdown (and a matching section in the mobile menu), alongside reduce-motion/glow/ripple.
- **Admin panel** regrouped to match the five pages; the obsolete hero-video config was removed.
- **Live Instagram** feed for **@msauw** (embeds individual permalinks if set, else the live profile).

### Managing the hero frames
Frames live in `public/hero/lg/` (1152px) and `public/hero/sm/` (640px), named `frame-000.webp … frame-269.webp`, with `public/hero/poster.webp` as the reduced-motion still. To change the sequence, replace those files (keep the same count and naming) or adjust `FRAME_COUNT` in `CanvasHeroSequence.jsx`.

## Quick start (local)

```bash
npm install
npm run dev
```

Open the URL it prints (usually http://localhost:5173).

## Host it on GitHub Pages

You'll do this once. After that, every push to `main` redeploys automatically.

### 1. Pick a repo name
This project is preconfigured for a repo named **`msa-uw`**. If you use a different name, change it in **two** places:
- `vite.config.js` → `base: "/YOUR_REPO_NAME/"`
- `package.json` → `"homepage": "https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/"`

(The `base` must match the repo name exactly, with slashes, or the page loads blank with no styling.)

### 2. Create the repo and push
On GitHub, create a new **public** repo (empty — no README). Then, in this folder:

```bash
git init
git add .
git commit -m "Initial MSA UW site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/msa-uw.git
git push -u origin main
```

### 3. Turn on Pages
In the repo on GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

That's it. The included workflow (`.github/workflows/deploy.yml`) builds the site and publishes it. Watch progress under the **Actions** tab. When it finishes (~1 min), your site is live at:

```
https://YOUR_USERNAME.github.io/msa-uw/
```

### Updating the site later
Edit files, then:

```bash
git add .
git commit -m "Update content"
git push
```

The site rebuilds and redeploys on its own.

## Editing content
Most content lives in the `seed` object near the top of `src/App.jsx` (hero text, prayer times, events, programs, links). You can also use the built-in **Admin** panel (footer → Admin login, demo password `msauw2025`) to edit content live — but note those edits only last for the visitor's browser session. See below.

## Important: the Admin panel is a demo
The admin login is a front-end-only gate and edits are **not saved** — they disappear on refresh, and the password is visible in the code, so it is not real security. For admins to log in safely and have changes persist for everyone, connect a backend. Two common free options:
- **Supabase** — Postgres database + real auth, generous free tier.
- **Firebase** — Firestore + Google/email auth.

The site reads everything from one `data` object, so swapping the seed data for a backend fetch is the main change needed. Happy to help wire this up.

## Custom domain (optional)
If the MSA has a domain (e.g. `msauw.org`), add it under **Settings → Pages → Custom domain**, then set `base: "/"` in `vite.config.js` and redeploy.

## Tech
React 18, Vite 5, lucide-react icons. No other runtime dependencies.

## Prayer times (Masjidal — auto-updates daily)

The prayer times card can show a live Masjidal widget that recalculates every
day on its own — no daily editing. The current MSA site already uses Masjidal
("Powered by Masjidal"), so reuse that account.

You need ONE of these, from whoever manages the MSA's Masjidal account:

1. **Masjid ID** — Log in at masjidal.com → Settings → Web Integration; the
   Masjid ID is shown in red. Put it in `src/App.jsx` → `seed.prayerTimes.masjidalId`.

2. **Embed code** (most reliable) — On that same Web Integration page, or by
   copying from the current MSA website, grab the full widget code (an
   `<iframe...>` or a `<div>`+`<script>` block). Paste the whole thing as a
   string into `seed.prayerTimes.masjidalEmbed`.

If both fields are empty, the card shows the manual times in the seed data
(which you'd have to edit by hand — the Masjidal widget is the better path).

The Jummah line and Announcement below the times are always manual — edit
`seed.prayerTimes.jummah` and `seed.prayerTimes.announcement`.

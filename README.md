# MSA UW Website

Website for the **University of Washington Muslim Student Association** — [msauw.org](https://msauw.org).

A single-page React app with a live-editable content system: officers sign in through an in-site Admin panel and edit copy, events, board members, gallery photos, sponsors, and merch without touching code. All content is stored in **Supabase** and served through **Firebase Hosting**.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 + [Vite 5](https://vitejs.dev/) |
| Animation | [anime.js](https://animejs.com/) v4 (scroll-driven hero + tree drawing) |
| Icons | lucide-react |
| Backend / data | [Supabase](https://supabase.com/) — Postgres (content, subscribers, admin log), Auth, and Storage |
| Hosting | [Firebase Hosting](https://firebase.google.com/docs/hosting) |
| Prayer times | AthanPlus / Masjidal widget, kept current by a scheduled GitHub Action |
| CI/CD | GitHub Actions |

No CSS framework — styles are authored inline / in-component. No server of our own; Supabase is the only backend.

---

## Architecture at a glance

- **Content model.** The whole site reads from one `data` object. On load, the app fetches the single `site_content` row from Supabase (`src/supabase.js` → `loadContent`); if that's empty or unreachable it falls back to the `seed` object defined near the top of `src/App.jsx`. Admin edits are written back to that same row.
- **Admin panel.** A footer "Admin login" opens a real Supabase-Auth email/password gate. Signed-in officers get inline editing across pages; saves go to Supabase and are recorded in an `admin_log` audit table. Row Level Security (RLS) blocks anonymous writes, so the public key in the front end is safe to ship.
- **Supabase Storage.** Gallery / sponsor / event / merch images upload to a public `gallery` bucket from the admin panel; the public URL is stored in the content object.
- **Mailing list.** The signup form inserts into a `subscribers` table (anyone can insert; only admins can read).
- **Hero animation.** `src/components/CanvasHeroSequence.jsx` renders an Apple-style scroll-scrubbed cherry-blossom image sequence on a canvas (responsive `sm` / `lg` frame sets in `public/hero/`, with a static poster fallback for reduced-motion). `src/QuadTree.jsx` draws a UW-Quad cherry tree branch-by-branch on scroll via anime.js.

---

## Project structure

```
├── src/
│   ├── App.jsx                    # entire app: pages, sections, seed content, admin panel
│   ├── supabase.js                # Supabase client + content/storage/subscriber/log helpers
│   ├── QuadTree.jsx               # scroll-drawn cherry-blossom tree (anime.js)
│   ├── components/
│   │   └── CanvasHeroSequence.jsx # scroll-scrubbed canvas hero sequence
│   └── main.jsx                   # React entry point
├── scripts/
│   └── sync-prayer-times.mjs      # daily prayer-time sync (runs in GitHub Actions)
├── public/
│   ├── hero/                      # hero frame sequences (sm/ + lg/) and poster
│   └── merch/                     # merch images
├── .github/workflows/
│   ├── firebase-deploy.yml        # build + deploy to Firebase Hosting on push to main
│   ├── deploy.yml                 # (legacy) GitHub Pages build/deploy
│   └── sync-prayer-times.yml      # scheduled daily prayer-time sync
├── firebase.json                  # Firebase Hosting config (serves dist/)
├── .firebaserc                    # Firebase project + hosting target
├── vite.config.js
└── package.json
```

---

## Local development

Requires Node.js 20+.

```bash
npm install
npm run dev      # start the Vite dev server (usually http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # preview the production build locally
```

The dev site talks to the live Supabase project, so content and admin login work locally out of the box.

---

## Deployment (Firebase Hosting)

The site is hosted on **Firebase Hosting**, Firebase project **`msa-website-dbaba`**, hosting target **`production`** (site `msa-website`), pointed at the custom domain **msauw.org**.

### Automatic

Every push to `main` triggers `.github/workflows/firebase-deploy.yml`, which runs `npm ci && npm run build` and deploys `dist/` to the live channel via `FirebaseExtended/action-hosting-deploy`.

Requires two repo secrets (**Settings → Secrets and variables → Actions**):
- `FIREBASE_SERVICE_ACCOUNT` — a Firebase service-account JSON with Hosting deploy permission.
- `GITHUB_TOKEN` — provided automatically by GitHub.

### Manual

```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy --only hosting
```

> A legacy `deploy.yml` (GitHub Pages) still exists but Firebase is the active host. Remove it if you don't want duplicate deploys running.

---

## Editing content

Two ways:

1. **Admin panel (preferred).** Footer → **Admin login**, sign in with a Supabase-Auth officer account, and edit inline. Changes save to Supabase and persist for everyone.
2. **Seed data.** Edit the `seed` object near the top of `src/App.jsx` for the code-level defaults (used before any Supabase content exists). Donation links (Zeffy), section headings, board roster, and stats all live here.

### Supabase setup

`src/supabase.js` documents the required schema inline. In short, you need:
- a `site_content` table with a single row (`id = 1`) holding a JSON `data` column;
- a `subscribers` table (public insert, admin-only read);
- an `admin_log` table (admin insert/read);
- a **public** Storage bucket named `gallery`;
- RLS policies as noted in the file, and officer accounts created under Supabase **Auth**.

The Supabase URL and **publishable** key are committed on purpose — they're public by design, and security comes from RLS, not from hiding the key. The **secret** service-role key is never committed; it lives only as a GitHub Actions secret (below).

---

## Prayer times

The prayer-times card and nav countdown use the MSA's **Masjidal / AthanPlus** widget (Masjid ID set in content at `prayerTimes.masjidalId`, or a full embed string in `prayerTimes.masjidalEmbed`).

Because that feed can't be fetched cross-origin from a browser (CORS), `.github/workflows/sync-prayer-times.yml` runs `scripts/sync-prayer-times.mjs` once a day (cron `0 8 * * *`, ~midnight Pacific). Running server-side, it fetches today's adhan times and writes the five prayer fields back into the Supabase `site_content` row, so the countdown's fallback times stay current automatically.

Requires the repo secret `SUPABASE_SERVICE_ROLE_KEY` (the Supabase secret API key — bypasses RLS, so it must **only** ever live as a GitHub secret).

The **Jummah** time and the **announcement** line below the times are always edited manually in content.

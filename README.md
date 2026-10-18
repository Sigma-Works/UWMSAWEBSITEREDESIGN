# MSA UW Website

The official website of the Muslim Student Association at the University of Washington. Live at [msauw.org](https://msauw.org).

This is a single-page React application with a built-in content management panel. Officers can update events, board members, photos, sponsors, merch and page copy from the browser, with no code changes or redeploys. The site was redesigned from a static page into a maintainable platform that can be handed from one board to the next.

## Highlights

- Admin panel for non-technical officers, protected by Supabase Auth
- Board roster organized by year, with the newest year shown by default
- Cherry blossom hero with an optional, click-to-play scroll animation on a canvas (never auto-downloaded)
- Monthly events calendar, weekly events, and today's prayer times on the home page with a live countdown
- Photo carousels and a lightbox, with image uploads handled in the admin panel
- Mailing list signup, search across all content, dark mode, and a mobile-first layout
- Event-level Google Analytics tracking plus Microsoft Clarity heatmaps, with a plain-language privacy statement
- WCAG 2.2 AA accessibility work and an on-site accessibility statement

## Tech stack

| Area | Technology |
| --- | --- |
| UI | React 18, Vite 5 |
| Animation | anime.js v4, HTML canvas, CSS |
| Icons | lucide-react |
| Data and auth | Supabase (Postgres, Auth, Storage) |
| Images | Cloudinary CDN, with Supabase Storage as a fallback |
| Hosting | Firebase Hosting |
| CI/CD | GitHub Actions |
| Analytics | Google Analytics 4, Microsoft Clarity |

There is no custom server. The browser talks to Supabase directly, and security is enforced with Row Level Security policies in the database.

## Architecture

### Content model

All site content lives in one JSON object. On load, the app reads a single `site_content` row from Supabase and merges it over a `seed` object defined in `src/App.jsx`. If Supabase is unreachable, the site renders the seed content instead, so the page never goes blank. Saving from the admin panel writes the whole object back to the same row.

### Routing

The app uses a small hash router (`/#/about`, `/#/events`, and so on). Hash routes work on any static host without server rewrites. Six pages are defined in a `PAGES` array, and each page lists the ordered sections it renders.

### Loading strategy

Public visitors download only what the public site needs. Site content is read with one `fetch` call (`src/contentApi.js`) and cached in `localStorage` for instant repeat visits. The admin dashboard (`src/admin/AdminPanel.jsx`), the Supabase client, the policy pages and the Quad tree are separate chunks loaded with `React.lazy` / `import()` only when they're used.

### Admin panel

Officers sign in with Supabase Auth. The editor is split into tabs for each content type, including board, events, gallery, sponsors, merch, programs and mailing list. Edits are written to Supabase and recorded in an `admin_log` table for an audit trail. Free-text link fields pass through a `safeHref` helper that blocks unsafe URL schemes.

### Images

Uploads are resized in the browser to a maximum of 1600px and converted to WebP before they leave the page. They are then sent to Cloudinary, which serves them through its CDN with automatic format and quality settings. If Cloudinary is not configured, uploads fall back to the Supabase `gallery` bucket. Images in `public/` are cached by Firebase Hosting for a year.

### Hero animation

`src/components/CanvasHeroSequence.jsx` shows a static poster with a "Play the bloom" button. Only when a visitor presses it does it download a 120 frame image sequence and draw it onto a single canvas, scrubbed by scroll position. It uses requestAnimationFrame throttling, a small preload pool, two resolution sets for phones and desktops, and a retina-aware canvas. With reduced motion enabled, only the poster is shown and no button is offered.

### Prayer times

Prayer times come from an AthanPlus (Masjidal) widget. Browsers cannot fetch that feed directly because of CORS, so a scheduled GitHub Action runs `scripts/sync-prayer-times.mjs` once a day. It reads the day's times on the server and writes them into the Supabase content row. The nav countdown and the home page's "Today's prayer times" strip both read those values; the shared logic is in `src/prayerTimes.js`.

### Analytics

`src/analytics.js` attaches one delegated click listener and sends GA4 events: `page_view`, `section_view`, `nav_click`, `button_click`, `link_click`, `social_click`, `outbound_click`, `merch_store_click`, `email_click`, `phone_click`, `photo_open` and `mailing_signup`. No personal data is collected, and tracking pauses while an officer is signed in. `gtag.js` itself is loaded after the page is idle.

Microsoft Clarity is loaded from the same file once the browser is idle. It is skipped entirely for visitors who send Global Privacy Control or Do Not Track, and the mailing-list form and admin dashboard carry `data-clarity-mask` so they're never recorded. Set `CLARITY_PROJECT_ID` in `src/analytics.js` to enable it.

Everything above is described for visitors at `/#/privacy` (`src/components/PolicyPages.jsx`). If you add a tracker, embed or form field, update that page too.

## Project structure

```
.
├── src/
│   ├── App.jsx                     # pages, sections, seed content (file map at the top)
│   ├── contentApi.js               # lightweight public content fetch + cache, lazy Supabase loader
│   ├── supabase.js                 # Supabase client, uploads, mailing list, audit log (lazy)
│   ├── prayerTimes.js              # prayer schedule, Seattle clock, shared countdown
│   ├── analytics.js                # GA4 event tracking + Microsoft Clarity loader
│   ├── QuadTree.jsx                # scroll-drawn cherry tree
│   ├── main.jsx                    # entry point
│   ├── admin/
│   │   └── AdminPanel.jsx          # officer dashboard (lazy chunk)
│   └── components/
│       ├── CanvasHeroSequence.jsx  # click-to-play scroll-driven canvas hero
│       └── PolicyPages.jsx         # privacy + accessibility statements
├── scripts/
│   └── sync-prayer-times.mjs       # daily prayer time sync
├── public/                         # hero frames, merch images, video, logos
├── .github/workflows/
│   ├── firebase-deploy.yml         # build and deploy on push to main
│   └── sync-prayer-times.yml       # scheduled prayer time sync
├── firebase.json                   # hosting config and cache headers
├── vite.config.js                  # build config and vendor chunk splitting
└── index.html                      # app shell and analytics snippet
```

## Getting started

You need Node.js 20 or newer.

```bash
npm install
npm run dev       # local dev server at http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve the production build locally
```

The local site connects to the live Supabase project, so content and admin login work out of the box.

## Configuration

**Supabase.** The project URL and publishable key are in `src/supabase.js`. These are public by design, because Row Level Security controls access. The schema is documented in comments in that file. It needs a `site_content` table with one row, a `subscribers` table, an `admin_log` table, a public `gallery` storage bucket, and officer accounts under Supabase Auth.

**Cloudinary.** Set `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` at the top of `src/supabase.js`. The preset must be unsigned. Leave both blank to use Supabase Storage instead.

**Analytics.** The GA4 measurement ID is set in `index.html`. The Microsoft Clarity Project ID goes in `CLARITY_PROJECT_ID` at the top of `src/analytics.js` (blank = Clarity off). Event parameters such as `section` and `link_text` need to be registered as custom dimensions in GA4 before they appear in reports.

## Deployment

Every push to `main` runs `firebase-deploy.yml`, which installs dependencies, builds the site and deploys `dist/` to Firebase Hosting under the `production` target. It needs one repository secret:

- `FIREBASE_SERVICE_ACCOUNT`: a service account key with Hosting deploy access

The daily prayer time workflow needs a second secret:

- `SUPABASE_SERVICE_ROLE_KEY`: bypasses RLS, so it must only ever live as a GitHub secret

## Performance notes

- Vendor code is split into separate cacheable chunks (React, anime.js, icons); admin, supabase-js and policy pages are lazy chunks
- The hero animation frames are only downloaded on request
- Google Analytics and Clarity load after the page is idle
- Images are lazy-loaded and compressed on upload
- Static assets are served with long-lived immutable cache headers
- The hero loads frames progressively and serves smaller frames to phones
- Content is fetched in a single request

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Add a line under "Unreleased" with every change.

## Maintaining the site

Most updates happen in the admin panel, so a new board can take over without touching the repository. Code changes are only needed for new features or layout work. For code-level defaults, edit the `seed` object near the top of `src/App.jsx`.

## Credits

Built and maintained by [Saad Ahmed](https://www.linkedin.com/in/sssaaaddd/) and [Zahid Mannan](https://www.linkedin.com/in/zahidmannan/) for the [UW MSA](https://www.instagram.com/msauw/?hl=en).

# Changelog

All notable changes to the MSA UW website (msauw.org) are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are in YYYY-MM-DD.

When you ship a change, add a line under **Unreleased**. When you deploy,
rename **Unreleased** to the date and start a new empty **Unreleased** section.

## [Unreleased]

## 2026-10-18

### Added
- **Microsoft Clarity** (heatmaps and anonymised session replays), loaded from
  `src/analytics.js`. It waits until the browser is idle, never loads for
  visitors who send Global Privacy Control or Do Not Track, and is masked over
  the mailing-list form and the officer dashboard. Project ID `yzuco9qvpp`
  is set in `CLARITY_PROJECT_ID` (set it to `""` to switch Clarity off).
- **Privacy statement** at `/#/privacy`, written in plain language. It covers
  Google Analytics, Clarity, the mailing list, on-device settings, third-party
  services and officer accounts.
- **Accessibility statement** at `/#/accessibility` (WCAG 2.2 AA target, known
  limitations, how to report a problem). The footer now links to both pages
  instead of UW's generic ones.
- **"Today's prayer times" strip on the home page**, under the announcements:
  all five prayers, the next one highlighted with a live countdown, plus
  Jummah info and a link to the Prayer page. It replaces the old plain
  "Prayer times" button.
- `public/robots.txt`.
- `<noscript>` fallback message with contact links.
- This changelog.

### Changed
- **The hero animation is now optional.** The home page shows the static
  cherry-blossom poster with a "Play the bloom" button. The 120-frame scroll
  animation (~14 MB on desktop, ~5 MB on phones) only downloads if someone
  presses it. It is never offered to reduced-motion users.
- **Cleaner announcements area.** Removed the mihrab arch outline and the
  large spinning rosary wheel behind the announcements. The logo now sits in
  normal flow above a single centred column.
- Prayer-time logic moved to `src/prayerTimes.js` and is shared by the nav
  pill and the home widget.
- Officer dashboard moved from `src/App.jsx` into `src/admin/AdminPanel.jsx`
  (no behaviour change).
- Footer "Privacy" and "Accessibility" links point to the new on-site pages.

### Performance
Lighthouse on mobile, live site vs this release (local runs vary a few
points either way): Performance **36 → 72–83**, LCP **7.0 s → 3.3–3.9 s**,
TBT **970 ms → 310–460 ms**, CLS **0.137 → ~0.03**, page weight
**6.8 MB → 1.8 MB**.
- Hero frames are no longer downloaded on every visit (see above).
- The admin dashboard and the Supabase client (~48 KB gzipped together) are
  separate lazy chunks. Public visitors never download them: site content is
  read with a single `fetch` (`src/contentApi.js`), and supabase-js loads only
  for officer login, saving, or a mailing-list signup. The main bundle went
  from 102 KB to 57 KB gzipped.
- Google Analytics' `gtag.js` (the biggest main-thread cost) loads after the
  page is idle. Events queue up and are sent once it arrives.
- Fonts load from `index.html` with `preconnect` instead of a late `@import`
  inside the app's JavaScript.
- The last-seen site content is cached in `localStorage`, so repeat visits
  render real content immediately and the page doesn't jump when fresh data
  arrives.
- One shared one-second clock drives every countdown, so the nav bar no
  longer re-renders every second. The scroll progress bar is written straight
  to the DOM, so the nav no longer re-renders on every scroll frame.
- Removed the hourly in-browser fetch of the AthanPlus prayer feed. It was
  always blocked by CORS (a wasted request and a console error on every page
  load). The daily GitHub Action sync is the real source of times.
- Reduced-motion preference is read synchronously, so reduced-motion visitors
  no longer mount the animated version first.
- `index.html` is served with `Cache-Control: no-cache` so new deploys show up
  immediately.

### Accessibility (WCAG 2.2 AA)
Lighthouse accessibility **92 → 100**.
- "Skip to main content" link. `<main>` is focusable.
- One `<h1>` per page (the announcements heading is now an `<h2>`).
- A descriptive browser-tab title per page.
- Visible focus outline on every interactive element, not just links and
  buttons.
- Closed mobile menu is `inert` and hidden, so keyboard and screen-reader
  users can't tab into invisible links.
- Every dialog (prayer times, search, photo viewer, board member profile)
  now moves focus in, keeps Tab inside, and returns focus to the button that
  opened it (shared `useDialogFocus` hook).
- Search is a proper combobox: results are announced, arrow-key selection is
  exposed to screen readers, Enter on a focused result opens that result, and
  there is a visible "Esc" close button.
- Settings switches keep keyboard focus after toggling (they used to remount
  and drop focus). Escape returns focus to the gear button.
- The site's own "Reduce motion" switch now also stops CSS-only animations,
  not just the JavaScript ones.
- Escape closes the mobile menu and returns focus to the menu button. The
  main nav is labelled.
- Mailing-list success and error messages are reliably announced, and errors
  are linked to the email field (`aria-invalid` + `aria-describedby`).
- Photo carousel shows its keyboard focus ring again.
- Hero "Play" button hands focus to the animation stage, with screen-reader
  status updates while it loads.
- Prayer pill's accessible name now contains its visible text (label in name).
- Carousel dots have 24×24 px tap targets (they were 6–8 px).
- Contrast fixes: light-theme faint text, footer secondary text and
  announcement metadata now meet 4.5:1.
- The Settings popover is a labelled group, not an invalid ARIA `menu`.
- Home prayer strip is an ordered list with `aria-current`, and the ticking
  countdown is hidden from screen readers in favour of a stable sentence.

### Fixed
- Officer saves are refused until fresh content has loaded, so a save can
  never overwrite newer data with the cached copy.
- Footer link `font-size: 13.5` was missing its unit, so it was ignored.
- Hero logo was rendered taller than its box (portrait image in a square box).

### Removed
- Unused hero helpers left over from the arch and wheel (`HeroArch`,
  `TiltWrap`, `useEnclosingBox`).
- Client-side AthanPlus fetch/parse code (see Performance).

### Notes for maintainers
- Two gallery photos still stored in Supabase Storage are about 600 KB and
  470 KB. Re-uploading them through the admin panel sends them through
  Cloudinary, which resizes and compresses them automatically.

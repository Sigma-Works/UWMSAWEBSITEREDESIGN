/* ════════════════════════════════════════════════════════════════════════
   PolicyPages.jsx: the Privacy statement and Accessibility statement

   Rendered at /#/privacy and /#/accessibility (see PAGES in App.jsx, where
   both routes are marked `hidden` so they don't clutter the main nav; the
   footer links to them). Lazy-loaded, so this text never weighs down the
   home page.

   Keeping these statements honest
   ───────────────────────────────
   Everything here describes what the code ACTUALLY does. If you add a new
   analytics tool, embed, form field or cookie, update the matching section
   below and bump LAST_UPDATED. The places that matter most:
     • src/analytics.js   GA4 events + Microsoft Clarity loader
     • src/supabase.js    mailing list, officer accounts, audit log
     • src/App.jsx        localStorage keys (search "localStorage"), embeds
   ════════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef } from "react";

const LAST_UPDATED = "October 18, 2026";
const CONTACT_EMAIL = "msauw@uw.edu";

/* ── Shared layout ─────────────────────────────────────────────────────── */

// Small reusable pieces so both statements share one readable layout:
// a narrow measure (~70 characters) and generous line height for comfort.
const wrap = { maxWidth: 760, margin: "0 auto", padding: "56px 20px 80px", lineHeight: 1.75,
  color: "var(--text)", fontSize: 16 };
const h2Style = { fontSize: 22, fontWeight: 700, margin: "40px 0 10px", color: "var(--accent)" };
const muted = { color: "var(--text-muted)" };
const linkStyle = { color: "var(--accent)", fontWeight: 600, textUnderlineOffset: 3 };

function Ext({ href, children }) {
  // External links open in a new tab; the visually hidden note tells
  // screen-reader users that will happen (WCAG 3.2.5 good practice).
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
      {children}<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Mail() {
  return <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>{CONTACT_EMAIL}</a>;
}

/** Page shell: moves keyboard/screen-reader focus to the heading when the
 *  page opens, so people know the "page" changed in this single-page app. */
function PolicyShell({ id, eyebrow, title, intro, children }) {
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <section id={id} aria-labelledby={`${id}-title`} style={{ background: "var(--bg)" }}>
      <div style={wrap}>
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "1.4px",
          textTransform: "uppercase", ...muted }}>{eyebrow}</div>
        <h1 id={`${id}-title`} ref={headingRef} tabIndex={-1}
          style={{ fontSize: "clamp(30px,5vw,44px)", lineHeight: 1.15, margin: "8px 0 14px",
            fontWeight: 800, outline: "none" }}>{title}</h1>
        <p style={{ ...muted, fontSize: 17.5, margin: 0 }}>{intro}</p>
        <p style={{ ...muted, fontSize: 13.5, marginTop: 10 }}>Last updated {LAST_UPDATED}</p>
        {children}
      </div>
    </section>
  );
}

/* ── Privacy statement ─────────────────────────────────────────────────── */

export function PrivacySection() {
  return (
    <PolicyShell id="privacy" eyebrow="Privacy"
      title="How we handle your information"
      intro="We're a student organization, not a company. We collect as little as we can,
        we never sell anything, and we'd rather explain it plainly than hide it in legal text.">

      <h2 style={h2Style}>The short version</h2>
      <ul>
        <li>No ads, no data sales, no sharing your details with anyone for marketing.</li>
        <li>We use two analytics tools, Google Analytics and Microsoft Clarity, to see which
          pages are useful and where the site is confusing. They don't receive your name or email.</li>
        <li>If you join the mailing list, we keep your name and email only to send MSA updates.</li>
        <li>If your browser sends a "Global Privacy Control" or "Do Not Track" signal, Microsoft
          Clarity doesn't load at all.</li>
      </ul>

      <h2 style={h2Style}>Analytics: Google Analytics</h2>
      <p>
        Google Analytics 4 tells us how many people visit, which pages they open, and which
        buttons and links get used (for example "Prayer times was clicked from the home page").
        We record the label of what was clicked and which section it was in. We never send
        anything you type into a form. Google sets cookies (named <code>_ga</code>) to tell a
        returning visitor from a new one, and receives your IP address, which it uses to
        estimate a rough location such as a city. Clicks are not tracked while an MSA officer
        is signed in, so our own editing doesn't skew the numbers.
      </p>
      <p style={muted}>
        You can opt out with Google's <Ext href="https://tools.google.com/dlpage/gaoptout">browser
        add-on</Ext> or any content blocker. Read more in <Ext href="https://policies.google.com/privacy">Google's
        privacy policy</Ext>.
      </p>

      <h2 style={h2Style}>Analytics: Microsoft Clarity</h2>
      <p>
        Clarity helps us see <em>how</em> the site is used: heatmaps of where people click and
        how far they scroll, and anonymised replays of visits that show mouse movement, taps
        and scrolling. That's how we spot things like a button nobody can find, or a page that
        breaks on phones. Clarity records your device and browser type, screen size, and a
        rough location derived from your IP address. It uses cookies (such as <code>_clck</code>
        and <code>_clsk</code>) to group page views into a visit.
      </p>
      <p>
        What Clarity does <strong>not</strong> see: the text you type into any form field
        (Clarity masks input fields), and nothing at all inside our mailing-list form or the
        officer dashboard, which are fully masked. Clarity only loads once your browser is idle,
        and it doesn't load if your browser sends Global Privacy Control or Do Not Track.
      </p>
      <p style={muted}>
        Microsoft processes this data under the <Ext href="https://privacy.microsoft.com/privacystatement">Microsoft
        Privacy Statement</Ext>. See also <Ext href="https://learn.microsoft.com/clarity/setup-and-installation/privacy-disclosure">Clarity's
        privacy disclosure</Ext>.
      </p>

      <h2 style={h2Style}>The mailing list</h2>
      <p>
        If you sign up, we store your first name, last name, email address, and the option you
        pick for "I am a…" (for example, a current student). It's stored in our database
        provider, Supabase, and only MSA officers can read it. We use it to send MSA news and
        event updates, nothing else. To be removed, reply to any email or write to <Mail />, and
        we'll delete your entry.
      </p>

      <h2 style={h2Style}>Settings saved on your device</h2>
      <p>
        A few choices are saved in your own browser's local storage so they stick between
        visits: light or dark mode, falling petals, reduce-motion, rosary glow and hover-ripple
        settings, a short-lived counter that stops the mailing-list form from being
        submitted too many times in a minute, and a copy of the site's public content (events,
        announcements, prayer times) so the page appears instantly on your next visit. None of
        this is personal, and it never leaves your device. You
        can clear it any time by clearing site data in your browser.
      </p>

      <h2 style={h2Style}>Other services the site relies on</h2>
      <p>Loading some parts of the site means your browser talks directly to these services,
        which can see your IP address and may set their own cookies:</p>
      <ul>
        <li><strong>Firebase Hosting</strong> (Google) serves the website itself.</li>
        <li><strong>Supabase</strong> stores the site's content and the mailing list.</li>
        <li><strong>Google Fonts</strong> provides the Poppins and Amiri typefaces.</li>
        <li><strong>Cloudinary</strong> hosts many of the photos.</li>
        <li><strong>Masjidal / AthanPlus</strong> provides the live prayer-times widget.</li>
        <li><strong>Instagram</strong> and <strong>TikTok</strong> embeds on the Community page,
          plus a <strong>Notion</strong> calendar on the Events page, if those are switched on.</li>
        <li><strong>Zeffy</strong> handles donations. When you donate you leave our site, and
          Zeffy's own privacy policy applies to anything you enter there.</li>
      </ul>

      <h2 style={h2Style}>Officer accounts</h2>
      <p>
        MSA officers who edit the site sign in with an email and password through Supabase
        Auth. When an officer saves a change, we keep a short log of which officer saved and
        which sections changed, so the board can see who updated what.
      </p>

      <h2 style={h2Style}>Questions or requests</h2>
      <p>
        Want to know what we hold about you, have it corrected, or have it deleted? Email <Mail /> and
        a board member will get back to you. If this statement changes, we'll update the date
        at the top. As a UW Registered Student Organization we also follow
        the <Ext href="https://www.washington.edu/online/privacy/">University of Washington's
        online privacy statement</Ext> where it applies.
      </p>
    </PolicyShell>
  );
}

/* ── Accessibility statement ───────────────────────────────────────────── */

export function AccessibilitySection() {
  return (
    <PolicyShell id="accessibility" eyebrow="Accessibility"
      title="Everyone should be able to use this site"
      intro="We aim to meet the W3C's Web Content Accessibility Guidelines (WCAG) 2.2 at
        level AA, and we treat accessibility problems as bugs to fix.">

      <h2 style={h2Style}>What we've built in</h2>
      <ul>
        <li>Full keyboard support, with a visible focus outline and a "Skip to main content"
          link as the first thing you reach with Tab.</li>
        <li>One clear heading structure per page, with descriptive page titles, so screen-reader
          users can jump around easily.</li>
        <li>Text and controls that meet WCAG AA colour-contrast ratios in both light and dark mode.</li>
        <li>A <strong>Reduce motion</strong> switch in Settings (the gear icon), which also turns on
          automatically if your device asks for reduced motion.</li>
        <li>The scrolling cherry-blossom animation at the top of the home page only plays if
          you choose to start it, so nothing large moves or downloads unless you ask.</li>
        <li>Text alternatives for meaningful images, and labelled form fields.</li>
        <li>Pages that work when zoomed to 200% and on small phone screens.</li>
      </ul>

      <h2 style={h2Style}>Known limitations</h2>
      <p>
        Some content comes from other services we can't fully control: the Masjidal prayer-times
        widget, Instagram and TikTok embeds, the Notion events calendar, and the Zeffy donation
        forms. If something in one of those is hard to use, let us know and we'll find you the
        same information another way. For example, prayer times are always written out on the
        home page and the Prayer page.
      </p>

      <h2 style={h2Style}>Tell us about a problem</h2>
      <p>
        If anything on this site is difficult for you to use, please email <Mail /> with the page
        and what happened. We'll aim to reply within a week and fix what we can. You can also
        reach the <Ext href="https://www.washington.edu/accessibility/">UW Office of the ADA
        Coordinator and accessibility resources</Ext>.
      </p>
    </PolicyShell>
  );
}

export default PrivacySection;

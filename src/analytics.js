/* ── Google Analytics event tracking ─────────────────────────────────────
   The gtag snippet lives in index.html. This file turns user actions into
   GA4 events so the dashboard shows WHAT people do, not just page loads.

   Events sent (Reports → Engagement → Events in GA4):
     page_view        – every page/route change (the site is a hash-router SPA)
     section_view     – a section scrolled into view   {section}
     nav_click        – top nav / menu links           {link_text, section}
     button_click     – any other button               {link_text, section}
     link_click       – internal links                 {link_text, section}
     social_click     – Instagram/TikTok/LinkedIn/etc. {link_type, link_text}
     outbound_click   – other external links           {link_url, link_domain}
     merch_store_click– "Visit the store" button       {link_url}
     email_click / phone_click – mailto: and tel: links
     photo_open       – gallery/carousel photo zoomed  {section}
     mailing_signup   – newsletter form submitted OK   (no personal data sent)

   No personal data (names, emails, form input) is ever sent. Clicks are
   ignored while an officer is signed in so admin work doesn't skew numbers.
   ─────────────────────────────────────────────────────────────────────── */

/* ── Microsoft Clarity (heatmaps + anonymised session replays) ────────────
   Clarity shows WHERE people click, how far they scroll, and where they get
   stuck, which GA4 event counts can't. Setup:
     1. Create a project at https://clarity.microsoft.com (sign in with the
        MSA account), add msauw.org.
     2. Settings → Overview → copy the Project ID (looks like "abc123xyz9")
        and paste it into CLARITY_PROJECT_ID below.
   Leave it blank and Clarity is simply never loaded.

   Privacy safeguards (all described on the site's /#/privacy page):
     • Not loaded at all for visitors whose browser sends Global Privacy
       Control or Do Not Track.
     • Loaded only once the browser is idle, so it never competes with the
       page's own first paint.
     • Form inputs are masked by Clarity by default; the admin dashboard and
       mailing-list form are additionally wrapped in data-clarity-mask so
       nothing inside them is ever recorded.
   ─────────────────────────────────────────────────────────────────────── */
export const CLARITY_PROJECT_ID = "yzuco9qvpp"; // MSA UW project on clarity.microsoft.com ("" disables Clarity)

/** True when the visitor's browser asks not to be tracked (GPC or DNT). */
export function privacySignalOn() {
  if (typeof navigator === "undefined") return false;
  return navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === "1" || window.doNotTrack === "1";
}

let clarityStarted = false;
export function initClarity() {
  if (clarityStarted || !CLARITY_PROJECT_ID || typeof window === "undefined") return;
  if (privacySignalOn()) return;   // respect the visitor's opt-out signal
  clarityStarted = true;

  const load = () => {
    // Microsoft's official loader, unminified: defines a queueing stub
    // (calls made before the script arrives are replayed), then injects
    // the tag script asynchronously.
    window.clarity = window.clarity || function (...args) {
      (window.clarity.q = window.clarity.q || []).push(args);
    };
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_PROJECT_ID)}`;
    document.head.appendChild(s);
  };
  // Wait for an idle moment (max 4s) so analytics never delays first paint.
  if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 2000);
}

let paused = false;
export function setTrackingPaused(v) { paused = !!v; }

export function track(name, params = {}) {
  if (paused || typeof window === "undefined" || typeof window.gtag !== "function") return;
  try { window.gtag("event", name, params); } catch { /* never break the site */ }
}

export function trackPageView(route) {
  track("page_view", {
    page_path: `/#${route}`,
    page_location: window.location.origin + `/#${route}`,
    page_title: document.title,
  });
}

const SOCIALS = [
  ["instagram.com", "instagram"], ["tiktok.com", "tiktok"], ["linkedin.com", "linkedin"],
  ["discord.", "discord"], ["youtube.com", "youtube"], ["facebook.com", "facebook"],
  ["x.com", "x"], ["twitter.com", "x"], ["whatsapp.com", "whatsapp"], ["linktr.ee", "linktree"],
];
const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80);

function sectionOf(el) {
  const s = el.closest("section[id]");
  return s ? s.id : "";
}

function classifyClick(e) {
  const el = e.target.closest?.("a, button, [role='button'], [data-track]");
  if (!el || el.closest("[data-no-track]")) return;
  // Ignore form fields' submit plumbing; the signup is tracked on success.
  const text = clean(el.getAttribute("data-track") || el.getAttribute("aria-label") || el.textContent);
  const section = sectionOf(el);
  const href = el.tagName === "A" ? el.getAttribute("href") || "" : "";

  if (/^mailto:/i.test(href)) return track("email_click", { link_text: text, section });
  if (/^tel:/i.test(href)) return track("phone_click", { link_text: text, section });

  if (/^https?:\/\//i.test(href)) {
    let host = "";
    try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    if (host && host !== window.location.hostname.replace(/^www\./, "")) {
      const social = SOCIALS.find(([d]) => host.includes(d));
      if (section === "merch") return track("merch_store_click", { link_url: href, link_text: text });
      if (social) return track("social_click", { link_type: social[1], link_text: text, section });
      return track("outbound_click", { link_url: href, link_domain: host, link_text: text, section });
    }
  }

  if (el.closest("header, nav")) return track("nav_click", { link_text: text, section: section || "nav" });
  if (el.tagName === "A") return track("link_click", { link_text: text, section });
  if (el.closest(".zoomable")) return track("photo_open", { section });
  track("button_click", { link_text: text, section });
}

let started = false;
export function initAnalytics() {
  if (started || typeof document === "undefined") return;
  started = true;
  document.addEventListener("click", classifyClick, true);
}

// Fire section_view once per section per page view, when ~35% is visible.
export function observeSections() {
  if (typeof IntersectionObserver === "undefined") return () => {};
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting && !seen.has(en.target.id)) {
        seen.add(en.target.id);
        track("section_view", { section: en.target.id });
      }
    });
  }, { threshold: 0.35 });
  document.querySelectorAll("section[id]").forEach((s) => io.observe(s));
  return () => io.disconnect();
}

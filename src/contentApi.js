/* ════════════════════════════════════════════════════════════════════════
   contentApi.js: the lightweight data path for public visitors

   Why this file exists
   ────────────────────
   The full Supabase client (@supabase/supabase-js) is a large library, but
   a normal visitor only ever needs ONE read: the single `site_content` row.
   That read is a plain HTTPS GET against Supabase's REST endpoint, so we do
   it here with fetch() and keep supabase-js out of the initial bundle.

   The full client (src/supabase.js) is still used for everything that
   needs auth or writes (admin login, saving content, uploads, the mailing
   list insert). It is loaded on demand through `loadSupabase()` below, so
   it only downloads when someone actually needs it.
   ════════════════════════════════════════════════════════════════════════ */

// These two values are public by design. The publishable key is meant to
// ship in front-end code; access is enforced by Row Level Security (RLS)
// policies in the database, not by hiding the key.
export const SUPABASE_URL = "https://rhngkfkvaecviwoezzvv.supabase.co";
export const SUPABASE_KEY = "sb_publishable_2YptlgjkaoMokG0rgRSEkQ_wq7y2iSc";

// supabase-js stores a signed-in officer's session in localStorage under
// "sb-<project-ref>-auth-token". Checking for that key lets us skip loading
// the auth client entirely for the 99% of visitors who are not officers.
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

/** Load the site content row. Resolves to the stored content object, or
 *  null when the row is empty or the request fails (the app then falls
 *  back to the built-in seed content, so the page never goes blank). */
export async function loadContentPublic({ timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/site_content?id=eq.1&select=data`,
      {
        signal: controller.signal,
        headers: {
          apikey: SUPABASE_KEY,
          // Ask PostgREST for a single object instead of a one-item array.
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const row = await res.json();
    const data = row?.data;
    return data && typeof data === "object" && Object.keys(data).length ? data : null;
  } catch (err) {
    console.warn("Content load failed, using built-in seed content:", err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Local cache of the last content we saw ─────────────────────────────
   Returning visitors get the real content (announcement bar, prayer times,
   events…) on the very first render instead of the built-in seed, and the
   page no longer jumps when the fresh copy arrives a moment later
   ("stale-while-revalidate": show the cached copy, then refresh it). */
const CACHE_KEY = "msa-content-cache-v1";

/** Last successfully loaded content, or null. Never throws. */
export function readCachedContent() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Remember content for the next visit. Quota errors are ignored. */
export function writeCachedContent(content) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(content)); } catch { /* ignore */ }
}

/** True when this browser holds a saved officer session (so the app should
 *  load the auth client and confirm it). Never throws, because private
 *  browsing modes can make localStorage access fail. */
export function hasStoredSession() {
  try {
    return !!localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Lazily import the full Supabase module (client, auth, uploads, mailing
 *  list). Vite turns this into a separate chunk that is fetched on first
 *  call and cached afterwards. */
export const loadSupabase = () => import("./supabase.js");

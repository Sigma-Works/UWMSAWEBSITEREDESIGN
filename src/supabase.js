import { createClient } from "@supabase/supabase-js";

// ── MSA UW Supabase project ─────────────────────────────────────────────
// These two values are safe to keep in front-end code. The publishable key
// is public by design; security is enforced by the Row Level Security (RLS)
// policies on the database, not by hiding this key.
const SUPABASE_URL = "https://rhngkfkvaecviwoezzvv.supabase.co";
const SUPABASE_KEY = "sb_publishable_2YptlgjkaoMokG0rgRSEkQ_wq7y2iSc";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Load the single site-content row. Returns the stored data object, or null
// if the row is empty/missing (first run) so the app can fall back to seed.
export async function loadContent() {
  const { data, error } = await supabase
    .from("site_content")
    .select("data")
    .eq("id", 1)
    .single();
  if (error) {
    console.warn("Supabase load failed, using local seed:", error.message);
    return null;
  }
  if (!data || !data.data || Object.keys(data.data).length === 0) return null;
  return data.data;
}

// Save the whole content object back to the single row. Requires an
// authenticated session (RLS blocks anonymous writes).
export async function saveContent(contentObj) {
  const { error } = await supabase
    .from("site_content")
    .update({ data: contentObj, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) {
    console.error("Supabase save failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/* ── Image uploads (Supabase Storage) ──────────────────────────────────
   Requires a PUBLIC bucket named "gallery" plus storage policies allowing
   public read and authenticated insert/delete. Officers upload from the
   admin panel; the public URL is stored in site content.
   ───────────────────────────────────────────────────────────────────── */

const BUCKET = "gallery";

// Make an uploaded filename safe and unique.
function safeName(name) {
  const dot = name.lastIndexOf(".");
  const ext = (dot > -1 ? name.slice(dot + 1) : "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const base = (dot > -1 ? name.slice(0, dot) : name)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "photo";
  return `${base}-${Date.now().toString(36)}.${ext}`;
}

// Upload one image into a folder: "gallery" | "sponsors" | "events".
// Returns { ok: true, url } or { ok: false, error }.
export async function uploadImage(file, folder = "gallery") {
  if (!file) return { ok: false, error: "No file selected." };
  if (!file.type?.startsWith("image/")) return { ok: false, error: "That file isn't an image." };
  if (file.size > 5 * 1024 * 1024)
    return { ok: false, error: "Image is larger than 5MB — please compress it first." };

  const path = `${folder}/${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) {
    const msg = /bucket/i.test(error.message)
      ? 'Storage bucket "gallery" not found. Create it in Supabase → Storage (make it Public).'
      : error.message;
    return { ok: false, error: msg };
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl, path };
}

// Given a public URL from our bucket, return its storage path (or null).
export function pathFromUrl(url) {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null; // not one of ours (e.g. a repo-hosted image)
  return decodeURIComponent(url.slice(i + marker.length));
}

// Delete an uploaded image by its storage path. Best-effort.
export async function deleteImage(path) {
  if (!path) return { ok: true };
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ── Mailing list ───────────────────────────────────────────────────────
   Signups go into a `subscribers` table. Anyone may INSERT (that's the
   point of a signup form) but only authenticated admins may read the list,
   so addresses can't be scraped with the public key.

   Run this once in the Supabase SQL editor:

     create table subscribers (
       id bigserial primary key,
       first_name text,
       last_name text,
       email text not null,
       status text,
       created_at timestamptz default now()
     );
     alter table subscribers enable row level security;
     create policy "anyone can subscribe"
       on subscribers for insert to anon, authenticated with check (true);
     create policy "admins can read"
       on subscribers for select to authenticated using (true);
     create unique index subscribers_email_key on subscribers (lower(email));
   ─────────────────────────────────────────────────────────────────────── */
export async function subscribe({ firstName, lastName, email, status }) {
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const { error } = await supabase.from("subscribers").insert({
    first_name: (firstName || "").trim() || null,
    last_name: (lastName || "").trim() || null,
    email: clean,
    status: status || null,
  });
  if (error) {
    // Unique-index violation means they're already on the list — treat as success.
    if (error.code === "23505" || /duplicate/i.test(error.message)) {
      return { ok: true, already: true };
    }
    if (/relation .* does not exist/i.test(error.message)) {
      return { ok: false, error: "Mailing list isn't set up yet — see the note in supabase.js." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Admin-only: read the subscriber list for export.
export async function listSubscribers() {
  const { data, error } = await supabase
    .from("subscribers")
    .select("first_name,last_name,email,status,created_at")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: data || [] };
}

/* ── Admin activity log ────────────────────────────────────────────────
   Records which admin saved changes and (roughly) what they touched, so the
   team has an audit trail. Requires a table `admin_log`:

     create table admin_log (
       id          bigint generated always as identity primary key,
       actor_email text,
       summary     text,
       created_at  timestamptz default now()
     );
     alter table admin_log enable row level security;
     -- only signed-in admins can write and read the log:
     create policy "admins insert log" on admin_log
       for insert to authenticated with check (true);
     create policy "admins read log" on admin_log
       for select to authenticated using (true);

   Writing to the log is best-effort: a failure here never blocks a content
   save (the save already succeeded by the time we log).
   ───────────────────────────────────────────────────────────────────── */
export async function logAdminChange(summary) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const actor_email = user?.email || "unknown";
    const { error } = await supabase
      .from("admin_log")
      .insert({ actor_email, summary: String(summary || "").slice(0, 500) });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "log failed" };
  }
}

// Admin-only: read the recent change history.
export async function listAdminLog(limit = 100) {
  const { data, error } = await supabase
    .from("admin_log")
    .select("actor_email,summary,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: data || [] };
}

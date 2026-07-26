// Server-side prayer-time sync — run once a day by
// .github/workflows/sync-prayer-times.yml (GitHub Actions), NOT by the
// browser. This exists because the nav countdown's "manual times" fields
// drift out of date daily (Fajr/Isha shift a few minutes every day), and
// having the *browser* fetch AthanPlus's live feed directly runs into
// CORS: that endpoint is built to be shown in an iframe, not fetched as
// data, and there's no guarantee (or documentation) saying cross-origin
// reads are allowed. A GitHub Action is just a server talking to another
// server — CORS doesn't apply at all — so this is the reliable way to
// keep the manual fields (which the countdown always falls back to)
// actually current, regardless of what any visitor's browser is allowed
// to do.
//
// What it does:
//   1. Reads the current site_content row from Supabase (service-role
//      key — the ONLY thing this needs that isn't already public) to see
//      which masjid_id is configured (data.prayerTimes.masjidalId).
//   2. If none is set, there's nothing to sync — exits quietly.
//   3. Fetches today's times from the same AthanPlus widget page the
//      popup already embeds, and pulls out the "starts" (adhan) time for
//      each prayer — not the bolded "iqamah" column.
//   4. Writes ONLY those five fields (Fajr/Dhuhr/Asr/Maghrib/Isha) back
//      into prayerTimes, leaving masjidalId, masjidalEmbed, jummah, and
//      every other field in the site_content row untouched.
//
// Required secret (GitHub repo → Settings → Secrets and variables →
// Actions): SUPABASE_SERVICE_ROLE_KEY. Get it from the Supabase
// dashboard → Settings → API Keys → "Publishable and secret API keys"
// tab → Secret keys section → the "default" key (sb_secret_...). That's
// the current replacement for the old service_role key. It bypasses row
// level security, so it must ONLY ever live here as a GitHub secret —
// never committed, never put in the site's own front-end code.

const SUPABASE_URL = "https://rhngkfkvaecviwoezzvv.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY is not set (add it as a GitHub Actions secret).");

async function supabaseRequest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      // New-format Supabase keys (sb_secret_... / sb_publishable_...) go
      // on the `apikey` header ONLY. Also sending it as `Authorization:
      // Bearer <key>` — the old service_role pattern — makes the
      // platform try to parse it as a JWT and reject the request with
      // "Invalid JWT", since these new keys aren't JWTs at all.
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${init.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res;
}

// Same tag-stripping approach as the (best-effort) client-side attempt in
// App.jsx: anchor on the visible "Fajr ... 3:46 AM" text rather than
// specific HTML structure, since Masjidal/AthanPlus don't publish a
// markup contract for this widget and a styling change on their end is
// far more likely than the visible prayer names/time format changing.
function parseAthanPlusTimes(html) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const upper = text.toUpperCase();
  const secondHeading = upper.indexOf("PRAYER TIMINGS", upper.indexOf("PRAYER TIMINGS") + 1);
  const todayText = secondHeading === -1 ? text : text.slice(0, secondHeading);
  const out = {};
  for (const name of PRAYER_ORDER) {
    const m = todayText.match(new RegExp(`\\b${name}\\b\\s+(\\d{1,2}:\\d{2}\\s*[AP]M)`, "i"));
    if (m) out[name] = m[1].toUpperCase();
  }
  return out;
}

async function main() {
  console.log("Reading current site_content row…");
  const row = await supabaseRequest("/rest/v1/site_content?id=eq.1&select=data").then((r) => r.json());
  const content = row?.[0]?.data;
  if (!content) fail("site_content row (id=1) is empty or missing — nothing to sync against.");

  const masjidId = (content.prayerTimes?.masjidalId || "").trim();
  if (!masjidId) {
    console.log("No masjidalId configured in the admin panel — nothing to sync. Exiting.");
    return;
  }

  console.log(`Fetching live times for masjid_id=${masjidId}…`);
  const widgetUrl = `https://timing.athanplus.com/masjid/widgets/embed?theme=3&masjid_id=${encodeURIComponent(masjidId)}&color=000000`;
  // A GitHub Actions runner has no browser fingerprint at all by default
  // (no User-Agent, datacenter IP) — some sites quietly serve a blocked/
  // challenge/empty page to requests like that instead of a real 4xx/5xx,
  // which is indistinguishable from "the markup changed" unless we look
  // at what actually came back. A normal browser User-Agent is enough to
  // get past simple bot-filtering; the diagnostic dump below (only prints
  // when parsing fails) covers the case where it isn't.
  const res = await fetch(widgetUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  console.log(`AthanPlus responded ${res.status} (final URL: ${res.url})`);
  if (!res.ok) throw new Error(`AthanPlus fetch failed: ${res.status}`);
  const html = await res.text();

  const parsed = parseAthanPlusTimes(html);
  const found = Object.keys(parsed);
  if (found.length === 0) {
    console.error(`Got ${html.length} bytes back. First 800 chars:\n${html.slice(0, 800)}`);
    fail("Could not find any prayer times in the fetched page — see the dump above for what actually came back.");
  }
  console.log(`Parsed: ${JSON.stringify(parsed)}`);
  if (found.length < PRAYER_ORDER.length) {
    console.warn(`⚠ Only found ${found.length}/${PRAYER_ORDER.length} prayers — writing what was found, leaving the rest as-is.`);
  }

  const merged = {
    ...content,
    prayerTimes: { ...content.prayerTimes, ...parsed },
  };

  console.log("Writing merged prayerTimes back to Supabase…");
  await supabaseRequest("/rest/v1/site_content?id=eq.1", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ data: merged, updated_at: new Date().toISOString() }),
  });

  console.log("✓ Prayer times synced.");
}

main().catch((e) => fail(e.message || String(e)));

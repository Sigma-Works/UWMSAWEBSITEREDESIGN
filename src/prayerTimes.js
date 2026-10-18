/* ════════════════════════════════════════════════════════════════════════
   prayerTimes.js: today's prayer schedule and the "next prayer" countdown

   Used by the nav-bar countdown pill AND the home-page "Today's prayers"
   widget, so both always agree.

   Where the times come from
   ─────────────────────────
   `data.prayerTimes` in the site content (Fajr … Isha as "5:42 AM" style
   strings). A scheduled GitHub Action (scripts/sync-prayer-times.mjs) reads
   the live AthanPlus/Masjidal feed once a day on GitHub's servers and writes
   the day's times into Supabase, so these values are current.

   The browser used to ALSO try to fetch the AthanPlus feed directly once an
   hour. That feed sends no CORS headers, so every one of those requests was
   blocked by the browser: a wasted network request plus a console error on
   every page load. It has been removed; the daily sync is the real source.

   Performance
   ───────────
   Every component that shows a countdown subscribes to ONE shared 1-second
   clock (see `useNow` below). There is one setInterval for the whole page,
   it only runs while at least one countdown is mounted, and only the small
   components that display the time re-render each second, never the whole
   nav bar or page.
   ════════════════════════════════════════════════════════════════════════ */

import { useMemo, useSyncExternalStore } from "react";

// Canonical display order. Also the chronological order on any normal day.
export const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

/** "5:42 AM" → minutes since midnight (342). Returns null if unparseable.
 *  A missing AM/PM is read as a 24-hour time ("13:15"). */
export function parsePrayerToMinutes(str) {
  const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes since midnight *in Seattle* (fractional, includes seconds).
 *
 *  Every prayer time on the site is Seattle local time, but `new Date()`
 *  reads the VISITOR's device clock. A visitor whose device is set to a
 *  different timezone would otherwise get a countdown that is hours off.
 *  Using the IANA zone (not a fixed UTC offset) also keeps this correct
 *  across the PST/PDT daylight-saving switch. */
const seattleFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export function getSeattleNowMinutes(date) {
  const parts = seattleFormatter.formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  // Some engines format midnight as "24" in 24h mode; normalise to 0.
  const hour = get("hour") % 24;
  return hour * 60 + get("minute") + get("second") / 60;
}

/* ── Shared 1-second clock (one interval for the whole page) ─────────────
   A tiny external store for React's useSyncExternalStore: components
   subscribe, the first subscriber starts the interval, the last one to
   unmount stops it. */
let nowMs = Date.now();
const listeners = new Set();
let intervalId = 0;
function subscribeClock(listener) {
  listeners.add(listener);
  if (!intervalId) {
    nowMs = Date.now();
    intervalId = setInterval(() => {
      nowMs = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(intervalId); intervalId = 0; }
  };
}
const getClock = () => nowMs;

/** Current time in ms, updated once a second via the shared clock. */
export function useNow() {
  return useSyncExternalStore(subscribeClock, getClock, getClock);
}

/** Today's schedule as [{ name, time, mins }], sorted chronologically.
 *  Sorting is defensive: an admin AM/PM typo shouldn't make the "next
 *  prayer" search skip an earlier time just because it's listed later. */
export function buildSchedule(times) {
  if (!times) return [];
  return PRAYER_ORDER
    .map((name) => ({ name, time: String(times[name] || "").trim(), mins: parsePrayerToMinutes(times[name]) }))
    .filter((p) => p.mins != null)
    .sort((a, b) => a.mins - b.mins);
}

/** Format a number of seconds as "H:MM:SS" (or "M:SS" under an hour). */
function formatCountdown(totalSec) {
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

/** Full picture for "today's prayers" UIs.
 *  Returns null when there are no usable times, otherwise:
 *    {
 *      prayers:   [{ name, time, mins, status: "past" | "next" | "upcoming" }],
 *      next:      the upcoming prayer object (tomorrow's Fajr after Isha),
 *      countdown: "1:23:45",
 *      tomorrow:  true when the next prayer is tomorrow's Fajr
 *    }
 *  Re-renders the calling component once a second (shared clock). */
export function useTodaysPrayers(times) {
  const now = useNow();
  const schedule = useMemo(() => buildSchedule(times), [times]);
  if (schedule.length === 0) return null;

  const nowMins = getSeattleNowMinutes(new Date(now));
  let next = schedule.find((p) => p.mins > nowMins);
  const tomorrow = !next;
  if (!next) next = schedule[0]; // after Isha → wrap to tomorrow's Fajr

  let diffMin = next.mins - nowMins;
  if (tomorrow) diffMin += 24 * 60;
  const countdown = formatCountdown(Math.max(0, Math.round(diffMin * 60)));

  const prayers = schedule.map((p) => ({
    ...p,
    // After Isha every prayer today is "past" (and Fajr is also "next").
    status: p === next ? "next" : (tomorrow || p.mins <= nowMins) ? "past" : "upcoming",
  }));
  return { prayers, next, countdown, tomorrow };
}

/** Back-compatible shape for the nav pill: { next, countdown } or null. */
export function usePrayerCountdown(times) {
  const today = useTodaysPrayers(times);
  return today ? { next: today.next, countdown: today.countdown } : null;
}

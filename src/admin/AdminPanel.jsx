/* ════════════════════════════════════════════════════════════════════════
   admin/AdminPanel.jsx: officer content-management dashboard

   Split out of App.jsx so the bundler puts it in its own chunk. Public
   visitors never download this code (or the Supabase client it pulls in)
   unless someone actually clicks "Admin". App.jsx loads it with
   React.lazy(() => import("./admin/AdminPanel.jsx")).

   Shared design tokens, seed content and small presentational helpers are
   imported back from App.jsx so the dashboard looks identical to the rest
   of the site and there is a single source of truth for each of them.
   ════════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Lock, LogOut, Plus, Trash2, Edit3, Save, ArrowUp, ArrowDown } from "lucide-react";
import { supabase, uploadImage, deleteImage, pathFromUrl,
  listSubscribers, logAdminChange, listAdminLog } from "../supabase";
import {
  DAYS, DUR, EASE, GOLD, GRAD_DEEP, PURPLE, seed,
  Eyebrow, Title, boardLinks, linkLabel,
  card, btnGold, btnGhost, btnPurple, inp, inpSm, miniBtn, delBtn, lbl,
} from "../App.jsx";

/* ============================================================
   ADMIN
   ============================================================ */
export default function AdminPanel({ data, setData, isAdmin, setIsAdmin, persist, saving, onClose }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("hero");
  const [savedMsg, setSavedMsg] = useState("");
  // Snapshot of content as it was when the panel opened / last saved, so we
  // can log which sections an admin actually changed.
  const baselineRef = useRef(null);
  if (baselineRef.current === null && data) baselineRef.current = data;

  const login = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) setErr(error.message || "Login failed. Check your email and password.");
    else { setIsAdmin(true); setPw(""); }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false); setEmail(""); setPw("");
  };

  // Which top-level content sections changed since the last snapshot.
  const changedSections = (before, after) => {
    if (!before || !after) return [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const changed = [];
    for (const k of keys) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
    }
    return changed;
  };

  const save = async () => {
    setSavedMsg("");
    const res = await persist(data);
    if (res.ok) {
      setSavedMsg("Saved — changes are now live.");
      setTimeout(() => setSavedMsg(""), 3000);
      // Best-effort audit log: record who saved and what changed. Never
      // blocks or fails the save (which already succeeded).
      const changed = changedSections(baselineRef.current, data);
      const summary = changed.length
        ? `Edited: ${changed.join(", ")}`
        : "Saved (no field-level changes detected)";
      logAdminChange(summary);
      baselineRef.current = data;   // reset baseline after a successful save
    } else setSavedMsg("Save failed: " + res.error);
  };

  return (
    <div role="dialog" aria-modal="true" className="modalBg" style={{ position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(20,12,40,.55)", backdropFilter: "blur(5px)", display: "grid",
      placeItems: "center", padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="modalIn" style={{ background: "var(--surface)", borderRadius: 20,
        width: "100%", maxWidth: isAdmin ? 880 : 420, maxHeight: "90vh", overflow: "hidden",
        display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,.4)",
        transition: `max-width ${DUR.base}ms ${EASE.out}` }}>

        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: GRAD_DEEP, color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {isAdmin ? <Edit3 size={20} /> : <Lock size={20} />}
            <span style={{ fontWeight: 700, fontSize: 17 }}>
              {isAdmin ? "Admin dashboard" : "Admin login"}</span>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,.15)",
            border: "none", borderRadius: 8, width: 34, height: 34, cursor: "pointer",
            display: "grid", placeItems: "center" }}>
            <X size={18} color="#fff" /></button>
        </div>

        {!isAdmin ? (
          <div style={{ padding: 28 }}>
            <p style={{ margin: "0 0 18px", color: "var(--text-muted)", fontSize: 14.5, lineHeight: 1.6 }}>
              Officer login. Sign in to edit events, prayer times, programs, and more.
            </p>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && login()}
              placeholder="Email" autoComplete="username" style={{ ...inp, marginBottom: 10 }} autoFocus />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && login()}
              placeholder="Password" autoComplete="current-password" style={inp} />
            {err && <div style={{ color: "#c0392b", fontSize: 13.5, marginTop: 10 }}>{err}</div>}
            <button className="btn" onClick={login} disabled={busy}
              style={{ ...btnPurple, width: "100%", marginTop: 16, opacity: busy ? .6 : 1 }}>
              {busy ? "Signing in…" : "Log in"}</button>
            <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
              Accounts are managed by MSA admins in Supabase. Ask an admin to add you if you
              need access.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
            <div style={{ width: 190, borderRight: "1px solid var(--border)", padding: 12,
              overflowY: "auto", background: "var(--surface-2)" }}>
              {[
                { group: "Global", items: [["bar", "Announcement bar"], ["copy", "Section text"], ["contact", "Contact & links"], ["links", "Quick links"]] },
                { group: "Home", items: [["hero", "Hero copy"], ["newhere", "New here?"], ["gallery", "Moments (photos)"], ["announce", "Announcements"]] },
                { group: "About", items: [["about", "About us"], ["donate", "Donate"], ["sponsors", "Sponsors"]] },
                { group: "Prayer", items: [["times", "Prayer times"], ["spaces", "Prayer spaces"], ["house", "Islamic House"]] },
                { group: "Events", items: [["events", "Weekly events"], ["calendar", "Calendar"], ["stats", "Stats / metrics"], ["programs", "Programs"]] },
                { group: "Community", items: [["board", "Board members"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["mailing", "Mailing list"], ["merch", "Merch"]] },
                { group: "Admin", items: [["history", "Change history"]] },
              ].map(({ group, items }) => (
                <div key={group} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "1px",
                    textTransform: "uppercase", color: "var(--text-faint)", padding: "8px 12px 4px" }}>
                    {group}
                  </div>
                  {items.map(([k, lbl]) => (
                    <button key={k} onClick={() => setTab(k)} style={{ display: "block", width: "100%",
                      textAlign: "left", padding: "9px 12px", borderRadius: 9, border: "none",
                      background: tab === k ? PURPLE : "transparent",
                      color: tab === k ? "#fff" : "var(--text-soft)",
                      fontWeight: 600, fontSize: 13.5, cursor: "pointer", marginBottom: 2,
                      fontFamily: "inherit" }}>{lbl}</button>
                  ))}
                </div>
              ))}
              <button onClick={logout} style={{ display: "flex",
                alignItems: "center", gap: 7, width: "100%", padding: "10px 12px", borderRadius: 9,
                border: "none", background: "transparent", color: "#c0392b", fontWeight: 600,
                fontSize: 13.5, cursor: "pointer", marginTop: 12, fontFamily: "inherit" }}>
                <LogOut size={15} /> Log out</button>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--border)",
                background: "var(--surface-2)", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: savedMsg.startsWith("Save failed") ? "#c0392b" : "#5a5468" }}>
                  {savedMsg || "Edit below, then Save to publish to the live site."}</span>
                <button className="btn" onClick={save} disabled={saving}
                  style={{ ...btnPurple, display: "inline-flex", alignItems: "center", gap: 7,
                    opacity: saving ? .6 : 1 }}>
                  <Save size={15} /> {saving ? "Saving…" : "Save changes"}</button>
              </div>
              <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
                <Editor tab={tab} data={data} setData={setData} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Change history — shows the admin_log audit trail (who saved what, when).
   Reads on mount; authenticated-only via RLS. */
function AdminHistory() {
  const [state, setState] = useState({ loading: true, rows: [], error: "" });
  useEffect(() => {
    let alive = true;
    listAdminLog(100).then((res) => {
      if (!alive) return;
      if (res.ok) setState({ loading: false, rows: res.rows, error: "" });
      else setState({ loading: false, rows: [], error: res.error });
    });
    return () => { alive = false; };
  }, []);

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <Section title="Change history">
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
        Every time an admin saves, we record who saved and which sections changed.
        Most recent first.
      </p>
      {state.loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>
      ) : state.error ? (
        <div style={{ padding: 14, borderRadius: 10, background: "var(--tint)",
          fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          Couldn't load the log{state.error ? `: ${state.error}` : ""}. If this is the first
          time, make sure the <b>admin_log</b> table exists in Supabase (setup SQL is in
          the code comments).
        </div>
      ) : state.rows.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>No changes recorded yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {state.rows.map((r, i) => (
            <div key={i} style={{ display: "grid", gap: 3, padding: "11px 14px", borderRadius: 10,
              background: "var(--tint)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10,
                flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--accent)" }}>
                  {r.actor_email || "unknown"}</span>
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{fmt(r.created_at)}</span>
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{r.summary}</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Editor({ tab, data, setData }) {
  const up = (patch) => setData({ ...data, ...patch });
  // Lives here (not inside the "board" branch below) because hooks can't be
  // called conditionally — Editor renders one big if/else chain keyed on tab.
  const boardYears = data.boardYears && data.boardYears.length ? data.boardYears : ["2025-26"];
  const [editYear, setEditYear] = useState(boardYears[0]);
  const [newBoardYear, setNewBoardYear] = useState("");
  // Same placeholder-vs-real-data race as the public board section: if the
  // saved year list finishes loading after this panel already mounted, or a
  // year gets deleted elsewhere, fall back to whatever's now first.
  useEffect(() => {
    if (boardYears.length && !boardYears.includes(editYear)) setEditYear(boardYears[0]);
  }, [data.boardYears]); // eslint-disable-line react-hooks/exhaustive-deps

  if (tab === "hero")
    return (
      <Section title="Home hero">
        <Field label="Kicker (small line above the headline)">
          <input style={inp} value={data.hero.kicker ?? ""}
            onChange={(e) => up({ hero: { ...data.hero, kicker: e.target.value } })} />
        </Field>
        <Field label="Headline — short lines read best over video">
          <textarea style={{ ...inp, minHeight: 70 }} value={data.hero.title}
            onChange={(e) => up({ hero: { ...data.hero, title: e.target.value } })} />
        </Field>
        <Field label="Mission statement">
          <textarea style={{ ...inp, minHeight: 90 }} value={data.hero.mission}
            onChange={(e) => up({ hero: { ...data.hero, mission: e.target.value } })} />
        </Field>
      </Section>
    );

  if (tab === "gallery")
    return (
      <ListEditor title="Photos" items={data.gallery}
        onChange={(gallery) => up({ gallery })}
        blank={{ caption: "New photo", tag: "Tag" }}
        fields={[["img", "Photo", "image"], ["caption", "Caption"], ["tag", "Tag"]]} />
    );

  if (tab === "sponsors")
    return (
      <ListEditor title="Sponsors" items={data.sponsors}
        onChange={(sponsors) => up({ sponsors })}
        blank={{ name: "New sponsor", url: "" }}
        fields={[["logo", "Logo", "image"], ["name", "Name"], ["url", "Website URL (optional)"]]} />
    );

  if (tab === "spaces")
    return (
      <ListEditor title="Prayer spaces" items={data.prayerSpaces}
        onChange={(prayerSpaces) => up({ prayerSpaces })}
        blank={{ name: "New space", loc: "Location", note: "", mapUrl: "" }}
        fields={[["name", "Name"], ["loc", "Location"], ["note", "Note"],
          ["mapUrl", "Google Maps link (optional)"]]} />
    );

  if (tab === "times") {
    const t = data.prayerTimes;
    const setT = (patch) => up({ prayerTimes: { ...t, ...patch } });
    return (
      <Section title="Islamic House prayer times">
        <Field label="Masjidal Masjid ID (leave blank to use manual times below)">
          <input style={inp} value={t.masjidalId || ""}
            onChange={(e) => setT({ masjidalId: e.target.value })}
            placeholder="e.g. RKxwXOdO" />
        </Field>
        <Field label="Masjidal full embed code (optional — overrides Masjid ID above if filled in)">
          <textarea style={{ ...inp, minHeight: 70 }} value={t.masjidalEmbed || ""}
            onChange={(e) => setT({ masjidalEmbed: e.target.value })}
            placeholder="<iframe ...></iframe>" />
        </Field>
        <div style={{ margin: "4px 0 14px", padding: "10px 12px", borderRadius: 10,
          background: "var(--tint)", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          The manual times below are only used when both Masjidal fields above are empty.
          Jummah and Announcement always show, either way.
        </div>
        {["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map((p) => (
          <Field key={p} label={`${p} (manual fallback)`}>
            <input style={inp} value={t[p] ?? ""} onChange={(e) => setT({ [p]: e.target.value })} />
          </Field>
        ))}
        <Field label="Jummah info (always shown)">
          <input style={inp} value={t.jummah ?? ""}
            placeholder="e.g. First khutbah 1:00 PM · Second 2:15 PM at Islamic House"
            onChange={(e) => setT({ jummah: e.target.value })} />
        </Field>
        <Field label="Announcement (always shown — leave blank to hide the block)">
          <textarea style={{ ...inp, minHeight: 70 }} value={t.announcement ?? ""}
            placeholder="e.g. Ramadan taraweeh begins after Isha — all welcome."
            onChange={(e) => setT({ announcement: e.target.value })} />
        </Field>
      </Section>
    );
  }

  if (tab === "events") {
    const setDay = (day, evs) => up({ events: { ...data.events, [day]: evs } });
    return (
      <Section title="Weekly events">
        {DAYS.map((day) => (
          <div key={day} style={{ marginBottom: 20, border: "1px solid var(--border)",
            borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", background: "var(--tint)", fontWeight: 700,
              color: "var(--accent)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {day}
              <button onClick={() => setDay(day, [...(data.events[day] || []),
                { id: Date.now(), name: "New event", time: "", loc: "", desc: "", img: "" }])}
                style={miniBtn}><Plus size={14} /> Add</button>
            </div>
            <div style={{ padding: 12, display: "grid", gap: 12 }}>
              {(data.events[day] || []).length === 0 &&
                <div style={{ color: "var(--text-faint)", fontSize: 13, textAlign: "center", padding: 8 }}>No events</div>}
              {(data.events[day] || []).map((e, idx) => (
                <div key={e.id} style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr auto" }}>
                  <input style={inpSm} placeholder="Name" value={e.name}
                    onChange={(ev) => { const c = [...data.events[day]]; c[idx] = { ...e, name: ev.target.value }; setDay(day, c); }} />
                  <input style={inpSm} placeholder="Time" value={e.time}
                    onChange={(ev) => { const c = [...data.events[day]]; c[idx] = { ...e, time: ev.target.value }; setDay(day, c); }} />
                  <button onClick={() => setDay(day, data.events[day].filter((_, i) => i !== idx))}
                    style={delBtn} aria-label="Delete"><Trash2 size={15} /></button>
                  <input style={{ ...inpSm, gridColumn: "1 / 3" }} placeholder="Location" value={e.loc}
                    onChange={(ev) => { const c = [...data.events[day]]; c[idx] = { ...e, loc: ev.target.value }; setDay(day, c); }} />
                  <input style={{ ...inpSm, gridColumn: "1 / 4" }} placeholder="Description (optional)" value={e.desc}
                    onChange={(ev) => { const c = [...data.events[day]]; c[idx] = { ...e, desc: ev.target.value }; setDay(day, c); }} />
                  <div style={{ gridColumn: "1 / 4" }}>
                    <ImageField label="Event photo (optional)" value={e.img || ""} folder="events"
                      onChange={(url) => { const c = [...data.events[day]]; c[idx] = { ...e, img: url }; setDay(day, c); }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>
    );
  }

  if (tab === "programs")
    return (
      <ListEditor title="Programs" items={data.programs}
        onChange={(programs) => up({ programs })}
        blank={{ name: "New program", desc: "", icon: "star" }}
        fields={[["name", "Name"], ["desc", "Description"], ["icon", "Icon (book/star/grad/sparkles/hand/users)"]]} />
    );

  if (tab === "copy") {
    const SECTION_KEYS = [
      ["about", "About"], ["quad", "The Quad"], ["announcements", "Announcements"], ["donate", "Donate"],
      ["islamicHouse", "Islamic House"], ["gallery", "Photo gallery"],
      ["sponsors", "Sponsors"], ["board", "Board members"], ["prayer", "Prayer"],
      ["events", "Events"], ["programs", "Programs"], ["connect", "Connect"],
      ["newHere", "New here?"], ["instagram", "Instagram"], ["tiktok", "TikTok"],
    ];
    const sections = data.sections || {};
    const setSection = (key, patch) => up({
      sections: { ...sections, [key]: { ...(sections[key] || {}), ...patch } },
    });
    return (
      <Section title="Section text">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Edit the heading and intro paragraph for each section. Leave a field blank to hide it.
          Basic formatting works in the intro: <b>**bold**</b>, <i>*italic*</i>,
          and [link text](https://example.com). Leave a blank line between paragraphs.
        </p>
        {SECTION_KEYS.map(([key, label]) => {
          const cur = sections[key] || seed.sections[key] || {};
          return (
            <div key={key} style={{ marginBottom: 18, border: "1px solid var(--border)",
              borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", background: "var(--tint)",
                fontWeight: 700, color: "var(--accent)", fontSize: 13.5 }}>{label}</div>
              <div style={{ padding: 14, display: "grid", gap: 10 }}>
                {key !== "donate" && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
                      Eyebrow (small label above the heading)</label>
                    <input style={inpSm} value={cur.eyebrow || ""}
                      onChange={(e) => setSection(key, { eyebrow: e.target.value })} />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
                    Heading</label>
                  <input style={inpSm} value={cur.title || ""}
                    onChange={(e) => setSection(key, { title: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
                    Intro paragraph</label>
                  <textarea style={{ ...inpSm, minHeight: 74, resize: "vertical" }}
                    value={cur.body || ""}
                    onChange={(e) => setSection(key, { body: e.target.value })} />
                </div>
              </div>
            </div>
          );
        })}
      </Section>
    );
  }

  if (tab === "board") {
    const board = data.board || [];
    const setBoard = (next) => up({ board: next });
    const setBoardYears = (next) => up({ boardYears: next });
    const edit = (i, patch) => {
      const c = [...board]; c[i] = { ...c[i], ...patch }; setBoard(c);
    };
    // Writes a member's full links array. Also clears the legacy single
    // `href` field once links are edited, so the two can't drift out of
    // sync — boardLinks() only falls back to `href` when `links` is empty.
    const setMemberLinks = (i, links) => edit(i, { links, href: "" });
    const add = () => setBoard([...board, {
      id: Date.now(), name: "New member", role: "Role", year: editYear,
      img: "", links: [], bio: "",
    }]);
    // New years go to the front of the list — that position is what both
    // this panel and the public site treat as "current" by default, so a
    // new board just adds their year and it's live immediately with no
    // reordering needed. Use the arrows below to fix the order manually
    // if a year is ever added out of sequence.
    const addBoardYear = () => {
      const y = newBoardYear.trim();
      if (!y || boardYears.includes(y)) return;
      setBoardYears([y, ...boardYears]);
      setEditYear(y);
      setNewBoardYear("");
    };
    const moveBoardYear = (yi, dir) => {
      const ni = yi + dir;
      if (ni < 0 || ni >= boardYears.length) return;
      setBoardYears(arraySwap(boardYears, yi, ni));
    };
    const removeBoardYear = (y) => {
      if (board.some((m) => (m.year || boardYears[0]) === y)) {
        alert(`Move or delete every member listed under ${y} before removing that year.`);
        return;
      }
      const next = boardYears.filter((x) => x !== y);
      setBoardYears(next);
      if (editYear === y) setEditYear(next[0] || "");
    };
    const groupIdxs = board.reduce((acc, m, idx) => {
      if ((m.year || boardYears[0]) === editYear) acc.push(idx);
      return acc;
    }, []);
    return (
      <Section title="Board members">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Photos upload to storage; links are optional and open from the pop-up shown when
          someone clicks the card — add as many as you like (Instagram, LinkedIn, a website…).
          Add a new year below for each incoming board rather than deleting the old one.
        </p>

        {/* Year management — top of this list is what the public site (and this
            panel) show by default, so reorder with the arrows to change which
            year counts as "current" without touching any code. */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
            Board years (top = shown by default)</label>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {boardYears.map((y, yi) => (
              <div key={y} onClick={() => setEditYear(y)} style={{ display: "flex", alignItems: "center",
                gap: 8, padding: "7px 10px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${editYear === y ? "var(--accent)" : "var(--border)"}`,
                background: editYear === y ? "var(--tint)" : "transparent" }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: editYear === y ? 700 : 500 }}>
                  {y}{yi === 0 && <span style={{ color: "var(--accent)", fontWeight: 700 }}> · current</span>}
                </span>
                <button onClick={(e) => { e.stopPropagation(); moveBoardYear(yi, -1); }}
                  disabled={yi === 0} style={yi === 0 ? moveBtnOff : moveBtn}
                  aria-label={`Move ${y} up`}><ArrowUp size={14} /></button>
                <button onClick={(e) => { e.stopPropagation(); moveBoardYear(yi, 1); }}
                  disabled={yi === boardYears.length - 1} style={yi === boardYears.length - 1 ? moveBtnOff : moveBtn}
                  aria-label={`Move ${y} down`}><ArrowDown size={14} /></button>
                {boardYears.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeBoardYear(y); }}
                    style={{ ...delBtn, width: 30, height: 30 }} aria-label={`Remove ${y}`}>
                    <Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input style={{ ...inpSm, width: 110 }} placeholder="e.g. 2027-28" value={newBoardYear}
              onChange={(e) => setNewBoardYear(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addBoardYear()} />
            <button onClick={addBoardYear} style={miniBtn}><Plus size={14} /> Add year</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>
            {editYear} board</h4>
          <button onClick={add} style={miniBtn}>
            <Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {groupIdxs.length === 0 && (
            <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8,
              textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
              None yet</div>
          )}
          {/* Reorder within the selected year by swapping with the nearest
              neighbour that shares the same year — `i` below is the real
              index into the full `board` array, but `pos`/`groupIdxs` track
              this member's position within just this year's group, since
              different years' members are interleaved in the array. */}
          {groupIdxs.map((i, pos) => {
            const m = board[i];
            return (
            <div key={m.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, paddingRight: 112, display: "grid", gap: 8, position: "relative" }}>
              <ImageField label="Photo" value={m.img || ""} folder="board"
                onChange={(url) => edit(i, { img: url })} />
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>Name</label>
                  <input style={inpSm} value={m.name || ""}
                    onChange={(e) => edit(i, { name: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>Role / title</label>
                  <input style={inpSm} value={m.role || ""}
                    onChange={(e) => edit(i, { role: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
                  Links (optional)</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {boardLinks(m).length === 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No links yet.</div>
                  )}
                  {boardLinks(m).map((l, li) => {
                    const links = boardLinks(m);
                    const editLink = (patch) => setMemberLinks(i,
                      links.map((x, xi) => (xi === li ? { ...x, ...patch } : x)));
                    return (
                      <div key={l.id ?? li} style={{ display: "grid", gap: 6,
                        gridTemplateColumns: "1fr 1.4fr auto", alignItems: "center" }}>
                        <input style={inpSm} placeholder="Label (optional)" value={l.label || ""}
                          onChange={(e) => editLink({ label: e.target.value })} />
                        <input style={inpSm} placeholder="https://…" value={l.url || ""}
                          onChange={(e) => editLink({ url: e.target.value })} />
                        <button onClick={() => setMemberLinks(i, links.filter((_, xi) => xi !== li))}
                          style={{ ...delBtn, width: 30, height: 30 }} aria-label="Remove link">
                          <Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                </div>
                <button onClick={() => setMemberLinks(i, [...boardLinks(m), { id: Date.now(), label: "", url: "" }])}
                  style={{ ...miniBtn, marginTop: 8 }}>
                  <Plus size={13} /> Add link</button>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
                  Mini bio</label>
                <textarea style={{ ...inpSm, minHeight: 70, resize: "vertical" }}
                  value={m.bio || ""} onChange={(e) => edit(i, { bio: e.target.value })} />
              </div>
              <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
                <button onClick={() => pos > 0 && setBoard(arraySwap(board, i, groupIdxs[pos - 1]))}
                  disabled={pos === 0} style={pos === 0 ? moveBtnOff : moveBtn}
                  aria-label={`Move ${m.name} up`}><ArrowUp size={14} /></button>
                <button onClick={() => pos < groupIdxs.length - 1 && setBoard(arraySwap(board, i, groupIdxs[pos + 1]))}
                  disabled={pos === groupIdxs.length - 1} style={pos === groupIdxs.length - 1 ? moveBtnOff : moveBtn}
                  aria-label={`Move ${m.name} down`}><ArrowDown size={14} /></button>
                <button onClick={() => setBoard(board.filter((_, n) => n !== i))}
                  style={delBtn} aria-label={`Delete ${m.name}`}><Trash2 size={15} /></button>
              </div>
            </div>
            );
          })}
        </div>
      </Section>
    );
  }

  if (tab === "announce") {
    const items = data.announcements || [];
    const set = (next) => up({ announcements: next });
    const edit = (i, patch) => { const c = [...items]; c[i] = { ...c[i], ...patch }; set(c); };
    return (
      <Section title="Announcements">
        <p style={{ margin: "-8px 0 16px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Shown directly below the hero. Pinned items appear first. Leave the date blank to hide it.
        </p>
        <button className="btn" onClick={() => set([...items, { id: Date.now(), kind: "notice",
          title: "New announcement", body: "", date: "", pinned: false, href: "" }])}
          style={{ ...btnPurple, marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} /> Add announcement</button>
        <div style={{ display: "grid", gap: 14 }}>
          {items.length === 0 && (
            <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 10, textAlign: "center",
              border: "1px dashed var(--border)", borderRadius: 10 }}>None yet</div>
          )}
          {items.map((a, i) => (
            <div key={a.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={lbl}>Type</label>
                  <select style={inpSm} value={a.kind || "notice"}
                    onChange={(e) => edit(i, { kind: e.target.value })}>
                    <option value="notice">Notice</option>
                    <option value="deadline">Deadline</option>
                    <option value="event">Event update</option>
                    <option value="ramadan">Ramadan</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Date label (optional)</label>
                  <input style={inpSm} placeholder="e.g. Fri 12 Sep" value={a.date || ""}
                    onChange={(e) => edit(i, { date: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={lbl}>Title</label>
                <input style={inpSm} value={a.title || ""}
                  onChange={(e) => edit(i, { title: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>Body</label>
                <textarea style={{ ...inpSm, minHeight: 68, resize: "vertical" }} value={a.body || ""}
                  onChange={(e) => edit(i, { body: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>Link (optional)</label>
                <input style={inpSm} placeholder="https://…" value={a.href || ""}
                  onChange={(e) => edit(i, { href: e.target.value })} />
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8,
                fontSize: 13, color: "var(--text-soft)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!a.pinned}
                  onChange={(e) => edit(i, { pinned: e.target.checked })} />
                Pin to the top
              </label>
              <button onClick={() => set(items.filter((_, n) => n !== i))}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete announcement"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "about") {
    const about = data.about || seed.about;
    const setAbout = (patch) => up({ about: { ...about, ...patch } });
    const pillars = about.pillars || [];
    const editP = (i, patch) => {
      const c = [...pillars]; c[i] = { ...c[i], ...patch }; setAbout({ pillars: c });
    };
    return (
      <Section title="About section">
        <Field label="Intro paragraph">
          <textarea style={{ ...inp, minHeight: 90 }} value={about.intro || ""}
            onChange={(e) => setAbout({ intro: e.target.value })} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "6px 0 10px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>Pillars</h4>
          <button onClick={() => setAbout({ pillars: [...pillars, { id: Date.now(),
            icon: "star", title: "New pillar", text: "" }] })} style={miniBtn}>
            <Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {pillars.map((p, i) => (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={lbl}>Title</label>
                  <input style={inpSm} value={p.title || ""}
                    onChange={(e) => editP(i, { title: e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Icon</label>
                  <select style={inpSm} value={p.icon || "star"}
                    onChange={(e) => editP(i, { icon: e.target.value })}>
                    {["star","book","grad","sparkles","hand","users"].map((k) =>
                      <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Text</label>
                <textarea style={{ ...inpSm, minHeight: 64, resize: "vertical" }} value={p.text || ""}
                  onChange={(e) => editP(i, { text: e.target.value })} />
              </div>
              <button onClick={() => setAbout({ pillars: pillars.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete pillar"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "donate") {
    const d = data.donate || seed.donate;
    const setD = (patch) => up({ donate: { ...d, ...patch } });
    const impact = d.impact || [];
    const editI = (i, patch) => {
      const c = [...impact]; c[i] = { ...c[i], ...patch }; setD({ impact: c });
    };
    return (
      <Section title="Donations">
        <Field label="MSA donation URL">
          <input style={inp} value={d.msaUrl || ""}
            onChange={(e) => setD({ msaUrl: e.target.value })} />
        </Field>
        <Field label="Islamic House donation URL">
          <input style={inp} value={d.houseUrl || ""}
            onChange={(e) => setD({ houseUrl: e.target.value })} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "6px 0 10px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>
            Impact tiers</h4>
          <button onClick={() => setD({ impact: [...impact, { id: Date.now(),
            amount: "$25", text: "" }] })} style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {impact.map((t, i) => (
            <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, gridTemplateColumns: "110px 1fr auto",
              alignItems: "end" }}>
              <div>
                <label style={lbl}>Amount</label>
                <input style={inpSm} value={t.amount || ""}
                  onChange={(e) => editI(i, { amount: e.target.value })} />
              </div>
              <div>
                <label style={lbl}>What it covers</label>
                <input style={inpSm} value={t.text || ""}
                  onChange={(e) => editI(i, { text: e.target.value })} />
              </div>
              <button onClick={() => setD({ impact: impact.filter((_, n) => n !== i) })}
                style={delBtn} aria-label="Delete tier"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "house") {
    const h = data.islamicHouse || seed.islamicHouse;
    const setH = (patch) => up({ islamicHouse: { ...h, ...patch } });
    const feats = h.features || [];
    const photos = h.photos || [];
    const editF = (i, patch) => { const c = [...feats]; c[i] = { ...c[i], ...patch }; setH({ features: c }); };
    const editPh = (i, patch) => { const c = [...photos]; c[i] = { ...c[i], ...patch }; setH({ photos: c }); };
    // Same legacy-migration read as the public section: once an admin
    // touches this list at all, it's saved under futureImages going
    // forward and the old singular futureImage field is just along for
    // the ride (harmless, unused once futureImages is non-empty).
    const futureImgs = (h.futureImages && h.futureImages.length)
      ? h.futureImages
      : (h.futureImage ? [{ id: "legacy", img: h.futureImage, caption: "" }] : []);
    const editFI = (i, patch) => {
      const c = [...futureImgs]; c[i] = { ...c[i], ...patch }; setH({ futureImages: c });
    };
    return (
      <Section title="Islamic House">
        <Field label="Address"><input style={inp} value={h.address || ""}
          onChange={(e) => setH({ address: e.target.value })} /></Field>
        <Field label="Google Maps link (optional)"><input style={inp} value={h.mapUrl || ""}
          placeholder="https://maps.google.com/…"
          onChange={(e) => setH({ mapUrl: e.target.value })} /></Field>
        <Field label="Hours / prayer note"><input style={inp} value={h.hours || ""}
          onChange={(e) => setH({ hours: e.target.value })} /></Field>
        <Field label="Description"><textarea style={{ ...inp, minHeight: 110 }} value={h.body || ""}
          onChange={(e) => setH({ body: e.target.value })} /></Field>
        <Field label="Donation URL"><input style={inp} value={h.donateUrl || ""}
          onChange={(e) => setH({ donateUrl: e.target.value })} /></Field>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "10px 0" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>
            Future building photo(s)</h4>
          <button onClick={() => setH({ futureImages: [...futureImgs, { id: Date.now(), img: "", caption: "" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <p style={{ margin: "-4px 0 12px", fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Shown above the "Visit" card. One photo shows as-is; add more and it
          becomes a slideshow with arrows automatically — no extra setup needed.
        </p>
        {futureImgs.length === 0 && (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8, marginBottom: 12,
            textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
            None yet — shows a "coming soon" placeholder on the site</div>
        )}
        <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
          {futureImgs.map((p, i) => (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, paddingRight: 112, display: "grid", gap: 8, position: "relative" }}>
              <ImageField label="Photo" value={p.img || ""} folder="house"
                onChange={(url) => editFI(i, { img: url })} />
              <div><label style={lbl}>Caption (optional)</label>
                <input style={inpSm} value={p.caption || ""}
                  onChange={(e) => editFI(i, { caption: e.target.value })} /></div>
              <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
                <button onClick={() => i > 0 && setH({ futureImages: arraySwap(futureImgs, i, i - 1) })}
                  disabled={i === 0} style={i === 0 ? moveBtnOff : moveBtn}
                  aria-label="Move photo up"><ArrowUp size={14} /></button>
                <button onClick={() => i < futureImgs.length - 1 && setH({ futureImages: arraySwap(futureImgs, i, i + 1) })}
                  disabled={i === futureImgs.length - 1} style={i === futureImgs.length - 1 ? moveBtnOff : moveBtn}
                  aria-label="Move photo down"><ArrowDown size={14} /></button>
                <button onClick={() => setH({ futureImages: futureImgs.filter((_, n) => n !== i) })}
                  style={delBtn} aria-label="Delete photo"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "10px 0" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>Highlights</h4>
          <button onClick={() => setH({ features: [...feats, { id: Date.now(), title: "New", text: "" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {feats.map((f, i) => (
            <div key={f.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div><label style={lbl}>Title</label>
                <input style={inpSm} value={f.title || ""}
                  onChange={(e) => editF(i, { title: e.target.value })} /></div>
              <div><label style={lbl}>Text</label>
                <input style={inpSm} value={f.text || ""}
                  onChange={(e) => editF(i, { text: e.target.value })} /></div>
              <button onClick={() => setH({ features: feats.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete highlight"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "16px 0 10px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>Photos</h4>
          <button onClick={() => setH({ photos: [...photos, { id: Date.now(), img: "", caption: "" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {photos.map((p, i) => (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, paddingRight: 112, display: "grid", gap: 8, position: "relative" }}>
              <ImageField label="Photo" value={p.img || ""} folder="house"
                onChange={(url) => editPh(i, { img: url })} />
              <div><label style={lbl}>Caption (optional)</label>
                <input style={inpSm} value={p.caption || ""}
                  onChange={(e) => editPh(i, { caption: e.target.value })} /></div>
              <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
                <button onClick={() => i > 0 && setH({ photos: arraySwap(photos, i, i - 1) })}
                  disabled={i === 0} style={i === 0 ? moveBtnOff : moveBtn}
                  aria-label="Move photo up"><ArrowUp size={14} /></button>
                <button onClick={() => i < photos.length - 1 && setH({ photos: arraySwap(photos, i, i + 1) })}
                  disabled={i === photos.length - 1} style={i === photos.length - 1 ? moveBtnOff : moveBtn}
                  aria-label="Move photo down"><ArrowDown size={14} /></button>
                <button onClick={() => setH({ photos: photos.filter((_, n) => n !== i) })}
                  style={delBtn} aria-label="Delete photo"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "newhere") {
    const nh = data.newHere || seed.newHere;
    const setNh = (patch) => up({ newHere: { ...nh, ...patch } });
    return (
      <Section title="New here?">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          The heading and paragraph are edited on the Section text tab (look for "New here?").
          This tab is just the button underneath it.
        </p>
        <Field label="Button label">
          <input style={inp} value={nh.linkLabel || ""}
            onChange={(e) => setNh({ linkLabel: e.target.value })} />
        </Field>
        <Field label="Link URL (e.g. the Muslim Student Guide)">
          <input style={inp} value={nh.href || ""} placeholder="https://…"
            onChange={(e) => setNh({ href: e.target.value })} />
        </Field>

        <div style={{ height: 1, background: "var(--border)", margin: "18px 0" }} />
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Second button (e.g. "Guide to being a Muslim at UW"). Leave the URL blank to hide it.
        </p>
        <Field label="Second button label">
          <input style={inp} value={nh.linkLabel2 || ""}
            onChange={(e) => setNh({ linkLabel2: e.target.value })} />
        </Field>
        <Field label="Second link URL">
          <input style={inp} value={nh.href2 || ""} placeholder="https://…"
            onChange={(e) => setNh({ href2: e.target.value })} />
        </Field>
      </Section>
    );
  }

  if (tab === "instagram") {
    const ig = data.instagram || seed.instagram;
    const setIg = (patch) => up({ instagram: { ...ig, ...patch } });
    const posts = ig.posts || [];
    const editP = (i, patch) => { const c = [...posts]; c[i] = { ...c[i], ...patch }; setIg({ posts: c }); };
    return (
      <Section title="Instagram">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Paste the URL of any public Instagram post (copy the link from the "..." menu on the
          post) — it renders as a real embedded post, no login required. The heading/intro text
          is edited on the Section text tab.
        </p>
        <Field label={'Instagram handle (for the "Follow us" link)'}>
          <input style={inp} value={ig.handle || ""} placeholder="msa_uw"
            onChange={(e) => setIg({ handle: e.target.value })} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "16px 0 10px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>Posts</h4>
          <button onClick={() => setIg({ posts: [...posts, { id: Date.now(), url: "" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {posts.map((p, i) => (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div><label style={lbl}>Post URL</label>
                <input style={inpSm} value={p.url || ""} placeholder="https://www.instagram.com/p/…"
                  onChange={(e) => editP(i, { url: e.target.value })} /></div>
              <button onClick={() => setIg({ posts: posts.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete post"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "tiktok") {
    const tk = data.tiktok || seed.tiktok;
    const setTk = (patch) => up({ tiktok: { ...tk, ...patch } });
    const posts = tk.posts || [];
    const editP = (i, patch) => { const c = [...posts]; c[i] = { ...c[i], ...patch }; setTk({ posts: c }); };
    return (
      <Section title="TikTok">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Paste the URL of any public TikTok video (copy the share link) to pin specific videos —
          each renders as a real embedded video, no login required. With no videos pinned, the
          section instead shows TikTok's own live profile card for the handle below (avatar,
          follower count, and up to 10 recent videos, updating on its own — nothing to maintain
          here). The heading/intro text is edited on the Section text tab.
        </p>
        <Field label={'TikTok handle (for the "Follow us" link)'}>
          <input style={inp} value={tk.handle || ""} placeholder="msa.uw"
            onChange={(e) => setTk({ handle: e.target.value })} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "16px 0 10px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>Videos</h4>
          <button onClick={() => setTk({ posts: [...posts, { id: Date.now(), url: "" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {posts.map((p, i) => (
            <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div><label style={lbl}>Video URL</label>
                <input style={inpSm} value={p.url || ""} placeholder="https://www.tiktok.com/@msa.uw/video/…"
                  onChange={(e) => editP(i, { url: e.target.value })} /></div>
              <button onClick={() => setTk({ posts: posts.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete video"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "merch") {
    const mc = data.merch || seed.merch;
    const setM = (patch) => up({ merch: { ...mc, ...patch } });
    const items = mc.items || [];
    const editI = (i, patch) => { const c = [...items]; c[i] = { ...c[i], ...patch }; setM({ items: c }); };
    const channels = mc.channels || [];
    const editC = (i, patch) => { const c = [...channels]; c[i] = { ...c[i], ...patch }; setM({ channels: c }); };
    return (
      <Section title="Merch">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Advertise upcoming merch with photos now. When it's orderable, turn on
          <b> "Merch is available"</b> to reveal the ordering options below it. Heading text
          is on this tab.
        </p>
        <Field label="Eyebrow (small label)">
          <input style={inp} value={mc.eyebrow || ""} onChange={(e) => setM({ eyebrow: e.target.value })} />
        </Field>
        <Field label="Title">
          <input style={inp} value={mc.title || ""} onChange={(e) => setM({ title: e.target.value })} />
        </Field>
        <Field label="Intro line">
          <input style={inp} value={mc.intro || ""} onChange={(e) => setM({ intro: e.target.value })} />
        </Field>
        <Field label="Store link (the button beneath the photos sends people here)">
          <input style={inp} value={mc.orderUrl || ""} placeholder="https://…"
            onChange={(e) => setM({ orderUrl: e.target.value })} />
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 4px",
          cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" checked={!!mc.available}
            onChange={(e) => setM({ available: e.target.checked })} />
          Merch is available (show ordering options)
        </label>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "18px 0 10px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>Products</h4>
          <button onClick={() => setM({ items: [...items, { id: Date.now(), name: "", note: "", img: "" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {items.map((it, i) => {
            // `images` is the current field; a lone legacy `img` (from
            // before multiple photos per product were supported) still
            // reads fine here — it just shows as this product's one photo
            // until edited, same pattern boardLinks() uses for the old
            // single-href board members.
            const imgs = it.images && it.images.length ? it.images : (it.img ? [it.img] : []);
            const setImgs = (next) => editI(i, { images: next, img: "" });
            return (
            <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div><label style={lbl}>Name</label>
                <input style={inpSm} value={it.name || ""} placeholder="MSA x Intentions Hoodie"
                  onChange={(e) => editI(i, { name: e.target.value })} /></div>
              <div><label style={lbl}>Note (color, sizing…)</label>
                <input style={inpSm} value={it.note || ""} placeholder="Off-white · unisex"
                  onChange={(e) => editI(i, { note: e.target.value })} /></div>
              <div>
                <label style={lbl}>Photos (front, back, worn — add as many as you like)</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {imgs.map((url, ii) => (
                    <div key={ii} style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <ImageField label={`Photo ${ii + 1}`} value={url} folder="merch"
                          onChange={(newUrl) => {
                            const next = imgs.slice(); next[ii] = newUrl;
                            setImgs(next.filter(Boolean));
                          }} />
                      </div>
                      <button type="button" onClick={() => setImgs(imgs.filter((_, xi) => xi !== ii))}
                        style={{ ...delBtn, width: 30, height: 30, marginBottom: 12 }}
                        aria-label={`Remove photo ${ii + 1}`}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setImgs([...imgs, ""])}
                  style={{ ...miniBtn, marginTop: imgs.length ? 4 : 0 }}>
                  <Plus size={13} /> Add photo</button>
              </div>
              <button onClick={() => setM({ items: items.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete product"><Trash2 size={15} /></button>
            </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "22px 0 6px" }}>
          <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>
            Ordering options</h4>
          <button onClick={() => setM({ channels: [...channels, { id: Date.now(), label: "", href: "", kind: "link" }] })}
            style={miniBtn}><Plus size={14} /> Add</button>
        </div>
        <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Shown only when "Merch is available" is on. Icon options: <b>link</b> (online store),
          <b> instagram</b> (DM), <b>table</b> (da'wah table).
        </p>
        <Field label="Ordering intro line">
          <input style={inp} value={mc.orderNote || ""} onChange={(e) => setM({ orderNote: e.target.value })} />
        </Field>
        <div style={{ display: "grid", gap: 12 }}>
          {channels.map((c, i) => (
            <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div><label style={lbl}>Label</label>
                <input style={inpSm} value={c.label || ""} placeholder="Order online (Intentions HQ)"
                  onChange={(e) => editC(i, { label: e.target.value })} /></div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr" }}>
                <div><label style={lbl}>Link (optional)</label>
                  <input style={inpSm} value={c.href || ""} placeholder="https://…"
                    onChange={(e) => editC(i, { href: e.target.value })} /></div>
                <div><label style={lbl}>Icon</label>
                  <input style={inpSm} value={c.kind || ""} placeholder="link / instagram / table"
                    onChange={(e) => editC(i, { kind: e.target.value })} /></div>
              </div>
              <button onClick={() => setM({ channels: channels.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete option"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "calendar") {
    const items = data.calendar || [];
    const set = (next) => up({ calendar: next });
    const edit = (i, patch) => { const c = [...items]; c[i] = { ...c[i], ...patch }; set(c); };
    const sorted = [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return (
      <Section title="Dated events (monthly calendar)">
        <p style={{ margin: "-8px 0 16px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          These appear in the monthly calendar view. The weekly view is edited on the Events tab.
        </p>
        <button className="btn" onClick={() => set([...items, { id: Date.now(),
          date: new Date().toISOString().slice(0, 10), name: "New event",
          time: "", loc: "", desc: "", category: "" }])}
          style={{ ...btnPurple, marginBottom: 16, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} /> Add dated event</button>
        <div style={{ display: "grid", gap: 14 }}>
          {items.length === 0 && (
            <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 10, textAlign: "center",
              border: "1px dashed var(--border)", borderRadius: 10 }}>No dated events yet</div>
          )}
          {items.map((e, i) => (
            <div key={e.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div><label style={lbl}>Date</label>
                  <input type="date" style={inpSm} value={e.date || ""}
                    onChange={(ev) => edit(i, { date: ev.target.value })} /></div>
                <div><label style={lbl}>Time</label>
                  <input style={inpSm} placeholder="6:00 PM" value={e.time || ""}
                    onChange={(ev) => edit(i, { time: ev.target.value })} /></div>
              </div>
              <div><label style={lbl}>Name</label>
                <input style={inpSm} value={e.name || ""}
                  onChange={(ev) => edit(i, { name: ev.target.value })} /></div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div><label style={lbl}>Location</label>
                  <input style={inpSm} value={e.loc || ""}
                    onChange={(ev) => edit(i, { loc: ev.target.value })} /></div>
                <div><label style={lbl}>Category (for filtering)</label>
                  <input style={inpSm} placeholder="e.g. Social, Halaqa, Sports" value={e.category || ""}
                    onChange={(ev) => edit(i, { category: ev.target.value })} /></div>
              </div>
              <div><label style={lbl}>Description (optional)</label>
                <input style={inpSm} value={e.desc || ""}
                  onChange={(ev) => edit(i, { desc: ev.target.value })} /></div>
              <button onClick={() => set(items.filter((_, n) => n !== i))}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete event"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (tab === "history") {
    return <AdminHistory />;
  }

  if (tab === "contact") {
    const c = data.contact || seed.contact;
    const setC = (patch) => up({ contact: { ...c, ...patch } });
    const extra = data.eventsExtra || seed.eventsExtra;
    const setE = (patch) => up({ eventsExtra: { ...extra, ...patch } });
    return (
      <Section title="Contact & suggestions">
        <Field label="Contact email">
          <input style={inp} value={c.email || ""}
            onChange={(e) => setC({ email: e.target.value })} />
        </Field>
        <Field label="Note under the email">
          <textarea style={{ ...inp, minHeight: 70 }} value={c.note || ""}
            onChange={(e) => setC({ note: e.target.value })} />
        </Field>
        <div style={{ height: 1, background: "var(--border)", margin: "18px 0" }} />
        <Field label="“Suggest an event” form URL (Google Form or similar)">
          <input style={inp} placeholder="https://forms.gle/…" value={extra.suggestUrl || ""}
            onChange={(e) => setE({ suggestUrl: e.target.value })} />
        </Field>
        <Field label="Suggestion prompt text">
          <input style={inp} value={extra.suggestNote || ""}
            onChange={(e) => setE({ suggestNote: e.target.value })} />
        </Field>
        <div style={{ height: 1, background: "var(--border)", margin: "18px 0" }} />
        <Field label="Notion calendar embed URL (published *.notion.site link)">
          <input style={inp} placeholder="https://your-page.notion.site/…" value={extra.notionUrl || ""}
            onChange={(e) => setE({ notionUrl: e.target.value })} />
        </Field>
        <p style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
          In Notion open the calendar → Share → <b>Publish</b> → copy the published link
          (it ends in <b>.notion.site</b>). Paste it here and the monthly view shows your
          Notion calendar. Leave blank to use the built-in calendar. A private
          app.notion.com link can't be embedded.
        </p>
      </Section>
    );
  }

  if (tab === "bar") {
    const bar = data.bar || seed.bar;
    const setBar = (patch) => up({ bar: { ...bar, ...patch } });
    return (
      <Section title="Announcement bar">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 9,
          fontSize: 14, color: "var(--text-soft)", cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={!!bar.on}
            onChange={(e) => setBar({ on: e.target.checked })} />
          Show the announcement bar above the navigation
        </label>
        <Field label="Bar message">
          <input style={inp} value={bar.text || ""}
            placeholder="e.g. Board applications close November 14."
            onChange={(e) => setBar({ text: e.target.value })} />
        </Field>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Link label (optional)">
            <input style={inp} value={bar.linkLabel || ""} placeholder="Apply now"
              onChange={(e) => setBar({ linkLabel: e.target.value })} />
          </Field>
          <Field label="Link URL — or #section">
            <input style={inp} value={bar.href || ""} placeholder="https://…  or  #events"
              onChange={(e) => setBar({ href: e.target.value })} />
          </Field>
        </div>
        <p style={{ margin: "-4px 0 10px", fontSize: 12.5, color: "var(--text-faint)",
          lineHeight: 1.6 }}>
          Editing the message shows the bar again to everyone who dismissed the previous one.
          Link to a page (<b>/events</b>, <b>/about#donate</b>) or an external URL.
        </p>
        <div style={{ margin: "4px 0 4px", padding: "10px 12px", borderRadius: 10,
          background: "var(--tint)", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          The hero is now a scroll-driven cherry-blossom image sequence — there's no video to
          configure. Frames live in <b>public/hero/</b>.
        </div>
      </Section>
    );
  }

  if (tab === "mailing") {
    const m = data.mailing || seed.mailing;
    const setM = (patch) => up({ mailing: { ...m, ...patch } });
    return (
      <Section title="Mailing list">
        <label style={{ display: "inline-flex", alignItems: "center", gap: 9,
          fontSize: 14, color: "var(--text-soft)", cursor: "pointer", marginBottom: 14 }}>
          <input type="checkbox" checked={!!m.on}
            onChange={(e) => setM({ on: e.target.checked })} />
          Show the mailing list section
        </label>
        <Field label="Heading">
          <input style={inp} value={m.title || ""}
            onChange={(e) => setM({ title: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea style={{ ...inp, minHeight: 70 }} value={m.body || ""}
            onChange={(e) => setM({ body: e.target.value })} />
        </Field>
        <Field label="External form URL (optional — leave blank to collect signups here)">
          <input style={inp} value={m.externalUrl || ""} placeholder="https://forms.gle/…"
            onChange={(e) => setM({ externalUrl: e.target.value })} />
        </Field>
        <SubscriberList />
      </Section>
    );
  }

  if (tab === "stats")
    return (
      <ListEditor title="Stats" items={data.stats || []}
        onChange={(stats) => up({ stats })}
        blank={{ value: "0", suffix: "+", label: "New stat" }}
        fields={[["value", "Number"], ["suffix", "Suffix (e.g. + or %)"], ["label", "Label"]]} />
    );

  if (tab === "links")
    return (
      <ListEditor title="External links" items={data.links}
        onChange={(links) => up({ links })}
        blank={{ name: "New link", href: "https://", kind: "link" }}
        fields={[["name", "Label"], ["href", "URL"], ["kind", "Icon (link/discord/facebook/instagram/tiktok/linkedin/donate)"]]} />
    );

  return null;
}


/* Admin-only: view and export mailing list signups. */
function SubscriberList() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setBusy(true); setErr("");
    const res = await listSubscribers();
    setBusy(false);
    if (res.ok) setRows(res.rows);
    else setErr(res.error);
  };

  const exportCsv = () => {
    if (!rows?.length) return;
    const head = ["First name", "Last name", "Email", "Status", "Joined"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.map(esc).join(",")].concat(
      rows.map((r) => [r.first_name, r.last_name, r.email, r.status,
        (r.created_at || "").slice(0, 10)].map(esc).join(","))
    ).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `msa-subscribers-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>
          Signups{rows ? ` (${rows.length})` : ""}</h4>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={load} disabled={busy} style={miniBtn}>
            {busy ? "Loading…" : rows ? "Refresh" : "Load list"}</button>
          {!!rows?.length && (
            <button className="btn" onClick={exportCsv} style={miniBtn}>Export CSV</button>
          )}
        </div>
      </div>
      {err && <div style={{ fontSize: 13, color: "#c0392b", marginBottom: 8 }}>{err}</div>}
      {rows && rows.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-faint)" }}>No signups yet.</div>
      )}
      {!!rows?.length && (
        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)",
          borderRadius: 10 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12,
              padding: "9px 12px", fontSize: 13,
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
              <span style={{ color: "var(--text)", minWidth: 0, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                <span style={{ color: "var(--text-faint)" }}> · {r.email}</span>
              </span>
              <span style={{ color: "var(--text-faint)", flexShrink: 0 }}>
                {(r.created_at || "").slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-faint)", lineHeight: 1.6 }}>
        Only signed-in admins can read this list — it isn't exposed publicly.
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 18px", color: "var(--accent)", fontSize: 19, fontWeight: 700 }}>{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-soft)",
        marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
// Upload / preview / remove a single image (gallery, sponsors, events).
function ImageField({ value, onChange, folder = "gallery", label = "Image" }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(""); setBusy(true);
    const res = await uploadImage(file, folder);
    setBusy(false);
    if (res.ok) onChange(res.url); else setErr(res.error);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = async () => {
    const p = pathFromUrl(value);
    onChange("");
    if (p) await deleteImage(p);
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 5 }}>
        <div style={{ width: 74, height: 56, borderRadius: 9, overflow: "hidden", flexShrink: 0,
          border: "1px solid var(--border-strong)", background: "var(--surface-2)", display: "grid", placeItems: "center" }}>
          {value ? <img src={value} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                 : <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>None</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            style={{ ...miniBtn, opacity: busy ? .6 : 1 }}>
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </button>
          {value && <button type="button" onClick={remove}
            style={{ ...miniBtn, background: "rgba(192,57,43,.1)", color: "#c0392b" }}>Remove</button>}
          <input ref={inputRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
        </div>
      </div>
      {err && <div style={{ color: "#c0392b", fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
// Swaps items i and j (both indices into `items`, keys preserved) — the
// building block for every "move up / move down" reorder control. Pure/
// immutable so it composes cleanly with the various setState callbacks
// each admin tab already uses.
function arraySwap(items, i, j) {
  if (i < 0 || j < 0 || i >= items.length || j >= items.length) return items;
  const c = items.slice();
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}

const moveBtn = { background: "var(--tint)", color: "var(--accent)", border: "none", borderRadius: 8,
  width: 30, height: 30, display: "grid", placeItems: "center", cursor: "pointer" };
const moveBtnOff = { ...moveBtn, opacity: 0.3, cursor: "default" };

function ListEditor({ title, items, onChange, blank, fields }) {
  const add = () => onChange([...items, { id: Date.now(), ...blank }]);
  const del = (i) => onChange(items.filter((_, n) => n !== i));
  const edit = (i, key, val) => { const c = [...items]; c[i] = { ...c[i], [key]: val }; onChange(c); };
  const move = (i, dir) => onChange(arraySwap(items, i, i + dir));
  return (
    <Section title={title}>
      <button className="btn" onClick={add} style={{ ...btnPurple, marginBottom: 16, display: "inline-flex",
        alignItems: "center", gap: 6 }}><Plus size={16} /> Add</button>
      {/* Reorder with the arrow buttons instead of deleting and re-adding —
          position on the live site follows this list's order directly. */}
      <div style={{ display: "grid", gap: 14 }}>
        {items.map((it, i) => (
          <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
            padding: 14, paddingRight: 112, display: "grid", gap: 8, position: "relative" }}>
            {fields.map(([key, lbl, kind]) => (
              kind === "image" ? (
                <ImageField key={key} label={lbl} value={it[key] || ""}
                  folder={title.toLowerCase().includes("sponsor") ? "sponsors" : "gallery"}
                  onChange={(url) => edit(i, key, url)} />
              ) : (
                <div key={key}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>{lbl}</label>
                  <input style={inpSm} value={it[key] || ""} onChange={(e) => edit(i, key, e.target.value)} />
                </div>
              )
            ))}
            <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
              <button onClick={() => i > 0 && move(i, -1)} disabled={i === 0}
                style={i === 0 ? moveBtnOff : moveBtn} aria-label="Move up"><ArrowUp size={14} /></button>
              <button onClick={() => i < items.length - 1 && move(i, 1)} disabled={i === items.length - 1}
                style={i === items.length - 1 ? moveBtnOff : moveBtn} aria-label="Move down"><ArrowDown size={14} /></button>
              <button onClick={() => del(i)} style={delBtn} aria-label="Delete"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}


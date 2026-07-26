/* ════════════════════════════════════════════════════════════════════════
   CanvasHeroSequence.jsx

   Apple-style scroll-driven cherry-blossom hero. A tall "scroll stage"
   pins a full-viewport <canvas>; as the visitor scrolls through the stage
   the canvas draws successive frames of a 270-image blossom sequence,
   producing a cinematic bloom that scrubs 1:1 with the scrollbar.

   Performance architecture
   ─────────────────────────
   • HTML5 Canvas, single draw call per rendered frame (no 270 stacked
     <img> layers, no CSS opacity crossfades → no compositor thrash).
   • requestAnimationFrame throttling: scroll only ever marks the target
     frame dirty; the actual decode+draw happens once per animation frame,
     and is skipped entirely when the target index hasn't changed.
   • Progressive preload with a small concurrency window so the first
     frames paint fast and the network isn't flooded with 270 parallel
     requests. Frames decode off-thread via Image.decode() where available.
   • Responsive source set — a lighter 640px sequence for phones, the
     1152px sequence for everything else, chosen once on mount.
   • Retina-aware backing store (devicePixelRatio, capped at 2) so the
     canvas is crisp without over-allocating on 3x phones.
   • prefers-reduced-motion (or the site's "reduce motion" setting) →
     the whole scroll stage collapses to a single static poster frame,
     no canvas loop, no tall spacer.

   The component is self-contained: it renders its own pinned stage and
   calls back with scroll progress (0..1) so the parent can fade hero
   text in/out in step with the bloom.
   ════════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback } from "react";

// To swap in a new sequence (e.g. a higher-quality 120-frame re-render):
// 1. Drop the files in public/hero/lg/ and public/hero/sm/, named
//    frame-000.webp … frame-{N-1}.webp, zero-padded to 3 digits (works
//    fine for any count up to 999 — no other change needed for naming).
// 2. Update FRAME_COUNT below to match the new total.
// Everything else (preload pool, scroll-to-frame mapping, resolution
// picking) automatically adapts to whatever count is set here.
const FRAME_COUNT = 270;
const BASE = import.meta.env.BASE_URL || "/";

// zero-padded 000..269 to match the encoded files
const frameName = (i) => `frame-${String(i).padStart(3, "0")}.webp`;
const frameUrl = (i, size) => `${BASE}hero/${size}/${frameName(i)}`;
const posterUrl = () => `${BASE}hero/poster.webp`;

/* Pick the source resolution once. Phones and narrow tablets get the
   640px set (≈7 MB across the whole sequence); everyone else the 1152px
   set. Data-saver / very slow links also fall back to the small set. */
function pickSize() {
  if (typeof window === "undefined") return "lg";
  const narrow = window.innerWidth < 820;
  const c = navigator.connection;
  const slow = c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""));
  return narrow || slow ? "sm" : "lg";
}

export default function CanvasHeroSequence({
  reduced = false,
  onProgress,
  // How many viewport-heights of scroll the sequence spans. Taller = the
  // bloom scrubs more slowly and reads as more deliberate.
  scrollHeightVh = 320,
  className = "",
  style,
  children,
}) {
  const stageRef = useRef(null);   // tall element that owns the scroll range
  const canvasRef = useRef(null);
  const framesRef = useRef([]);    // Image objects, sparse until loaded
  const drawnRef = useRef(-1);     // last frame index actually painted
  const targetRef = useRef(0);     // frame the scroll position wants
  const rafRef = useRef(0);
  const sizeRef = useRef("lg");

  const [ready, setReady] = useState(false);   // first frame painted
  const [loadPct, setLoadPct] = useState(0);   // preload progress 0..100

  /* ── Canvas draw ─────────────────────────────────────────────────────
     Draws image `i` with object-fit: cover math into the backing store. */
  const paint = useCallback((i) => {
    const canvas = canvasRef.current;
    const img = framesRef.current[i];
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;
    // alpha:false used to be set here on the theory that opaque frames don't
    // need an alpha channel — but an alpha:false canvas initializes to
    // opaque BLACK before anything is drawn to it (rather than transparent),
    // so any brief unpainted moment (a resize mid-transition, a dropped
    // frame while scrubbing fast) flashed solid black instead of just
    // showing whatever was behind it. Default (alpha) canvas costs nothing
    // extra here since we always draw a full-cover opaque image anyway.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Higher-quality downscaling when the frame is bigger than its on-
    // screen size (e.g. the "lg" 1152px set on a smaller laptop window) —
    // default browser scaling can look soft/aliased otherwise.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // cover
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    drawnRef.current = i;
  }, []);

  /* Find the nearest already-loaded frame to `i` so scrubbing never
     stalls on a not-yet-decoded index — it shows the closest neighbour
     and upgrades once the exact frame arrives. */
  const nearestLoaded = useCallback((i) => {
    const frames = framesRef.current;
    if (frames[i]?.complete && frames[i].naturalWidth) return i;
    for (let d = 1; d < FRAME_COUNT; d++) {
      const lo = i - d, hi = i + d;
      if (lo >= 0 && frames[lo]?.complete && frames[lo].naturalWidth) return lo;
      if (hi < FRAME_COUNT && frames[hi]?.complete && frames[hi].naturalWidth) return hi;
    }
    return -1;
  }, []);

  /* ── Backing-store sizing (retina-aware) ─────────────────────────── */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const nw = Math.round(w * dpr);
    const nh = Math.round(h * dpr);
    if (canvas.width !== nw || canvas.height !== nh) {
      canvas.width = nw;
      canvas.height = nh;
      // force a repaint of whatever frame is current after a resize
      const cur = drawnRef.current < 0 ? targetRef.current : drawnRef.current;
      drawnRef.current = -1;
      paint(nearestLoaded(cur));
    }
  }, [paint, nearestLoaded]);

  /* ── rAF render loop: only repaints when the target frame changed ── */
  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const want = targetRef.current;
    if (want === drawnRef.current) return;      // nothing to do this frame
    const idx = nearestLoaded(want);
    if (idx >= 0) paint(idx);
  }, [paint, nearestLoaded]);

  /* ── Scroll → target frame (cheap; no drawing here) ──────────────── */
  const onScroll = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    // progress through the pinned range, clamped 0..1
    const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
    targetRef.current = Math.min(
      FRAME_COUNT - 1,
      Math.round(p * (FRAME_COUNT - 1))
    );
    onProgress?.(p);
  }, [onProgress]);

  /* ── Preload sequence (progressive, bounded concurrency) ─────────── */
  useEffect(() => {
    if (reduced) return;                 // reduced-motion: no sequence load
    const size = pickSize();
    sizeRef.current = size;
    framesRef.current = new Array(FRAME_COUNT);

    let cancelled = false;
    let loaded = 0;

    const loadOne = (i) =>
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.src = frameUrl(i, size);
        const done = () => {
          if (cancelled) return resolve();
          framesRef.current[i] = img;
          loaded++;
          setLoadPct(Math.round((loaded / FRAME_COUNT) * 100));
          // first usable frame → reveal + kick the loop
          if (!ready && drawnRef.current < 0) {
            requestAnimationFrame(() => {
              resize();
              paint(nearestLoaded(targetRef.current));
              setReady(true);
            });
          }
          resolve();
        };
        if (img.decode) {
          img.decode().then(done).catch(done);
        } else {
          img.onload = done;
          img.onerror = done;
        }
      });

    // Load in scrub order but with a bounded pool so the first frames
    // win the network. Priority: 0,1,2… sequentially is what a top-to-
    // bottom scroll needs, so we just stream in order with a window.
    const POOL = 6;
    let next = 0;
    const pump = async () => {
      while (!cancelled && next < FRAME_COUNT) {
        const i = next++;
        await loadOne(i);
      }
    };
    const workers = Array.from({ length: POOL }, pump);
    Promise.all(workers).catch(() => {});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  /* ── Wire up scroll + resize + rAF loop ──────────────────────────── */
  useEffect(() => {
    if (reduced) return;
    resize();
    onScroll();
    rafRef.current = requestAnimationFrame(loop);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
  }, [reduced, loop, onScroll, resize]);

  /* ── Reduced-motion static fallback ──────────────────────────────── */
  if (reduced) {
    return (
      <section
        className={className}
        style={{
          position: "relative",
          minHeight: "100svh",
          overflow: "hidden",
          ...style,
        }}
      >
        <img
          src={posterUrl()}
          alt="Cherry blossoms in full bloom"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", zIndex: 0,
          }}
        />
        <div style={{ position: "absolute", inset: 0, zIndex: 1,
          background: "linear-gradient(180deg, rgba(20,17,24,.55) 0%, rgba(20,17,24,.35) 45%, rgba(20,17,24,.72) 100%)" }} />
        <div style={{ position: "relative", zIndex: 2, minHeight: "100svh",
          display: "grid", placeItems: "center" }}>
          {children}
        </div>
      </section>
    );
  }

  /* ── Scroll-driven canvas ────────────────────────────────────────── */
  return (
    <section
      ref={stageRef}
      className={className}
      style={{
        position: "relative",
        height: `${scrollHeightVh}vh`,   // the scroll range
        ...style,
      }}
    >
      {/* Pinned viewport-height layer */}
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100svh",
          overflow: "hidden",
          // hardware-acceleration hints
          transform: "translate3d(0,0,0)",
          willChange: "transform",
        }}
      >
        {/* Poster shows until the first sequence frame is painted */}
        <img
          src={posterUrl()}
          alt=""
          aria-hidden="true"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", zIndex: 0,
            opacity: ready ? 0 : 1,
            transition: "opacity 600ms ease",
          }}
        />
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            display: "block", zIndex: 1,
            opacity: ready ? 1 : 0,
            transition: "opacity 600ms ease",
          }}
        />
        {/* Contrast scrim for overlaid text */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 2,
          background: "linear-gradient(180deg, rgba(20,17,24,.48) 0%, rgba(20,17,24,.28) 42%, rgba(20,17,24,.68) 100%)" }} />
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 2,
          background: "radial-gradient(ellipse at 50% 42%, transparent 0%, rgba(20,17,24,.42) 80%)" }} />

        {/* Overlaid hero content (title, CTA…) provided by the parent */}
        <div style={{ position: "relative", zIndex: 3, height: "100svh",
          display: "grid", placeItems: "center", padding: "0 20px" }}>
          {children}
        </div>

        {/* Tiny load indicator until the sequence is mostly ready */}
        {!ready && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 4,
            height: 3, background: "rgba(255,255,255,.12)" }}>
            <div style={{ height: "100%", width: `${loadPct}%`,
              background: "linear-gradient(90deg,#b4788c,#c9b688)",
              transition: "width 200ms linear" }} />
          </div>
        )}
      </div>
    </section>
  );
}

import React, { useState, useEffect, useRef, useCallback, useContext, createContext } from "react";
import { supabase, loadContent, saveContent, uploadImage, deleteImage, pathFromUrl,
  subscribe, listSubscribers, logAdminChange, listAdminLog } from "./supabase";
// Lazy — keeps anime.js out of the initial bundle. It only downloads when
// a visitor actually scrolls near the Quad section.
const QuadTree = React.lazy(() => import("./QuadTree.jsx"));
// Scroll-driven cherry-blossom canvas hero (270-frame sequence). Kept in its
// own module so the frame-preload logic and canvas loop stay isolated.
import CanvasHeroSequence from "./components/CanvasHeroSequence.jsx";
// Bold anime.js-driven hero: curtain intro, orchestrated headline reveal,
// 3D cursor tilt on the medallion, magnetic CTAs. Self-contained — no
// external files required beyond the animejs package itself.
import { animate, createTimeline, stagger, utils } from "animejs";
import {
  Menu, X, Heart, MapPin, Clock, Calendar, Users, BookOpen,
Instagram, Facebook, Link2,
  Lock, LogOut, Plus, Trash2, Edit3, ChevronLeft, ChevronRight,
  Home, Star, HandHeart, GraduationCap, Sparkles, ExternalLink, Save,
  Sun, Moon, Mail, Send, CalendarDays, LayoutGrid, Search,
  Settings, Camera, ArrowUp, ArrowDown
} from "lucide-react";

/* ============================================================
   MSA UW — single-page site + in-session admin dashboard
   Colors: UW Purple #4B2E83, Gold #B7A57A
   Note: content edits persist for the browser session only
   (artifacts can't use storage). Wire to a backend to persist.
   ============================================================ */

// Palette derived from the MSA at UW logo (crescent + Seattle skyline):
// near-black base, a purple→pink gradient, and gold accents.
const INK = "#141118";        // logo black base
const INK2 = "#1f1a29";       // slightly lifted black for panels
const PURPLE = "#5b3d8c";     // primary purple (deepened from logo mauve for text contrast)
const PURPLE_D = "#3a2660";   // deep purple
const VIOLET = "#8c78b4";     // logo blue-violet
const MAUVE = "#a078a8";      // logo mauve
const PINK = "#b4788c";       // logo dusty rose (gradient tail)
const GOLD = "#c9b688";       // warmer gold accent, reads on black
const GOLD_D = "#B7A57A";     // original gold, for light surfaces
// signature gradient lifted straight from the logo
const GRAD = `linear-gradient(120deg, ${VIOLET} 0%, ${MAUVE} 45%, ${PINK} 100%)`;
const GRAD_DEEP = `linear-gradient(135deg, ${INK} 0%, ${PURPLE_D} 55%, ${PURPLE} 100%)`;
// Saturated "neon" variants — brighter and punchier than the muted brand
// PURPLE/GOLD above, used specifically for glow/radiate effects (hero logo,
// loading icon, arch) where the ask is a literal neon-sign look rather than
// the site's usual restrained palette.
const NEON_PURPLE = "#B84BFF";
const NEON_GOLD = "#FFD23F";
const NEON_WHITE = "#F5F6FF";   // bright, faintly cool white — for the About globe's neon accent

const MERCH_URL = "https://intentionshq.com/products/msa-x-intentions-off-white-hoodie";

// Admin-entered links (board member socials, sponsor sites, announcement
// links, etc.) sometimes get typed without a scheme, e.g.
// "linkedin.com/in/zahid" instead of "https://linkedin.com/in/zahid". The
// admin field shows exactly what was typed, so that looks totally normal —
// but as an <a href> it's a RELATIVE link, which the browser resolves
// against the current page. On GitHub Pages that silently turns it into
// ".../UWMSAWEBSITEREDESIGN/linkedin.com/in/zahid" instead of leaving the
// site, i.e. a link that looks fine in the admin panel but is broken on the
// live site. This adds "https://" onto anything that isn't already an
// absolute URL, a mailto:/tel: link, or an in-page "#anchor".
// Schemes an admin-entered link is actually allowed to use. Anything else
// with an explicit "scheme:" prefix (javascript:, data:, vbscript:, file:,
// etc.) gets neutralized to "#" instead of being handed to an <a href> —
// those are the classic stored-XSS vectors when free-text URL fields (board
// member links, sponsor URLs, prayer-space map links, …) get rendered back
// out as real hrefs. This doesn't require a login to exploit in itself, but
// it closes off the easiest version of "an admin account gets phished/
// compromised, then used to plant a javascript: link that fires for every
// visitor" — worth doing even though only admins can edit this content.
const SAFE_HREF_SCHEMES = /^(https?|mailto|tel):/i;
function safeHref(url) {
  if (!url) return url;
  const trimmed = String(url).trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return SAFE_HREF_SCHEMES.test(trimmed) ? trimmed : "#";
  }
  return `https://${trimmed}`;
}

/* Nav is grouped so it stays readable as the site grows. Top-level items
   show on desktop; `children` render in a dropdown. On mobile everything
   flattens into one scrollable list. */
// ── Five-page structure ────────────────────────────────────────────────
// Each page has a hash route (safe on GitHub Pages — no server rewrites),
// a label for the nav, and the ordered list of section ids it renders.
// Section components stay exactly as they were; only where they live moved.
const PAGES = [
  // "announcements" is no longer its own section here — it's rendered
  // inside "home" now (the arch/rosary backdrop shows announcement cards).
  { route: "/",          label: "Home",      sections: ["home", "new-here", "moments"] },
  { route: "/about",     label: "About",     sections: ["about", "donate", "connect", "sponsors"] },
  { route: "/prayer",    label: "Prayer",    sections: ["prayer", "islamic-house"] },
  { route: "/events",    label: "Events",    sections: ["events", "stats", "programs"] },
  { route: "/community", label: "Community", sections: ["board", "instagram", "tiktok", "quad", "mailing"] },
];

// Top-level nav: the five pages, an external Merch link, and the Donate CTA
// (Donate lives on /about but the CTA jumps straight to its section).
const NAV = [
  ...PAGES.map((p) => ({ route: p.route, label: p.label })),
  { label: "Merch", external: true, href: MERCH_URL },
  { route: "/about", section: "donate", label: "Donate", cta: true },
];

// route → page lookup, and the set of in-page section ids per page (used by
// the scroll spy so the correct nav item highlights on the active page).
const ROUTE_TO_PAGE = Object.fromEntries(PAGES.map((p) => [p.route, p]));
const SECTION_TO_ROUTE = {};
PAGES.forEach((p) => p.sections.forEach((s) => { SECTION_TO_ROUTE[s] = p.route; }));

/* Normalise a raw location.hash into one of our known routes. Anything
   unrecognised falls back to "/". Accepts "#/about", "/about", "about". */
function routeFromHash(hash) {
  let h = (hash || "").replace(/^#/, "").trim();
  if (!h) return "/";
  if (!h.startsWith("/")) h = "/" + h;
  // strip a trailing #section anchor if someone linked /about#donate via hash
  return ROUTE_TO_PAGE[h] ? h : "/";
}

/* Hash router hook. Returns the current route and a navigate(route, section?)
   that updates the hash and (optionally) scrolls to a section on the target
   page after it renders. */
function useHashRoute() {
  const [route, setRoute] = useState(() =>
    typeof window === "undefined" ? "/" : routeFromHash(window.location.hash)
  );
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [route, setRoute];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Eight-point star — signature motif, drawn as inline SVG
function Star8({ size = 40, color = GOLD, opacity = 1, className = "" }) {
  const pts = [];
  const cx = 50, cy = 50;
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? 48 : 20;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className}
         style={{ opacity }} aria-hidden="true">
      <polygon points={pts.join(" ")} fill={color} />
    </svg>
  );
}

// Girih tessellation — interlocking 8-point stars linked into a tile grid,
// generated so the geometry is exact. Used as a repeating decorative band.
// Monotonic counter so every GirihBand instance gets a unique pattern id,
// even when two bands share the same color/unit on one page. (Duplicate SVG
// ids would let one band's url(#id) resolve to another's pattern.)
let _girihCounter = 0;
function girihUid() { _girihCounter += 1; return _girihCounter; }

function girihTile(unit, color) {
  const c = unit / 2, outer = unit * 0.4, inner = unit * 0.21;
  const star = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    star.push(`${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`);
  }
  // spokes reaching to each edge midpoint, so stars interlock across tiles
  const spokes = [[c, c - outer, c, 0], [c, c + outer, c, unit],
    [c - outer, c, 0, c], [c + outer, c, unit, c]];
  return { star: star.join(" "), spokes };
}
function GirihBand({ color = GOLD, bg = "transparent", height = 60, opacity = 0.5, unit = 60 }) {
  // Build a DOM-safe, unique pattern id. The old version interpolated the
  // raw color into the id — fine for "#c9b688", but colors like
  // "rgba(201,182,136,.4)" left parentheses/commas/dots in the id, making
  // url(#...) fail to resolve. A failed pattern reference makes the <rect>
  // fall back to its default fill (BLACK) — that was the black bar. Slugify
  // so only [a-z0-9-] survive, and keep a counter so two bands with the
  // same color still get distinct ids.
  const slug = String(color).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  // Stable across re-renders so the pattern reference never dangles.
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = `girih-${Math.round(unit)}-${slug}-${girihUid()}`;
  const id = idRef.current;
  const { star, spokes } = girihTile(unit, color);
  return (
    <svg width="100%" height={height} preserveAspectRatio="xMidYMid slice"
         style={{ display: "block", background: bg }} aria-hidden="true">
      <defs>
        <pattern id={id} width={unit} height={unit} patternUnits="userSpaceOnUse">
          <g fill="none" stroke={color} strokeWidth="1.3" opacity={opacity}>
            <polygon points={star} />
            {spokes.map((s, i) => <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} />)}
            {/* small linking diamonds at corners */}
            <polygon points={`0,0 ${unit*0.12},${-unit*0.12} 0,${-unit*0.24} ${-unit*0.12},${-unit*0.12}`}
              transform={`translate(${unit/2},${unit/2})`} />
          </g>
        </pattern>
      </defs>
      {/* fill="transparent" first guarantees that even if the pattern
          reference ever fails to resolve, the rect stays see-through
          instead of falling back to SVG's default black fill. */}
      <rect width="100%" height={height} fill="transparent" />
      <rect width="100%" height={height} fill={`url(#${id})`} />
    </svg>
  );
}

// Pointed (mihrab) arch outline — width/height driven, exact curve.
function archPath(w, h, spring) {
  // spring = height where the straight jambs end and the arch begins
  const cx = w / 2;
  return `M0,${h} L0,${spring} Q0,${spring * 0.35} ${cx},0 Q${w},${spring * 0.35} ${w},${spring} L${w},${h} Z`;
}

// Point on a quadratic bezier at t, given the same three control points
// archPath uses for its curved cap — used to sample "voussoir" tick marks
// along the curve for a more genuinely Islamic-geometric mihrab look
// (real mihrabs are built from radiating wedge-shaped stones).
function quadPoint(p0, p1, p2, t) {
  const mt = 1 - t;
  return [
    mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
    mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
  ];
}

// A symmetric fan of short radiating lines tracing the arch's curved cap,
// like the wedge joints of real voussoir stonework, plus small 8-point
// star accents at the two shoulders and the apex (echoing the site's
// signature Star8 motif).
function archOrnamentGeometry(w, h, spring, count = 6, tickLen = 9) {
  const cx = w / 2;
  const fanOrigin = [cx, spring * 0.6];
  const ticks = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const [x, y] = quadPoint([0, spring], [0, spring * 0.35], [cx, 0], t);
    const dx = x - fanOrigin[0], dy = y - fanOrigin[1];
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    ticks.push([x, y, x + nx * tickLen, y + ny * tickLen]);
    ticks.push([w - x, y, w - x - nx * tickLen, y + ny * tickLen]);
  }
  const star = (cx0, cy0, r) => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const rad = i % 2 === 0 ? r : r * 0.42;
      const a = (Math.PI / 8) * i - Math.PI / 2;
      pts.push(`${(cx0 + rad * Math.cos(a)).toFixed(2)},${(cy0 + rad * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(" ");
  };
  const stars = [star(0, spring, 8), star(w, spring, 8), star(cx, 0, 9)];
  return { ticks, stars };
}
function Arch({ w = 120, h = 160, spring, stroke = PURPLE, sw = 2, fill = "none", children, style }) {
  const sp = spring ?? h * 0.55;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%"
         preserveAspectRatio="none" style={style} aria-hidden="true">
      <path d={archPath(w, h, sp)} fill={fill} stroke={stroke} strokeWidth={sw} />
      {children}
    </svg>
  );
}

// Muqarnas-inspired stepped cornice — two offset tiers for a vaulted look.
function Muqarnas({ color = GOLD, height = 22, cells = 10, opacity = 0.9 }) {
  const w = 100, step = w / cells;
  const tier = (y0, h, phase) => {
    let d = `M0,${y0}`;
    for (let i = 0; i <= cells; i++) {
      const x = i * step + phase;
      d += ` L${(x - step * 0.5).toFixed(2)},${(y0 + h).toFixed(2)} L${x.toFixed(2)},${y0}`;
    }
    d += ` L${w},${y0} Z`;
    return d;
  };
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height}
         preserveAspectRatio="none" style={{ display: "block" }} aria-hidden="true">
      <path d={tier(0, height * 0.55, 0)} fill={color} opacity={opacity} />
      <path d={tier(height * 0.42, height * 0.55, step / 2)} fill={color} opacity={opacity * 0.6} />
    </svg>
  );
}

// Full-section star lattice — a soft, repeating geometric texture for the
// background of light content sections. Deliberately faint so text stays
// readable. Sits behind content via absolute positioning + low opacity.
function StarLatticeBg({ color = PURPLE, opacity = 0.05, unit = 64 }) {
  const c = unit / 2, outer = unit * 0.5, inner = unit * 0.3;
  const star = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    star.push(`${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`);
  }
  const spokes = [[c, c - outer, c, 0], [c, c + outer, c, unit],
    [c - outer, c, 0, c], [c + outer, c, unit, c]];
  const id = "lattice-" + Math.round(unit) + "-" + Math.round(opacity * 1000);
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, opacity,
      pointerEvents: "none", zIndex: 0 }}>
      <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
           style={{ display: "block" }}>
        <defs>
          <pattern id={id} width={unit} height={unit} patternUnits="userSpaceOnUse">
            <g fill="none" stroke={color} strokeWidth="1.1">
              <polygon points={star.join(" ")} />
              {spokes.map((s, i) => <line key={i} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} />)}
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}



/* ── Scroll reveal ──────────────────────────────────────────────────────
   Wrap anything in <Reveal> and it fades + rises into place the first time
   it scrolls into view, then stays put. Uses IntersectionObserver — no
   scroll hijacking. Respects prefers-reduced-motion. */
/* ════════════════════════════════════════════════════════════════════════
   MOTION FOUNDATION
   Shared easing, timing, and reveal primitives. Everything animated on the
   site composes from these so timing stays consistent and tunable in one
   place. Only transform/opacity are animated (GPU-friendly, 60fps).
   ════════════════════════════════════════════════════════════════════════ */

const EASE = {
  // Primary: decelerating, calm arrival. Used for most entrances.
  out: "cubic-bezier(.16,.84,.44,1)",
  // Softer, longer tail — for large elements (hero, images).
  outSoft: "cubic-bezier(.22,.61,.36,1)",
  // Gentle both ends — for hover and state changes.
  inOut: "cubic-bezier(.65,.05,.36,1)",
  // Slight overshoot — used sparingly (buttons, badges).
  spring: "cubic-bezier(.34,1.36,.64,1)",
};

const DUR = {
  fast: 260,
  base: 620,
  slow: 900,
  hero: 1100,
};

// ── Display settings (site-wide toggles, independent of OS preferences) ──
// A visitor's "reduce motion" choice made *on this site* (via the settings
// menu in the nav) rather than in their OS. Provided once near the root of
// App() and read everywhere via useMotionPrefs()/useReducedMotion() below,
// so flipping the master switch turns off every decorative animation
// (rosary spin, hero intro, lantern sway, parallax, ripple, carousel spin)
// without touching every component individually — each of those already
// calls useReducedMotion(), which now also honors this. glowOff and
// rippleOff are finer switches for people who want most motion but not
// those two specific effects.
const MotionPrefsContext = createContext({
  motionOff: false, setMotionOff: () => {},
  glowOff: false, setGlowOff: () => {},
  rippleOff: false, setRippleOff: () => {},
  dark: false,
});
function useMotionPrefs() {
  return useContext(MotionPrefsContext);
}
// Live light/dark reading, piggybacking on the same provider as the motion
// prefs (both are "site-wide visual settings read deep in the tree") so
// components like the About globe can pick theme-appropriate colors
// without threading a `dark` prop down through every intermediate section.
function useTheme() {
  return useContext(MotionPrefsContext).dark;
}

// Single source of truth for the reduced-motion preference, kept live so
// the site responds if the user changes it mid-session — combines the OS
// setting with the visitor's manual in-site "Reduce motion" toggle.
function useReducedMotion() {
  const [osReduced, setOsReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setOsReduced(mq.matches);
    const on = (e) => setOsReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const { motionOff } = useContext(MotionPrefsContext);
  return osReduced || motionOff;
}

// Drives the hero's scroll-reactive neon glow (logo, arch, rosette accent)
// from one shared place instead of several independent animations. Writes
// two CSS custom properties onto `rootRef`'s element — `--fx-angle` (a
// rotation, for conic-gradient glows) and `--fx-mix` (0..1, for blending
// between neon purple and neon gold) — combining a slow idle drift with a
// nudge from scroll position, so the glow keeps moving gently at rest and
// visibly shifts position/color as you scroll, like light catching an
// object at a different angle. Everything downstream just reads the CSS
// vars (`var(--fx-angle)`, `color-mix(... var(--fx-mix) ...)`), so this is
// the only piece of JS involved — no React re-renders, one rAF loop, and
// that loop only runs while the hero is actually on screen.
function useHeroScrollFX(rootRef, reduced) {
  useEffect(() => {
    if (reduced) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    let inView = false;
    const start = performance.now();

    const tick = (t) => {
      const elapsed = (t - start) / 1000;
      const angle = (elapsed * 16 + window.scrollY * 0.12) % 360;
      const mix = (Math.sin(elapsed * 0.25 + window.scrollY * 0.0035) + 1) / 2;
      root.style.setProperty("--fx-angle", angle.toFixed(1) + "deg");
      root.style.setProperty("--fx-mix", mix.toFixed(3));
      if (inView) raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView && !raf) raf = requestAnimationFrame(tick);
      else if (!inView) { cancelAnimationFrame(raf); raf = 0; }
    }, { rootMargin: "200px 0px" });
    io.observe(root);

    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, [reduced, rootRef]);
}

// Measures the box that exactly encloses everything from the top of
// `startRef` to the bottom of `endRef` (both relative to `sectionRef`),
// plus the widest of `widthRefs` — used to size HeroArch so it always
// wraps the rosary wheel and the CTA buttons regardless of viewport size,
// font-loading reflow, or how long the headline text is, instead of
// guessing fixed percentages. Re-measures on resize and shortly after
// mount (fonts/images can still reflow content a beat after first paint).
function useEnclosingBox(sectionRef, startRef, endRef, widthRefs, padding = 36) {
  const [box, setBox] = useState(null);
  useEffect(() => {
    const measure = () => {
      const section = sectionRef.current, start = startRef.current, end = endRef.current;
      if (!section || !start || !end) return;
      const sBox = section.getBoundingClientRect();
      const aBox = start.getBoundingClientRect();
      const bBox = end.getBoundingClientRect();
      // Clamp to 0: the section has overflow:hidden, so a negative top
      // (which happens whenever the rosette sits closer to the section's
      // top edge than `padding`) used to push the arch's peak above the
      // section's own boundary and get clipped off — "arch not fully
      // visible" at the top. Clamping keeps the box fully inside the
      // section while leaving `bottom` (and therefore where the arch's
      // base lands) untouched.
      const rawTop = aBox.top - sBox.top - padding;
      const top = Math.max(rawTop, 0);
      const bottom = bBox.bottom - sBox.top + padding;
      let width = 0;
      widthRefs.forEach((r) => {
        if (r.current) width = Math.max(width, r.current.getBoundingClientRect().width);
      });
      setBox({ top, height: Math.max(0, bottom - top), width: width + padding * 2 });
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    const t = setTimeout(measure, 350);
    return () => { window.removeEventListener("resize", measure); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRef, startRef, endRef, padding]);
  return box;
}

// Fires once when the element scrolls into view.
function useInView({ threshold = 0.15, rootMargin = "0px 0px -10% 0px", once = true } = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); if (once) obs.disconnect(); }
      else if (!once) setInView(false);
    }, { threshold, rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, rootMargin, once]);
  return [ref, inView];
}

// Attaches touch-swipe navigation to any carousel/slideshow container.
// Pure touch events (not pointer events) on purpose — this only fires on
// actual touchscreens, so it can't interfere with mouse-driven interactions
// a component already has (e.g. the Moments carousel's cursor-tilt effect,
// which listens for pointermove/pointerleave). A swipe only counts once the
// horizontal drag clears `threshold` px AND is clearly more horizontal than
// vertical, so a normal vertical scroll over the carousel doesn't
// accidentally trigger a page change.
function useSwipe(ref, { onLeft, onRight, threshold = 40, enabled = true } = {}) {
  const onLeftRef = useRef(onLeft), onRightRef = useRef(onRight);
  onLeftRef.current = onLeft; onRightRef.current = onRight;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startX = 0, startY = 0, tracking = false;
    const onStart = (e) => {
      const t = e.touches?.[0]; if (!t) return;
      startX = t.clientX; startY = t.clientY; tracking = true;
    };
    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches?.[0]; if (!t) return;
      const dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0) onLeftRef.current?.(); else onRightRef.current?.();
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", () => { tracking = false; }, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [ref, threshold, enabled]);
}

/* Reveal — the workhorse entrance animation.
   variant: "up" | "down" | "left" | "right" | "fade" | "scale" | "blur"
   Composes transform + opacity only. */
const REVEAL_VARIANTS = {
  up:    (d) => `translate3d(0, ${d}px, 0)`,
  down:  (d) => `translate3d(0, ${-d}px, 0)`,
  left:  (d) => `translate3d(${d}px, 0, 0)`,
  right: (d) => `translate3d(${-d}px, 0, 0)`,
  fade:  () => "none",
  scale: (d) => `scale(${1 - d / 260})`,
  rise:  (d) => `translate3d(0, ${d}px, 0) scale(${1 - d / 900})`,
};

function Reveal({
  children, delay = 0, distance = 26, variant = "up",
  duration = DUR.base, ease = EASE.out, style, threshold = 0.15, as: Tag = "div", ...rest
}) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView({ threshold });
  const show = reduced || inView;
  const from = (REVEAL_VARIANTS[variant] || REVEAL_VARIANTS.up)(distance);
  return (
    <Tag ref={ref} style={{
      opacity: show ? 1 : 0,
      transform: show ? "translate3d(0,0,0)" : from,
      transition: reduced ? "none"
        : `opacity ${duration}ms ${ease} ${delay}ms, transform ${duration}ms ${ease} ${delay}ms`,
      willChange: show ? "auto" : "opacity, transform",
      ...style,
    }} {...rest}>{children}</Tag>
  );
}

/* Stagger — reveals children in sequence with a shared rhythm.
   Avoids hand-writing delay={n * 70} everywhere. */
function Stagger({ children, step = 80, base = 0, variant = "up", distance = 26,
  duration = DUR.base, ease = EASE.out, style, ...rest }) {
  const items = React.Children.toArray(children);
  return (
    <>
      {items.map((child, i) => (
        <Reveal key={child.key ?? i} delay={base + i * step} variant={variant}
          distance={distance} duration={duration} ease={ease} style={style} {...rest}>
          {child}
        </Reveal>
      ))}
    </>
  );
}

/* TextReveal — splits a string into words that rise in sequence.
   Uses inline-block spans; whitespace preserved so wrapping is natural. */
function TextReveal({ text, delay = 0, step = 42, duration = DUR.slow,
  ease = EASE.outSoft, style, as: Tag = "span" }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView({ threshold: 0.25 });
  const show = reduced || inView;
  const words = String(text).split(" ");
  return (
    <Tag ref={ref} style={{ display: "inline-block", ...style }}>
      {words.map((w, i) => (
        <span key={i} style={{ display: "inline-block", overflow: "hidden",
          verticalAlign: "top" }}>
          <span style={{
            display: "inline-block",
            opacity: show ? 1 : 0,
            transform: show ? "translate3d(0,0,0)" : "translate3d(0,0.9em,0)",
            transition: reduced ? "none"
              : `opacity ${duration}ms ${ease} ${delay + i * step}ms, transform ${duration}ms ${ease} ${delay + i * step}ms`,
          }}>{w}</span>
          {i < words.length - 1 && <span>&nbsp;</span>}
        </span>
      ))}
    </Tag>
  );
}


/* Small petal glyph for the toggle button. */
function PetalIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: "block" }}>
      <path d="M12 2 C14.5 6, 18 7, 20.5 6.5 C19.5 10, 20 13.5, 22 16 C18.5 16.5, 15.5 18.5, 14 22 C13 18.5, 12 17, 12 17 C12 17, 11 18.5, 10 22 C8.5 18.5, 5.5 16.5, 2 16 C4 13.5, 4.5 10, 3.5 6.5 C6 7, 9.5 6, 12 2 Z"
        fill={color} />
    </svg>
  );
}

/* ── Light Markdown ─────────────────────────────────────────────────────
   Admin-entered copy supports **bold**, *italic*, [links](url) and blank
   lines for paragraphs. Rendered by building React elements — never
   dangerouslySetInnerHTML, so admin text can't inject markup. */
function inlineMd(text, keyPrefix = "m") {
  const nodes = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m, i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{tok.slice(1, -1)}</em>);
    } else {
      const close = tok.indexOf("](");
      const label = tok.slice(1, close);
      // Same scheme allowlist as every other admin-entered URL in the
      // site (safeHref) — markdown links were the one place a raw
      // javascript:/data: href could still slip through untouched.
      const href = safeHref(tok.slice(close + 2, -1));
      const external = /^https?:\/\//i.test(href);
      nodes.push(
        <a key={`${keyPrefix}-a${i++}`} href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          style={{ color: "var(--accent)", fontWeight: 600 }}>{label}</a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text, style }) {
  if (!text) return null;
  const paras = String(text).split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <>
      {paras.map((p, i) => (
        <p key={i} style={{ margin: i === 0 ? "0 0 12px" : "0 0 12px", ...style }}>
          {inlineMd(p.trim(), `p${i}`)}
        </p>
      ))}
    </>
  );
}

/* Pulls a section's admin-editable copy, falling back to the seed defaults
   so a missing field never renders a blank heading. */
function useSectionCopy(data, key) {
  const fromData = data?.sections?.[key] || {};
  const fallback = seed.sections?.[key] || {};
  return {
    eyebrow: fromData.eyebrow ?? fallback.eyebrow ?? "",
    title: fromData.title ?? fallback.title ?? "",
    body: fromData.body ?? fallback.body ?? "",
  };
}

/* ── Rosette ────────────────────────────────────────────────────────────
   The circular medallion found in mosque domes, windows and tilework —
   built the way it is drawn with a compass: a ring of overlapping circles,
   concentric guides, radial spokes, and an n-point star traced by skipping
   vertices. `skip` must be coprime with `points` or the star breaks into
   separate polygons (12/3 gives three squares; 12/5 gives one star).
   Rotates with scroll: turning as you move down, unwinding as you move up. */
function Rosette({ points = 12, skip = 5, size = 260, color = "currentColor",
  opacity = 0.5, strokeWidth = 1, style }) {
  const R = 100;
  const geom = React.useMemo(() => {
    const circles = [];
    for (let i = 0; i < points; i++) {
      const a = (2 * Math.PI * i) / points;
      circles.push({
        cx: +(Math.cos(a) * R * 0.58).toFixed(2),
        cy: +(Math.sin(a) * R * 0.58).toFixed(2),
      });
    }
    const star = [];
    for (let i = 0; i < points; i++) {
      const a = (2 * Math.PI * ((i * skip) % points)) / points - Math.PI / 2;
      star.push(`${(Math.cos(a) * R * 0.78).toFixed(2)},${(Math.sin(a) * R * 0.78).toFixed(2)}`);
    }
    const spokes = [];
    for (let i = 0; i < points; i++) {
      const a = (2 * Math.PI * i) / points - Math.PI / 2;
      spokes.push({
        x1: +(Math.cos(a) * R * 0.40).toFixed(2), y1: +(Math.sin(a) * R * 0.40).toFixed(2),
        x2: +(Math.cos(a) * R).toFixed(2),        y2: +(Math.sin(a) * R).toFixed(2),
      });
    }
    return { circles, star: star.join(" "), spokes };
  }, [points, skip]);

  return (
    <svg viewBox="-110 -110 220 220" width={size} height={size} aria-hidden="true"
      style={{ display: "block", opacity, overflow: "visible", ...style }}>
      <g fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke">
        <circle cx="0" cy="0" r={R} />
        <circle cx="0" cy="0" r={R * 0.78} />
        <circle cx="0" cy="0" r={R * 0.40} />
        {geom.circles.map((c, i) => (
          <circle key={i} cx={c.cx} cy={c.cy} r={R * 0.40} opacity="0.72" />
        ))}
        <polygon points={geom.star} />
        {geom.spokes.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} opacity="0.6" />
        ))}
      </g>
    </svg>
  );
}

/* Wraps a Rosette (or anything) and spins it from scroll position.
   `speed` is degrees per 100px scrolled; sign flips the direction. The
   rotation is eased frame-to-frame so it glides rather than snapping,
   and it naturally reverses when the user scrolls back up. */
function ScrollSpin({ speed = 26, children, style, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const target = useRef(0);
  const current = useRef(0);
  const raf = useRef(0);
  const inView = useRef(false);

  // Same fix as Parallax: this used to run its rAF loop forever regardless
  // of whether the wheel was ever visible. Now it only spins while in (or
  // near) the viewport and stops once it has caught up to the scroll
  // target, resuming on the next scroll tick.
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;

    const startLoop = () => {
      if (raf.current || !inView.current || document.hidden) return;
      raf.current = requestAnimationFrame(tick);
    };
    const measure = () => {
      target.current = (window.scrollY / 100) * speed;
      startLoop();
    };
    const tick = () => {
      current.current += (target.current - current.current) * 0.07;
      el.style.transform = `rotate(${current.current.toFixed(2)}deg)`;
      const settled = Math.abs(target.current - current.current) < 0.02;
      if (settled || !inView.current || document.hidden) { raf.current = 0; return; }
      raf.current = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
      if (inView.current) startLoop();
      else { cancelAnimationFrame(raf.current); raf.current = 0; }
    }, { rootMargin: "200px 0px" });
    io.observe(el);

    measure();
    current.current = target.current;
    el.style.transform = `rotate(${current.current.toFixed(2)}deg)`;

    const onVisibility = () => { if (!document.hidden) startLoop(); };
    window.addEventListener("scroll", measure, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      io.disconnect();
      window.removeEventListener("scroll", measure);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [speed, reduced]);

  return (
    <div ref={ref} aria-hidden="true"
      style={{ willChange: "transform", ...style }} {...rest}>{children}</div>
  );
}

/* Rosettes parked in the margins of a section. Positioned mostly outside the
   content column so they fill empty edge space without crowding text. */
function EdgeRosettes({ arrangement = "left" }) {
  const sets = {
    left: [
      { top: "6%",  left: "-7%",  size: 300, points: 12, skip: 5, spin: 22,  op: .10 },
      { bottom: "8%", left: "3%", size: 150, points: 8,  skip: 3, spin: -34, op: .085 },
    ],
    right: [
      { top: "10%", right: "-6%", size: 280, points: 16, skip: 7, spin: -20, op: .10 },
      { bottom: "12%", right: "4%", size: 160, points: 12, skip: 5, spin: 30, op: .085 },
    ],
    both: [
      { top: "4%",  left: "-8%",  size: 320, points: 16, skip: 7, spin: 18,  op: .095 },
      { top: "18%", right: "-7%", size: 240, points: 12, skip: 5, spin: -26, op: .095 },
      { bottom: "6%", left: "42%", size: 130, points: 8, skip: 3, spin: 40,  op: .07 },
    ],
    wide: [
      { top: "12%", left: "-5%",  size: 220, points: 12, skip: 5, spin: 24,  op: .09 },
      { bottom: "10%", right: "-5%", size: 260, points: 16, skip: 7, spin: -18, op: .09 },
    ],
  };
  const items = sets[arrangement] || sets.left;
  return (
    <>
      {items.map((r, i) => (
        <div key={i} aria-hidden="true" style={{
          position: "absolute", pointerEvents: "none", zIndex: 0,
          top: r.top, left: r.left, right: r.right, bottom: r.bottom,
        }}>
          <ScrollSpin speed={r.spin}>
            <Rosette points={r.points} skip={r.skip} size={r.size}
              color="var(--rosette)" opacity={r.op} strokeWidth={1.1} />
          </ScrollSpin>
        </div>
      ))}
    </>
  );
}

/* ── Sakura wind (canvas) ───────────────────────────────────────────────
   Petals drift across the whole viewport and react to scroll: scrolling
   kicks up a gust that pushes them sideways and speeds their fall, then
   decays back to a calm breeze. Canvas keeps it cheap even at 40+ petals.
   Skipped entirely for reduced-motion users. */
function SakuraWind({ dark }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth, h = window.innerHeight;
    const size = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    const COUNT = w < 700 ? 20 : 38;
    const colors = dark
      ? ["rgba(216,168,214,.85)", "rgba(180,120,140,.8)", "rgba(140,120,180,.75)"]
      : ["rgba(180,120,140,.8)", "rgba(200,150,175,.75)", "rgba(140,105,180,.6)"];

    const spawn = (fromTop) => ({
      x: Math.random() * w,
      y: fromTop ? -20 - Math.random() * h : Math.random() * h,
      size: 5 + Math.random() * 9,
      vy: 0.5 + Math.random() * 1,
      vx: -0.4 + Math.random() * 0.8,
      rot: Math.random() * 360,
      vrot: -4 + Math.random() * 8,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.01 + Math.random() * 0.02,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
    let petals = Array.from({ length: COUNT }, () => spawn(false));

    let lastY = window.scrollY;
    let gust = 0;   // horizontal wind, driven by scroll velocity
    let gustV = 0;  // extra downward push while scrolling
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      gust = Math.max(-55, Math.min(55, gust + delta * 1.4));
      gustV = Math.min(30, gustV + Math.abs(delta) * 0.6);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", size, { passive: true });

    let raf;
    const draw = () => {
      // Skip the per-frame work (but keep the loop alive) while the tab is
      // backgrounded — no point animating petals nobody can see.
      if (document.hidden) { raf = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, w, h);
      gust *= 0.945;   // decay back to a calm breeze
      gustV *= 0.92;
      for (const p of petals) {
        p.sway += p.swaySpeed;
        p.x += p.vx + gust * 0.055 + Math.sin(p.sway) * 0.7;
        p.y += p.vy + gustV * 0.05;
        p.rot += p.vrot + gust * 0.3;
        if (p.y > h + 20 || p.x < -30 || p.x > w + 30) Object.assign(p, spawn(true));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.42, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", size);
    };
  }, [dark]);
  return (
    <canvas ref={canvasRef} aria-hidden="true"
      style={{ position: "fixed", inset: 0, zIndex: 40, pointerEvents: "none" }} />
  );
}

/* ── Parallax ───────────────────────────────────────────────────────────
   Drifts a decorative element as it passes through the viewport. Transform
   only (no layout thrash), rAF-throttled, off for reduced-motion users. */
function Parallax({ speed = 0.15, children, style, float = false, ...rest }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const target = useRef(0);
  const current = useRef(0);
  const raf = useRef(0);
  const inView = useRef(false);

  // Perf note: this used to run an independent requestAnimationFrame loop
  // forever, for the lifetime of the page, for every single Parallax
  // instance (~20 of them across the site) — a major source of mobile
  // jank, since it kept ~20 rAF callbacks + scroll/resize listeners alive
  // even for sections nowhere near the viewport. Now the loop only runs
  // while the element is near the viewport (IntersectionObserver) and
  // stops itself once it has settled at its target, restarting on the
  // next scroll/resize.
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (r.top + r.height / 2 - vh / 2) / vh;
      target.current = progress * speed * 100;
      startLoop();
    };

    const startLoop = () => {
      if (raf.current || !inView.current || document.hidden) return;
      raf.current = requestAnimationFrame(tick);
    };

    const tick = () => {
      current.current += (target.current - current.current) * 0.085; // lerp
      if (el) el.style.transform = `translate3d(0, ${current.current.toFixed(2)}px, 0)`;
      const settled = Math.abs(target.current - current.current) < 0.05;
      if (settled || !inView.current || document.hidden) {
        raf.current = 0; // stop — nothing meaningful left to animate right now
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
      if (inView.current) { measure(); startLoop(); }
      else { cancelAnimationFrame(raf.current); raf.current = 0; }
    }, { rootMargin: "200px 0px" });
    io.observe(el);

    const onVisibility = () => { if (!document.hidden) startLoop(); };

    measure();
    current.current = target.current;
    el.style.transform = `translate3d(0, ${current.current.toFixed(2)}px, 0)`;

    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      io.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [speed, reduced]);

  return (
    <div ref={ref} aria-hidden="true"
      className={float && !reduced ? "floaty-slow" : undefined}
      style={{
        position: "absolute", pointerEvents: "none", zIndex: 0,
        willChange: "transform", ...style,
      }} {...rest}>{children}</div>
  );
}

/* ── Botanical accents ──────────────────────────────────────────────── */
function CrescentAccent({ size = 150, color = GOLD, opacity = 0.5, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"
      style={{ opacity, display: "block", ...style }}>
      <path d="M62 12 A38 38 0 1 0 62 88 A30 30 0 1 1 62 12 Z" fill={color} />
      <circle cx="78" cy="30" r="3.2" fill={color} />
      <circle cx="86" cy="46" r="2.2" fill={color} />
      <circle cx="74" cy="60" r="1.8" fill={color} />
    </svg>
  );
}

function Lantern({ size = 70, color = GOLD, opacity = 0.55, style }) {
  return (
    <svg width={size} height={size * 1.5} viewBox="0 0 40 60" aria-hidden="true"
      style={{ opacity, display: "block", ...style }}>
      <line x1="20" y1="0" x2="20" y2="8" stroke={color} strokeWidth="1.5" />
      <path d="M12 8 h16 v3 h-16 Z" fill={color} />
      <path d="M9 11 C9 11, 4 22, 4 30 C4 40, 11 48, 20 48 C29 48, 36 40, 36 30 C36 22, 31 11, 31 11 Z"
        fill="none" stroke={color} strokeWidth="1.6" />
      <path d="M4 30 h32" stroke={color} strokeWidth="1" opacity="0.6" />
      <path d="M7 21 h26 M7 39 h26" stroke={color} strokeWidth="0.9" opacity="0.45" />
      <path d="M14 48 h12 v3 h-12 Z" fill={color} />
      <line x1="20" y1="51" x2="20" y2="58" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

/* ── Animated counter — counts up when scrolled into view ───────────── */
function Counter({ to = 100, suffix = "", duration = 1600, label }) {
  const ref = useRef(null);
  const [val, setVal] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setVal(to); return; }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || started.current) return;
      started.current = true;
      obs.disconnect();
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min((now - start) / duration, 1);
        setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, duration]);
  return (
    <div ref={ref} style={{ textAlign: "center", minWidth: 150 }}>
      <div style={{ fontSize: "clamp(34px,5vw,54px)", fontWeight: 800, color: GOLD,
        lineHeight: 1, letterSpacing: "-1px" }}>{val}{suffix}</div>
      <div style={{ marginTop: 8, fontSize: 13.5, color: "rgba(255,255,255,.75)",
        letterSpacing: ".5px" }}>{label}</div>
    </div>
  );
}

/* ── Stats band — dark strip with counting numbers ──────────────────── */
function StatsBand({ stats }) {
  return (
    <section id="stats" style={{ position: "relative", overflow: "hidden", background: INK,
      padding: "72px 20px" }}>
      <AmbientGlow subtle />
      <div aria-hidden="true" style={{ position: "absolute", top: "-30%", left: "-4%",
        pointerEvents: "none", zIndex: 0 }}>
        <ScrollSpin speed={20}>
          <Rosette points={12} skip={5} size={260} color={GOLD} opacity={0.10} />
        </ScrollSpin>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", bottom: "-34%", right: "-3%",
        pointerEvents: "none", zIndex: 0 }}>
        <ScrollSpin speed={-24}>
          <Rosette points={16} skip={7} size={230} color={GOLD} opacity={0.10} />
        </ScrollSpin>
      </div>
      <Parallax speed={0.4} float style={{ top: 30, right: "18%" }}>
        <CrescentAccent size={90} opacity={.28} />
      </Parallax>
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto",
        display: "flex", justifyContent: "space-around", gap: 36, flexWrap: "wrap" }}>
        {stats.map((s, n) => (
          <Reveal key={s.id ?? n} delay={n * 110}>
            <Counter to={Number(s.value) || 0} suffix={s.suffix || ""} label={s.label} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const seed = {
  hero: {
    // `kicker` is the small line above the headline.
    kicker: "University of Washington · Since 1968",
    // Short, punchy headlines read better over video. One per line.
    title: "Faith. Community. Belonging.",
    mission: "A home away from home for Muslim Huskies — worship, learning, friendship, and service.",
  },
  // ── Announcement bar (above the nav) ──────────────────────────────────
  bar: {
    on: true,
    text: "Board applications for 2026–27 are open — deadline November 14.",
    linkLabel: "Apply now",
    href: "",
  },
  // ── Mailing list ──────────────────────────────────────────────────────
  mailing: {
    on: true,
    title: "Start with the mailing list",
    body: "One email a week. Everything happening in the community, nothing more.",
    // Optional: a Google Form / Mailchimp URL. If set, the form links out
    // instead of saving to Supabase.
    externalUrl: "",
  },
  // ── Section copy ──────────────────────────────────────────────────────
  // Every section's eyebrow, heading and intro paragraph live here so
  // officers can rewrite them from the admin panel without touching code.
  // `body` supports light Markdown: **bold**, *italic*, [text](url), and
  // blank lines for paragraphs.
  sections: {
    quad:     { eyebrow: "On the Quad", title: "Where spring finds us",
                body: "Every April the Quad turns pink and the whole campus slows down for a week. It's where we gather, where new students find us, and where the community feels smallest and warmest." },
    about:    { eyebrow: "Who we are", title: "About MSA at UW",
                body: "The Muslim Student Association is a home away from home for Muslim Huskies. We're here so that no student has to navigate university life alone — whether that means finding a place to pray between classes, a community to break fast with, or friends who understand." },
    announcements: { eyebrow: "Latest", title: "Announcements",
                body: "Reminders, deadlines, and everything you need to know this week." },
    donate:   { eyebrow: "Support us", title: "Fuel the community",
                body: "Every dollar goes straight back to students — iftars during Ramadan, weekly halaqas, retreats, and the Islamic House that keeps our doors open." },
    islamicHouse: { eyebrow: "Our home on campus", title: "The Islamic House",
                body: "A few steps from campus, the Islamic House is where the community gathers — for daily prayers, Jummah, iftars, and everything in between." },
    contact:  { eyebrow: "Say salaam", title: "Get in touch",
                body: "Questions, ideas, or just want to say hello? We'd genuinely love to hear from you — new students especially." },
    gallery:  { eyebrow: "Our community", title: "Moments from the year",
                body: "Eid celebrations, Jummah, retreats, and the everyday gatherings that make MSA home." },
    sponsors: { eyebrow: "With support from", title: "Our sponsors & partners",
                body: "" },
    board:    { eyebrow: "Our team", title: "Board members",
                body: "The students who keep MSA running — past and present." },
    prayer:   { eyebrow: "Prayer", title: "Places & times to pray",
                body: "" },
    events:   { eyebrow: "This week", title: "Weekly calendar",
                body: "Everything happening across the week — drop in anytime." },
    programs: { eyebrow: "Get involved", title: "Our programs",
                body: "Ways to grow, give back, and connect throughout the year." },
    connect:  { eyebrow: "Connect", title: "Find your people",
                body: "Join the group chats, follow along, and support the community." },
    newHere:  { eyebrow: "Getting started", title: "New here?",
                body: "First time hearing about MSA, or just landed on campus? Start with our student guide — it walks through everything from finding prayer spaces to jumping into your first event." },
    instagram: { eyebrow: "Follow along", title: "On Instagram",
                body: "Event recaps, reminders, and behind-the-scenes moments." },
    tiktok:   { eyebrow: "Follow along", title: "On TikTok",
                body: "Quick recaps, event hype, and behind-the-scenes clips." },
  },
  // ── About pillars ─────────────────────────────────────────────────────
  about: {
    intro: "MSA at UW has served Muslim students since 1968 — running daily prayers, weekly halaqas, Ramadan iftars, retreats and socials, and advocating for Muslim students on campus.",
    pillars: [
      { id: 1, icon: "star", title: "Faith",
        text: "Daily prayers, Jummah, Quran circles and halaqas — spaces to keep your deen steady through the demands of the quarter." },
      { id: 2, icon: "users", title: "Community",
        text: "Iftars, BBQs, game nights and retreats. The friendships that make a large campus feel small." },
      { id: 3, icon: "hand", title: "Service",
        text: "Volunteering, fundraisers and outreach — putting what we believe into practice, on campus and beyond." },
      { id: 4, icon: "sparkles", title: "Welcome",
        text: "Every Muslim student belongs here, whichever background you come from and wherever you are in your practice. Non-Muslim friends are welcome too." },
    ],
  },
  // ── Announcements / bulletin ─────────────────────────────────────────
  // kind: "notice" | "deadline" | "event" | "ramadan"
  announcements: [
    { id: 1, kind: "notice", title: "Welcome back, Huskies!",
      body: "Weekly halaqas resume this week — check the calendar for times and rooms.",
      date: "", pinned: true, href: "" },
    { id: 2, kind: "deadline", title: "Board applications close soon",
      body: "Interested in helping run MSA next year? Applications are open now.",
      date: "", pinned: false, href: "" },
  ],
  // ── Islamic House ────────────────────────────────────────────────────
  islamicHouse: {
    address: "Near NE 45th St, Seattle",
    mapUrl: "",
    hours: "Open for all five daily prayers · Jummah every Friday",
    body: "The Islamic House is the heart of Muslim student life at UW. It hosts daily congregational prayers, Friday Jummah, Ramadan iftars and taraweeh, and community gatherings all year round. MSA works hand in hand with the House — many of our events happen here.\n\nEveryone is welcome, whether you're coming for prayer, for iftar, or just to find your feet on campus.",
    donateUrl: "https://www.zeffy.com/en-US/donation-form/0b12beb3-2da5-4c6b-87b9-cfc84cf47e6a",
    // Future/renovation photo(s) of the building, shown above the "Visit"
    // card as a small slideshow — separate from the `photos` gallery below
    // since it's meant to be one featured slot, not a grid entry. Empty by
    // default; admins add photos from the Islamic House tab.
    // `futureImage` (singular) is the old single-photo field, kept around
    // so a site that already had one saved doesn't lose it — see the
    // migration fallback in IslamicHouseSection, which folds it into
    // `futureImages` as the first slide if that array is still empty.
    futureImage: "",
    futureImages: [],
    features: [
      { id: 1, title: "Daily prayers", text: "All five prayers in congregation, every day." },
      { id: 2, title: "Jummah", text: "Two khutbahs each Friday — check the prayer section for times." },
      { id: 3, title: "Ramadan", text: "Nightly iftars and taraweeh throughout the month." },
      { id: 4, title: "Community space", text: "A place to study, rest, and gather between classes." },
    ],
    photos: [],
  },
  // ── "New here?" — a short pointer to the Muslim Student Guide for
  // newcomers. Text/heading come from sections.newHere above; the link
  // itself lives here since it's a single URL, not a copy field.
  newHere: {
    linkLabel: "Read the Muslim Student Guide",
    // Was previously duplicated as its own card in the Connect/"Find your
    // people" links list ("Guide to being a Muslim at UW") — moved here so
    // there's one canonical place for it, editable from the "New here?"
    // admin tab.
    href: "https://docs.google.com/document/d/16K_gyLqsaIWM-s6BXqNTarokx8q9srlzK3433G9VFZ0/edit?usp=sharing",
    // Second guide button — "Guide to being a Muslim at UW". Points to the
    // same canonical doc by default; edit label/URL from the "New here?"
    // admin tab if it should link somewhere different.
    linkLabel2: "Guide to being a Muslim at UW",
    href2: "https://docs.google.com/document/d/16K_gyLqsaIWM-s6BXqNTarokx8q9srlzK3433G9VFZ0/edit?usp=sharing",
  },
  // ── Instagram — admin pastes individual post URLs (same pattern as the
  // photo gallery); each renders via Instagram's own oEmbed widget, no API
  // keys required. `handle` powers the "Follow us" link/fallback.
  instagram: {
    handle: "msauw",
    // Live embeds: paste permalinks in the admin (Community → Instagram).
    // When empty, the section shows the live @msauw profile embed as a
    // fallback so the feed is never a placeholder block.
    posts: [],
  },
  // ── TikTok — same admin pattern as Instagram: paste individual video
  // URLs and each renders via TikTok's own oEmbed widget. TikTok doesn't
  // offer a public "profile grid" iframe the way Instagram does, so with
  // no posts set the section falls back to a plain "Follow us" card
  // instead of attempting a live profile embed.
  tiktok: {
    handle: "msa.uw",
    posts: [],
  },
  // ── Contact ──────────────────────────────────────────────────────────
  contact: {
    email: "msauw@uw.edu",
    note: "We usually reply within a couple of days. For urgent event questions, the Discord is fastest.",
  },
  // ── Donations ────────────────────────────────────────────────────────
  donate: {
    msaUrl: "https://www.zeffy.com/en-US/donation-form/44131d7a-557e-4fdc-9a70-14e9f67206ef",
    houseUrl: "https://www.zeffy.com/en-US/donation-form/0b12beb3-2da5-4c6b-87b9-cfc84cf47e6a",
    impact: [
      { id: 1, amount: "$25", text: "Feeds a student at a Ramadan iftar" },
      { id: 2, amount: "$100", text: "Covers refreshments for a weekly halaqa" },
      { id: 3, amount: "$500", text: "Sponsors a full community event" },
    ],
  },
  // ── Events extras ────────────────────────────────────────────────────
  eventsExtra: {
    suggestUrl: "",
    suggestNote: "Have an idea for an event? We'd love to hear it.",
    // When set to a PUBLISHED Notion calendar (a *.notion.site URL), the
    // monthly view embeds it instead of the built-in calendar. Leave blank
    // to use the built-in one.
    notionUrl: "",
  },
  // Dated events power the monthly calendar. date is YYYY-MM-DD.
  calendar: [],
  // ── Board members ─────────────────────────────────────────────────────
  // status: "current" | "previous". `href` is optional; when set the card
  // links out. `bio` shows in the expanded detail view.
  board: [
    { id: 1, name: "Example Name", role: "President", status: "current",
      img: "", href: "", bio: "Add a short bio from the admin panel." },
    { id: 2, name: "Example Name", role: "Vice President", status: "current",
      img: "", href: "", bio: "" },
    { id: 3, name: "Example Name", role: "Events Chair", status: "current",
      img: "", href: "", bio: "" },
    { id: 4, name: "Example Name", role: "Past President", status: "previous",
      img: "", href: "", bio: "" },
  ],
  // To use a real photo, add img: "//your-file.jpg" (file goes in public/gallery/).
  // Without img, the card shows a colored gradient placeholder.
  gallery: [
    { id: 1, caption: "Eid on the Quad", tag: "Eid", img: "" },
    { id: 2, caption: "Friday Jummah", tag: "Jummah", img: "" },
    { id: 3, caption: "Fall Retreat", tag: "Retreat", img: "" },
    { id: 4, caption: "Welcome BBQ", tag: "Social", img: "" },
    { id: 5, caption: "Iftar Night", tag: "Ramadan", img: "" },
    { id: 6, caption: "Community Service Day", tag: "Service", img: "" },
  ],
  // To use a real logo, add logo: "/sponsors/your-file.png" (file goes in public/sponsors/).
  // Without logo, the card shows the sponsor's name as text.
  sponsors: [
    { id: 1, name: "Islamic House", logo: "" },
    { id: 2, name: "MAPS", logo: "" },
    { id: 3, name: "ASUW", logo: "" },
    { id: 4, name: "Local Halal Co.", logo: "" },
    { id: 5, name: "Ummah Foods", logo: "" },
    { id: 6, name: "Crescent Realty", logo: "" },
  ],
  // mapUrl defaults to a Google Maps search for the building name (not a
  // pinned address — nobody's verified exact coordinates for these rooms)
  // so "Open in Maps" is useful out of the box; admins can overwrite with
  // an exact link any time from the Prayer spaces tab.
  prayerSpaces: [
    { id: 1, name: "HUB Reflection Room", loc: "Husky Union Building, Room 145", note: "Open during building hours · wudu station nearby",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Husky+Union+Building+University+of+Washington" },
    { id: 2, name: "Islamic House", loc: "Near NE 45th St", note: "Full masjid · all five daily prayers",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Islamic+House+University+of+Washington" },
    { id: 3, name: "Odegaard Quiet Room", loc: "Odegaard Library, Ground Floor", note: "Quiet reflection · prayer mats available",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Odegaard+Undergraduate+Library+University+of+Washington" },
    { id: 4, name: "Engineering Prayer Space", loc: "ECE Building", note: "Reservable · check MSA Discord for access",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=Paul+Allen+Center+University+of+Washington" },
  ],
  prayerTimes: {
    // ── Masjidal live widget ──────────────────────────────────────────────
    // The current MSA site uses Masjidal (mymasjidal.com), which auto-updates
    // prayer times daily on its own. To use it here, get the Masjid ID from
    // whoever runs the MSA account (Settings → Web Integration on masjidal.com)
    // and paste it below. The card will then show the live, self-updating widget
    // and ignore the manual times underneath.
    //
    // If you instead have the full embed <iframe...> code from the old site,
    // paste it into masjidalEmbed as a string and it will be used as-is.
    masjidalId: "RKxwXOdO",       // e.g. "1234"
    masjidalEmbed: "",    // OR paste a full <iframe ...></iframe> string
    // ── Manual times (used only when both Masjidal fields above are empty) ──
    Fajr: "5:42 AM", Dhuhr: "1:15 PM", Asr: "4:50 PM",
    Maghrib: "7:38 PM", Isha: "9:05 PM",
    // ── Always shown, under the widget or the manual times ──────────────
    jummah: "First khutbah 1:00 PM · Second 2:15 PM at Islamic House",
    announcement: "",
  },
  // Any event can take an optional img: "/events/your-file.jpg" (file in public/events/)
  // to show a banner photo at the top of its card. Monday shows the pattern.
  events: {
    Monday: [{ id: 1, name: "Quran Circle", time: "6:00 PM", loc: "HUB 145", desc: "Weekly tajweed & reflection", img: "" }],
    Tuesday: [{ id: 2, name: "Brothers' Halaqa", time: "7:00 PM", loc: "Islamic House", desc: "" }],
    Wednesday: [{ id: 3, name: "Sisters' Halaqa", time: "6:30 PM", loc: "HUB 145", desc: "" }],
    Thursday: [{ id: 4, name: "Mentorship Meetup", time: "5:00 PM", loc: "Odegaard", desc: "Pair with an upperclassman" }],
    Friday: [{ id: 5, name: "Jummah Prayer", time: "1:00 PM", loc: "Islamic House", desc: "Two khutbahs" }],
    Saturday: [{ id: 6, name: "Community Service", time: "10:00 AM", loc: "Varies", desc: "Check Discord for location" }],
    Sunday: [{ id: 7, name: "Social Night", time: "7:00 PM", loc: "Varies", desc: "Games, food, friends" }],
  },
  stats: [
    { id: 1, value: "40", suffix: "+", label: "Events each year" },
    { id: 2, value: "500", suffix: "+", label: "Students reached" },
    { id: 3, value: "6", suffix: "", label: "Weekly programs" },
  ],
  programs: [
    { id: 1, name: "Weekly Halaqas", desc: "Faith-centered circles for brothers and sisters, every week.", icon: "book" },
    { id: 2, name: "Quran Study", desc: "Tajweed, memorization, and reflection at every level.", icon: "star" },
    { id: 3, name: "Mentorship", desc: "New students paired with experienced Huskies for guidance.", icon: "grad" },
    { id: 4, name: "Sisters Program", desc: "Dedicated space, events, and support for sisters.", icon: "sparkles" },
    { id: 5, name: "Community Service", desc: "Give back through volunteering and local outreach.", icon: "hand" },
    { id: 6, name: "Social Events", desc: "BBQs, game nights, retreats, and Eid celebrations.", icon: "users" },
  ],
  links: [
    { id: 1, name: "Linktree", href: "https://linktr.ee/msauw", kind: "link" },
    { id: 2, name: "Join the Discord", href: "https://discord.gg/wb56SYhaF6", kind: "discord" },
    { id: 3, name: "Instagram", href: "https://instagram.com/msauw", kind: "instagram" },
    { id: 4, name: "MSA UW Facebook", href: "https://www.facebook.com/groups/650155172271569/", kind: "facebook" },
    { id: 5, name: "Sisters' Facebook Group", href: "https://www.facebook.com/groups/355223922312624/", kind: "facebook" },
    // id 6 (the Muslim Student Guide) used to live here too — now lives only
    // as the button in the "New here?" section, so it's not duplicated.
    { id: 7, name: "Donate to MSA UW 💜", href: "https://www.zeffy.com/en-US/donation-form/44131d7a-557e-4fdc-9a70-14e9f67206ef", kind: "donate" },
    { id: 8, name: "Donate to the Islamic House", href: "https://www.zeffy.com/en-US/donation-form/0b12beb3-2da5-4c6b-87b9-cfc84cf47e6a", kind: "donate" },
  ],
};

const progIcon = (k, c = PURPLE) => {
  const p = { size: 26, color: c };
  return { book: <BookOpen {...p} />, star: <Star size={26} color={c} />, grad: <GraduationCap {...p} />,
    sparkles: <Sparkles {...p} />, hand: <HandHeart {...p} />, users: <Users {...p} /> }[k] || <Star size={26} color={c} />;
};

/* ── Brand glyphs ────────────────────────────────────────────────────────
   lucide-react dropped brand logos (trademark reasons), so the real
   Discord / TikTok / LinkedIn marks are inlined here as small SVGs that
   take the same { size, color } props as the lucide icons. Use these for
   the connect cards and footer socials so the icons match each platform. */
function DiscordIcon({ size = 24, color = "#fff", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={style}>
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.245.198.372.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.057c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}
function TikTokIcon({ size = 24, color = "#fff", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={style}>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
    </svg>
  );
}
function LinkedInIcon({ size = 24, color = "#fff", style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={style}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/>
    </svg>
  );
}

const linkIcon = (k) => {
  const p = { size: 24, color: "#fff" };
  return { link: <Link2 {...p} />, discord: <DiscordIcon {...p} />, facebook: <Facebook {...p} />,
    instagram: <Instagram {...p} />, tiktok: <TikTokIcon {...p} />, linkedin: <LinkedInIcon {...p} />,
    donate: <Heart {...p} /> }[k] || <Link2 {...p} />;
};

/* Merges saved content over the built-in defaults. Nested objects
   (sections, prayerTimes, hero, events) merge key-by-key so a field the
   admin has never touched keeps its default instead of vanishing. Arrays
   are replaced wholesale — an admin deleting the last item must stick. */
function mergeContent(base, saved) {
  const out = { ...base, ...saved };
  for (const key of ["hero", "sections", "prayerTimes", "events", "about",
                     "islamicHouse", "contact", "donate", "eventsExtra",
                     "bar", "mailing", "newHere", "instagram", "tiktok"]) {
    if (base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      const savedVal = saved?.[key];
      if (savedVal && typeof savedVal === "object" && !Array.isArray(savedVal)) {
        out[key] = { ...base[key], ...savedVal };
        // sections is two levels deep — merge each section's fields too
        if (key === "sections") {
          for (const sk of Object.keys(base.sections)) {
            if (savedVal[sk] && typeof savedVal[sk] === "object") {
              out.sections[sk] = { ...base.sections[sk], ...savedVal[sk] };
            }
          }
        }
      }
    }
  }
  return out;
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState(seed);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("home");
  // Current page (hash route). Section components are grouped onto pages
  // by PAGES above; this decides which group renders.
  const [route, setRoute] = useHashRoute();
  const [adminOpen, setAdminOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // Curtain-up moment before the hero animates in — see HeroCurtain below.
  const [curtainDone, setCurtainDone] = useState(false);

  // Real load progress (0-100) for the loading screen's logo fill.
  //
  // Found and fixed a real bug here: the previous version computed each
  // frame as `p + (target - p) * factor` — an asymptotic "ease toward a
  // target" formula that, by construction, only ever gets CLOSER to 100,
  // never mathematically reaches it. Once the remaining gap got small
  // enough, adding a fraction of it to a value already near 100 fell below
  // floating-point precision and simply stopped changing — p would get
  // stuck at something like 99.9999999999998 forever. Since the curtain's
  // dismissal check is `progress >= 100`, that value never satisfied it,
  // so the site was stuck behind the loading screen on EVERY load, not
  // just failed ones — this is what was actually still broken.
  // This version recomputes a plain linear percentage fresh from elapsed
  // time each frame (no compounding, no asymptote), and snaps straight to
  // the literal integer 100 — not an approximation of it — the instant
  // either the real content has loaded or MAX_WAIT has passed, then stops
  // the loop entirely.
  const [loadProgress, setLoadProgress] = useState(0);
  useEffect(() => {
    const MAX_WAIT = 3200;
    let raf = 0;
    const start = performance.now();
    const tick = (t) => {
      const elapsed = t - start;
      if (loaded || elapsed >= MAX_WAIT) {
        setLoadProgress(100);
        return; // done — no further frames needed
      }
      setLoadProgress(Math.min(92, (elapsed / MAX_WAIT) * 92));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  // Theme — remembers the visitor's choice, otherwise follows their OS setting.
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("msa-theme");
      if (saved) return saved === "dark";
    } catch {}
    return typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    try { localStorage.setItem("msa-theme", dark ? "dark" : "light"); } catch {}
    // Tell the browser which scheme we're in so form controls and
    // scrollbars match the theme too.
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  // Cherry blossom petals — on by default, but the visitor's choice sticks.
  // Anyone who prefers reduced motion starts with them off.
  const [searchOpen, setSearchOpen] = useState(false);
  // ⌘K / Ctrl-K opens search from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const [petals, setPetals] = useState(() => {
    try {
      const saved = localStorage.getItem("msa-petals");
      if (saved !== null) return saved === "on";
    } catch {}
    // Off by default now — visitors can turn petals on in Settings (their
    // choice then sticks). Also stays off for reduced-motion users.
    return false;
  });
  useEffect(() => {
    try { localStorage.setItem("msa-petals", petals ? "on" : "off"); } catch {}
  }, [petals]);

  // Display settings (Nav's gear menu) — persisted, provided to the whole
  // tree below via MotionPrefsContext. See useReducedMotion()/useMotionPrefs()
  // near the top of the file for how these actually take effect.
  const boolPref = (key, fallback) => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return saved === "on";
    } catch {}
    return fallback;
  };
  const [motionOff, setMotionOff] = useState(() => boolPref("msa-motion-off", false));
  // Rosary glow starts OFF by default (glowOff = true) unless the visitor
  // has explicitly turned it on before (saved pref wins).
  const [glowOff, setGlowOff] = useState(() => boolPref("msa-glow-off", true));
  const [rippleOff, setRippleOff] = useState(() => boolPref("msa-ripple-off", false));
  useEffect(() => { try { localStorage.setItem("msa-motion-off", motionOff ? "on" : "off"); } catch {} }, [motionOff]);
  useEffect(() => { try { localStorage.setItem("msa-glow-off", glowOff ? "on" : "off"); } catch {} }, [glowOff]);
  useEffect(() => { try { localStorage.setItem("msa-ripple-off", rippleOff ? "on" : "off"); } catch {} }, [rippleOff]);
  const motionPrefs = { motionOff, setMotionOff, glowOff, setGlowOff, rippleOff, setRippleOff, dark };
  // App() renders the Provider that everything below it reads from, so it
  // can't consume its own context — combine its one direct use (RippleField)
  // with the local motionOff state by hand instead.
  const effectiveReduced = reducedMotion || motionOff;

  // On load: pull saved content from Supabase (fall back to seed if empty),
  // and check whether an admin session is already active.
  // try/catch/finally is load-bearing here: without it, a thrown error from
  // loadContent()/getSession() (offline, Supabase misconfigured/unreachable,
  // etc.) meant setLoaded(true) never ran — and since the loading screen's
  // dismissal is tied to `loaded`, the whole site got stuck behind the
  // curtain forever instead of just falling back to the seed content.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadContent();
        if (!cancelled && remote) setData(mergeContent(seed, remote));
        const { data: { session } } = await supabase.auth.getSession();
        if (!cancelled) setIsAdmin(!!session);
      } catch (err) {
        console.warn("Content/session load failed — continuing with seed content.", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    // keep isAdmin in sync if the session changes (login/logout/expiry)
    let sub;
    try {
      sub = supabase.auth.onAuthStateChange((_e, session) => {
        setIsAdmin(!!session);
      }).data;
    } catch (err) {
      console.warn("Auth state listener failed to attach.", err);
    }
    return () => { cancelled = true; sub?.subscription?.unsubscribe(); };
  }, []);

  // Persist the whole content object to Supabase. Used by the admin panel's
  // Save button. Requires an authenticated session (enforced by RLS).
  const persist = useCallback(async (next) => {
    setSaving(true);
    const res = await saveContent(next);
    setSaving(false);
    return res;
  }, []);

  // Navigate to a section, crossing pages when needed. Accepts a bare
  // section id ("events"), a page route ("/about"), or "/about#donate".
  // Same-page → smooth-scrolls; cross-page → switches route, then scrolls
  // once the new page has painted.
  const navigateTo = useCallback((target) => {
    setMenuOpen(false);
    if (!target) return;

    // route with optional section: "/about" or "/about#donate"
    if (target.startsWith("/")) {
      const [r, sec] = target.split("#");
      const dest = ROUTE_TO_PAGE[r] ? r : "/";
      if (window.location.hash.replace(/^#/, "") !== dest) {
        window.location.hash = dest;      // triggers hashchange → setRoute
        setRoute(dest);
      }
      // scroll after the page renders (or straight to top if no section)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (sec) {
          const el = document.getElementById(sec);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }));
      return;
    }

    // bare section id — find which page owns it
    const destRoute = SECTION_TO_ROUTE[target] || "/";
    if (destRoute !== route) {
      window.location.hash = destRoute;
      setRoute(destRoute);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = document.getElementById(target);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }));
    } else {
      const el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [route, setRoute]);
  // Back-compat alias — many sections call onNav(id).
  const scrollTo = navigateTo;

  // On every route change, jump to the top of the new page.
  useEffect(() => { window.scrollTo({ top: 0 }); setActive(route); }, [route]);

  // scroll spy — only the current page's sections
  useEffect(() => {
    const page = ROUTE_TO_PAGE[route];
    const ids = page ? page.sections : [];
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [loaded, route]);

  return (
    <MotionPrefsContext.Provider value={motionPrefs}>
    <div data-theme={dark ? "dark" : "light"}
      style={{ fontFamily: "'Poppins', system-ui, sans-serif",
        color: "var(--text)", background: "var(--bg)", minHeight: "100vh" }}>
      <StyleTag />
      <RippleField reduced={effectiveReduced || rippleOff} />
      <HeroCurtain progress={loadProgress} onDone={() => setCurtainDone(true)} />
      {petals && <SakuraWind dark={dark} />}
      <AnnouncementBar bar={data.bar} onNav={scrollTo} />
      {/* Nav highlights by page ROUTE ("/", "/about", …), not by the
          scroll-spy section id — `active` holds section ids (e.g. "home",
          "prayer") which never match a NAV item's `route`, so the old
          `active={active}` wiring meant the current-page indicator could
          never actually light up. `route` always holds the current page
          path, so that's what Nav needs for aria-current/highlighting. */}
      <Nav active={route} onNav={scrollTo} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        prayerTimes={data.prayerTimes || seed.prayerTimes}
           onAdmin={() => setAdminOpen(true)} isAdmin={isAdmin}
           dark={dark} onToggleDark={() => setDark((d) => !d)}
           petals={petals} onTogglePetals={() => setPetals((p) => !p)}
           onSearch={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)}
        data={data} onNav={scrollTo} />
      <main>
        <PageRouter route={route} data={data} onNav={scrollTo}
          curtainDone={curtainDone} reduced={effectiveReduced} />
      </main>
      <Footer onAdmin={() => setAdminOpen(true)} data={data} onNav={scrollTo} />
      {adminOpen && (
        <AdminPanel
          data={data} setData={setData}
          isAdmin={isAdmin} setIsAdmin={setIsAdmin}
          persist={persist} saving={saving}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </div>
    </MotionPrefsContext.Provider>
  );
}

/* ── Page router ─────────────────────────────────────────────────────────
   Renders the section components that belong to the active route. Section
   ids map to components here; the ordering per page lives in PAGES above. */
function PageRouter({ route, data, onNav, curtainDone, reduced }) {
  const render = (id) => {
    switch (id) {
      case "home":          return <HomeSection key="home" data={data} onNav={onNav} curtainDone={curtainDone} reduced={reduced} />;
      case "new-here":      return <NewHereSection key="new-here" data={data} onNav={onNav} />;
      case "moments":       return <MomentsSection key="moments" data={data} />;
      // "announcements" used to be its own standalone section here — it's
      // now folded into the home hero (the arch/rosary backdrop shows the
      // announcement cards directly), so there's no separate case for it
      // anymore. The id lives on in data.sections.announcements (still
      // editable from the admin "Section text" tab) and in the footer/
      // search links below, both retargeted to "home".
      case "about":         return <AboutSection key="about" data={data} />;
      case "donate":        return <DonateSection key="donate" data={data} />;
      case "connect":       return <ConnectSection key="connect" data={data} />;
      case "sponsors":      return <SponsorsSection key="sponsors" data={data} />;
      case "prayer":        return <PrayerSection key="prayer" data={data} />;
      case "islamic-house": return <IslamicHouseSection key="islamic-house" data={data} />;
      case "events":        return <EventsSection key="events" data={data} />;
      case "stats":         return <StatsBand key="stats" stats={data.stats || []} />;
      case "programs":      return <ProgramsSection key="programs" data={data} />;
      case "board":         return <BoardSection key="board" data={data} />;
      case "instagram":     return <InstagramSection key="instagram" data={data} />;
      case "tiktok":         return <TikTokSection key="tiktok" data={data} />;
      case "quad":          return <QuadSection key="quad" data={data} />;
      case "mailing":       return <MailingList key="mailing" data={data} />;
      default:              return null;
    }
  };
  const page = ROUTE_TO_PAGE[route] || ROUTE_TO_PAGE["/"];
  return <>{page.sections.map(render)}</>;
}

function StyleTag() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&family=Amiri:wght@400;700&display=swap');
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { margin: 0; }

      /* ── Theme tokens ───────────────────────────────────────────────────
         Purple and gold stay constant across both themes — only the
         surfaces and text shift. Everything reads from these variables so
         a theme swap never needs component changes. */
      :root, [data-theme="light"] {
        --bg: #faf9fc;
        --surface: #ffffff;
        --surface-2: #faf9fc;
        --nav-bg: rgba(255,255,255,.62);
        --nav-bg-solid: rgba(255,255,255,.86);
        --text: #2c2640;
        --text-muted: #5a5468;
        --text-soft: #4a4458;
        --text-faint: #8a8498;
        --border: rgba(75,46,131,.10);
        --border-strong: rgba(0,0,0,.15);
        --card-shadow: 0 4px 20px rgba(75,46,131,.06);
        --card-shadow-hover: 0 22px 48px rgba(75,46,131,.20);
        --tint: rgba(75,46,131,.05);
        --tint-2: rgba(75,46,131,.08);
        --lattice: #5b3d8c;
        --rosette: #5b3d8c;
        /* Nav + icon accent: purple reads well on light, gold on dark. */
        --accent: #5b3d8c;
        --accent-strong: #4a3175;
        --nav-active-bg: rgba(75,46,131,.09);
        --nav-idle: #4a4458;
      }
      [data-theme="dark"] {
        --bg: #120e1a;
        --surface: #1c1628;
        --surface-2: #171122;
        --nav-bg: rgba(18,14,26,.66);
        --nav-bg-solid: rgba(18,14,26,.90);
        --text: #f1ecfa;
        --text-muted: #bcb2d4;
        --text-soft: #cfc4e6;
        --text-faint: #948ab0;
        --border: rgba(201,182,214,.14);
        --border-strong: rgba(201,182,214,.22);
        --card-shadow: 0 4px 22px rgba(0,0,0,.34);
        --card-shadow-hover: 0 22px 52px rgba(0,0,0,.46);
        --tint: rgba(201,182,214,.06);
        --tint-2: rgba(201,182,214,.10);
        --lattice: #c9b6d6;
        --rosette: #d9c79a;
        --accent: #d9c79a;
        --accent-strong: #e6d7b0;
        --nav-active-bg: rgba(201,182,136,.16);
        --nav-idle: #c3b8db;
      }
      /* Theme swap eases rather than snapping. */
      body, #root, [data-theme] {
        transition: background-color 420ms ${EASE.inOut}, color 420ms ${EASE.inOut};
      }

      /* ── Accessibility: honour reduced-motion everywhere ────────────── */
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *, *::before, *::after {
          animation-duration: .001ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: .001ms !important;
          scroll-behavior: auto !important;
        }
      }

      /* ── Hero entrance ──────────────────────────────────────────────── */
      .reveal { opacity: 0; transform: translate3d(0,26px,0);
                animation: rise ${DUR.hero}ms ${EASE.outSoft} forwards; }
      @keyframes rise { to { opacity: 1; transform: translate3d(0,0,0); } }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ── Card lift: two-stage easing so it feels weighted ───────────── */
      .lift { transition: transform ${DUR.fast}ms ${EASE.out},
                          box-shadow ${DUR.fast}ms ${EASE.out}; }
      .lift:hover { transform: translate3d(0,-6px,0);
                    box-shadow: var(--card-shadow-hover); }
      .lift:active { transform: translate3d(0,-2px,0);
                     transition-duration: 90ms; }

      /* Inner media on a lifting card gets a slow counter-zoom — the depth
         cue that makes hover feel layered rather than flat. */
      .lift img, .zoomable img { transition: transform 900ms ${EASE.outSoft}; }
      .lift:hover img, .zoomable:hover img { transform: scale(1.045); }

      /* ── Buttons: press physics ─────────────────────────────────────── */
      .btn { transition: transform ${DUR.fast}ms ${EASE.spring},
                         box-shadow ${DUR.fast}ms ${EASE.out},
                         filter ${DUR.fast}ms ${EASE.out};
             will-change: transform; }
      .btn:hover { transform: translate3d(0,-2px,0); filter: brightness(1.06); }
      .btn:active { transform: translate3d(0,1px,0) scale(.985);
                    transition-duration: 80ms; }

      /* ── Nav links: underline grows from centre ─────────────────────── */
      .navlink { position: relative; }
      .navlink::after {
        content: ""; position: absolute; left: 50%; right: 50%; bottom: 4px;
        height: 2px; background: var(--accent); border-radius: 2px;
        transition: left ${DUR.fast}ms ${EASE.out}, right ${DUR.fast}ms ${EASE.out};
      }
      .navlink:hover::after { left: 14px; right: 14px; }

      /* ── Shiny sweep text — a bright purple highlight sweeps through the
         gold eyebrow labels on an endless loop (section kickers like "OUR
         HOME ON CAMPUS"). GPU-cheap: only background-position animates.
         Reduced-motion users never get this class in the first place (see
         Eyebrow), so there's no separate override needed here. ── */
      .shiny-text {
        /* --shiny-base defaults to the gold used on eyebrow labels;
           callers (e.g. the white hero headline) override it inline via
           style={{ "--shiny-base": "#fff" }} so the same sweep works on
           any base color without a second copy of this rule. */
        background-image: linear-gradient(100deg,
          var(--shiny-base, ${GOLD}) 35%, ${NEON_PURPLE} 50%, var(--shiny-base, ${GOLD}) 65%);
        background-size: 240% 100%;
        /* Resting position (used before the animation-delay below has
           elapsed, and matching the 0% keyframe exactly so there's no
           jump when it kicks in) has to land the purple stop fully
           outside the text — otherwise the very first paint shows a
           static purple patch wherever the resting position happens to
           put it. 200% used to put it right on top of the right half of
           the text at load. 140% sits in the gap between repeats, so
           nothing purple is visible until the sweep actually reaches it. */
        background-position: 140% 0;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        /* background-position counts down from 140% to -40% each cycle,
           which — given the gradient's own 240% tile width and the
           purple stop sitting at its midpoint — enters the text from the
           left edge, sweeps across to the right, then clears the text
           entirely before looping back to the (also-hidden) 140%
           starting point. 4s per cycle (was 3s): a little slower per the
           latest feedback, still smooth/continuous rather than the old
           two-phase sweep-then-hold. */
        animation: shineSweep 4s ${EASE.inOut} infinite;
        animation-delay: 1.1s;
      }
      @keyframes shineSweep {
        0%   { background-position: 140% 0; }
        100% { background-position: -40% 0; }
      }

      /* ── Ambient background glow (very slow, very soft) ─────────────── */
      @keyframes glowDrift {
        0%   { transform: translate3d(0,0,0) scale(1); }
        50%  { transform: translate3d(3%,-2%,0) scale(1.12); }
        100% { transform: translate3d(0,0,0) scale(1); }
      }
      .glow { animation: glowDrift 22s ${EASE.inOut} infinite; will-change: transform; }

      /* ── Hanging lanterns: pendulum swing + breathing glow ──────────── */
      @keyframes swing {
        0%   { transform: rotate(-2.6deg); }
        50%  { transform: rotate(2.6deg); }
        100% { transform: rotate(-2.6deg); }
      }
      .swing { animation-name: swing; animation-timing-function: ${EASE.inOut};
               animation-iteration-count: infinite; will-change: transform; }
      @keyframes lampPulse {
        0%, 100% { opacity: .55; transform: translate(-50%,-50%) scale(1); }
        50%      { opacity: 1;   transform: translate(-50%,-50%) scale(1.13); }
      }
      .lampglow { animation: lampPulse 5.5s ${EASE.inOut} infinite; }

      /* ── Animated logo: breathing float, halo pulse, slow orbit ─────── */
      @keyframes logoFloat {
        0%,100% { transform: translate3d(0,0,0) scale(1); }
        50%     { transform: translate3d(0,-7px,0) scale(1.012); }
      }
      .logofloat { animation: logoFloat 7s ${EASE.inOut} infinite; will-change: transform; }
      @keyframes haloPulse {
        0%,100% { opacity: .55; transform: scale(1); }
        50%     { opacity: 1;   transform: scale(1.09); }
      }
      .logohalo { animation: haloPulse 6s ${EASE.inOut} infinite; }
      @keyframes orbitSpin { to { transform: rotate(360deg); } }
      .logoorbit { animation: orbitSpin 46s linear infinite; }

      /* ── Tasbih sway ────────────────────────────────────────────────── */
      @keyframes tasbihSwing {
        0%,100% { transform: rotate(-3.2deg); }
        50%     { transform: rotate(3.2deg); }
      }
      .tasbihswing { animation: tasbihSwing 7.5s ${EASE.inOut} infinite; }

      /* ── Donate CTA: a slow, soft attention pulse (never flashy) ─────── */
      @keyframes donateGlow {
        0%,100% { box-shadow: 0 0 0 0 rgba(201,182,136,0); }
        50%     { box-shadow: 0 0 0 7px rgba(201,182,136,.14); }
      }
      .donatepulse { animation: donateGlow 3.6s ${EASE.inOut} infinite; }

      /* ── Announcement bar link ──────────────────────────────────────── */
      .barlink { display: inline-flex; align-items: center; gap: 3px; color: ${GOLD};
                 background: none; border: none; padding: 0; cursor: pointer;
                 font-family: inherit; font-size: 13.5px; font-weight: 700;
                 text-decoration: none; white-space: nowrap;
                 transition: gap ${DUR.fast}ms ${EASE.out}; }
      .barlink:hover { gap: 7px; text-decoration: underline; }

      /* ── Cinematic film grain ───────────────────────────────────────────
         A very faint animated noise layer over dark sections. It's the
         thing that reads as "shot on film" rather than "rendered". */
      @keyframes grainShift {
        0%,100% { transform: translate3d(0,0,0); }
        10% { transform: translate3d(-2%,-3%,0); }
        30% { transform: translate3d(3%,-2%,0); }
        50% { transform: translate3d(-1%,2%,0); }
        70% { transform: translate3d(2%,1%,0); }
        90% { transform: translate3d(-3%,-1%,0); }
      }
      .grain::after {
        content: ""; position: absolute; inset: -12%;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.38'/%3E%3C/svg%3E");
        opacity: .05; pointer-events: none; mix-blend-mode: overlay;
        animation: grainShift 5s steps(6) infinite;
      }

      /* ── Cinematic vignette for dark sections ───────────────────────── */
      .vignette::before {
        content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
        background: radial-gradient(ellipse at 50% 45%, transparent 42%, rgba(12,9,17,.55) 100%);
      }

      /* ── Ambient scroll lighting ────────────────────────────────────── */
      @keyframes lightDrift {
        0%   { transform: translate3d(0,0,0) scale(1); opacity: .5; }
        33%  { transform: translate3d(4%,-3%,0) scale(1.16); opacity: .85; }
        66%  { transform: translate3d(-3%,2%,0) scale(1.06); opacity: .62; }
        100% { transform: translate3d(0,0,0) scale(1); opacity: .5; }
      }
      .lightorb { animation: lightDrift 26s ${EASE.inOut} infinite; will-change: transform, opacity; }
      @keyframes softFlicker {
        0%,100% { opacity: .62; }
        42%     { opacity: .82; }
        58%     { opacity: .70; }
      }
      .flicker { animation: softFlicker 8s ${EASE.inOut} infinite; }

      /* ── Decorative float — for SVG accents ─────────────────────────── */
      @keyframes floatY {
        0%   { transform: translate3d(0,0,0) rotate(0deg); }
        50%  { transform: translate3d(0,-12px,0) rotate(1.4deg); }
        100% { transform: translate3d(0,0,0) rotate(0deg); }
      }
      .floaty { animation: floatY 9s ${EASE.inOut} infinite; }
      .floaty-slow { animation: floatY 15s ${EASE.inOut} infinite; }

      /* ── Sponsor logos: settle to full colour on hover ──────────────── */
      .sponsorlogo { filter: saturate(.55) opacity(.82);
                     transition: filter ${DUR.base}ms ${EASE.out},
                                 transform ${DUR.base}ms ${EASE.out}; }
      .lift:hover .sponsorlogo { filter: saturate(1) opacity(1);
                                 transform: scale(1.05); }

      /* ── Event cards: header tint deepens on hover ──────────────────── */
      .eventcard { transition: transform ${DUR.fast}ms ${EASE.out},
                               box-shadow ${DUR.fast}ms ${EASE.out},
                               border-color ${DUR.fast}ms ${EASE.out}; }
      .eventcard:hover { transform: translate3d(0,-5px,0);
                         box-shadow: 0 20px 44px rgba(75,46,131,.16); }

      /* ── Admin modal entrance ───────────────────────────────────────── */
      @keyframes modalBgIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes modalIn {
        from { opacity: 0; transform: translate3d(0,18px,0) scale(.975); }
        to   { opacity: 1; transform: translate3d(0,0,0) scale(1); }
      }
      .modalBg { animation: modalBgIn ${DUR.fast}ms ${EASE.out} both; }
      .modalIn { animation: modalIn ${DUR.base}ms ${EASE.out} 40ms both; }

      /* ── Gallery crossfade ──────────────────────────────────────────── */
      .xfade { transition: opacity 780ms ${EASE.outSoft},
                           transform 1500ms ${EASE.outSoft}; }

      a:focus-visible, button:focus-visible {
        outline: 3px solid ${GOLD}; outline-offset: 3px; border-radius: 6px;
      }
    `}</style>
  );
}

/* ── Display settings menu ─────────────────────────────────────────────
   One place for visitors to dial back motion/effects without touching OS
   settings: a master "Reduce motion" switch (feeds straight into
   useReducedMotion(), so it turns off every decorative animation site-wide
   — rosary spin, hero intro, lantern sway, parallax, the ripple, the
   carousel spin), plus two finer switches for the rosary wheel's neon glow
   and the hover ripple specifically, for anyone who wants most motion but
   not those two. Choices persist across visits via MotionPrefsContext. */
function SettingsMenu({ dark, onToggleDark, petals, onTogglePetals }) {
  const { motionOff, setMotionOff, glowOff, setGlowOff, rippleOff, setRippleOff } = useMotionPrefs();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ToggleRow = ({ label, hint, checked, onToggle }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 14, padding: "9px 2px" }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 1, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={() => onToggle(!checked)}
        style={{ flex: "0 0 auto", width: 38, height: 22, borderRadius: 999, position: "relative",
          border: "none", cursor: "pointer", padding: 0,
          background: checked ? GOLD : "var(--border-strong)",
          transition: `background ${DUR.fast}ms ${EASE.out}` }}>
        <span aria-hidden="true" style={{ position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: `left ${DUR.fast}ms ${EASE.out}` }} />
      </button>
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-label="Display settings"
        aria-expanded={open} aria-haspopup="true" title="Display settings" style={iconBtn}>
        <Settings size={16} color="var(--accent)" />
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: 268,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
          boxShadow: "0 18px 40px rgba(0,0,0,.24)", padding: "8px 14px", zIndex: 60 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase",
            color: "var(--text-faint)", padding: "8px 2px 2px" }}>Appearance</div>
          <ToggleRow label="Dark mode" hint="Switch between the light and dark themes"
            checked={!!dark} onToggle={() => onToggleDark?.()} />
          <ToggleRow label="Falling petals" hint="Cherry-blossom petals drifting over the page"
            checked={!!petals} onToggle={() => onTogglePetals?.()} />

          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase",
            color: "var(--text-faint)", padding: "8px 2px 2px" }}>Display settings</div>
          <ToggleRow label="Reduce motion" hint="Turns off spinning, parallax, and intro animations"
            checked={motionOff} onToggle={setMotionOff} />
          <ToggleRow label="Rosary glow" hint="Neon purple/gold glow on the home page medallion"
            checked={!glowOff} onToggle={(v) => setGlowOff(!v)} />
          <ToggleRow label="Hover ripple" hint="The outward wave when you click or hover"
            checked={!rippleOff} onToggle={(v) => setRippleOff(!v)} />
        </div>
      )}
    </div>
  );
}

/* "Next prayer in HH:MM:SS" pill for the nav bar. Parses the manual prayer
   times (Fajr…Isha), figures out the next one, and counts down — one timer,
   updated once a second, cleared on unmount. Clicking it opens a popup with
   the live Masjidal widget (or a link-out if no Masjid ID is set). Renders
   nothing if there are no usable times. */
const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

function parsePrayerToMinutes(str) {
  // "5:42 AM" -> minutes since midnight; returns null if unparseable
  const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10); const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function NextPrayerTimer({ times, compact = false }) {
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Build today's prayer schedule in minutes; memoized on the times object.
  const schedule = React.useMemo(() => {
    if (!times) return [];
    return PRAYER_ORDER
      .map((name) => ({ name, mins: parsePrayerToMinutes(times[name]) }))
      .filter((p) => p.mins != null);
  }, [times]);

  if (schedule.length === 0) return null;

  const nowMins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let next = schedule.find((p) => p.mins > nowMins);
  let crossesMidnight = false;
  if (!next) { next = schedule[0]; crossesMidnight = true; } // wrap to tomorrow's Fajr

  // seconds until next prayer
  let diffMin = next.mins - nowMins;
  if (crossesMidnight) diffMin += 24 * 60;
  const totalSec = Math.max(0, Math.round(diffMin * 60));
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const countdown = hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;

  return (
    <>
      <button onClick={() => setOpen(true)} title="Prayer times"
        aria-label={`Next prayer ${next.name} in ${countdown}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 7,
          padding: compact ? "7px 12px" : "8px 14px", borderRadius: 999,
          border: "1px solid var(--border)", background: "var(--tint)",
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          color: "var(--text)", fontSize: compact ? 12.5 : 13, fontWeight: 600 }}>
        <Clock size={compact ? 13 : 14} color="var(--accent)" />
        <span style={{ color: "var(--text-muted)" }}>{next.name} in</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--accent)" }}>
          {countdown}
        </span>
      </button>
      {open && <MasjidalPopup times={times} onClose={() => setOpen(false)} />}
    </>
  );
}

/* Popup showing the live Masjidal prayer-times widget. */
function MasjidalPopup({ times, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Prevent the background from scrolling while the popup is open — but do
    // NOT use position:fixed on <body> (that reflows the page under the fixed
    // nav and broke the layout). Just hide overflow; the page keeps its
    // scroll position, and the overlay below sits on top at a fixed viewport
    // position with its own internal scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const embed = (times?.masjidalEmbed || "").trim();
  const id = (times?.masjidalId || "").trim();
  // Prefer a pasted embed (sanitized); otherwise build the AthanPlus widget
  // URL straight from the Masjid ID — same host the prayer card uses.
  const cleanEmbed = embed ? sanitizeIframe(embed) : "";
  const widgetSrc = !cleanEmbed && id
    ? `https://timing.athanplus.com/masjid/widgets/embed?theme=3&masjid_id=${encodeURIComponent(id)}&color=000000`
    : "";

  return (
    <div role="dialog" aria-modal="true" aria-label="Prayer times" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,8,14,.62)",
        backdropFilter: "blur(4px)",
        // Center the popup with top padding clearing the fixed nav. The box
        // caps its own height and scrolls its body internally, so it's never
        // taller than the screen and the header/X is always visible.
        display: "flex", justifyContent: "center", alignItems: "center",
        padding: "88px 16px 24px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(440px, 96vw)",
        maxHeight: "calc(100dvh - 112px)", display: "flex", flexDirection: "column",
        overflow: "hidden", position: "relative", padding: 0 }}>
        {/* fixed header (doesn't scroll) — X always visible */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--border)",
          background: "var(--surface)", flexShrink: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <Clock size={17} color="var(--accent)" /> Prayer Times
          </div>
          <button onClick={onClose} aria-label="Close" style={{ ...iconBtn, width: 34, height: 34 }}>
            <X size={17} color="var(--accent)" />
          </button>
        </div>
        {/* scrollable body */}
        <div style={{ overflowY: "auto", overscrollBehavior: "contain",
          padding: (cleanEmbed || widgetSrc) ? 0 : 18 }}>
          {cleanEmbed ? (
            <div style={{ width: "100%" }} dangerouslySetInnerHTML={{ __html: cleanEmbed }} />
          ) : widgetSrc ? (
            <iframe title="Prayer times" src={widgetSrc} loading="lazy"
              style={{ width: "100%", height: 500, border: "none", display: "block" }} />
          ) : (
            /* Manual times (always render) + link to the live Masjidal page. */
            <div style={{ display: "grid", gap: 8 }}>
              {PRAYER_ORDER.filter((n) => times?.[n]).map((n) => (
                <div key={n} style={{ display: "flex", justifyContent: "space-between",
                  padding: "10px 14px", borderRadius: 10, background: "var(--tint)" }}>
                  <span style={{ fontWeight: 600 }}>{n}</span>
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{times[n]}</span>
                </div>
              ))}
              {times?.jummah && (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "6px 4px", lineHeight: 1.5 }}>
                  {times.jummah}
                </div>
              )}
              <a className="btn" href="https://mymasjidal.com/" target="_blank" rel="noopener noreferrer"
                style={{ ...btnPurple, textDecoration: "none", display: "inline-flex",
                  alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}>
                <ExternalLink size={15} /> Live times on Masjidal
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Minimal allowlist sanitizer for an admin-pasted <iframe> embed: strips
   everything except a single iframe with safe attributes, so a stored embed
   string can't inject scripts. Admin content is trusted-ish, but this keeps
   a compromised/mistaken value from running arbitrary HTML. */
function sanitizeIframe(html) {
  const m = String(html).match(/<iframe\b[^>]*>(?:<\/iframe>)?/i);
  if (!m) return "";
  const tag = m[0];
  const srcM = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!srcM) return "";
  const src = srcM[1];
  // only allow https iframes from Masjidal / AthanPlus (its widget host)
  if (!/^https:\/\/([\w-]+\.)?(masjidal\.com|athanplus\.com)\//i.test(src)) return "";
  return `<iframe src="${src}" style="width:100%;height:520px;border:none;display:block" loading="lazy" title="Masjidal prayer times"></iframe>`;
}

function Nav({ active, onNav, menuOpen, setMenuOpen, onAdmin, dark, onToggleDark,
  petals, onTogglePetals, onSearch, prayerTimes }) {
  const { motionOff, setMotionOff, glowOff, setGlowOff, rippleOff, setRippleOff } = useMotionPrefs();
  const [solid, setSolid] = useState(false);
  const [progress, setProgress] = useState(0);
  const [openMenu, setOpenMenu] = useState(null);  // which dropdown is open
  const navRef = useRef(null);

  useEffect(() => {
    let ticking = false, raf = 0;
    const read = () => {
      const y = window.scrollY;
      setSolid(y > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(y / max, 1) : 0);
      ticking = false;
    };
    const onScroll = () => { if (ticking) return; ticking = true; raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Close a dropdown on outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e) => { if (!navRef.current?.contains(e.target)) setOpenMenu(null); };
    const onKey = (e) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  // active is the current route ("/", "/about", …). A nav item is active
  // when its route matches (the Donate CTA never highlights).
  const itemActive = (item) => !item.cta && item.route && item.route === active;
  // Navigate: pages go to their route; the Donate CTA jumps to its section.
  const go = (item) => {
    setOpenMenu(null); setMenuOpen(false);
    if (item.external) { window.open(item.href, "_blank", "noopener"); return; }
    onNav(item.section ? `${item.route}#${item.section}` : item.route);
  };

  return (
    <>
    <header ref={navRef} style={{
      position: "sticky", top: 0, zIndex: 50,
      background: solid ? "var(--nav-bg-solid)" : "var(--nav-bg)",
      backdropFilter: `blur(${solid ? 18 : 10}px) saturate(1.6)`,
      WebkitBackdropFilter: `blur(${solid ? 18 : 10}px) saturate(1.6)`,
      borderBottom: `1px solid ${solid ? "var(--border)" : "transparent"}`,
      boxShadow: solid ? "var(--card-shadow)" : "0 0 0 rgba(0,0,0,0)",
      transition: `background ${DUR.base}ms ${EASE.out}, box-shadow ${DUR.base}ms ${EASE.out}, border-color ${DUR.base}ms ${EASE.out}, backdrop-filter ${DUR.base}ms ${EASE.out}`,
    }}>
      <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: -1,
        height: 2, transformOrigin: "0 50%",
        transform: `scaleX(${progress})`,
        background: `linear-gradient(90deg, ${VIOLET}, ${GOLD})`,
        opacity: progress > 0.005 ? 1 : 0,
        transition: `opacity ${DUR.base}ms ${EASE.out}` }} />

      <nav style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <button className="btn logomark" onClick={() => onNav("/")} aria-label="MSA at UW — home"
          style={{ display: "flex", alignItems: "center", gap: 10, background: "none",
            border: "none", cursor: "pointer", padding: 0, height: 44, flexShrink: 0 }}>
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="MSA at UW logo"
            style={{ height: 44, width: 44, objectFit: "contain",
              transformOrigin: "left center",
              transform: solid ? "scale(.86)" : "scale(1)",
              transition: `transform ${DUR.base}ms ${EASE.out}` }} />
        </button>

        {/* ── Desktop ─────────────────────────────────────────────────── */}
        <div className="desk" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {NAV.map((item, i) => {
            if (item.external) {
              return (
                <a key={`ext-${i}`} href={item.href} target="_blank" rel="noopener noreferrer"
                  className="navlink" style={{ ...navLink(false), display: "inline-flex",
                    alignItems: "center", gap: 5, textDecoration: "none" }}>
                  {item.label} <ExternalLink size={12} />
                </a>
              );
            }
            if (item.cta) {
              return (
                <button key={`cta-${i}`} className="btn" onClick={() => go(item)}
                  style={{ marginLeft: 6, padding: "9px 18px", borderRadius: 999,
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    fontSize: 14, fontWeight: 700, color: "#2c2418",
                    background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)`,
                    boxShadow: "0 6px 18px rgba(201,182,136,.35)",
                    display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Heart size={14} /> {item.label}
                </button>
              );
            }
            return (
              <button key={item.route} className="navlink" onClick={() => go(item)}
                aria-current={itemActive(item) ? "page" : undefined}
                style={navLink(itemActive(item))}>{item.label}</button>
            );
          })}

          <NextPrayerTimer times={prayerTimes} />
          <button className="btn" onClick={onSearch} aria-label="Search the site"
            title="Search (⌘K)" style={iconBtn}>
            <Search size={16} color="var(--accent)" />
          </button>
          {/* Theme + petals now live inside the consolidated Settings menu. */}
          <SettingsMenu dark={dark} onToggleDark={onToggleDark}
            petals={petals} onTogglePetals={onTogglePetals} />
          <button className="btn" onClick={onAdmin} aria-label="Admin login" style={iconBtn}>
            <Lock size={16} color="var(--accent)" />
          </button>
        </div>

        {/* ── Mobile trigger ──────────────────────────────────────────── */}
        <button className="mob" onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen}
          style={{ display: "none", background: "none", border: "none", cursor: "pointer",
            padding: 6 }}>
          {menuOpen ? <X size={26} color="var(--accent)" /> : <Menu size={26} color="var(--accent)" />}
        </button>
      </nav>
    </header>

      {/* ── Mobile sheet ──────────────────────────────────────────────────
          Rendered OUTSIDE <header> on purpose: <header> has a
          backdrop-filter, and any ancestor with backdrop-filter/filter/
          transform becomes the containing block for position:fixed
          descendants (a well-known mobile Safari/Chrome gotcha). Nested
          inside <header>, this sheet was sizing/positioning itself against
          the ~68px-tall header box instead of the real viewport — combined
          with the body-scroll lock below, that's what made the page look
          totally frozen when opened on mobile (menu invisible/mispositioned
          AND the page underneath unscrollable).
          Fixed below the bar and scrollable, so a long list can never run
          off-screen no matter how many items there are. */}
      <div className="mob" style={{
        display: "none", position: "fixed", left: 0, right: 0, top: 68, bottom: 0,
        width: "100%", maxWidth: "100vw", boxSizing: "border-box", overflowX: "hidden",
        background: "var(--nav-bg-solid)",
        backdropFilter: "blur(18px) saturate(1.6)",
        WebkitBackdropFilter: "blur(18px) saturate(1.6)",
        borderTop: "1px solid var(--border)",
        overflowY: "auto", WebkitOverflowScrolling: "touch",
        opacity: menuOpen ? 1 : 0,
        transform: menuOpen ? "translate3d(0,0,0)" : "translate3d(0,-8px,0)",
        pointerEvents: menuOpen ? "auto" : "none",
        transition: `opacity ${DUR.base}ms ${EASE.out}, transform ${DUR.base}ms ${EASE.out}`,
        zIndex: 49,
      }}>
        <div style={{ padding: "10px 20px calc(28px + env(safe-area-inset-bottom, 0px))" }}>
          {NAV.map((item, i) => {
            if (item.external) {
              return (
                <a key={`mext-${i}`} href={item.href} target="_blank" rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)} style={mobLink}>
                  {item.label} <ExternalLink size={14} />
                </a>
              );
            }
            if (item.cta) {
              return (
                <button key={`mcta-${i}`} onClick={() => go(item)}
                  style={{ ...mobLink, marginTop: 14, justifyContent: "center",
                    borderRadius: 12, borderBottom: "none", color: "#2c2418",
                    background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)`, fontWeight: 700 }}>
                  <Heart size={16} /> {item.label}
                </button>
              );
            }
            return (
              <button key={item.route} onClick={() => go(item)}
                aria-current={itemActive(item) ? "page" : undefined}
                style={{ ...mobLink, color: itemActive(item) ? "var(--accent)" : "var(--nav-idle)" }}>
                {item.label}
              </button>
            );
          })}

          <div style={{ height: 1, background: "var(--border)", margin: "14px 0 6px" }} />
          <button onClick={() => { setMenuOpen(false); onSearch?.(); }} style={mobLink}>
            <Search size={15} /> Search
          </button>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "1.4px",
            textTransform: "uppercase", color: "var(--text-faint)",
            padding: "12px 8px 4px" }}>Appearance</div>
          <button onClick={onToggleDark} style={mobLink}>
            {dark ? <Sun size={15} /> : <Moon size={15} />} {dark ? "Light mode" : "Dark mode"}
          </button>
          <button onClick={onTogglePetals} style={mobLink} aria-pressed={!!petals}>
            <PetalIcon size={15} color="var(--accent)" />
            {petals ? "Petals: on" : "Petals: off"}
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
          <button onClick={() => setMotionOff((v) => !v)} style={mobLink} aria-pressed={motionOff}>
            <Settings size={15} color="var(--accent)" />
            {motionOff ? "Reduce motion: on" : "Reduce motion: off"}
          </button>
          <button onClick={() => setGlowOff((v) => !v)} style={mobLink} aria-pressed={glowOff}>
            <Settings size={15} color="var(--accent)" />
            {glowOff ? "Rosary glow: off" : "Rosary glow: on"}
          </button>
          <button onClick={() => setRippleOff((v) => !v)} style={mobLink} aria-pressed={rippleOff}>
            <Settings size={15} color="var(--accent)" />
            {rippleOff ? "Hover ripple: off" : "Hover ripple: on"}
          </button>
          <button onClick={() => { setMenuOpen(false); onAdmin(); }} style={mobLink}>
            <Lock size={15} /> Admin
          </button>
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) { .desk { display: none !important; } .mob { display: block !important; } }
        @media (max-width: 980px) { nav .mob { display: flex !important; } }
      `}</style>
    </>
  );
}

const iconBtn = {
  marginLeft: 6, display: "grid", placeItems: "center", width: 38, height: 38,
  borderRadius: 10, border: "1px solid var(--border-strong)",
  background: "var(--surface)", cursor: "pointer", flexShrink: 0,
};

const navLink = (on) => ({
  padding: "9px 14px", background: on ? "var(--nav-active-bg)" : "transparent",
  border: "none", cursor: "pointer", borderRadius: 10, fontWeight: 600, fontSize: 14.5,
  color: on ? "var(--accent)" : "var(--nav-idle)",
  fontFamily: "inherit", textDecoration: "none",
  transition: `background ${DUR.fast}ms ${EASE.out}, color ${DUR.fast}ms ${EASE.out}`,
});
const mobLink = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  padding: "13px 10px", background: "none", border: "none",
  borderBottom: "1px solid var(--border)",
  fontSize: 16, fontWeight: 600, color: "var(--accent)", cursor: "pointer",
  fontFamily: "inherit", textDecoration: "none", borderRadius: 8,
};

function Band({ children, id, alt, style, divider, lattice, decor, floats, rosettes,
  light, lightTone = "violet", lightAt = "top-left" }) {
  return (
    <section id={id} style={{ position: "relative", overflow: "hidden",
      padding: "68px 20px", background: alt ? "var(--surface)" : "transparent", ...style }}>
      {light && <SectionLight tone={lightTone} placement={lightAt} />}
      {lattice && <StarLatticeBg color="var(--lattice)" opacity={alt ? 0.055 : 0.05} unit={66} />}
      {rosettes && <EdgeRosettes arrangement={rosettes} />}
      {floats}
      {/* Parallax botanicals framing the section. `decor` picks the arrangement. */}
      {decor === "left" && (
        <Parallax speed={-0.16} float style={{ bottom: -30, right: -60 }}>
          <CrescentAccent size={130} opacity={.09} />
        </Parallax>
      )}
      {decor === "right" && (
        <Parallax speed={-0.18} float style={{ bottom: 10, left: -40 }}>
          <Lantern size={80} opacity={.12} />
        </Parallax>
      )}
      {decor === "both" && (
        <Parallax speed={-0.2} float style={{ bottom: -10, left: "45%" }}>
          <CrescentAccent size={100} opacity={.08} />
        </Parallax>
      )}
      {divider && (
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "-40px auto 52px", opacity: .55 }}>
          <GirihBand color={GOLD} height={30} opacity={1} unit={44} />
        </div>
      )}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto" }}>{children}</div>
    </section>
  );
}

function Eyebrow({ children }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView({ threshold: 0.4 });
  const show = reduced || inView;
  return (
    <div ref={ref} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {/* star spins gently into place */}
      <span style={{
        display: "inline-flex",
        opacity: show ? 1 : 0,
        transform: show ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(.4)",
        transition: reduced ? "none"
          : `opacity ${DUR.base}ms ${EASE.out}, transform ${DUR.slow}ms ${EASE.spring}`,
      }}><Star8 size={16} /></span>
      {/* shiny-text sweeps a bright purple highlight through the gold
          label on a loop — purely decorative, so it's applied via a class
          (not inline color) so prefers-reduced-motion users, who get the
          animation frozen by the global media query above, still land on
          a normal solid-looking label rather than a half-swept gradient. */}
      <span className={reduced ? "" : "shiny-text"} style={{ textTransform: "uppercase", letterSpacing: "2px", fontSize: 12.5,
        fontWeight: 700, color: reduced ? GOLD : undefined,
        opacity: show ? 1 : 0,
        transform: show ? "translate3d(0,0,0)" : "translate3d(-10px,0,0)",
        transition: reduced ? "none"
          : `opacity ${DUR.base}ms ${EASE.out} 90ms, transform ${DUR.base}ms ${EASE.out} 90ms`,
      }}>{children}</span>
      {/* hairline rule that draws outward */}
      <span aria-hidden="true" style={{ flex: 1, height: 1, marginLeft: 4,
        background: `linear-gradient(90deg, ${GOLD}, transparent)`,
        transformOrigin: "0 50%",
        transform: show ? "scaleX(1)" : "scaleX(0)",
        opacity: .45,
        transition: reduced ? "none" : `transform ${DUR.slow}ms ${EASE.outSoft} 160ms`,
      }} />
    </div>
  );
}

function Title({ children, delay = 0 }) {
  const isText = typeof children === "string";
  return (
    <h2 style={{ fontSize: "clamp(28px,4vw,42px)", fontWeight: 800, color: "var(--accent)",
      margin: "0 0 16px", letterSpacing: "-1px", lineHeight: 1.1 }}>
      {isText
        ? <TextReveal text={children} delay={delay + 90} step={48} />
        : <Reveal delay={delay + 90} variant="up" distance={20}>{children}</Reveal>}
    </h2>
  );
}

/* Renders a section's eyebrow + title + intro from admin-editable copy.
   Any field left blank in the admin panel is simply skipped. */
function SectionCopy({ data, sectionKey, style }) {
  const copy = useSectionCopy(data, sectionKey);
  return (
    <>
      {copy.eyebrow && <Eyebrow>{copy.eyebrow}</Eyebrow>}
      {copy.title && <Title>{copy.title}</Title>}
      {copy.body && (
        <Reveal delay={260} variant="up" distance={18}>
          <div style={{ color: "var(--text-muted)", maxWidth: 560, marginBottom: 36,
            fontSize: 16.5, lineHeight: 1.65, ...style }}>
            <Markdown text={copy.body} style={{ margin: "0 0 10px" }} />
          </div>
        </Reveal>
      )}
    </>
  );
}

/* Lead paragraph under a Title — reveals just after it. */
function Lead({ children, delay = 260, style }) {
  return (
    <Reveal delay={delay} variant="up" distance={18}>
      <p style={{ color: "var(--text-muted)", maxWidth: 560, margin: "0 0 36px", fontSize: 16.5,
        lineHeight: 1.65, ...style }}>{children}</p>
    </Reveal>
  );
}

/* ---------- HOME ---------- */
/* ── HeroCurtain ─────────────────────────────────────────────────────────
   The opening moment: the logo spins slowly with a neon glow that cycles
   between purple and gold, holds for a beat, then the whole curtain sweeps
   up and out of view. Fires onDone once, so the hero underneath knows
   exactly when to start its own reveal. Skips straight to onDone for
   reduced-motion users so nothing blocks the page. */
function HeroCurtain({ progress = 0, onDone }) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(!reduced);
  const rootRef = useRef(null);
  // Keep the latest onDone without making the mount effect depend on it —
  // onDone is an inline arrow from the parent, so its identity changes on
  // every App render. Depending on it directly re-ran this effect after the
  // curtain had already unmounted and nulled out its refs.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const firedRef = useRef(false);

  useEffect(() => {
    if (reduced) onDoneRef.current?.();
  }, [reduced]);

  // Dismissal is tied to real load progress now, not a fixed timer: once
  // `progress` actually reaches 100 (see loadProgress in App), hold briefly
  // so the fully-lit mark is visible for a beat, then sweep the curtain away.
  useEffect(() => {
    if (reduced || firedRef.current || progress < 100) return;
    firedRef.current = true;
    const holdTimer = setTimeout(() => {
      animate(rootRef.current, {
        opacity: 0, scale: 1.08, duration: 700, ease: "inExpo",
        onComplete: () => { setVisible(false); onDoneRef.current?.(); },
      });
    }, 400);
    return () => clearTimeout(holdTimer);
  }, [progress, reduced]);

  if (!visible) return null;

  const pct = Math.max(0, Math.min(100, progress));
  // Interpolated purple -> gold, driven directly by load progress (no
  // fixed-interval pulse anymore) — this IS the loading indicator.
  const litColor = `color-mix(in srgb, ${NEON_PURPLE} ${(100 - pct).toFixed(0)}%, ${NEON_GOLD} ${pct.toFixed(0)}%)`;
  const logoUrl = `${import.meta.env.BASE_URL}logo-mark.png`;

  return (
    <div ref={rootRef} aria-hidden="true" style={{
      position: "fixed", inset: 0, zIndex: 999, display: "grid", placeItems: "center",
      background: INK, pointerEvents: "none",
    }}>
      <div style={{ position: "relative", width: 148, height: 148, display: "grid", placeItems: "center" }}>
        {/* radiating glow — colour tracks load progress rather than a fixed
            timed pulse, and grows a little as loading nears completion */}
        <div aria-hidden="true" style={{
          position: "absolute", inset: -18, borderRadius: "50%",
          filter: "blur(24px)", opacity: 0.35 + (pct / 100) * 0.4,
          background: `radial-gradient(circle, ${litColor} 0%, transparent 72%)`,
          transition: reduced ? "none" : "opacity 200ms linear",
        }} />
        {/* No spin anymore — the mark holds still. Progress reads entirely
            through the lines lighting up below. */}
        <div style={{ position: "relative", width: 128, height: 128 }}>
          {/* dim, "unlit" base mark */}
          <img src={logoUrl} alt="" width={128} height={128} decoding="async"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "contain", filter: "grayscale(1) brightness(.5)", opacity: 0.5 }} />
          {/* "lit" overlay — masked to the logo's own silhouette (so only
              the mark's actual lines/shapes light up, not a bounding box),
              filled bottom-to-top as progress rises, colour sliding from
              neon purple to neon gold as it completes */}
          <div aria-hidden="true" style={{
            position: "absolute", inset: 0,
            backgroundColor: litColor,
            WebkitMaskImage: `url(${logoUrl})`, maskImage: `url(${logoUrl})`,
            WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
            WebkitMaskPosition: "center", maskPosition: "center",
            WebkitMaskSize: "contain", maskSize: "contain",
            clipPath: `inset(${(100 - pct).toFixed(1)}% 0 0 0)`,
            transition: reduced ? "none" : "clip-path 120ms linear, background-color 200ms linear",
            filter: `drop-shadow(0 0 9px ${litColor})`,
          }} />
        </div>
      </div>
    </div>
  );
}

/* ── 3D cursor tilt ──────────────────────────────────────────────────────
   Wraps a child in a perspective container that tilts toward the cursor
   (±8°) — the "premium, modern" depth cue used across Linear/Vercel/Stripe.
   Smoothed with anime.js rather than snapping straight to the pointer. */
function TiltWrap({ children, max = 8, style }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = outerRef.current, inner = innerRef.current;
    if (!el || !inner) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      animate(inner, {
        rotateY: px * max * 2, rotateX: -py * max * 2,
        duration: 700, ease: "outQuad",
      });
    };
    const onLeave = () => animate(inner, { rotateX: 0, rotateY: 0, duration: 900, ease: "outQuad" });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => { el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); };
  }, [reduced, max]);

  return (
    <div ref={outerRef} style={{ perspective: 900, ...style }}>
      <div ref={innerRef} style={{ transformStyle: "preserve-3d" }}>{children}</div>
    </div>
  );
}

/* ── Magnetic button ─────────────────────────────────────────────────────
   Nudges toward the cursor within its own bounds (up to ~10px) and pops
   slightly on hover — a small, deliberate bit of "this was crafted" feel
   for the hero CTAs. Falls back to plain hover for reduced motion. */
function Magnetic({ children, strength = 10, style }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      animate(el, { translateX: x * strength * 2, translateY: y * strength * 2, scale: 1.035,
        duration: 400, ease: "outQuad" });
    };
    const onLeave = () => animate(el, { translateX: 0, translateY: 0, scale: 1, duration: 500, ease: "outElastic(1,.6)" });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => { el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); };
  }, [reduced, strength]);
  return <div ref={ref} style={{ display: "inline-block", willChange: "transform", ...style }}>{children}</div>;
}

/* Canvas ripple grid — small dark squares that ripple outward from the
   cursor in alternating purple/gold rings. Scoped to the hero section
   (not the whole page), and skipped entirely for reduced-motion. */
/* ── RippleField ──────────────────────────────────────────────────────────
   Site-wide "outward" hover/tap effect: a sparse dot grid that ripples out
   from wherever you move the cursor (or tap, on touch devices) in
   alternating purple/gold rings. Mounted once at the app root as a single
   fixed, viewport-sized overlay — not per-section — so there's exactly one
   canvas and one animation loop for the whole page.

   Perf-critical difference from the old per-section version: the redraw
   loop used to run requestAnimationFrame forever, clearing and redrawing
   every dot every frame, for the entire life of the page. Here the canvas
   is only cleared/redrawn while a ripple is actually decaying (roughly the
   ~1.8s after a pointer moves or taps); the rest of the time the loop is
   stopped entirely and the last-drawn frame (or nothing) just sits there.
   That's the difference between one rAF callback that's *usually idle* and
   one that's *always working* — the latter is what was contributing to the
   mobile jank. */
function RippleField({ reduced }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const isSmall = () => window.innerWidth < 640;
    const RING_COLORS = [PURPLE, GOLD];
    const RIPPLE_LIFE = 60; // frames
    const WAVE_SPEED = 4;
    const RING_SPACING = 34, RING_TRAIL = 2;

    let SPACING = isSmall() ? 34 : 26;
    // Shrunk from 320 — the wave used to travel nearly a third of the
    // screen; now it fades out as a smaller, quicker pulse right around
    // the cursor/tap point instead of sweeping across half the viewport.
    const DOT_SIZE = 2, RIPPLE_RADIUS = 150;

    let w = 0, h = 0, cols = 0, rows = 0;
    let raf = 0, clock = 0, running = false;
    const pointer = { x: -9999, y: -9999, t: -9999 };

    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      SPACING = isSmall() ? 34 : 26;
      cols = Math.ceil(w / SPACING);
      rows = Math.ceil(h / SPACING);
    };
    resize();

    const clear = () => ctx.clearRect(0, 0, w, h);

    // Only the "active ripple" window ever redraws the full grid; once it
    // decays the loop stops itself and the canvas goes back to blank/idle.
    const draw = () => {
      clock += 1;
      const age = clock - pointer.t;
      const wavefront = age * WAVE_SPEED;
      const alive = age < RIPPLE_LIFE && wavefront < RIPPLE_RADIUS && !document.hidden;

      if (!alive) { clear(); running = false; return; } // stop the loop

      clear();
      for (let cy = 0; cy <= rows; cy++) {
        for (let cx = 0; cx <= cols; cx++) {
          const x = cx * SPACING, y = cy * SPACING;
          const dx = x - pointer.x, dy = y - pointer.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const behindFront = wavefront - dist;
          if (behindFront < 0 || behindFront >= RING_SPACING * RING_TRAIL) continue; // skip undisturbed dots entirely
          const ringIndex = Math.floor(dist / RING_SPACING);
          const bandFade = 1 - behindFront / (RING_SPACING * RING_TRAIL);
          const overallFade = Math.max(0, 1 - age / RIPPLE_LIFE);
          const boost = bandFade * overallFade;
          const size = DOT_SIZE + boost * 3;
          ctx.globalAlpha = Math.min(1, 0.3 + boost * 0.9);
          ctx.fillStyle = RING_COLORS[ringIndex % 2];
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    const startRipple = (x, y) => {
      pointer.x = x; pointer.y = y; pointer.t = clock;
      if (!running) { running = true; raf = requestAnimationFrame(draw); }
    };

    const onPointerMove = (e) => startRipple(e.clientX, e.clientY);
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t) startRipple(t.clientX, t.clientY);
    };
    const onResize = () => resize();
    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(raf); running = false; clear(); } };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  if (reduced) return null;
  return (
    <canvas ref={canvasRef} aria-hidden="true"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh",
        zIndex: 9998, pointerEvents: "none" }} />
  );
}

function HomeSection({ data, onNav, curtainDone, reduced: reducedProp }) {
  const reducedHook = useReducedMotion();
  const reduced = reducedProp ?? reducedHook;
  const { glowOff } = useMotionPrefs();
  // Ref to the scroll-hero title wrapper. CanvasHeroSequence fades it
  // directly on the DOM as the bloom scrubs — no per-scroll React re-render.
  const heroOverlayRef = useRef(null);
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const glowARef = useRef(null);
  const glowBRef = useRef(null);
  const rosetteWrapRef = useRef(null);
  // Used to be the CTA buttons (Get Involved / Learn More) — those moved to
  // the New Here section, so the arch's lower boundary is now the
  // announcement cards instead.
  const announceRef = useRef(null);
  const archWidthRefs = useRef([rosetteWrapRef, announceRef]).current;
  // Sorted announcements — pinned first — rendered where the old
  // headline/subtitle/CTA used to sit. Same data + sort the standalone
  // Announcements section used to use, before that section was folded into
  // this hero backdrop (the arch + spinning rosary now *is* the
  // announcement section, rather than a separate block further down).
  const sortedAnnouncements = React.useMemo(() => {
    const items = data.announcements || [];
    return [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  }, [data.announcements]);

  // Drives --fx-angle/--fx-mix on the section for the logo glow + arch glow.
  useHeroScrollFX(sectionRef, reduced);

  // Sizes the arch so it actually encloses the rosette wheel down through
  // the announcement cards, measured from the real rendered layout rather
  // than guessed percentages.
  // Padding bumped up a bit (38 → 56) to give the arch some extra
  // breathing room around what it encloses, now that the logo sits higher
  // up inside it.
  const archBox = useEnclosingBox(sectionRef, rosetteWrapRef, announceRef, archWidthRefs, 56);

  // Fluid-reveal entrance — logo mark scales/fades in, then
  // kicker/headline/subtitle/CTA. Fires once the curtain hands off (or
  // immediately, statically, for reduced-motion visitors) — same gating
  // as before.
  useEffect(() => {
    const stage = stageRef.current;
    // .hero-logo-mark now lives outside stageRef (it's absolutely
    // positioned against the section so it can be pinned to the rosary
    // wheel's center) — so queries for it are scoped to the whole section.
    const section = sectionRef.current;
    if (!stage || !section) return;
    if (reduced) {
      utils.set(section.querySelectorAll(
        ".hero-ann-head,.hero-ann-cards,.hero-logo-mark"
      ), { opacity: 1, translateY: 0, scale: 1, filter: "blur(0px)" });
      return;
    }
    if (!curtainDone) return;

    const tl = createTimeline({ defaults: { ease: "outExpo" } });
    tl.add(section.querySelector(".hero-logo-mark"), {
        opacity: [0, 1], scale: [0.85, 1], duration: 950, ease: "outExpo",
      }, 0)
      .add(stage.querySelector(".hero-ann-head"), {
        opacity: [0, 1], translateY: [24, 0], filter: ["blur(6px)", "blur(0px)"], duration: 650,
      }, "-=250")
      .add(stage.querySelector(".hero-ann-cards"), {
        opacity: [0, 1], translateY: [22, 0], duration: 600,
      }, "-=200");

    return () => tl?.revert?.();
  }, [curtainDone, reduced]);

  // Bold ambient light — bigger, more saturated blooms drifting behind the
  // hero, still slow, still nothing that snaps.
  useEffect(() => {
    if (reduced) return;
    const a = animate(glowARef.current, {
      translateX: [0, 56, 0], translateY: [0, 36, 0], duration: 13000, loop: true, ease: "inOutSine",
    });
    const b = animate(glowBRef.current, {
      translateX: [0, -46, 0], translateY: [0, 28, 0], duration: 16000, loop: true, ease: "inOutSine", delay: 1200,
    });
    return () => { a?.revert?.(); b?.revert?.(); };
  }, [reduced]);

  return (
    <>
      {/* ── Scroll-driven cherry-blossom hero ──────────────────────────────
          Apple-style: a pinned canvas scrubs a 270-frame bloom sequence as
          the visitor scrolls, then hands off to the branded home hero below.
          Collapses to a single static poster under reduced-motion. */}
      <CanvasHeroSequence reduced={reduced} overlayRef={heroOverlayRef}>
        <div ref={heroOverlayRef} style={{ textAlign: "center", maxWidth: 820,
          // The fade/translate is written straight to this node by
          // CanvasHeroSequence as you scroll (no React re-render per tick).
          opacity: 1,
          transform: "none",
          transition: "opacity 120ms linear",
          pointerEvents: "none" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8,
            padding: "7px 16px", borderRadius: 999, background: "rgba(201,182,136,.18)",
            border: "1px solid rgba(201,182,136,.45)", marginBottom: 22 }}>
            <PetalIcon size={15} color={GOLD} />
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: ".6px",
              textTransform: "uppercase", color: "rgba(255,255,255,.85)" }}>
              {data.hero.kicker ?? seed.hero.kicker}
            </span>
          </div>
          {/* Shiny sweep on the main headline too, not just the eyebrow
              labels — white base so it still reads bright at rest, with
              the same purple highlight passing through it on a loop.
              Falls back to plain white for reduced-motion visitors. */}
          <h1 className={reduced ? "" : "shiny-text"}
            style={{ margin: 0, color: reduced ? "#fff" : undefined, fontWeight: 800,
            fontSize: "clamp(34px,6vw,68px)", lineHeight: 1.05,
            "--shiny-base": "#fff",
            filter: "drop-shadow(0 2px 30px rgba(0,0,0,.4))" }}>
            {data.hero.title ?? seed.hero.title}
          </h1>
          <p style={{ marginTop: 20, color: "rgba(255,255,255,.86)",
            fontSize: "clamp(15px,2vw,20px)", lineHeight: 1.6, maxWidth: 620,
            marginLeft: "auto", marginRight: "auto" }}>
            {data.hero.mission}
          </p>
          {!reduced && (
            <div data-hero-hint style={{ marginTop: 34, opacity: 1,
              fontSize: 12.5, letterSpacing: "1.5px", textTransform: "uppercase",
              color: "rgba(255,255,255,.6)" }}>
              Scroll to watch it bloom
            </div>
          )}
        </div>
      </CanvasHeroSequence>

      <section id="home" ref={sectionRef} className="grain vignette" style={{ position: "relative", overflow: "hidden",
        background: GRAD_DEEP,
        color: "#fff", padding: "104px 20px 0" }}>
        <AmbientGlow />
        <PatternField />
        {/* bold gold + violet light blooms — bigger and more saturated than
            a purely "subtle" ambient layer, still drifting almost imperceptibly */}
        <div aria-hidden="true" ref={glowARef} style={{ position: "absolute", top: "4%", left: "8%",
          width: 540, height: 540, borderRadius: "50%", filter: "blur(100px)", pointerEvents: "none", zIndex: 0,
          background: `radial-gradient(circle, rgba(201,182,136,.4) 0%, transparent 70%)` }} />
        <div aria-hidden="true" ref={glowBRef} style={{ position: "absolute", bottom: "0%", right: "4%",
          width: 480, height: 480, borderRadius: "50%", filter: "blur(90px)", pointerEvents: "none", zIndex: 0,
          background: `radial-gradient(circle, rgba(140,120,180,.42) 0%, transparent 70%)` }} />
        <HangingLanterns />
        {/* large rosary-wheel medallion — spins as the page scrolls, tilts
            slightly in 3D toward the cursor, centered directly behind the
            logo/arch. Wrapped in a plain measured div (rosetteWrapRef) so
            HeroArch below can size itself to actually enclose it.
            The wheel used to be a flat 560px regardless of viewport — on
            phones (much narrower than 560px) the section's overflow:hidden
            clipped its left/right edges into two straight vertical lines,
            so what should read as a circle came across as a squared-off
            shape. Sizing it with clamp() instead keeps it a true circle at
            every width, just a smaller one on small screens — and as a
            bonus, the arch below (which measures this wrapper's real
            width) now hugs it correctly on mobile too instead of sizing
            itself for the old fixed 560px. */}
        {/* top uses max(140px, 5%) instead of a bare 5% — on a shorter
            section (fewer announcements) 5% alone could land at well
            under 56px (the padding useEnclosingBox pads the arch's box
            by), pushing the arch's measured top negative and clipping its
            peak against this section's own overflow:hidden edge, and
            visually reading as if it bled into the cherry-blossom hero
            above. The 140px floor guarantees real breathing room under
            the sticky nav no matter how short the section is. */}
        <div ref={rosetteWrapRef} style={{ position: "absolute", top: "max(140px, 5%)", left: "50%",
          width: "clamp(230px, 52vw, 560px)", height: "clamp(230px, 52vw, 560px)",
          marginLeft: "calc(clamp(230px, 52vw, 560px) / -2)",
          pointerEvents: "none", zIndex: 0 }}>
          <TiltWrap max={9}>
            <ScrollSpin speed={14}>
              <Rosette points={16} skip={7} color={GOLD}
                opacity={0.15} strokeWidth={1}
                style={{ width: "clamp(230px, 52vw, 560px)", height: "clamp(230px, 52vw, 560px)" }} />
            </ScrollSpin>
          </TiltWrap>
        </div>
        {/* central mihrab arch silhouette — strokes draw themselves in,
            framing the logo, sized to enclose the rosette + CTA buttons */}
        <HeroArch box={archBox} />

        {/* ── Logo mark — pulled out of normal flow and pinned above the
            rosary wheel's own center (rosette center is top:5% + half its
            560px size = 5%+280px; the logo sits higher than that, at
            5%+152px, so it reads as tucked up near the top of the arch's
            opening rather than dead-center on the wheel — while still
            leaving a comfortable gap from the arch's peak itself).
            A radiating neon purple/gold glow sits behind it, its angle
            driven by useHeroScrollFX (see --fx-angle/--fx-mix on the
            section), so the light visibly shifts position as you scroll —
            like catching the mark at a different angle.
            NOTE: the centering transform and the entrance scale/opacity
            animation (added to .hero-logo-mark by anime.js below) must live
            on separate elements — same reason as TiltWrap — otherwise the
            animation's own `transform` write would knock the mark off its
            centered position. ── */}
        <div style={{ position: "absolute", left: "50%", top: "calc(max(140px, 5%) + 152px)",
          transform: "translate(-50%, -50%)", zIndex: 2, pointerEvents: "none" }}>
          <div className="hero-logo-mark" style={{
            position: "relative", opacity: 0,
            width: "clamp(230px, 34vw, 340px)", height: "clamp(230px, 34vw, 340px)",
            display: "grid", placeItems: "center",
          }}>
            {/* glow layer — a blurred conic gradient rotating with scroll,
                so purple/gold trade places around the mark as you scroll.
                Skipped entirely when the "Rosary glow" display setting is
                off (Nav's settings menu / MotionPrefsContext). */}
            {/* glow layer — a soft CIRCULAR radial glow emanating from the
                logo. Uses a radial-gradient that fades to transparent at the
                edge, so it reads as a round halo (no square corners the old
                blurred conic-gradient produced). The color shifts between
                neon purple/gold with scroll via --fx-mix. Skipped entirely
                when the "Rosary glow" display setting is off. */}
            {!glowOff && (
              <>
                <div aria-hidden="true" style={{
                  position: "absolute", inset: "-28%", borderRadius: "50%",
                  background: `radial-gradient(circle at center, color-mix(in srgb, ${NEON_PURPLE} calc((1 - var(--fx-mix, .5)) * 100%), ${NEON_GOLD} calc(var(--fx-mix, .5) * 100%)) 0%, transparent 62%)`,
                  filter: "blur(30px)", opacity: 0.7, mixBlendMode: "screen",
                }} />
                <div aria-hidden="true" style={{
                  position: "absolute", inset: "-8%", borderRadius: "50%",
                  background: `radial-gradient(circle at center, color-mix(in srgb, ${NEON_GOLD} calc((1 - var(--fx-mix, .5)) * 100%), ${NEON_PURPLE} calc(var(--fx-mix, .5) * 100%)) 0%, transparent 58%)`,
                  filter: "blur(18px)", opacity: 0.5, mixBlendMode: "screen",
                }} />
              </>
            )}
            <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="MSA at UW logo"
              decoding="async"
              style={{ position: "relative", width: "82%", height: "82%", objectFit: "contain",
                filter: glowOff
                  ? "drop-shadow(0 8px 26px rgba(0,0,0,.4))"
                  : `drop-shadow(0 8px 26px rgba(0,0,0,.4)) drop-shadow(0 0 22px color-mix(in srgb, ${NEON_PURPLE} calc((1 - var(--fx-mix, .5)) * 100%), ${NEON_GOLD} calc(var(--fx-mix, .5) * 100%)))` }} />
          </div>
        </div>

        <div ref={stageRef} style={{ maxWidth: 960, margin: "0 auto", position: "relative", zIndex: 2,
          textAlign: "center", paddingBottom: 24 }}>

          {/* Spacer — the logo above is absolutely positioned (so it can be
              pinned to the rosary wheel's center), so this holds open the
              vertical space it used to occupy in normal flow, keeping the
              kicker/headline below from jumping up. */}
          <div aria-hidden="true" style={{ height: "clamp(300px, 38vw, 400px)" }} />

          {/* ── This used to be the headline/subtitle/CTA. Per the plan
              (arch + spinning rosary backdrop becomes the announcements
              section, standalone Announcements section below removed): the
              backdrop — glow, rosette wheel, arch, logo — stays exactly as
              it was; what sits inside it is now the announcement header +
              cards instead of the old marketing headline. Get Involved /
              Learn More moved down to the New Here section. ── */}
          <div className="hero-ann-head" style={{ opacity: 0 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8,
              padding: "7px 16px", borderRadius: 999, background: "rgba(201,182,136,.18)",
              border: "1px solid rgba(201,182,136,.45)", marginBottom: 18 }}>
              <Star8 size={14} color={GOLD} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1.2px",
                textTransform: "uppercase", color: "rgba(255,255,255,.85)" }}>
                {data.sections?.announcements?.eyebrow ?? seed.sections.announcements.eyebrow}
              </span>
            </div>
            <h1 style={{ margin: "0 0 14px", fontSize: "clamp(34px,5.4vw,58px)", fontWeight: 800,
              lineHeight: 1.05, letterSpacing: "-1.8px" }}>
              {data.sections?.announcements?.title ?? seed.sections.announcements.title}
            </h1>
            {(data.sections?.announcements?.body ?? seed.sections.announcements.body) && (
              <p style={{ maxWidth: 560, margin: "0 auto", color: "rgba(255,255,255,.8)",
                fontSize: "clamp(15px,1.8vw,17px)", lineHeight: 1.65 }}>
                {data.sections?.announcements?.body ?? seed.sections.announcements.body}
              </p>
            )}
          </div>

          {/* When there's nothing to show, this renders empty (zero height)
              rather than a placeholder card — a dark, semi-transparent
              "nothing new" box sitting on the already-dark hero backdrop
              read as a stray black box, and it was the whole reason for
              extra empty space here when no announcements were set. The
              ref stays on the wrapper either way so the arch above still
              has something to measure and size itself against. */}
          <div ref={announceRef} className="hero-ann-cards"
            style={{ opacity: 0, marginTop: sortedAnnouncements.length ? 32 : 0, textAlign: "left" }}>
            {sortedAnnouncements.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
                gap: 14 }}>
                {sortedAnnouncements.map((a) => {
                  const kind = ANN_KINDS[a.kind] || ANN_KINDS.notice;
                  const Wrapper = a.href ? "a" : "div";
                  const wrapProps = a.href
                    ? { href: safeHref(a.href), target: "_blank", rel: "noopener noreferrer" } : {};
                  return (
                    <Wrapper key={a.id} {...wrapProps} className="lift" style={{
                      display: "block", padding: 0, overflow: "hidden", height: "100%",
                      textDecoration: "none", position: "relative", borderRadius: 16,
                      background: "rgba(255,255,255,.06)", border: "1px solid rgba(201,182,136,.28)" }}>
                      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0,
                        bottom: 0, width: 4, background: kind.color }} />
                      <div style={{ padding: "18px 20px 18px 24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                          flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.2px",
                            textTransform: "uppercase", color: kind.color }}>{kind.label}</span>
                          {a.pinned && (
                            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".6px",
                              textTransform: "uppercase", color: "rgba(255,255,255,.6)",
                              border: "1px solid rgba(255,255,255,.25)", borderRadius: 99,
                              padding: "2px 8px" }}>Pinned</span>
                          )}
                          {a.date && (
                            <span style={{ marginLeft: "auto", fontSize: 12.5,
                              color: "rgba(255,255,255,.55)" }}>{a.date}</span>
                          )}
                        </div>
                        <h3 style={{ margin: "0 0 6px", fontSize: 16.5, fontWeight: 700,
                          color: "#fff" }}>{a.title}</h3>
                        {a.body && (
                          <div style={{ color: "rgba(255,255,255,.75)", fontSize: 14, lineHeight: 1.55 }}>
                            <Markdown text={a.body} style={{ margin: "0 0 6px" }} />
                          </div>
                        )}
                        {a.href && (
                          <div style={{ marginTop: 8, color: GOLD, fontSize: 12.5,
                            fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                            Read more <ExternalLink size={12} />
                          </div>
                        )}
                      </div>
                    </Wrapper>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Home quick-actions: a prominent Donate call-to-action plus a fast
            jump to prayer times. Sits right under the announcements, above
            the scroll cue. */}
        <div style={{ position: "relative", zIndex: 2, maxWidth: 720, margin: "8px auto 0",
          display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center" }}>
          <button onClick={() => onNav("/about#donate")} className="lift"
            style={{ display: "inline-flex", alignItems: "center", gap: 9,
              padding: "14px 26px", borderRadius: 14, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 15.5, fontWeight: 800, color: "#2c2418",
              background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)`,
              boxShadow: "0 10px 30px rgba(201,182,136,.4)" }}>
            <Heart size={17} /> Donate to MSA UW
          </button>
          <button onClick={() => onNav("/prayer")} className="lift"
            style={{ display: "inline-flex", alignItems: "center", gap: 9,
              padding: "14px 24px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
              fontSize: 15, fontWeight: 700, color: "#fff",
              background: "rgba(255,255,255,.10)", border: "1px solid rgba(255,255,255,.28)" }}>
            <Clock size={16} /> Prayer times
          </button>
        </div>
        {/* Small hint: where to change site settings. */}
        <div style={{ position: "relative", zIndex: 2, textAlign: "center", marginTop: 14,
          fontSize: 12.5, color: "rgba(255,255,255,.55)", lineHeight: 1.5, padding: "0 20px" }}>
          Petals, animations, and light/dark mode can be changed in{" "}
          <span style={{ color: "rgba(255,255,255,.8)", fontWeight: 600 }}>Settings</span>{" "}
          (the ⚙ icon in the top bar).
        </div>

        <ScrollCue onClick={() => onNav("moments")} />
        {/* girih band along the base of the hero — marginTop gives it
            extra clearance so it doesn't visually collide with the arch's
            base line. The arch is absolutely positioned (it doesn't push
            this flow content down on its own) and extends `padding` (56px)
            below the announcement cards, while the cards' wrapper only has
            24px of paddingBottom — without this gap the arch's bottom edge
            ran a good ~30px into the band below it. */}
        <div style={{ position: "relative", marginTop: 56 }}>
          <GirihBand color="rgba(183,165,122,.45)" height={54} opacity={1} unit={54} />
        </div>
        <style>{`
          @keyframes msaWindowFlicker {
            0%, 100% { opacity: .35; } 45% { opacity: 1; } 52% { opacity: .5; } 60% { opacity: .95; }
          }
        `}</style>
      </section>
    </>
  );
}

/* ── Moments from the year — the highlight carousel, now its own section
   so it can sit on the Home page directly under the hero/new-here. */
function MomentsSection({ data }) {
  return (
    <Band id="moments" lattice decor="left" rosettes="left" light lightTone="violet" lightAt="top-left" floats={<>
      <Parallax speed={.12} float style={{ top: 20, right: "8%" }}>
        <Star8 size={64} color="var(--rosette)" opacity={.10} /></Parallax>
      <Parallax speed={-.08} float style={{ bottom: 40, left: "4%" }}>
        <Star8 size={38} color={GOLD} opacity={.16} /></Parallax>
    </>}>
      <SectionCopy data={data} sectionKey="gallery" />
      <Gallery items={data.gallery} />
    </Band>
  );
}

/* ---------- SPONSORS ---------- */
function SponsorsSection({ data }) {
  return (
    <Band id="sponsors" alt lattice rosettes="wide" light lightTone="violet" lightAt="bottom-left">
      <SectionCopy data={data} sectionKey="sponsors" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))",
        gap: 16, marginTop: 8 }}>
        {(data.sponsors || []).map((s, n) => {
          const inner = s.logo ? (
            <img src={s.logo} alt={s.name} className="sponsorlogo"
              style={{ maxHeight: 60, maxWidth: "100%", objectFit: "contain" }} />
          ) : (
            <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 15 }}>{s.name}</span>
          );
          const boxStyle = { ...card, display: "grid", placeItems: "center",
            height: 96, textAlign: "center", padding: 16, textDecoration: "none" };
          return (
            <Reveal key={s.id} delay={n * 70} variant="scale" distance={22} duration={DUR.slow}>
              {s.url ? (
                <a href={safeHref(s.url)} target="_blank" rel="noopener noreferrer"
                  className="lift" style={boxStyle} title={`Visit ${s.name}`}>{inner}</a>
              ) : (
                <div className="lift" style={boxStyle}>{inner}</div>
              )}
            </Reveal>
          );
        })}
      </div>
      <Reveal variant="rise" distance={26} delay={140}>
        <div style={{ marginTop: 30, textAlign: "center" }}>
          <a className="btn" href={(data.donate || seed.donate).msaUrl}
            target="_blank" rel="noopener noreferrer"
            style={{ ...btnPurple, textDecoration: "none", display: "inline-flex",
              alignItems: "center", gap: 8 }}>
            <Heart size={15} /> Become a sponsor
          </a>
        </div>
      </Reveal>
    </Band>
  );
}

/* Lanterns strung across the top of the hero. Each hangs from its own cord,
   swings on its own cycle, and glows softly — staggered so they never move
   in unison. Hidden for reduced-motion users. */
function HangingLanterns() {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (reduced) { setLit(true); return; }
    const t = setTimeout(() => setLit(true), 500);
    return () => clearTimeout(t);
  }, [reduced]);

  // left %, drop length, scale, swing duration, phase offset
  const lamps = [
    { left: 8,  drop: 34, size: 52, dur: 6.4, delay: -0.9 },
    { left: 21, drop: 74, size: 40, dur: 7.8, delay: -2.6 },
    { left: 34, drop: 20, size: 34, dur: 5.6, delay: -1.7 },
    { left: 68, drop: 26, size: 36, dur: 7.1, delay: -0.3 },
    { left: 80, drop: 66, size: 46, dur: 6.0, delay: -3.4 },
    { left: 92, drop: 30, size: 38, dur: 8.2, delay: -1.2 },
  ];

  return (
    <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, right: 0,
      height: "56%", overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
      {lamps.map((l, i) => (
        <div key={i} style={{
          position: "absolute", left: `${l.left}%`, top: 0,
          transformOrigin: "50% 0%",
          opacity: lit ? 1 : 0,
          transform: lit ? "none" : "translate3d(0,-24px,0)",
          transition: reduced ? "none"
            : `opacity ${DUR.slow}ms ${EASE.outSoft} ${240 + i * 110}ms, transform ${DUR.slow}ms ${EASE.outSoft} ${240 + i * 110}ms`,
        }}>
          {/* swing wrapper — separate element so the entrance transform above
              is never clobbered by the animation */}
          <div className={reduced ? "" : "swing"} style={{
            transformOrigin: "50% 0%",
            animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s`,
          }}>
            {/* cord */}
            <div style={{ width: 1, height: l.drop, margin: "0 auto",
              background: "linear-gradient(rgba(201,182,136,.55), rgba(201,182,136,.28))" }} />
            <div style={{ position: "relative" }}>
              {/* glow behind the lamp */}
              <div className={reduced ? "" : "lampglow"} style={{
                position: "absolute", left: "50%", top: "42%",
                width: l.size * 2.4, height: l.size * 2.4,
                transform: "translate(-50%,-50%)", borderRadius: "50%",
                background: `radial-gradient(circle, rgba(201,182,136,.30) 0%, transparent 66%)`,
                filter: "blur(12px)", animationDelay: `${l.delay}s`,
              }} />
              <Lantern size={l.size} color={GOLD} opacity={0.62}
                style={{ position: "relative", margin: "0 auto" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tasbih({ height = 190, opacity = 0.5, color = GOLD, style }) {
  const reduced = useReducedMotion();
  const BEADS = 21;
  // Beads sit on a narrow teardrop loop.
  const pts = React.useMemo(() => {
    const out = [];
    for (let i = 0; i < BEADS; i++) {
      const t = (i / BEADS) * Math.PI * 2;
      out.push({
        x: +(Math.sin(t) * 26).toFixed(2),
        y: +(56 + Math.cos(t) * 40).toFixed(2),
        r: i % 7 === 0 ? 4.4 : 3.3,   // marker beads every 7th
      });
    }
    return out;
  }, []);
  return (
    <svg width={height * 0.62} height={height} viewBox="0 0 80 130" aria-hidden="true"
      style={{ display: "block", opacity, overflow: "visible", ...style }}>
      <g className={reduced ? "" : "tasbihswing"} style={{ transformOrigin: "40px 6px" }}>
        {/* hanging cord */}
        <line x1="40" y1="0" x2="40" y2="16" stroke={color} strokeWidth="1" opacity=".8" />
        {/* imam bead + tassel */}
        <ellipse cx="40" cy="20" rx="4" ry="5.4" fill={color} opacity=".9" />
        <g transform="translate(40,0)">
          {pts.map((p, i) => (
            <circle key={i} cx={40 + p.x - 40 + p.x * 0} cy={p.y} r={p.r}
              fill={color} opacity={i % 7 === 0 ? 0.95 : 0.7}
              transform={`translate(${p.x},0)`} />
          ))}
        </g>
        {/* tassel */}
        <line x1="40" y1="112" x2="40" y2="124" stroke={color} strokeWidth="1" opacity=".7" />
        <path d="M36 124 L44 124 L42 130 L38 130 Z" fill={color} opacity=".7" />
        {/* travelling highlight — one bead lighting up as it moves round */}
        {!reduced && (
          <circle r="4.6" fill="#fff" opacity=".85">
            <animateMotion dur="9s" repeatCount="indefinite"
              path="M0,16 C26,16 26,96 0,96 C-26,96 -26,16 0,16 Z"
              transform="translate(40,0)" />
            <animate attributeName="opacity" values="0;.85;.85;0"
              dur="9s" repeatCount="indefinite" />
          </circle>
        )}
      </g>
    </svg>
  );
}

/* Mihrab arch whose outline draws itself, then breathes gently. */
function HeroArch({ box }) {
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (reduced) { setDrawn(true); return; }
    const t = setTimeout(() => setDrawn(true), 120);
    return () => clearTimeout(t);
  }, [reduced]);

  // Fixed proportions for the curve shape itself — only the CONTAINER
  // (below) is resized to actually fit the rosette + CTA buttons; the
  // viewBox stays the same so the mihrab silhouette doesn't distort.
  const W = 220, H = 300, SPRING = 168;
  const { ticks, stars } = React.useMemo(() => archOrnamentGeometry(W, H, SPRING, 6, 9), []);

  // NOTE: the centering translate and the float animation must live on
  // separate elements — a CSS animation that sets `transform` would otherwise
  // overwrite `translateX(-50%)` and knock the arch off-centre.
  const outer = box
    ? { position: "absolute", top: box.top, left: "50%", transform: "translateX(-50%)",
        width: Math.max(box.width, 320), height: box.height, opacity: 0.55, pointerEvents: "none" }
    : { position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)",
        width: "min(720px, 92%)", height: "90%", opacity: 0.55, pointerEvents: "none" };

  const glowFilter = reduced ? "none"
    : `drop-shadow(0 0 7px color-mix(in srgb, ${NEON_PURPLE} calc((1 - var(--fx-mix, .5)) * 100%), ${NEON_GOLD} calc(var(--fx-mix, .5) * 100%)))`;

  return (
    <div aria-hidden="true" style={outer}>
      <div className={reduced ? "" : "floaty-slow"} style={{ width: "100%", height: "100%" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          {/* outer mihrab outline — self-draws in, then carries the
              scroll-reactive purple/gold glow (--fx-mix, set by
              useHeroScrollFX on the section) */}
          <path d={archPath(W, H, SPRING)} fill="none" stroke="rgba(201,182,136,.55)"
            strokeWidth="1.4" pathLength="1"
            style={{
              strokeDasharray: 1,
              strokeDashoffset: drawn ? 0 : 1,
              transition: reduced ? "none" : `stroke-dashoffset 2600ms ${EASE.outSoft} 200ms`,
              filter: glowFilter,
            }} />

          {/* The smaller inset concentric frame that used to sit here (a
              continuously scroll-rotated <g>, independent of the outer
              arch outline above) was removed — it read as an unnecessary
              extra moving piece next to the rosette wheel already spinning
              behind it, and cost a per-frame transform recalculation for
              not much visual payoff. The outer arch outline, voussoir fan,
              and star accents below are untouched. */}

          {/* voussoir fan — short radiating ticks along the curve, like
              wedge-stone joints on a real mihrab */}
          <g stroke="rgba(201,182,136,.45)" strokeWidth="1"
            style={{ opacity: drawn ? 1 : 0, transition: reduced ? "none" : `opacity 900ms ${EASE.outSoft} 1500ms` }}>
            {ticks.map((t, i) => <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />)}
          </g>

          {/* 8-point star accents at the shoulders + apex — the site's
              signature motif, worked into the arch itself */}
          <g fill={GOLD} style={{ opacity: drawn ? 0.6 : 0, transition: reduced ? "none" : `opacity 900ms ${EASE.outSoft} 1700ms` }}>
            {stars.map((s, i) => <polygon key={i} points={s} />)}
          </g>
        </svg>
      </div>
    </div>
  );
}

/* Two very slow, very soft colour blooms behind the hero. Pure transform
   animation on blurred radial gradients — cheap and adds real depth. */
function AmbientGlow({ subtle = false }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  const k = subtle ? 0.45 : 1;
  const blob = (color, size) => ({
    position: "absolute", width: size, height: size, borderRadius: "50%",
    background: `radial-gradient(circle, ${color} 0%, transparent 68%)`,
    filter: `blur(${subtle ? 60 : 48}px)`, pointerEvents: "none",
  });
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", zIndex: 0 }}>
      <div className="glow" style={{ ...blob(`rgba(140,120,180,${.42 * k})`, subtle ? 520 : 620),
        top: "-18%", left: "-12%" }} />
      <div className="glow" style={{ ...blob(`rgba(180,120,140,${.34 * k})`, subtle ? 440 : 520),
        bottom: "-16%", right: "-10%", animationDelay: "-11s", animationDuration: "27s" }} />
    </div>
  );
}

/* A quiet nudge to scroll. Fades in last, drifts, hides once you move. */
function ScrollCue({ onClick }) {
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const f = () => setHidden(window.scrollY > 80);
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <button onClick={onClick} aria-label="Scroll to content"
      style={{
        position: "absolute", left: "50%", bottom: 74, zIndex: 3,
        transform: "translateX(-50%)", background: "none", border: "none",
        cursor: "pointer", padding: 10,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: `opacity ${DUR.base}ms ${EASE.out} ${hidden ? 0 : 1500}ms`,
      }}>
      <span className={reduced ? "" : "floaty"} style={{ display: "block" }}>
        <svg width="26" height="38" viewBox="0 0 26 38" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="24" height="36" rx="12"
            stroke="rgba(201,182,136,.55)" strokeWidth="1.4" />
          <circle cx="13" cy="11" r="3" fill={GOLD}>
            {!reduced && <animate attributeName="cy" values="11;22;11" dur="2.4s" repeatCount="indefinite" />}
          </circle>
        </svg>
      </span>
    </button>
  );
}

function PatternField() {
  const stars = [];
  const spots = [[6, 18], [16, 68], [30, 30], [50, 82], [72, 22], [86, 60], [92, 12], [40, 55], [64, 74]];
  spots.forEach(([l, t], i) => stars.push(
    <div key={i} style={{ position: "absolute", left: `${l}%`, top: `${t}%`,
      animation: `spin ${26 + i * 4}s linear infinite` }}>
      <Star8 size={30 + (i % 3) * 22} color="#fff" opacity={0.05 + (i % 3) * 0.02} />
    </div>
  ));
  return <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{stars}</div>;
}

/* ── Gallery / "Moments from the year" ────────────────────────────────────
   A round, scroll-driven 3D photo carousel — each photo its own rectangular
   "subsection" arranged evenly around a ring, in the spirit of the circular
   carousels at inkwell.tech / the Codrops "Scroll-Driven Circular 3D
   Carousel" piece. Scrolling through the pinned section spins the ring
   (smoothed with a lerp toward the scroll-driven target angle, giving it
   weight/momentum instead of snapping 1:1 to scroll), the cursor tilts the
   whole assembly slightly toward it, cards dim/brighten by how far around
   the ring they currently sit (front = brightest, and — a free side effect
   of real perspective — biggest, since translateZ pushes the front card
   toward the camera), and the caption of whichever photo is currently
   front-and-center is called out below. Small arrow buttons flank the ring
   so it can be stepped one photo at a time by hand, independent of scroll.

   Built with plain CSS 3D (perspective + rotateY/translateZ), not
   WebGL/Three.js like the reference — this site has zero 3D-engine
   dependency today and mobile performance was a real pain point earlier in
   this project, so the carousel *language* (ring of photos, real depth,
   momentum-driven spin, cursor reactivity) is reproduced without pulling in
   a renderer. The one thing intentionally left out is the reference's
   WebGL-only post-processing (chromatic aberration / shader distortion) and
   raycasted hover — everything else about "a round carousel that spins as
   you scroll" is here. */
function Gallery({ items }) {
  const reduced = useReducedMotion();
  // Only used for the "Turn on animations" escape hatch in the
  // reduced-motion fallback below — lets someone who flipped the site's
  // own Settings > Reduce motion toggle (it persists in localStorage, so
  // it's easy to forget it's on) get the coverflow back with one click,
  // without touching anyone whose *OS* has reduced motion turned on.
  const { motionOff, setMotionOff } = useMotionPrefs();
  const list = (items?.length ? items : []).filter(Boolean);
  const n = list.length;

  const grad = (i) => {
    const g = [
      `linear-gradient(135deg,${PURPLE},${VIOLET})`, `linear-gradient(135deg,${MAUVE},${PINK})`,
      `linear-gradient(135deg,${PURPLE_D},${PURPLE})`, `linear-gradient(135deg,${VIOLET},${MAUVE})`,
      `linear-gradient(135deg,${INK},${PURPLE})`, `linear-gradient(135deg,${PINK},${PURPLE})`,
    ];
    return g[i % g.length];
  };

  // No photos added yet — a small, compact note instead of rendering
  // nothing (which just left the section looking like a mostly-empty
  // title with a lot of unexplained space under it).
  if (n === 0) {
    return (
      <div style={{ padding: "22px 20px", borderRadius: 16, textAlign: "center",
        background: "var(--tint)", border: "1px dashed var(--border-strong)",
        color: "var(--text-faint)", fontSize: 14 }}>
        Photos coming soon — add some from the admin panel.
      </div>
    );
  }

  // Reduced-motion fallback: a plain static grid of rectangular photos,
  // fully visible immediately, no 3D coverflow at all.
  if (reduced) {
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: "clamp(14px,2.6vw,26px)" }}>
          {list.map((it, i) => (
            <div key={it.id ?? i} style={{ borderRadius: 16,
              overflow: "hidden", aspectRatio: "4 / 3", boxShadow: "0 8px 24px rgba(0,0,0,.28)" }}>
              {it.img
                ? <img src={it.img} alt={it.caption || ""} loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                : <div style={{ width: "100%", height: "100%", background: grad(i) }} />}
            </div>
          ))}
        </div>
        {/* Only shown when THIS SITE'S OWN "Reduce motion" toggle (Settings
            menu) is what's causing the grid — never for a visitor whose OS
            has reduced motion turned on, since that's an accessibility
            choice this site shouldn't second-guess. The in-site toggle is
            easy to flip on while poking around Settings and then forget
            about, since it persists in localStorage indefinitely. */}
        {motionOff && (
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <button onClick={() => setMotionOff(false)} className="btn"
              style={{ display: "inline-flex", alignItems: "center", gap: 7,
                padding: "10px 18px", borderRadius: 999, border: "1px solid var(--border-strong)",
                background: "var(--surface)", color: "var(--accent)", fontWeight: 700,
                fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>
              <Sparkles size={14} /> Reduce motion is on for this site — turn it off to see the photo carousel
            </button>
          </div>
        )}
      </div>
    );
  }

  return <Coverflow list={list} n={n} grad={grad} />;
}

/* ── Coverflow gallery ─────────────────────────────────────────────────
   Recreated after Originkit's Coverflow Gallery
   (https://www.originkit.dev/components/coverflowgallery): the active
   photo sits upright and in front, flanked by neighbours that tilt back
   in 3D perspective and dim with distance. Click a side photo to bring
   it to center; click the centered photo to pop it out into a full
   zoom view with its caption (PhotoLightbox — same viewer the Islamic
   House photos use, arrows/swipe/keyboard included).
   Unlike the old ring carousel this replaces, position is driven purely
   by clicks/arrows/swipe/keyboard rather than scroll position, so there's
   no pinned-scroll-runway section to size — just a fixed-height stage
   that sits in normal document flow. */
function Coverflow({ list, n, grad }) {
  const [active, setActive] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(null);
  const [cardW, setCardW] = useState(260);
  const sceneRef = useRef(null);
  const reduced = useReducedMotion();
  const lockRef = useRef(false);

  // Card width follows the scene's own measured width — fewer photos get
  // bigger cards, more photos shrink so neighbours stay on-screen instead
  // of overflowing off the edges.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const measure = () => {
      const w = scene.clientWidth || 1;
      const base = n <= 4 ? 0.5 : n <= 8 ? 0.4 : 0.32;
      setCardW(Math.max(150, Math.min(420, w * base)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scene);
    return () => ro.disconnect();
  }, [n]);

  // Briefly locks input after a move so rapid clicks/keys/swipes don't
  // stack up and look jittery — same guard the reference component uses.
  const MOVE_MS = 520;
  const lock = () => { lockRef.current = true; setTimeout(() => { lockRef.current = false; }, MOVE_MS); };
  const step = (dir) => {
    if (lockRef.current) return;
    lock();
    setActive((a) => ((a + dir) % n + n) % n);
  };
  const onCardClick = (i) => {
    if (i === active) { setZoomIdx(active); return; }
    if (lockRef.current) return;
    lock();
    setActive(i);
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setZoomIdx(active); }
  };
  useSwipe(sceneRef, { onLeft: () => step(1), onRight: () => step(-1), enabled: n > 1 });

  const cardH = cardW * 0.75; // 4:3, matches every other photo card on the site
  const SCALE_STEP = 0.16, MAX_VISIBLE = 2, DEPTH = cardW * 0.62, TILT = 10, SIDE_TILT = 6;
  const spacing = cardW * 0.72;
  const stageHeight = cardH * 1.5;

  return (
    <div>
      <div ref={sceneRef} tabIndex={0} role="group" aria-roledescription="carousel"
        aria-label="Moments from the year — photo coverflow"
        onKeyDown={onKeyDown}
        style={{ position: "relative", width: "100%", height: stageHeight,
          display: "flex", alignItems: "center", justifyContent: "center",
          perspective: 1400, outline: "none", touchAction: "pan-y" }}>
        <div style={{ position: "relative", width: cardW, height: cardH, transformStyle: "preserve-3d" }}>
          {list.map((it, i) => {
            let rel = i - active;
            if (rel > n / 2) rel -= n;
            if (rel < -n / 2) rel += n;
            const ax = Math.abs(rel);
            const visible = ax <= MAX_VISIBLE;
            const isActive = rel === 0;
            const scale = Math.max(0.4, 1 - ax * SCALE_STEP);
            const tx = rel * spacing;
            const tz = -ax * DEPTH;
            const ry = -rel * TILT;
            const rz = rel * SIDE_TILT;
            const dim = isActive ? 0 : Math.min(0.6, 0.2 + ax * 0.2);
            return (
              <div key={it.id ?? i}
                onClick={() => visible && onCardClick(i)}
                aria-label={it.caption || `Photo ${i + 1}`}
                aria-hidden={!visible}
                style={{
                  position: "absolute", left: 0, top: 0, width: cardW, height: cardH,
                  borderRadius: 16, overflow: "hidden", transformStyle: "preserve-3d",
                  boxShadow: "0 14px 34px rgba(0,0,0,.38), 0 0 0 3px rgba(255,255,255,.08) inset",
                  transform: `translate3d(${tx}px,0,${tz}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`,
                  transition: reduced ? "none" : `transform ${MOVE_MS}ms cubic-bezier(.22,1,.36,1), opacity ${MOVE_MS}ms`,
                  opacity: visible ? 1 : 0,
                  cursor: visible ? (isActive ? "zoom-in" : "pointer") : "default",
                  pointerEvents: visible ? "auto" : "none",
                  zIndex: MAX_VISIBLE - ax,
                  background: "#1a1a1a",
                }}>
                {it.img
                  ? <img src={it.img} alt={it.caption || ""} loading="lazy" decoding="async" draggable={false}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                        objectFit: "cover", display: "block", userSelect: "none" }} />
                  : <div style={{ position: "absolute", inset: 0, background: grad(i) }} />}
                {/* dim overlay — same "distance darkens the card" read as the reference */}
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#000",
                  opacity: dim, transition: reduced ? "none" : `opacity ${MOVE_MS}ms`, pointerEvents: "none" }} />
                {isActive && (
                  <>
                    <div aria-hidden="true" style={{ position: "absolute", inset: 0,
                      background: "linear-gradient(0deg, rgba(0,0,0,.55) 0%, transparent 45%)",
                      pointerEvents: "none" }} />
                    <div aria-hidden="true" style={{ position: "absolute", right: 10, top: 10,
                      width: 30, height: 30, borderRadius: "50%", background: "rgba(20,17,24,.55)",
                      border: "1px solid rgba(255,255,255,.3)", display: "grid", placeItems: "center",
                      color: "#fff", pointerEvents: "none" }}>
                      <Camera size={14} />
                    </div>
                    {it.caption && (
                      <div style={{ position: "absolute", left: 12, right: 12, bottom: 10,
                        fontSize: 13, fontWeight: 700, color: "#fff",
                        textShadow: "0 1px 6px rgba(0,0,0,.6)", pointerEvents: "none" }}>
                        {it.caption}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {n > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          gap: 12, marginTop: 18 }}>
          <button className="btn" aria-label="Previous photo" onClick={() => step(-1)}
            style={boardNavBtn}><ChevronLeft size={17} color="var(--accent)" /></button>
          <div style={{ display: "flex", gap: 7 }}>
            {list.map((it, n2) => (
              <button key={it.id ?? n2} onClick={() => !lockRef.current && (lock(), setActive(n2))}
                aria-label={`Go to photo ${n2 + 1}`} aria-current={n2 === active}
                style={{ width: 8, height: 8, borderRadius: 99, border: "none", padding: 0,
                  cursor: "pointer", background: n2 === active ? GOLD : "var(--border-strong)",
                  transition: `background ${DUR.fast}ms ${EASE.out}` }} />
            ))}
          </div>
          <button className="btn" aria-label="Next photo" onClick={() => step(1)}
            style={boardNavBtn}><ChevronRight size={17} color="var(--accent)" /></button>
        </div>
      )}

      <PhotoLightbox photos={list} index={zoomIdx} onClose={() => { setActive(zoomIdx); setZoomIdx(null); }}
        onNav={(dir) => setZoomIdx((i) => { const next = (i + dir + n) % n; setActive(next); return next; })} />
    </div>
  );
}



/* ---------- PRAYER ---------- */
/* Masjidal live prayer-times widget.
   - If `embed` is set, it should be the full markup Masjidal gives you
     (an <iframe...> or <div>+<script>); it's injected as-is.
   - Else if `id` is set, we build Masjidal's standard iframe from the Masjid ID.
   Masjidal recalculates daily on their servers, so nothing here needs updating. */
function MasjidalWidget({ id, embed }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!embed || !ref.current) return;
    // Inject raw embed markup, re-executing any <script> tags it contains.
    ref.current.innerHTML = embed;
    ref.current.querySelectorAll("script").forEach((old) => {
      const s = document.createElement("script");
      [...old.attributes].forEach((a) => s.setAttribute(a.name, a.value));
      s.text = old.textContent;
      old.replaceWith(s);
    });
  }, [embed]);

  if (embed) {
    return <div ref={ref} style={{ padding: "12px 16px" }} />;
  }
  // Masjid ID → Masjidal's daily-timings iframe (served via athanplus.com).
  return (
    <div style={{ padding: "8px 12px" }}>
      <iframe
        title="Masjidal prayer times"
        src={`https://timing.athanplus.com/masjid/widgets/embed?theme=3&masjid_id=${encodeURIComponent(id)}&color=000000`}
        style={{ width: "100%", minHeight: 500, border: "none" }}
        allowTransparency="true"
        loading="lazy"
      />
      <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", padding: "4px 0 8px" }}>
        Prayer times powered by Masjidal
      </div>
    </div>
  );
}

function PrayerSection({ data }) {
  const t = data.prayerTimes;
  return (
    <Band id="prayer" alt lattice rosettes="right" light lightTone="gold" lightAt="bottom-left">
      <SectionCopy data={data} sectionKey="prayer" />
      <Parallax speed={-0.12} style={{ bottom: 60, left: "1%" }}>
        <Tasbih height={170} opacity={0.24} color="var(--rosette)" />
      </Parallax>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24, marginTop: 32,
        alignItems: "start" }} className="prayer-grid">
        <div style={{ display: "grid", gap: 16 }}>
          {(data.prayerSpaces || []).map((s, n) => (
            <Reveal key={s.id} delay={n * 70} variant="left" distance={22}>
            <div className="lift" style={{ ...card, padding: "22px 24px", display: "flex", gap: 16 }}>
              <div style={{ flexShrink: 0, width: 46, height: 56, position: "relative",
                display: "grid", placeItems: "center" }}>
                <div style={{ position: "absolute", inset: 0 }}>
                  <Arch w={46} h={56} spring={34} stroke="none" fill="rgba(75,46,131,.08)"
                    style={{ width: "100%", height: "100%" }} />
                </div>
                <MapPin size={20} color="var(--accent)" style={{ position: "relative", marginTop: 6 }} />
              </div>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>{s.name}</h3>
                <div style={{ color: "var(--text-muted)", fontSize: 14.5, marginBottom: 6 }}>{s.loc}</div>
                <div style={{ color: "var(--text-faint)", fontSize: 13.5 }}>{s.note}</div>
                {s.mapUrl && (
                  <a href={safeHref(s.mapUrl)} target="_blank" rel="noopener noreferrer"
                    style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 12.5, fontWeight: 700, color: "var(--accent)", textDecoration: "none" }}>
                    <MapPin size={12} /> Open in Maps
                  </a>
                )}
              </div>
            </div>
            </Reveal>
          ))}
        </div>

        <Reveal variant="right" distance={26} delay={140} duration={DUR.slow}
          style={{ position: "sticky", top: 90 }}>
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div style={{ background: GRAD_DEEP, color: "#fff",
            padding: "22px 24px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", right: -20, top: -20, opacity: .2 }}>
              <Star8 size={110} color="#fff" /></div>
            <div style={{ position: "relative" }}>
              <div style={{ fontSize: 12.5, letterSpacing: "1.5px", textTransform: "uppercase",
                color: "rgba(255,255,255,.75)" }}>Islamic House</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>Today's prayer times</div>
            </div>
          </div>
          <div style={{ marginTop: -1 }}><Muqarnas color={GOLD} height={16} cells={12} opacity={.85} /></div>

          {(t.masjidalId || t.masjidalEmbed) ? (
            <MasjidalWidget id={t.masjidalId} embed={t.masjidalEmbed} />
          ) : (
            <div style={{ padding: "8px 24px" }}>
              {["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"].map((p) => (
                <div key={p} style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", padding: "13px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>{p}</span>
                  <span style={{ fontFamily: "'Amiri',serif", fontSize: 18, color: "var(--accent)", fontWeight: 700 }}>{t[p]}</span>
                </div>
              ))}
            </div>
          )}

          {t.jummah && (
            <div style={{ padding: "16px 24px", background: "rgba(183,165,122,.1)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Calendar size={16} color={GOLD} />
                <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--accent)" }}>Jummah</span>
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
                <Markdown text={t.jummah} style={{ margin: 0 }} />
              </div>
            </div>
          )}
          {t.announcement && (
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Sparkles size={16} color={GOLD} />
                <span style={{ fontWeight: 700, fontSize: 13.5, color: "var(--accent)" }}>Announcement</span>
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
                <Markdown text={t.announcement} style={{ margin: 0 }} />
              </div>
            </div>
          )}
        </div>
        </Reveal>
      </div>
      <style>{`@media (max-width:820px){.prayer-grid{grid-template-columns:1fr !important;}}`}</style>
    </Band>
  );
}

/* ── Monthly calendar ───────────────────────────────────────────────────
   Renders dated events (data.calendar) in a month grid, alongside the
   recurring weekly view. Pure date maths — no library. */
const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
// Matches the weekday keys used in data.events (Weekly events tab) and
// Date.getDay()'s 0=Sunday..6=Saturday ordering, for projecting recurring
// weekly events onto the month grid below.
const WEEKDAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Turns a free-text time like "7:00 PM" or "1:15pm" into minutes-since-
// midnight so the day view can sort events chronologically (Google
// Calendar-style). Unparseable/missing times sort last rather than
// throwing the whole list into a random order.
function timeToMinutes(t) {
  if (!t) return 9999;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}

function MonthCalendar({ events, weeklyEvents }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [picked, setPicked] = useState(null);
  const [activeCat, setActiveCat] = useState("all");   // category filter
  const reduced = useReducedMotion();
  // Animation refs/state — ported from the spring-based reveal language in
  // https://github.com/yassir-jeraidi/full-calendar (weekday header +
  // day-cell stagger-in, directional slide on month navigation, badge pop
  // when the event count changes), reimplemented on our existing animejs
  // motion system rather than adopting framer-motion.
  const headerRef = useRef(null);
  const gridRef = useRef(null);
  const badgeRef = useRef(null);
  const dirRef = useRef(0); // -1 = went to previous month, 1 = next, 0 = initial mount
  const mountedRef = useRef(false);

  // Projects the recurring weekly schedule (This week's Halaqa etc. — the
  // same data the "This week" tab shows, keyed by weekday name) onto every
  // matching date in whichever month is currently displayed, so a weekly
  // event shows up on the monthly calendar automatically instead of
  // needing a separate dated entry from the admin. Recomputed only when
  // the visible month or the weekly schedule itself changes.
  const recurringForMonth = React.useMemo(() => {
    if (!weeklyEvents) return [];
    const out = [];
    const daysIn = new Date(cursor.y, cursor.m + 1, 0).getDate();
    for (let d = 1; d <= daysIn; d++) {
      const wd = WEEKDAY_NAMES[new Date(cursor.y, cursor.m, d).getDay()];
      (weeklyEvents[wd] || []).forEach((e) => {
        out.push({ ...e,
          id: `recur-${e.id}-${cursor.y}-${cursor.m}-${d}`,
          date: `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          recurring: true });
      });
    }
    return out;
  }, [weeklyEvents, cursor.y, cursor.m]);

  // Dated (data.calendar) events plus this month's projected recurring
  // ones. A weekly event an admin ALSO gave a specific dated entry to
  // (e.g. a one-off relocated Halaqa) just shows twice — harmless, and
  // rare enough not to bother de-duplicating by name.
  const allEvents = React.useMemo(() => [...(events || []), ...recurringForMonth],
    [events, recurringForMonth]);

  // Distinct categories present across all events (for the filter chips).
  const categories = React.useMemo(() => {
    const set = new Set();
    allEvents.forEach((e) => { if (e.category) set.add(e.category); });
    return Array.from(set).sort();
  }, [allEvents]);

  // Reset the filter if the active category disappears from the data.
  useEffect(() => {
    if (activeCat !== "all" && !categories.includes(activeCat)) setActiveCat("all");
  }, [categories, activeCat]);

  // Apply the active category filter before indexing.
  const filteredEvents = React.useMemo(() =>
    activeCat === "all" ? allEvents : allEvents.filter((e) => e.category === activeCat),
    [allEvents, activeCat]);

  // Index events by YYYY-MM-DD for O(1) lookup per cell.
  const byDate = React.useMemo(() => {
    const map = {};
    filteredEvents.forEach((e) => {
      if (!e.date) return;
      (map[e.date] = map[e.date] || []).push(e);
    });
    return map;
  }, [filteredEvents]);

  const cells = monthMatrix(cursor.y, cursor.m);
  const key = (d) =>
    `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const shift = (delta) => {
    dirRef.current = delta;
    setPicked(null);
    setCursor(({ y, m }) => {
      const nm = m + delta;
      if (nm < 0) return { y: y - 1, m: 11 };
      if (nm > 11) return { y: y + 1, m: 0 };
      return { y, m: nm };
    });
  };

  // Weekday header (Sun/Mon/...) staggers down into place once on mount —
  // it's static content, no need to re-run on month change.
  useEffect(() => {
    if (reduced) return;
    const header = headerRef.current;
    if (!header) return;
    const a = animate(header.children, {
      opacity: [0, 1], translateY: [-8, 0],
      duration: 380, delay: stagger(35), ease: "outQuad",
    });
    return () => a?.revert?.();
  }, [reduced]);

  // Day cells: on every month change, slide in from the direction you
  // navigated (previous -> from the left, next -> from the right — like
  // AnimatePresence's slideFromLeft/slideFromRight in the reference),
  // staggered cell-by-cell. First mount just fades/rises in place.
  useEffect(() => {
    if (reduced) return;
    const grid = gridRef.current;
    if (!grid) return;
    const dir = mountedRef.current ? dirRef.current : 0;
    mountedRef.current = true;
    const fromX = dir === 0 ? 0 : dir * 18;
    utils.set(grid.children, { opacity: 0, translateX: fromX, translateY: dir === 0 ? 8 : 0 });
    const a = animate(grid.children, {
      opacity: [0, 1], translateX: [fromX, 0], translateY: [dir === 0 ? 8 : 0, 0],
      duration: 420, delay: stagger(10), ease: "outQuad",
    });
    return () => a?.revert?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.y, cursor.m, reduced]);

  // Event-count badge pops when the count for the visible month changes —
  // mirrors the reference's AnimatePresence-based badge transition.
  const monthEventCount = React.useMemo(
    () => Object.keys(byDate).filter((k) => k.startsWith(`${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`)).length,
    [byDate, cursor.y, cursor.m]
  );
  useEffect(() => {
    if (reduced || !badgeRef.current) return;
    const a = animate(badgeRef.current, {
      scale: [0.8, 1], opacity: [0, 1], duration: 320, ease: "outBack",
    });
    return () => a?.revert?.();
  }, [monthEventCount, reduced]);

  const isToday = (d) =>
    d && today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === d;

  // Chronological, Google-Calendar-day-view style, not insertion order.
  const pickedEvents = React.useMemo(() => {
    const list = picked ? (byDate[picked] || []) : [];
    return [...list].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  }, [picked, byDate]);
  const pickedDayNum = picked ? Number(picked.split("-")[2]) : null;

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "16px 18px", background: "var(--tint)" }}>
        <button className="btn" onClick={() => shift(-1)} aria-label="Previous month"
          style={boardNavBtn}><ChevronLeft size={17} color="var(--accent)" /></button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 16.5, color: "var(--accent)" }}>
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
          {monthEventCount > 0 && (
            <span key={monthEventCount} ref={badgeRef} style={{ fontSize: 11.5, fontWeight: 700,
              padding: "2px 8px", borderRadius: 999, background: "var(--tint-2)",
              color: "var(--accent)", border: "1px solid var(--border)" }}>
              {monthEventCount} event{monthEventCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button className="btn" onClick={() => shift(1)} aria-label="Next month"
          style={boardNavBtn}><ChevronRight size={17} color="var(--accent)" /></button>
      </div>

      {/* Category filter chips — only shown when events carry categories. */}
      {categories.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, padding: "12px 16px 2px" }}>
          {["all", ...categories].map((c) => {
            const on = activeCat === c;
            return (
              <button key={c} onClick={() => { setActiveCat(c); setPicked(null); }}
                aria-pressed={on}
                style={{ padding: "5px 13px", borderRadius: 999, fontFamily: "inherit",
                  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  border: on ? "1px solid transparent" : "1px solid var(--border-strong)",
                  background: on ? PURPLE : "transparent",
                  color: on ? "#fff" : "var(--text-soft)",
                  transition: `background ${DUR.fast}ms ${EASE.out}, color ${DUR.fast}ms ${EASE.out}` }}>
                {c === "all" ? "All events" : c}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ padding: 12 }}>
        <div ref={headerRef} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4,
          marginBottom: 6 }}>
          {DOW_SHORT.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700,
              letterSpacing: ".6px", textTransform: "uppercase", color: "var(--text-faint)",
              padding: "4px 0" }}>{d}</div>
          ))}
        </div>
        {/* Day cells are dot-only on narrow phones (not enough width for
            readable text across 7 columns) and switch to inline "time
            name" rows — like Google Calendar's month view, per the
            reference screenshot — once there's room, via the
            .cal-lines/.cal-dots media query in the <style> block below.
            Both are always rendered; CSS just picks which one shows. */}
        <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const k = key(d);
            const evs = (byDate[k] || []).slice().sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
            const has = evs.length > 0;
            const sel = picked === k;
            const today = isToday(d);
            const MAX_LINES = 3;
            return (
              <button key={i} className="cal-cell" onClick={() => has && setPicked(sel ? null : k)}
                aria-label={has ? `${d}: ${evs.length} event${evs.length > 1 ? "s" : ""}` : String(d)}
                disabled={!has}
                style={{
                  borderRadius: 10, cursor: has ? "pointer" : "default", fontFamily: "inherit",
                  border: sel ? `2px solid ${GOLD}` : today ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: has ? "var(--tint-2)" : "transparent",
                  position: "relative", textAlign: "left",
                  transition: reduced ? "none"
                    : `background ${DUR.fast}ms ${EASE.out}, border-color ${DUR.fast}ms ${EASE.out}, transform ${DUR.fast}ms ${EASE.out}`,
                  transform: sel ? "translate3d(0,-2px,0)" : "none",
                }}>
                <span className="cal-daynum" style={{
                  fontWeight: has || today ? 700 : 500, fontSize: 13.5,
                  color: has ? "var(--accent)" : "var(--text-faint)" }}>
                  {today
                    ? <span style={{ display: "inline-grid", placeItems: "center", width: 20, height: 20,
                        borderRadius: "50%", background: PURPLE, color: "#fff", fontSize: 11.5 }}>{d}</span>
                    : d}
                </span>

                {/* mobile: small dot cluster, same as before */}
                {has && (
                  <span aria-hidden="true" className="cal-dots" style={{ position: "absolute", bottom: 5,
                    left: 0, right: 0, justifyContent: "center", gap: 2 }}>
                    {evs.slice(0, 3).map((_, n) => (
                      <span key={n} style={{ width: 4, height: 4, borderRadius: 99, background: GOLD }} />
                    ))}
                  </span>
                )}

                {/* tablet/desktop: actual event rows inline in the box */}
                {has && (
                  <span className="cal-lines" style={{ flexDirection: "column", gap: 2, marginTop: 2, minWidth: 0 }}>
                    {evs.slice(0, MAX_LINES).map((e) => (
                      <span key={e.id} style={{ display: "flex", alignItems: "center", gap: 3,
                        fontSize: 10.5, lineHeight: 1.3, minWidth: 0 }}>
                        <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%",
                          flexShrink: 0, background: e.recurring ? GOLD : "var(--accent)" }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          color: "var(--text)", fontWeight: 600 }}>
                          {e.time && <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>{e.time} </span>}
                          {e.name}
                        </span>
                      </span>
                    ))}
                    {evs.length > MAX_LINES && (
                      <span style={{ fontSize: 10, color: "var(--text-faint)", paddingLeft: 8 }}>
                        +{evs.length - MAX_LINES} more
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <style>{`
          .cal-cell { min-height: 38px; padding: 0; display: grid; place-items: center; }
          .cal-cell .cal-dots { display: flex; }
          .cal-cell .cal-lines { display: none; }
          @media (min-width: 640px) {
            .cal-cell { min-height: 92px; padding: 6px 6px 5px; display: flex;
              flex-direction: column; align-items: stretch; justify-content: flex-start; }
            .cal-cell .cal-daynum { align-self: flex-start; }
            .cal-cell .cal-dots { display: none; }
            .cal-cell .cal-lines { display: flex; }
          }
        `}</style>

        {/* Selected day detail — Google-Calendar-day-view style: a
            circular day-number badge up top, then a plain chronological
            list of colored-dot + time + name rows instead of the old
            boxed cards, per the reference screenshot. Still animates open
            without measuring height. */}
        <div style={{ display: "grid",
          gridTemplateRows: pickedEvents.length ? "1fr" : "0fr",
          opacity: pickedEvents.length ? 1 : 0,
          marginTop: pickedEvents.length ? 14 : 0,
          transition: reduced ? "none"
            : `grid-template-rows ${DUR.base}ms ${EASE.out}, opacity ${DUR.base}ms ${EASE.out}, margin-top ${DUR.base}ms ${EASE.out}` }}>
          <div style={{ overflow: "hidden" }}>
            <div style={{ borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--surface)", padding: "16px 16px 10px" }}>
              {pickedDayNum != null && (
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                  <span style={{ display: "grid", placeItems: "center", width: 30, height: 30,
                    borderRadius: "50%", background: PURPLE, color: "#fff",
                    fontSize: 13.5, fontWeight: 700 }}>
                    {pickedDayNum}
                  </span>
                </div>
              )}
              <div style={{ display: "grid", gap: 10 }}>
                {pickedEvents.map((e) => (
                  <div key={e.id} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span aria-hidden="true" style={{ flexShrink: 0, width: 8, height: 8,
                      borderRadius: "50%", background: e.recurring ? GOLD : "var(--accent)" }} />
                    <div style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      {e.time && (
                        <span style={{ fontSize: 13.5, color: "var(--text-muted)",
                          whiteSpace: "nowrap" }}>{e.time}</span>
                      )}
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)" }}>
                        {e.name}</span>
                      {e.recurring && (
                        <span title="Repeats every week — from the Weekly events tab"
                          style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".5px",
                            textTransform: "uppercase", color: "var(--accent)",
                            border: "1px solid var(--border-strong)", borderRadius: 999,
                            padding: "1px 6px" }}>Weekly</span>
                      )}
                      {e.loc && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3,
                          fontSize: 12, color: "var(--text-faint)" }}>
                          <MapPin size={11} /> {e.loc}</span>
                      )}
                      {e.desc && (
                        <div style={{ flexBasis: "100%", fontSize: 12.5, color: "var(--text-muted)",
                          lineHeight: 1.5 }}>{e.desc}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ height: 6 }} />
            </div>
          </div>
        </div>

        {Object.keys(byDate).length === 0 && (
          <div style={{ marginTop: 12, textAlign: "center", fontSize: 13,
            color: "var(--text-faint)", padding: "10px 0" }}>
            No events this month yet — weekly events (Weekly events tab) show up here
            automatically, or add a one-off dated event from the admin panel.
          </div>
        )}
      </div>
    </div>
  );
}

/* Embeds a published Notion calendar in an iframe. Notion only allows
   embedding pages that have been shared with "Publish to web" (a
   *.notion.site URL). A private app.notion.com link won't render, so if an
   admin pastes one we normalise what we can and, if it can't be embedded,
   show a graceful "open the calendar" link-out instead of a blank frame. */
function NotionCalendarEmbed({ url }) {
  const [failed, setFailed] = useState(false);
  const clean = String(url || "").trim();
  // A publishable embed URL is a notion.site link. app.notion.com/notion.so
  // links are private workspace URLs and can't be iframed.
  const embeddable = /notion\.site/i.test(clean);

  if (!embeddable || failed) {
    return (
      <div style={{ ...card, padding: 28, textAlign: "center" }}>
        <CalendarDays size={26} color="var(--accent)" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>MSA UW Calendar</div>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 440,
          margin: "0 auto 16px" }}>
          Open the full calendar in Notion for the latest events.
        </p>
        <a className="btn" href={safeHref(clean)} target="_blank" rel="noopener noreferrer"
          style={{ ...btnPurple, textDecoration: "none", display: "inline-flex",
            alignItems: "center", gap: 8 }}>
          <ExternalLink size={15} /> Open the calendar
        </a>
      </div>
    );
  }
  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <iframe title="MSA UW Calendar" src={clean} loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: 640, border: "none", display: "block",
          background: "var(--surface)" }} />
    </div>
  );
}

/* ---------- EVENTS ---------- */
function EventsSection({ data }) {
  return (
    <Band id="events" divider lattice decor="both" rosettes="both" light lightTone="gold" lightAt="top-right">
      <SectionCopy data={data} sectionKey="events" />
      <EventsViews data={data} />
    </Band>
  );
}

/* Weekly / monthly toggle plus the suggestion CTA. */
function EventsViews({ data }) {
  const [view, setView] = useState("week");
  const reduced = useReducedMotion();
  const extra = data.eventsExtra || seed.eventsExtra;
  return (
    <>
      <Reveal variant="up" distance={16}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
          <div role="tablist" aria-label="Event views"
            style={{ display: "inline-flex", position: "relative", padding: 4, borderRadius: 999,
              background: "var(--tint)", border: "1px solid var(--border)" }}>
            <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4, left: 4,
              width: "calc(50% - 4px)", borderRadius: 999, background: "var(--surface)",
              boxShadow: "var(--card-shadow)",
              transform: view === "week" ? "translateX(0)" : "translateX(100%)",
              transition: reduced ? "none" : `transform ${DUR.base}ms ${EASE.out}` }} />
            {[["week", "This week", LayoutGrid], ["month", "Monthly", CalendarDays]].map(([k, label, Icon]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                style={{ position: "relative", zIndex: 1, border: "none", background: "none",
                  cursor: "pointer", padding: "9px 18px", borderRadius: 999,
                  fontFamily: "inherit", fontSize: 14, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", gap: 7,
                  color: view === k ? "var(--accent)" : "var(--text-muted)",
                  transition: `color ${DUR.fast}ms ${EASE.out}` }}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          {extra.suggestUrl && (
            <a className="btn" href={extra.suggestUrl} target="_blank" rel="noopener noreferrer"
              style={{ ...btnPurple, textDecoration: "none", display: "inline-flex",
                alignItems: "center", gap: 8 }}>
              <Send size={15} /> Suggest an event
            </a>
          )}
        </div>
      </Reveal>

      {view === "week"
        ? <WeeklyEvents data={data} />
        : extra.notionUrl
          ? <Reveal variant="rise" distance={24}><NotionCalendarEmbed url={extra.notionUrl} /></Reveal>
          : <Reveal variant="rise" distance={24}><MonthCalendar events={data.calendar || []} weeklyEvents={data.events || {}} /></Reveal>}

      <Reveal delay={160} variant="rise" distance={24}>
        <div style={{ marginTop: 26, ...card, padding: "24px 26px", display: "flex",
          alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap",
          background: "linear-gradient(120deg, var(--tint), var(--tint-2))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0,
              display: "grid", placeItems: "center",
              background: `linear-gradient(135deg, ${PURPLE}, ${VIOLET})` }}>
              <Sparkles size={20} color="#fff" />
            </div>
            <div>
              <h3 style={{ margin: "0 0 3px", fontSize: 17, fontWeight: 700,
                color: "var(--accent)" }}>Got an idea?</h3>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
                {extra.suggestNote}</p>
            </div>
          </div>
          <a className="btn" href={extra.suggestUrl || "mailto:msauw@uw.edu?subject=Event%20suggestion"}
            target={extra.suggestUrl ? "_blank" : undefined}
            rel={extra.suggestUrl ? "noopener noreferrer" : undefined}
            style={{ ...btnGold, textDecoration: "none", display: "inline-flex",
              alignItems: "center", gap: 8 }}>
            <Send size={16} /> Suggest an event
          </a>
        </div>
      </Reveal>
    </>
  );
}

function WeeklyEvents({ data }) {
  return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 16 }}>
        {DAYS.map((day, dn) => {
          const evs = data.events[day] || [];
          const isFri = day === "Friday";
          return (
            <Reveal key={day} delay={dn * 75} variant="rise" distance={28} duration={DUR.slow}>
            <div className="eventcard" style={{ ...card, padding: 0, overflow: "hidden", height: "100%",
              border: isFri ? `2px solid ${GOLD}` : card.border }}>
              <div style={{ padding: "12px 18px", background: isFri ? "rgba(183,165,122,.15)" : "var(--tint)",
                display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: 15 }}>{day}</span>
                {isFri && <Star8 size={15} />}
              </div>
              <div style={{ padding: 14, display: "grid", gap: 10, minHeight: 90 }}>
                {evs.length === 0 && (
                  <div style={{ color: "var(--text-faint)", fontSize: 13.5, padding: "18px 0", textAlign: "center" }}>
                    No events yet</div>
                )}
                {evs.map((e) => (
                  <div key={e.id} style={{ borderRadius: 12, overflow: "hidden",
                    background: "var(--tint)", border: "1px solid var(--border)" }}>
                    {e.img && <img src={e.img} alt={e.name}
                      style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }} />}
                    <div style={{ padding: "12px 14px" }}>
                    <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14.5, marginBottom: 5 }}>{e.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--accent)",
                      fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>
                      <Clock size={12} /> {e.time}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-faint)", fontSize: 12.5 }}>
                      <MapPin size={12} /> {e.loc}</div>
                    {e.desc && <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 6 }}>{e.desc}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </Reveal>
          );
        })}
      </div>
  );
}

/* ── Ambient scroll lighting ────────────────────────────────────────────
   Soft light pools that live behind a section and gain intensity as it
   comes into view, then settle. Purely transform/opacity on blurred
   radial gradients, so it costs almost nothing. */
function SectionLight({ tone = "violet", intensity = 1, placement = "top-left" }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView({ threshold: 0.05, rootMargin: "0px 0px -5% 0px", once: false });
  if (reduced) return null;
  const tones = {
    violet: "rgba(140,120,180,",
    rose:   "rgba(180,120,140,",
    gold:   "rgba(201,182,136,",
  };
  const base = tones[tone] || tones.violet;
  const spots = {
    "top-left":     { top: "-16%", left: "-10%" },
    "top-right":    { top: "-14%", right: "-8%" },
    "bottom-left":  { bottom: "-18%", left: "-8%" },
    "bottom-right": { bottom: "-16%", right: "-10%" },
  };
  return (
    <div ref={ref} aria-hidden="true" style={{ position: "absolute", inset: 0,
      overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <div className="lightorb" style={{
        position: "absolute", width: 520, height: 520, borderRadius: "50%",
        background: `radial-gradient(circle, ${base}${(0.30 * intensity).toFixed(2)}) 0%, transparent 68%)`,
        filter: "blur(58px)",
        opacity: inView ? 1 : 0.28,
        transition: `opacity 1400ms ${EASE.outSoft}`,
        ...spots[placement],
      }} />
    </div>
  );
}

/* ── Announcement bar ───────────────────────────────────────────────────
   Sits above the nav. Dismissal is remembered per-message, so editing the
   text in the admin panel re-shows it to everyone who dismissed the old one. */
function AnnouncementBar({ bar, onNav }) {
  // No persistence on purpose: dismissing the bar should only hide it for
  // the current page view, not forever — refreshing (or just visiting
  // again later) brings it back. Plain component state does exactly that
  // since it resets on every fresh load; it used to write a dismissal
  // hash to localStorage, which persists indefinitely and was why closing
  // it once made it disappear for good.
  const [dismissed, setDismissed] = useState(false);

  if (!bar?.on || !bar?.text || dismissed) return null;

  const close = () => setDismissed(true);

  // Internal links: "#section", "/route", or "/route#section".
  const isInternal = bar.href && (bar.href.startsWith("#") || bar.href.startsWith("/"));
  const internalTarget = bar.href
    ? (bar.href.startsWith("#") ? bar.href.slice(1) : bar.href)
    : "";
  const label = bar.linkLabel || "";

  return (
    <div style={{ position: "relative", zIndex: 51,
      background: `linear-gradient(100deg, ${PURPLE_D}, ${PURPLE} 55%, ${VIOLET})`,
      color: "#fff" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "9px 44px 9px 20px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        flexWrap: "wrap", fontSize: 13.5, lineHeight: 1.45, textAlign: "center" }}>
        <Star8 size={13} color={GOLD} />
        <span>{bar.text}</span>
        {label && bar.href && (
          isInternal ? (
            <button onClick={() => onNav?.(internalTarget)} className="barlink">
              {label} <ChevronRight size={13} />
            </button>
          ) : (
            <a href={safeHref(bar.href)} target="_blank" rel="noopener noreferrer" className="barlink">
              {label} <ChevronRight size={13} />
            </a>
          )
        )}
      </div>
      <button onClick={close} aria-label="Dismiss announcement"
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
          background: "rgba(255,255,255,.12)", border: "none", borderRadius: 8,
          width: 26, height: 26, display: "grid", placeItems: "center", cursor: "pointer" }}>
        <X size={14} color="#fff" />
      </button>
    </div>
  );
}

/* ── Hero background video ──────────────────────────────────────────────
   Renders only when a source is configured, so the site keeps its gradient
   hero until footage exists. Muted + playsInline + autoplay is the only
   combination browsers allow to start on its own. Never loads on
   reduced-motion or save-data connections. */
/* HeroVideo removed — the scroll-driven CanvasHeroSequence replaces the
   old background-video hero. See src/components/CanvasHeroSequence.jsx. */

/* ── Mailing list ───────────────────────────────────────────────────────
   Saves straight to Supabase, or links out if an external form is set. */
function MailingList({ data }) {
  const cfg = data?.mailing || seed.mailing;
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("Current student");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // {ok, text}
  const [hp, setHp] = useState("");        // honeypot — real users never fill this

  if (!cfg?.on) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    setMsg(null);

    // Honeypot: bots fill hidden fields. If it's filled, silently "succeed"
    // without hitting the backend.
    if (hp) { setMsg({ ok: true, text: "You're in. Look out for the next one." }); return; }

    // Basic input validation before touching the network.
    const emailClean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
      setMsg({ ok: false, text: "Please enter a valid email address." }); return;
    }
    if (first.length > 80 || last.length > 80 || email.length > 160) {
      setMsg({ ok: false, text: "That's a bit long — please shorten your entry." }); return;
    }

    // Lightweight client-side rate limit: max 3 attempts per rolling minute,
    // tracked in localStorage. Stops accidental double-submits and casual abuse
    // (the real guard is Supabase RLS + a unique index on email).
    try {
      const now = Date.now();
      const hits = JSON.parse(localStorage.getItem("msa-ml-hits") || "[]")
        .filter((t) => now - t < 60000);
      if (hits.length >= 3) {
        setMsg({ ok: false, text: "Too many attempts — please wait a minute and try again." });
        return;
      }
      localStorage.setItem("msa-ml-hits", JSON.stringify([...hits, now]));
    } catch {}

    setBusy(true);
    const res = await subscribe({ firstName: first, lastName: last, email: emailClean, status });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: res.already
        ? "You're already on the list — see you next week."
        : "You're in. Look out for the next one." });
      setFirst(""); setLast(""); setEmail("");
    } else {
      setMsg({ ok: false, text: res.error });
    }
  };

  return (
    <Band id="mailing" alt lattice rosettes="left" light lightTone="violet" lightAt="top-right">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 34,
        alignItems: "center" }} className="mail-grid">
        <div>
          <Eyebrow>Stay in the loop</Eyebrow>
          <Title>{cfg.title}</Title>
          <Reveal delay={240} variant="up" distance={16}>
            <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 16.5,
              lineHeight: 1.7, maxWidth: 460 }}>{cfg.body}</p>
          </Reveal>
          <Reveal delay={320}>
            <div style={{ display: "flex", alignItems: "center", gap: 8,
              color: "var(--text-faint)", fontSize: 13 }}>
              <Star8 size={12} /> No spam, ever. Unsubscribe any time.
            </div>
          </Reveal>
        </div>

        <Reveal variant="rise" distance={28} delay={120} duration={DUR.slow}>
          <div style={{ ...card, padding: "26px 26px 24px" }}>
            {cfg.externalUrl ? (
              <>
                <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: 14.5 }}>
                  Sign up through our form — takes about ten seconds.
                </p>
                <a className="btn" href={cfg.externalUrl} target="_blank" rel="noopener noreferrer"
                  style={{ ...btnPurple, textDecoration: "none", display: "inline-flex",
                    alignItems: "center", gap: 8 }}>
                  <Send size={15} /> Open the signup form
                </a>
              </>
            ) : (
              <form onSubmit={submit}>
                {/* Honeypot — visually hidden, off-screen, not tabbable. Bots
                    that auto-fill fields will trip it; humans never see it. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px",
                  width: 1, height: 1, overflow: "hidden" }}>
                  <label>Leave this field empty
                    <input type="text" tabIndex={-1} autoComplete="off" value={hp}
                      onChange={(e) => setHp(e.target.value)} />
                  </label>
                </div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label style={lbl} htmlFor="ml-first">First name</label>
                    <input id="ml-first" style={inpSm} value={first} autoComplete="given-name"
                      onChange={(e) => setFirst(e.target.value)} />
                  </div>
                  <div>
                    <label style={lbl} htmlFor="ml-last">Last name</label>
                    <input id="ml-last" style={inpSm} value={last} autoComplete="family-name"
                      onChange={(e) => setLast(e.target.value)} />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={lbl} htmlFor="ml-email">Email</label>
                  <input id="ml-email" type="email" required style={inpSm} value={email}
                    autoComplete="email" placeholder="you@uw.edu"
                    onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={lbl} htmlFor="ml-status">I am a…</label>
                  <select id="ml-status" style={inpSm} value={status}
                    onChange={(e) => setStatus(e.target.value)}>
                    <option>Current student</option>
                    <option>Incoming student</option>
                    <option>Alum</option>
                    <option>Community member</option>
                  </select>
                </div>
                <button type="submit" className="btn" disabled={busy}
                  style={{ ...btnPurple, width: "100%", marginTop: 16, opacity: busy ? .6 : 1,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Send size={15} /> {busy ? "Signing you up…" : "Sign up"}
                </button>
                {msg && (
                  <div role="status" style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.5,
                    color: msg.ok ? "var(--accent)" : "#c0392b" }}>{msg.text}</div>
                )}
              </form>
            )}
          </div>
        </Reveal>
      </div>
      <style>{`@media (max-width:820px){.mail-grid{grid-template-columns:1fr !important;}}`}</style>
    </Band>
  );
}

/* ── Site search ────────────────────────────────────────────────────────
   Indexes everything already in `data` — no extra backend. Opens with the
   nav button or ⌘K / Ctrl-K. */
function buildIndex(data) {
  const out = [];
  const push = (type, title, sub, section) =>
    title && out.push({ type, title: String(title), sub: sub ? String(sub) : "", section });

  DAYS.forEach((d) => (data.events?.[d] || []).forEach((e) =>
    push("Event", e.name, [d, e.time, e.loc].filter(Boolean).join(" · "), "events")));
  (data.calendar || []).forEach((e) =>
    push("Event", e.name, [e.date, e.time, e.loc].filter(Boolean).join(" · "), "events"));
  (data.programs || []).forEach((p) => push("Program", p.name, p.desc, "programs"));
  (data.board || []).forEach((m) =>
    push("Board", m.name, [m.role, m.status === "previous" ? "Previous" : "Current"]
      .filter(Boolean).join(" · "), "board"));
  (data.prayerSpaces || []).forEach((s) => push("Prayer space", s.name, s.loc, "prayer"));
  // Announcements now render inside the "home" hero, not their own section.
  (data.announcements || []).forEach((a) => push("Announcement", a.title, a.body, "home"));
  (data.links || []).forEach((l) => push("Link", l.name, l.href, "connect"));
  (data.sponsors || []).forEach((s) => push("Sponsor", s.name, "", "sponsors"));
  (data.about?.pillars || []).forEach((p) => push("About", p.title, p.text, "about"));
  (data.islamicHouse?.features || []).forEach((f) =>
    push("Islamic House", f.title, f.text, "islamic-house"));
  return out;
}

function SearchOverlay({ open, onClose, data, onNav }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const index = React.useMemo(() => buildIndex(data), [data]);

  const results = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return index
      .map((item) => {
        const t = item.title.toLowerCase(), s = item.sub.toLowerCase();
        // Title matches rank above body matches; prefix above substring.
        let score = 0;
        if (t.startsWith(term)) score = 100;
        else if (t.includes(term)) score = 70;
        else if (s.includes(term)) score = 35;
        else return null;
        return { ...item, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [q, index]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 40); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" && results[sel]) {
        e.preventDefault(); onNav(results[sel].section); onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, sel, onNav, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Search" className="modalBg"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(20,12,40,.55)",
        backdropFilter: "blur(5px)", display: "grid", placeItems: "start center",
        padding: "12vh 16px 16px" }}>
      <div onClick={(e) => e.stopPropagation()} className="modalIn"
        style={{ ...card, width: "100%", maxWidth: 560, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
          borderBottom: "1px solid var(--border)" }}>
          <Search size={17} color="var(--accent)" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search events, programs, people…"
            aria-label="Search the site"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent",
              fontFamily: "inherit", fontSize: 16, color: "var(--text)" }} />
          <kbd style={{ fontSize: 11, color: "var(--text-faint)",
            border: "1px solid var(--border-strong)", borderRadius: 6, padding: "2px 6px" }}>Esc</kbd>
        </div>
        <div style={{ maxHeight: "52vh", overflowY: "auto", padding: 8 }}>
          {!q.trim() && (
            <div style={{ padding: "18px 12px", fontSize: 13.5, color: "var(--text-faint)",
              lineHeight: 1.7 }}>
              Try “jummah”, “halaqa”, “president”, or “iftar”.
            </div>
          )}
          {q.trim() && results.length === 0 && (
            <div style={{ padding: "18px 12px", fontSize: 13.5, color: "var(--text-faint)" }}>
              Nothing matched “{q.trim()}”.
            </div>
          )}
          {results.map((r, i) => (
            <button key={`${r.type}-${r.title}-${i}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => { onNav(r.section); onClose(); }}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%",
                textAlign: "left", padding: "11px 12px", borderRadius: 10, border: "none",
                cursor: "pointer", fontFamily: "inherit",
                background: i === sel ? "var(--tint-2)" : "transparent",
                transition: `background ${DUR.fast}ms ${EASE.out}` }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".8px",
                textTransform: "uppercase", color: "var(--accent)", flexShrink: 0,
                border: "1px solid var(--border-strong)", borderRadius: 99,
                padding: "3px 8px" }}>{r.type}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 600,
                  color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden",
                  textOverflow: "ellipsis" }}>{r.title}</span>
                {r.sub && (
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--text-faint)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.sub}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Defers loading the tree (and anime.js with it) until the section is close
   to the viewport, so the initial page load stays light.
   Back to a single tree — the three-tree grove tried here didn't land, so
   this reverts to the one centered tree it was before.
   The reserved space below (while waiting to scroll into view, or while
   the lazy chunk is still loading) used to be a flat, empty div with no
   background of its own — sitting on this section's dark gradient, that
   read as a plain black rectangle under the "importance of donating" copy
   rather than looking like part of the design. Giving it the same soft
   gold ground-glow the tree itself has means there's always *something*
   there instead of a dead rectangle, whichever state it's in. */
function LazyQuadTree({ reduced }) {
  const [ref, near] = useInView({ threshold: 0, rootMargin: "600px 0px" });
  const glow = (
    <div aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: "10%",
      width: 280, height: 50, marginLeft: -140, borderRadius: "50%", filter: "blur(26px)",
      background: `radial-gradient(ellipse, ${GOLD}22 0%, transparent 70%)` }} />
  );
  return (
    <div ref={ref} style={{ position: "relative", minHeight: 320, display: "flex",
      alignItems: "flex-end", justifyContent: "center" }}>
      {!near && glow}
      {near && (
        <React.Suspense fallback={<div style={{ position: "relative", height: 320, width: "100%" }}>{glow}</div>}>
          <QuadTree reduced={reduced} height={320}
            accent={PINK} bark="#6b5545" gold={GOLD}
            petalColors={[PINK, "#e8c4d4", MAUVE]} />
        </React.Suspense>
      )}
    </div>
  );
}

/* ---------- THE QUAD ----------
   A full-bleed cinematic moment: a cherry blossom tree draws itself as you
   scroll, then sheds petals. Ties the site to the most recognisable place
   on campus without needing photography we don't have. */
function QuadSection({ data }) {
  const reduced = useReducedMotion();
  const copy = data?.sections?.quad || seed.sections.quad;
  return (
    <section id="quad" className="grain vignette" style={{ position: "relative", overflow: "hidden",
      background: GRAD_DEEP, color: "#fff", padding: "72px 20px 0" }}>
      <AmbientGlow subtle />
      <div aria-hidden="true" style={{ position: "absolute", top: "-14%", left: "-6%",
        pointerEvents: "none", zIndex: 0 }}>
        <ScrollSpin speed={16}>
          <Rosette points={16} skip={7} size={300} color={GOLD} opacity={0.08} />
        </ScrollSpin>
      </div>

      <div style={{ position: "relative", zIndex: 2, maxWidth: 760, margin: "0 auto",
        textAlign: "center" }}>
        <Reveal variant="up" distance={18}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8,
            padding: "7px 16px", borderRadius: 999, background: "rgba(201,182,136,.16)",
            border: "1px solid rgba(201,182,136,.4)", marginBottom: 18 }}>
            <Star8 size={14} color={GOLD} />
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: GOLD }}>{copy.eyebrow}</span>
          </div>
        </Reveal>
        <h2 style={{ fontSize: "clamp(26px,4vw,42px)", fontWeight: 800, letterSpacing: "-1px",
          lineHeight: 1.12, margin: "0 0 16px" }}>
          <TextReveal text={copy.title} delay={60} step={48} />
        </h2>
        <Reveal delay={240} variant="up" distance={16}>
          <div style={{ color: "rgba(255,255,255,.82)", fontSize: 16.5, lineHeight: 1.7,
            maxWidth: 560, margin: "0 auto" }}>
            <Markdown text={copy.body} style={{ margin: "0 0 10px" }} />
          </div>
        </Reveal>
      </div>

      {/* the tree itself */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "-10px auto 0" }}>
        <LazyQuadTree reduced={reduced} />
      </div>

      {/* horizon line so the tree stands on something */}
      <div aria-hidden="true" style={{ position: "relative", zIndex: 1, height: 1,
        background: `linear-gradient(90deg, transparent, ${GOLD}55 22%, ${GOLD}55 78%, transparent)`,
        maxWidth: 1100, margin: "0 auto" }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <GirihBand color="rgba(201,182,136,.4)" height={46} opacity={1} unit={50} />
      </div>
    </section>
  );
}

/* ---------- ABOUT ---------- */
function AboutSection({ data }) {
  const about = data.about || seed.about;
  const reduced = useReducedMotion();
  const copy = data.sections?.about ?? seed.sections.about;
  const vidRef = useRef(null);
  const wrapRef = useRef(null);
  const inViewRef = useRef(false);
  const base = import.meta.env.BASE_URL || "/";
  const poster = `${base}video/about-poster.webp`;

  // Play the intro video once when it first scrolls into view, then stop on
  // its last frame (looping looked bad — the cut back to frame 1 was
  // obvious). Pause if the tab is hidden mid-play; don't restart once done.
  const playedRef = useRef(false);
  useEffect(() => {
    if (reduced) return;
    const v = vidRef.current;
    if (!v) return;
    const sync = () => {
      if (playedRef.current) return;              // already played through once
      const visible = inViewRef.current && !document.hidden;
      if (visible) v.play?.().catch(() => {}); else v.pause?.();
    };
    const onEnded = () => { playedRef.current = true; };  // freeze on last frame
    const io = new IntersectionObserver(([e]) => { inViewRef.current = e.isIntersecting; sync(); },
      { rootMargin: "200px 0px" });
    if (wrapRef.current) io.observe(wrapRef.current);
    document.addEventListener("visibilitychange", sync);
    v.addEventListener("ended", onEnded);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", sync);
      v.removeEventListener("ended", onEnded); };
  }, [reduced]);

  return (
    <section id="about" style={{ position: "relative", overflow: "hidden", background: INK }}>
      {/* ── Cinematic video hero ─────────────────────────────────────── */}
      <div ref={wrapRef} style={{ position: "relative", minHeight: "min(82vh, 760px)",
        display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
        {/* background media */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          {reduced ? (
            <img src={poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <video ref={vidRef} muted playsInline autoPlay preload="none" poster={poster}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}>
              <source src={`${base}video/about-loop.mp4`} type="video/mp4" />
            </video>
          )}
        </div>
        {/* dark scrims for text legibility (left-weighted + bottom) */}
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 1,
          background: "linear-gradient(90deg, rgba(20,17,24,.86) 0%, rgba(20,17,24,.55) 42%, rgba(20,17,24,.15) 78%, rgba(20,17,24,.05) 100%)" }} />
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 1,
          background: "linear-gradient(180deg, rgba(20,17,24,.35) 0%, transparent 30%, transparent 55%, rgba(20,17,24,.8) 100%)" }} />

        {/* Arabic calligraphy watermark, top-right */}
        <div aria-hidden="true" style={{ position: "absolute", top: "clamp(24px,6vw,64px)",
          right: "clamp(20px,5vw,72px)", zIndex: 2, color: "rgba(201,182,136,.55)",
          fontSize: "clamp(22px,3vw,40px)", fontWeight: 600, letterSpacing: "1px",
          textShadow: "0 2px 20px rgba(0,0,0,.5)", direction: "rtl" }}>
          بَيْتُ الطُّلَّاب
        </div>

        {/* headline content, bottom-left */}
        <div style={{ position: "relative", zIndex: 3, width: "100%", maxWidth: 1180,
          margin: "0 auto", padding: "0 clamp(20px,5vw,64px) clamp(48px,8vw,96px)" }}>
          <Reveal variant="up" distance={20}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <span style={{ width: 34, height: 1.5, background: GOLD, display: "inline-block" }} />
              <span style={{ fontSize: "clamp(11px,1.4vw,13px)", fontWeight: 700,
                letterSpacing: "2.4px", textTransform: "uppercase", color: "rgba(255,255,255,.82)" }}>
                {copy.eyebrow}
              </span>
            </div>
          </Reveal>
          <Reveal variant="up" distance={24} delay={80}>
            <h2 style={{ margin: 0, color: "#fff", fontWeight: 800,
              fontSize: "clamp(44px,8vw,104px)", lineHeight: 1.0, letterSpacing: "-2px",
              textShadow: "0 4px 40px rgba(0,0,0,.4)" }}>
              {copy.title}
            </h2>
          </Reveal>
          {copy.body && (
            <Reveal variant="up" distance={18} delay={160}>
              <p style={{ margin: "22px 0 0", color: "rgba(255,255,255,.86)", maxWidth: 560,
                fontSize: "clamp(15px,2vw,19px)", lineHeight: 1.6 }}>
                {copy.body}
              </p>
            </Reveal>
          )}
        </div>
      </div>

      {/* ── Info cards row (from about.pillars) ──────────────────────── */}
      <div style={{ position: "relative", zIndex: 4, background: INK,
        padding: "0 clamp(20px,5vw,64px) clamp(48px,7vw,80px)", marginTop: "-1px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto",
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          {(about.pillars || []).map((p, n) => (
            <Reveal key={p.id} delay={n * 80} variant="rise" distance={24}>
              <div className="lift" style={{ height: "100%", padding: "22px 22px 24px",
                borderRadius: 16, background: "rgba(255,255,255,.045)",
                border: "1px solid rgba(255,255,255,.10)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                  {progIcon(p.icon, GOLD)}
                  <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "1.6px",
                    textTransform: "uppercase", color: "rgba(201,182,136,.9)" }}>
                    {p.title}
                  </span>
                </div>
                <div style={{ color: "#fff", fontSize: 15.5, fontWeight: 700, marginBottom: 6,
                  lineHeight: 1.3 }}>{p.headline || p.title}</div>
                <p style={{ margin: 0, color: "rgba(255,255,255,.68)", fontSize: 13.5,
                  lineHeight: 1.6 }}>{p.text}</p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Keep the intro paragraph below the cards so the "since 1968"
            history isn't lost in the redesign. */}
        {about.intro && (
          <Reveal variant="up" distance={16}>
            <div style={{ maxWidth: 760, margin: "clamp(40px,6vw,64px) auto 0", textAlign: "center",
              color: "rgba(255,255,255,.72)", fontSize: 16, lineHeight: 1.75 }}>
              <Markdown text={about.intro} style={{ margin: 0 }} />
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

/* ---------- ANNOUNCEMENTS ----------
   The standalone Announcements section that used to live here is gone —
   its content now renders directly inside the home hero (see HomeSection's
   .hero-ann-head / .hero-ann-cards), where the arch + spinning rosary used
   to frame a marketing headline. ANN_KINDS stays here since HomeSection
   still uses it for the announcement card styling. */
const ANN_KINDS = {
  notice:   { label: "Notice",   color: "#8c78b4" },
  deadline: { label: "Deadline", color: "#b4788c" },
  event:    { label: "Event",    color: "#c9b688" },
  ramadan:  { label: "Ramadan",  color: "#7fa08c" },
};

/* ---------- DONATE ---------- */
function DonateSection({ data }) {
  const d = data.donate || seed.donate;
  return (
    <section id="donate" className="grain vignette" style={{ position: "relative", overflow: "hidden",
      background: GRAD_DEEP, color: "#fff", padding: "88px 20px" }}>
      <AmbientGlow subtle />
      <div aria-hidden="true" style={{ position: "absolute", top: "-24%", left: "-6%",
        pointerEvents: "none", zIndex: 0 }}>
        <ScrollSpin speed={18}>
          <Rosette points={12} skip={5} size={300} color={GOLD} opacity={0.10} />
        </ScrollSpin>
      </div>
      <div aria-hidden="true" style={{ position: "absolute", bottom: "-28%", right: "-5%",
        pointerEvents: "none", zIndex: 0 }}>
        <ScrollSpin speed={-22}>
          <Rosette points={16} skip={7} size={260} color={GOLD} opacity={0.10} />
        </ScrollSpin>
      </div>

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1000, margin: "0 auto",
        textAlign: "center" }}>
        <Reveal variant="up" distance={20}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8,
            padding: "7px 16px", borderRadius: 999, background: "rgba(201,182,136,.16)",
            border: "1px solid rgba(201,182,136,.4)", marginBottom: 20 }}>
            <Heart size={14} color={GOLD} />
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "1.4px",
              textTransform: "uppercase", color: GOLD }}>
              {data.sections?.donate?.eyebrow ?? seed.sections.donate.eyebrow}</span>
          </div>
        </Reveal>
        <h2 style={{ fontSize: "clamp(28px,4.4vw,46px)", fontWeight: 800, letterSpacing: "-1px",
          lineHeight: 1.1, margin: "0 0 16px" }}>
          <TextReveal text={data.sections?.donate?.title ?? seed.sections.donate.title}
            delay={80} step={48} />
        </h2>
        <Reveal delay={260} variant="up" distance={16}>
          <div style={{ maxWidth: 640, margin: "0 auto 34px", color: "rgba(255,255,255,.85)",
            fontSize: 16.5, lineHeight: 1.7 }}>
            <Markdown text={data.sections?.donate?.body ?? seed.sections.donate.body}
              style={{ margin: "0 0 10px" }} />
          </div>
        </Reveal>

        {/* Impact tiers */}
        {(d.impact || []).length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 14, maxWidth: 760, margin: "0 auto 34px" }}>
            {d.impact.map((t, n) => (
              <Reveal key={t.id} delay={340 + n * 90} variant="rise" distance={22}>
                <div style={{ padding: "20px 18px", borderRadius: 16,
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(201,182,136,.28)", height: "100%" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: GOLD, lineHeight: 1 }}>
                    {t.amount}</div>
                  <div style={{ marginTop: 8, fontSize: 13.5, color: "rgba(255,255,255,.8)",
                    lineHeight: 1.5 }}>{t.text}</div>
                </div>
              </Reveal>
            ))}
          </div>
        )}

        <Reveal delay={620} variant="up" distance={18}>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <a className="btn" href={safeHref(d.msaUrl)} target="_blank" rel="noopener noreferrer"
              style={{ ...btnGold, textDecoration: "none", display: "inline-flex",
                alignItems: "center", gap: 9, fontSize: 16, padding: "15px 32px" }}>
              <Heart size={18} /> Donate to MSA
            </a>
            <a className="btn" href={safeHref(d.houseUrl)} target="_blank" rel="noopener noreferrer"
              style={{ ...btnGhost, textDecoration: "none", display: "inline-flex",
                alignItems: "center", gap: 9, fontSize: 16, padding: "15px 32px" }}>
              Support the Islamic House
            </a>
          </div>
        </Reveal>
        <Reveal delay={720}>
          <p style={{ marginTop: 18, fontSize: 12.5, color: "rgba(255,255,255,.55)" }}>
            Donations are processed securely through Zeffy — 100% reaches the MSA.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- ISLAMIC HOUSE ---------- */
function IslamicHouseSection({ data }) {
  const h = data.islamicHouse || seed.islamicHouse;
  // Index into h.photos currently open in the lightbox, or null when closed.
  const [lightbox, setLightbox] = useState(null);
  const photos = h.photos || [];
  const navLightbox = (dir) => setLightbox((i) => (i === null ? null : (i + dir + photos.length) % photos.length));
  // futureImages is the new multi-photo slideshow field. h.futureImage
  // (singular) was the old single-photo field it replaces — if a site
  // already had one of those saved and hasn't added anything to the new
  // array yet, show it as the slideshow's one slide instead of the empty
  // placeholder, so upgrading doesn't lose an admin's existing photo.
  const futureImages = (h.futureImages && h.futureImages.length)
    ? h.futureImages
    : (h.futureImage ? [{ id: "legacy", img: h.futureImage, caption: "" }] : []);
  return (
    <Band id="islamic-house" lattice rosettes="both" decor="right" light lightTone="gold" lightAt="bottom-right">
      {/* tasbih swaying quietly in the margin */}
      <Parallax speed={0.16} style={{ top: 90, right: "2%" }}>
        <Tasbih height={230} opacity={0.32} color="var(--rosette)" />
      </Parallax>
      {/* SectionCopy (eyebrow/title/intro) used to sit full-width above
          this grid, which pushed the "Visit Islamic House" card well
          below the heading instead of alongside it. Moving it inside the
          left column means both columns now start at the same row (grid
          has alignItems:"start"), so the card rides up flush with the
          eyebrow/title instead of floating lower next to the body copy. */}
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 26,
        alignItems: "start" }} className="house-grid">
        <div>
          <SectionCopy data={data} sectionKey="islamicHouse" />
          {h.body && (
            <Reveal variant="up" distance={18}>
              <div style={{ color: "var(--text-muted)", fontSize: 15.5, lineHeight: 1.75,
                marginBottom: 22 }}>
                <Markdown text={h.body} style={{ margin: "0 0 14px" }} />
              </div>
            </Reveal>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
            gap: 14 }}>
            {(h.features || []).map((f, n) => (
              <Reveal key={f.id} delay={n * 80} variant="rise" distance={22}>
                <div className="lift" style={{ ...card, padding: "18px 20px", height: "100%" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Star8 size={13} />
                    <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700,
                      color: "var(--accent)" }}>{f.title}</h4>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-muted)",
                    lineHeight: 1.6 }}>{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* Right column: the "Visit Islamic House" details card sits at the
            top for stronger desktop balance against the long left column,
            with the building photo underneath. */}
        <div style={{ display: "grid", gap: 20 }}>
          <Reveal variant="right" distance={26} delay={80} duration={DUR.slow}>
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ background: GRAD_DEEP, color: "#fff", padding: "20px 22px",
                position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", right: -26, top: -26, opacity: .18 }}>
                  <Star8 size={110} color="#fff" /></div>
                <div style={{ position: "relative" }}>
                  <div style={{ fontSize: 12, letterSpacing: "1.5px", textTransform: "uppercase",
                    color: "rgba(255,255,255,.72)" }}>Visit</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>Islamic House</div>
                </div>
              </div>
              <div style={{ marginTop: -1 }}>
                <Muqarnas color={GOLD} height={14} cells={12} opacity={.85} />
              </div>
              <div style={{ padding: "18px 22px", display: "grid", gap: 14 }}>
                {h.address && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <MapPin size={17} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.55 }}>
                      {h.address}</div>
                  </div>
                )}
                {h.hours && (
                  <div style={{ display: "flex", gap: 10 }}>
                    <Clock size={17} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.55 }}>
                      {h.hours}</div>
                  </div>
                )}
                <div style={{ display: "grid", gap: 9, marginTop: 4 }}>
                  {h.mapUrl && (
                    <a className="btn" href={safeHref(h.mapUrl)} target="_blank" rel="noopener noreferrer"
                      style={{ ...btnPurple, textDecoration: "none", textAlign: "center",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      <MapPin size={15} /> Open in Maps
                    </a>
                  )}
                  {h.donateUrl && (
                    <a className="btn" href={safeHref(h.donateUrl)} target="_blank" rel="noopener noreferrer"
                      style={{ ...btnGold, textDecoration: "none", textAlign: "center",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                      <Heart size={15} /> Support the House
                    </a>
                  )}
                </div>
              </div>
            </div>
          </Reveal>

          {/* Building photo slot — same position/size (right column,
              second item, 4:3 box) as before, now a small slideshow when
              there's more than one photo. A single photo (or the legacy
              futureImage) renders exactly as it did previously, with no
              arrows; zero photos keeps the original "coming soon"
              placeholder so the layout never jumps. */}
          <Reveal variant="right" distance={26} delay={140} duration={DUR.slow}>
            {futureImages.length > 0 ? (
              <ImageSlideshow images={futureImages} alt="Future Islamic House building" />
            ) : (
              <div style={{ ...card, aspectRatio: "4 / 3", display: "grid", placeItems: "center",
                gap: 8, textAlign: "center", padding: 20,
                border: "1.5px dashed var(--border-strong)", background: "var(--surface-2)" }}>
                <Camera size={26} color="var(--text-faint)" />
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-faint)" }}>
                  Future building photo coming soon</div>
              </div>
            )}
          </Reveal>
        </div>
      </div>

      {/* Photos — click any thumbnail to browse the full set in a
          lightbox with prev/next arrows (PhotoLightbox below). Admins can
          add as many as they like from the Islamic House tab; there's no
          cap on the array, the grid just wraps. */}
      {photos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 14, marginTop: 26 }}>
          {photos.map((p, n) => (
            <Reveal key={p.id ?? n} delay={n * 70} variant="scale" distance={20}>
              <button type="button" onClick={() => setLightbox(n)} className="zoomable"
                aria-label={p.caption ? `View photo: ${p.caption}` : `View photo ${n + 1} of ${photos.length}`}
                style={{ ...card, padding: 0, overflow: "hidden", aspectRatio: "4 / 3",
                  border: "none", cursor: "pointer", display: "block", width: "100%",
                  font: "inherit", color: "inherit" }}>
                {p.img
                  ? <img src={p.img} alt={p.caption || ""} loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", height: "100%",
                      background: `linear-gradient(140deg, ${PURPLE_D}, ${VIOLET})` }} />}
              </button>
            </Reveal>
          ))}
        </div>
      )}
      <PhotoLightbox photos={photos} index={lightbox} onClose={() => setLightbox(null)} onNav={navLightbox} />
      <style>{`@media (max-width:880px){.house-grid{grid-template-columns:1fr !important;}}`}</style>
    </Band>
  );
}

/* Full-screen viewer for a photo array — prev/next arrow buttons plus
   arrow-key and swipe-free keyboard navigation, Escape/backdrop to close.
   Generic enough to reuse anywhere a plain photo array needs browsing
   (currently just the Islamic House photos, which have no carousel of
   their own the way the home page Moments gallery does). */
/* Small inline slideshow for a single featured photo slot — same 4:3 card
   box a lone image used to sit in, just with prev/next arrows and dot
   indicators once there's more than one photo. Deliberately lighter than
   PhotoLightbox (no fullscreen overlay, no keyboard/scroll locking) since
   this lives inline in the page layout, not as a modal. */
function ImageSlideshow({ images, alt }) {
  const [i, setI] = useState(0);
  const reduced = useReducedMotion();
  const n = images.length;
  const boxRef = useRef(null);
  // Clamp if the array shrinks (e.g. an admin deletes the slide being shown).
  useEffect(() => { if (i > n - 1) setI(Math.max(0, n - 1)); }, [n, i]);

  const go = (dir) => setI((cur) => (cur + dir + n) % n);
  const cur = images[i];
  useSwipe(boxRef, { onLeft: () => go(1), onRight: () => go(-1), enabled: n > 1 });

  return (
    <div ref={boxRef} className="zoomable" style={{ ...card, padding: 0, overflow: "hidden",
      aspectRatio: "4 / 3", position: "relative", touchAction: n > 1 ? "pan-y" : undefined }}>
      {cur?.img
        ? <img key={cur.id ?? i} src={cur.img} alt={cur.caption || alt} loading="lazy" decoding="async"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", height: "100%",
            background: `linear-gradient(140deg, ${PURPLE_D}, ${VIOLET})` }} />}

      {n > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo"
            style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
              width: 32, height: 32, borderRadius: "50%", border: "1px solid rgba(255,255,255,.35)",
              background: "rgba(20,17,24,.55)", color: "#fff", display: "grid", placeItems: "center",
              cursor: "pointer" }}>
            <ChevronLeft size={17} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              width: 32, height: 32, borderRadius: "50%", border: "1px solid rgba(255,255,255,.35)",
              background: "rgba(20,17,24,.55)", color: "#fff", display: "grid", placeItems: "center",
              cursor: "pointer" }}>
            <ChevronRight size={17} />
          </button>
          {/* dot indicators — also clickable, jump straight to a slide */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 10,
            display: "flex", justifyContent: "center", gap: 6 }}>
            {images.map((im, di) => (
              <button key={im.id ?? di} type="button" onClick={() => setI(di)}
                aria-label={`Go to photo ${di + 1}`} aria-current={di === i}
                style={{ width: di === i ? 16 : 6, height: 6, borderRadius: 999, border: "none",
                  padding: 0, cursor: "pointer", background: di === i ? "#fff" : "rgba(255,255,255,.45)",
                  transition: reduced ? "none" : `width ${DUR.fast}ms ${EASE.out}` }} />
            ))}
          </div>
        </>
      )}
      {cur?.caption && (
        <div style={{ position: "absolute", left: 10, right: 10, top: 10, fontSize: 12,
          fontWeight: 700, color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>
          {cur.caption}
        </div>
      )}
    </div>
  );
}

function PhotoLightbox({ photos, index, onClose, onNav }) {
  const overlayRef = useRef(null);
  useEffect(() => {
    if (index === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onNav(-1);
      else if (e.key === "ArrowRight") onNav(1);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, onClose, onNav]);
  // Swipe anywhere on the overlay to browse — hook has to be called
  // unconditionally (before the index===null early return below), so it
  // self-disables via `enabled` instead of being skipped.
  useSwipe(overlayRef, {
    onLeft: () => onNav(1), onRight: () => onNav(-1),
    enabled: index !== null && photos.length > 1,
  });

  if (index === null) return null;
  const p = photos[index];
  if (!p) return null;

  const arrowBtn = {
    position: "absolute", top: "50%", transform: "translateY(-50%)",
    width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,.28)",
    background: "rgba(20,17,24,.72)", color: "#fff", display: "grid", placeItems: "center",
    cursor: "pointer",
  };

  return (
    <div ref={overlayRef} role="dialog" aria-modal="true" aria-label="Photo viewer" className="modalBg"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(10,8,16,.88)",
        backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20,
        touchAction: "pan-y" }}>
      <button onClick={onClose} aria-label="Close"
        style={{ position: "absolute", top: 18, right: 18, width: 40, height: 40, borderRadius: "50%",
          border: "1px solid rgba(255,255,255,.28)", background: "rgba(20,17,24,.72)", color: "#fff",
          display: "grid", placeItems: "center", cursor: "pointer" }}>
        <X size={20} />
      </button>
      {photos.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onNav(-1); }} aria-label="Previous photo"
          style={{ ...arrowBtn, left: 14 }}>
          <ChevronLeft size={22} />
        </button>
      )}
      <div onClick={(e) => e.stopPropagation()} className="modalIn"
        style={{ maxWidth: "min(88vw, 900px)", maxHeight: "82vh", display: "grid", gap: 10 }}>
        {p.img
          ? <img src={p.img} alt={p.caption || ""} style={{ maxWidth: "100%", maxHeight: "72vh",
              borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,.5)", objectFit: "contain",
              display: "block", margin: "0 auto" }} />
          : <div style={{ width: "min(88vw, 700px)", height: "60vh", borderRadius: 14,
              background: `linear-gradient(140deg, ${PURPLE_D}, ${VIOLET})` }} />}
        {p.caption && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,.85)", fontSize: 14.5, fontWeight: 600 }}>
            {p.caption}
          </div>
        )}
        {photos.length > 1 && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 12.5 }}>
            {index + 1} / {photos.length}
          </div>
        )}
      </div>
      {photos.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onNav(1); }} aria-label="Next photo"
          style={{ ...arrowBtn, right: 14 }}>
          <ChevronRight size={22} />
        </button>
      )}
    </div>
  );
}

/* ---------- BOARD MEMBERS ---------- */
/* Compact revolving carousel, deliberately smaller in scale than the main
   gallery. Tabs switch between current and previous board. Clicking a card
   opens its bio; if the member has a link, the bio panel offers it. */
function BoardSection({ data }) {
  const [tab, setTab] = useState("current");
  const [open, setOpen] = useState(null);   // id of expanded member
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(5);
  const reduced = useReducedMotion();
  const trackWrapRef = useRef(null);

  // How many cards fit at once — recalculated on resize.
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setPerPage(w < 560 ? 1 : w < 860 ? 2 : w < 1120 ? 3 : 5);
    };
    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc);
  }, []);

  const members = (data.board || []).filter((m) => (m.status || "current") === tab);
  const pages = Math.max(1, Math.ceil(members.length / perPage));

  // Keep the page in range when the tab or viewport changes.
  useEffect(() => { setPage((p) => Math.min(p, pages - 1)); }, [pages, tab]);
  useEffect(() => { setOpen(null); setPage(0); }, [tab]);

  const openMember = members.find((m) => m.id === open);

  const switchTab = (t) => { if (t !== tab) setTab(t); };

  // Swipe left/right on touch devices pages the carousel the same way the
  // arrow buttons below do — most useful at perPage:1 (phones), where each
  // member gets their own "page" to swipe through.
  useSwipe(trackWrapRef, {
    onLeft: () => setPage((p) => (p + 1) % pages),
    onRight: () => setPage((p) => (p - 1 + pages) % pages),
    enabled: pages > 1,
  });

  return (
    <Band id="board" alt lattice rosettes="right" decor="left" light lightTone="rose" lightAt="bottom-left">
      <SectionCopy data={data} sectionKey="board" />

      {/* Tabs — the active pill slides between options */}
      <Reveal variant="up" distance={16}>
        <div role="tablist" aria-label="Board member groups"
          style={{ display: "inline-flex", position: "relative", padding: 4, borderRadius: 999,
            background: "var(--tint)", border: "1px solid var(--border)", marginBottom: 28 }}>
          <span aria-hidden="true" style={{ position: "absolute", top: 4, bottom: 4,
            left: 4, width: "calc(50% - 4px)", borderRadius: 999, background: "var(--surface)",
            boxShadow: "var(--card-shadow)",
            transform: tab === "current" ? "translateX(0)" : "translateX(100%)",
            transition: reduced ? "none" : `transform ${DUR.base}ms ${EASE.out}` }} />
          {[["current", "Current board"], ["previous", "Previous board"]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => switchTab(k)}
              style={{ position: "relative", zIndex: 1, border: "none", background: "none",
                cursor: "pointer", padding: "9px 20px", borderRadius: 999,
                fontFamily: "inherit", fontSize: 14, fontWeight: 700,
                color: tab === k ? "var(--accent)" : "var(--text-muted)",
                transition: `color ${DUR.fast}ms ${EASE.out}` }}>
              {label}
            </button>
          ))}
        </div>
      </Reveal>

      {members.length === 0 ? (
        <div style={{ color: "var(--text-faint)", fontSize: 14.5, padding: "22px 0" }}>
          No {tab === "current" ? "current" : "previous"} board members listed yet.
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {/* Track — translated by page, so it revolves rather than reflowing.
              Ref is what useSwipe listens on for touch drag. */}
          <div ref={trackWrapRef} style={{ overflow: "hidden", touchAction: "pan-y" }}>
            <div style={{ display: "flex",
              transform: `translate3d(-${page * 100}%, 0, 0)`,
              transition: reduced ? "none" : `transform ${DUR.slow}ms ${EASE.outSoft}` }}>
              {Array.from({ length: pages }, (_, pi) => (
                <div key={pi} style={{ flex: "0 0 100%", display: "grid", gap: 16,
                  gridTemplateColumns: `repeat(${perPage}, minmax(0, 1fr))` }}>
                  {members.slice(pi * perPage, pi * perPage + perPage).map((m, n) => (
                    <BoardCard key={m.id} member={m} delay={n * 70}
                      active={open === m.id}
                      onOpen={() => setOpen(open === m.id ? null : m.id)} />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {pages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
              gap: 12, marginTop: 20 }}>
              <button className="btn" aria-label="Previous board members"
                onClick={() => setPage((p) => (p - 1 + pages) % pages)}
                style={boardNavBtn}><ChevronLeft size={18} color="var(--accent)" /></button>
              <div style={{ display: "flex", gap: 7 }}>
                {Array.from({ length: pages }, (_, n) => (
                  <button key={n} onClick={() => setPage(n)} aria-label={`Page ${n + 1}`}
                    style={{ width: 22, height: 8, borderRadius: 99, border: "none",
                      background: "transparent", cursor: "pointer", padding: 0,
                      display: "grid", placeItems: "center" }}>
                    <span aria-hidden="true" style={{ display: "block", width: 22, height: 8,
                      borderRadius: 99, transformOrigin: "50% 50%",
                      transform: n === page ? "scaleX(1)" : "scaleX(.34)",
                      background: n === page ? GOLD : "var(--border-strong)",
                      transition: `transform ${DUR.base}ms ${EASE.out}, background ${DUR.base}ms ${EASE.out}` }} />
                  </button>
                ))}
              </div>
              <button className="btn" aria-label="Next board members"
                onClick={() => setPage((p) => (p + 1) % pages)}
                style={boardNavBtn}><ChevronRight size={18} color="var(--accent)" /></button>
            </div>
          )}

          {/* Expanded bio — grid-rows trick animates height without JS measuring */}
          <div style={{ display: "grid",
            gridTemplateRows: openMember ? "1fr" : "0fr",
            opacity: openMember ? 1 : 0,
            marginTop: openMember ? 20 : 0,
            transition: reduced ? "none"
              : `grid-template-rows ${DUR.base}ms ${EASE.out}, opacity ${DUR.base}ms ${EASE.out}, margin-top ${DUR.base}ms ${EASE.out}` }}>
            <div style={{ overflow: "hidden" }}>
              {openMember && (
                <div style={{ ...card, padding: "22px 24px", display: "flex", gap: 18,
                  alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: "var(--accent)" }}>
                      {openMember.name}</div>
                    <div style={{ fontSize: 13.5, color: "var(--text-faint)", marginBottom: 10 }}>
                      {openMember.role}</div>
                    {openMember.bio
                      ? <div style={{ color: "var(--text-muted)", fontSize: 14.5, lineHeight: 1.65 }}>
                          <Markdown text={openMember.bio} style={{ margin: "0 0 8px" }} /></div>
                      : <div style={{ color: "var(--text-faint)", fontSize: 14 }}>No bio yet.</div>}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {openMember.href && (
                      <a className="btn" href={safeHref(openMember.href)} target="_blank" rel="noopener noreferrer"
                        style={{ ...btnPurple, textDecoration: "none", display: "inline-flex",
                          alignItems: "center", gap: 7 }}>
                        Visit <ExternalLink size={14} />
                      </a>
                    )}
                    <button className="btn" onClick={() => setOpen(null)}
                      style={{ ...btnPurple, background: "var(--tint-2)", color: "var(--accent)" }}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Band>
  );
}

const boardNavBtn = {
  width: 38, height: 38, borderRadius: 999, cursor: "pointer",
  border: "1px solid var(--border-strong)", background: "var(--surface)",
  display: "grid", placeItems: "center",
};

/* One board member. Compact portrait card; clicking toggles the bio panel. */
function BoardCard({ member: m, delay = 0, active, onOpen }) {
  const [hover, setHover] = useState(false);
  const initials = String(m.name || "?").trim().split(/\s+/)
    .slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
  return (
    <Reveal delay={delay} variant="rise" distance={24}>
      <button onClick={onOpen} aria-expanded={!!active}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        className="lift zoomable"
        style={{ ...card, width: "100%", padding: 0, overflow: "hidden", cursor: "pointer",
          textAlign: "left", fontFamily: "inherit", display: "block",
          borderColor: active ? GOLD : undefined,
          borderWidth: active ? 2 : 1, borderStyle: "solid" }}>
        <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1",
          overflow: "hidden", background: `linear-gradient(140deg, ${PURPLE_D}, ${VIOLET})` }}>
          {m.img
            ? <img src={m.img} alt="" loading="lazy"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center",
                color: "rgba(255,255,255,.9)", fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>
                {initials || <Users size={30} />}
              </div>}
          {/* hover scrim hinting the card is interactive */}
          <div aria-hidden="true" style={{ position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(20,17,24,.55), transparent 55%)",
            opacity: hover || active ? 1 : 0.65,
            transition: `opacity ${DUR.fast}ms ${EASE.out}` }} />
          {m.href && (
            <span aria-hidden="true" style={{ position: "absolute", top: 8, right: 8,
              width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center",
              background: "rgba(255,255,255,.9)",
              transform: hover ? "translate3d(0,-2px,0)" : "none",
              transition: `transform ${DUR.fast}ms ${EASE.spring}` }}>
              <ExternalLink size={13} color={PURPLE} />
            </span>
          )}
        </div>
        <div style={{ padding: "12px 14px 14px" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginTop: 2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.role}</div>
        </div>
      </button>
    </Reveal>
  );
}

/* ---------- PROGRAMS ---------- */
function ProgramsSection({ data }) {
  return (
    <Band id="programs" alt divider lattice decor="right" rosettes="left" light lightTone="violet" lightAt="bottom-right">
      <SectionCopy data={data} sectionKey="programs" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 20 }}>
        {(data.programs || []).map((p, n) => (
          <Reveal key={p.id} delay={n * 85} variant="rise" distance={30} duration={DUR.slow}>
            <ProgramCard program={p} />
          </Reveal>
        ))}
      </div>
    </Band>
  );
}

/* Program card — the arch fills and the icon lifts on hover. */
function ProgramCard({ program: p }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="lift" style={{ ...card, padding: "26px 24px", height: "100%" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ width: 54, height: 62, position: "relative", display: "grid",
        placeItems: "center", marginBottom: 16 }}>
        <div style={{ position: "absolute", inset: 0,
          transform: hover ? "translate3d(0,-3px,0) scale(1.06)" : "none",
          transition: `transform ${DUR.base}ms ${EASE.spring}` }}>
          <Arch w={54} h={62} spring={38}
            stroke={hover ? "rgba(183,165,122,.85)" : "rgba(183,165,122,.5)"} sw={1.2}
            fill={hover ? "rgba(183,165,122,.26)" : "rgba(183,165,122,.15)"}
            style={{ width: "100%", height: "100%", transition: `all ${DUR.base}ms ${EASE.out}` }} />
        </div>
        <div style={{ position: "relative", marginTop: 8,
          transform: hover ? "translate3d(0,-3px,0)" : "none",
          transition: `transform ${DUR.base}ms ${EASE.spring}` }}>{progIcon(p.icon)}</div>
      </div>
      <h3 style={{ margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "var(--accent)" }}>{p.name}</h3>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14.5, lineHeight: 1.6 }}>{p.desc}</p>
    </div>
  );
}

/* ---------- NEW HERE? ---------- */
/* A short pointer for newcomers straight to the Muslim Student Guide.
   Heading/body come from the standard section-copy system (admin: Section
   text → "New here?"); the link itself is a single field on its own admin
   tab, since it's a URL rather than editorial copy. */
function NewHereSection({ data, onNav }) {
  const nh = data.newHere || seed.newHere;
  return (
    <Band id="new-here" lattice rosettes="left" light lightTone="gold" lightAt="top-left">
      <SectionCopy data={data} sectionKey="newHere" />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {nh.href && (
          <Reveal variant="rise" distance={20}>
            <a href={safeHref(nh.href)} target="_blank" rel="noopener noreferrer" className="btn lift"
              style={{ display: "inline-flex", alignItems: "center", gap: 9,
                padding: "13px 24px", borderRadius: 12, textDecoration: "none",
                fontWeight: 700, fontSize: 15, color: "#2c2418",
                background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)` }}>
              <BookOpen size={17} /> {nh.linkLabel || "Read the guide"}
            </a>
          </Reveal>
        )}
        {/* Second guide button — "Guide to being a Muslim at UW". */}
        {nh.href2 && (
          <Reveal variant="rise" distance={20} delay={40}>
            <a href={safeHref(nh.href2)} target="_blank" rel="noopener noreferrer" className="btn lift"
              style={{ display: "inline-flex", alignItems: "center", gap: 9,
                padding: "13px 24px", borderRadius: 12, textDecoration: "none",
                fontWeight: 700, fontSize: 15, color: "#2c2418",
                background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)` }}>
              <BookOpen size={17} /> {nh.linkLabel2 || "Read the guide"}
            </a>
          </Reveal>
        )}
        {/* Get Involved / Learn More — moved down from the home hero, which
            now shows announcements instead of a marketing CTA. This is a
            more natural home for them anyway: newcomers land here right
            after the hero, looking for exactly this next step. */}
        {onNav && (
          <Reveal variant="rise" distance={20} delay={80}>
            {/* Get Involved -> Events page (the weekly/monthly calendar lives there). */}
            <Magnetic><button className="btn lift" onClick={() => onNav("events")}
              style={{ ...btnPurple, padding: "13px 24px", borderRadius: 12, fontSize: 15 }}>
              Get Involved
            </button></Magnetic>
          </Reveal>
        )}
        {onNav && (
          <Reveal variant="rise" distance={20} delay={140}>
            {/* Learn More -> About page. */}
            <button className="btn lift" onClick={() => onNav("about")}
              style={{ padding: "13px 24px", borderRadius: 12, fontWeight: 700, fontSize: 15,
                background: "transparent", color: "var(--text)", cursor: "pointer",
                border: "1px solid var(--border-strong)", fontFamily: "inherit" }}>
              Learn More
            </button>
          </Reveal>
        )}
      </div>
    </Band>
  );
}

/* ---------- INSTAGRAM ---------- */
/* Admin pastes individual post URLs (same list-editor pattern as the photo
   gallery); each renders as a genuinely embedded post via Instagram's own
   oEmbed script (embed.js) — no API tokens, no backend. embed.js scans the
   page once loaded for `.instagram-media` blockquotes and swaps each into
   a real iframe; re-running `window.instgrm.Embeds.process()` is what
   picks up any blockquote added after that initial scan (e.g. when an
   admin adds a new post without a full page reload). */
function InstagramEmbed({ url }) {
  useEffect(() => {
    const process = () => window.instgrm?.Embeds?.process();
    if (window.instgrm) { process(); return; }
    const existing = document.querySelector('script[src="https://www.instagram.com/embed.js"]');
    if (existing) { existing.addEventListener("load", process, { once: true }); return; }
    const script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.addEventListener("load", process, { once: true });
    document.body.appendChild(script);
  }, [url]);
  return (
    <blockquote className="instagram-media" data-instgrm-permalink={url} data-instgrm-version="14"
      style={{ margin: "0 auto", maxWidth: 400, minWidth: 280, width: "100%", background: "#fff",
        borderRadius: 14 }} />
  );
}

function InstagramSection({ data }) {
  const ig = data.instagram || seed.instagram;
  const posts = (ig.posts || []).filter((p) => p.url);
  const handle = (ig.handle || "").replace(/^@/, "").trim();
  return (
    <Band id="instagram" alt lattice rosettes="wide" light lightTone="rose" lightAt="top-right">
      <SectionCopy data={data} sectionKey="instagram" />
      {handle && (
        <Reveal variant="rise" distance={16}>
          <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noopener noreferrer"
            className="lift" style={{ display: "inline-flex", alignItems: "center", gap: 8,
              marginBottom: 22, padding: "10px 18px", borderRadius: 999, textDecoration: "none",
              fontWeight: 700, fontSize: 14, color: "#fff",
              background: "linear-gradient(135deg,#833AB4,#FD1D1D,#FCB045)" }}>
            <Instagram size={16} /> Follow @{handle}
          </a>
        </Reveal>
      )}
      {posts.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 20, justifyItems: "center" }}>
          {posts.map((p, i) => (
            <Reveal key={p.id ?? i} delay={i * 70} variant="rise" distance={20}>
              <InstagramEmbed url={p.url} />
            </Reveal>
          ))}
        </div>
      ) : handle ? (
        /* No individual permalinks set → embed the live @handle profile so
           the section is always a real feed, never a placeholder block. */
        <Reveal variant="rise" distance={18}>
          <InstagramProfileEmbed handle={handle} />
        </Reveal>
      ) : null}
    </Band>
  );
}

/* Live profile feed embed. Instagram's own embed.js renders a permalink
   blockquote; for a profile we use a lightweight, privacy-respecting
   iframe to the public profile-embed grid, with a graceful link-out card
   if the embed is blocked. */
function InstagramProfileEmbed({ handle }) {
  const [failed, setFailed] = useState(false);
  const clean = handle.replace(/^@/, "").trim();
  const profileUrl = `https://www.instagram.com/${clean}/`;
  const embedSrc = `https://www.instagram.com/${clean}/embed`;

  if (failed) {
    return (
      <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="lift"
        style={{ display: "block", maxWidth: 400, margin: "0 auto", padding: 28,
          borderRadius: 16, textDecoration: "none", color: "var(--text)",
          background: "var(--surface)", border: "1px solid var(--border)", textAlign: "center" }}>
        <Instagram size={30} style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 700, fontSize: 16 }}>@{clean}</div>
        <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 6 }}>
          View the latest posts on Instagram
        </div>
      </a>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", width: "100%" }}>
      <iframe
        title={`Instagram — @${clean}`}
        src={embedSrc}
        loading="lazy"
        onError={() => setFailed(true)}
        scrolling="no"
        style={{ width: "100%", height: 480, border: "1px solid var(--border)",
          borderRadius: 14, background: "#fff", overflow: "hidden" }}
      />
    </div>
  );
}

/* ---------- TIKTOK ────────────────────────────────────────────────────
   Same admin pattern as Instagram above: paste individual video URLs,
   each renders via TikTok's own oEmbed widget (embed.js). TikTok has no
   public equivalent of Instagram's profile-grid iframe, so with no posts
   set this just shows a "Follow us" card instead of trying to fake a
   live feed. ── */
// Loads TikTok's embed.js once and re-triggers its scan for any embed
// component (video or creator profile) mounted after the first load —
// same idea as InstagramEmbed's loader above, just shared across both
// TikTok embed kinds so there's one script tag total no matter how many
// blockquotes end up on the page.
function useTikTokEmbedScript(dep) {
  useEffect(() => {
    // embed.js scans the page for tiktok-embed blockquotes on its own
    // load and sets up a MutationObserver for anything added afterward
    // (e.g. an admin adding a video/handle without a full page reload),
    // so all this needs to do is make sure exactly one copy of the
    // script tag ever gets added.
    if (document.querySelector('script[src="https://www.tiktok.com/embed.js"]')) return;
    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    document.body.appendChild(script);
  }, [dep]);
}

function TikTokEmbed({ url }) {
  useTikTokEmbedScript(url);
  return (
    <blockquote className="tiktok-embed" cite={url} data-video-id="" style={{ maxWidth: 325,
      minWidth: 260, margin: "0 auto" }}>
      <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
    </blockquote>
  );
}

// TikTok's official Creator Profile Embed
// (https://developers.tiktok.com/doc/embed-creator-profiles) — the same
// embed.js script renders this into a live card with avatar, follower/
// following/likes counts, and up to 10 of the account's most recent
// videos, auto-updating with no admin upkeep. This is what shows when no
// individual video URLs have been pinned, mirroring how the Instagram
// section falls back to a live profile embed.
function TikTokProfileEmbed({ handle }) {
  const cite = `https://www.tiktok.com/@${handle}`;
  useTikTokEmbedScript(handle);
  return (
    <div style={{ maxWidth: 720, minWidth: 288, margin: "0 auto", width: "100%" }}>
      <blockquote className="tiktok-embed" cite={cite} data-unique-id={handle}
        data-embed-type="creator" data-embed-from="oembed"
        style={{ maxWidth: 720, minWidth: 288, margin: "0 auto" }}>
        <section>
          <a target="_blank" rel="noopener noreferrer" href={`${cite}?refer=creator_embed`}>@{handle}</a>
        </section>
      </blockquote>
    </div>
  );
}

function TikTokSection({ data }) {
  const tk = data.tiktok || seed.tiktok;
  const posts = (tk.posts || []).filter((p) => p.url);
  const handle = (tk.handle || "").replace(/^@/, "").trim();
  return (
    <Band id="tiktok" lattice rosettes="wide" light lightTone="violet" lightAt="top-left">
      <SectionCopy data={data} sectionKey="tiktok" />
      {handle && (
        <Reveal variant="rise" distance={16}>
          <a href={`https://www.tiktok.com/@${handle}`} target="_blank" rel="noopener noreferrer"
            className="lift" style={{ display: "inline-flex", alignItems: "center", gap: 8,
              marginBottom: 22, padding: "10px 18px", borderRadius: 999, textDecoration: "none",
              fontWeight: 700, fontSize: 14, color: "#fff", background: "#000" }}>
            <TikTokIcon size={16} /> Follow @{handle}
          </a>
        </Reveal>
      )}
      {posts.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 20, justifyItems: "center" }}>
          {posts.map((p, i) => (
            <Reveal key={p.id ?? i} delay={i * 70} variant="rise" distance={20}>
              <TikTokEmbed url={p.url} />
            </Reveal>
          ))}
        </div>
      ) : handle ? (
        /* No individual video URLs pinned → the live creator profile
           embed (avatar, stats, recent videos) so the section is never
           just a placeholder, same as Instagram's fallback above. */
        <Reveal variant="rise" distance={18}>
          <TikTokProfileEmbed handle={handle} />
        </Reveal>
      ) : null}
    </Band>
  );
}

/* ---------- CONNECT ---------- */
function ConnectSection({ data }) {
  const c = data.contact || seed.contact;
  const bg = (k) => ({
    discord: "#5865F2", instagram: "linear-gradient(135deg,#833AB4,#FD1D1D,#FCB045)",
    facebook: "#1877F2", tiktok: "#000000", linkedin: "#0A66C2",
    donate: `linear-gradient(135deg,${PURPLE},${GOLD})`, link: PURPLE,
  }[k] || PURPLE);
  const items = [
    { key: "email", href: `mailto:${c.email}`, external: false,
      icon: <Mail size={22} color="#fff" />, bg: `linear-gradient(135deg, ${PURPLE}, ${VIOLET})`,
      label: "Email us", sub: c.email },
    ...(data.links || []).map((l) => ({
      key: l.id, href: safeHref(l.href), external: true,
      icon: linkIcon(l.kind), bg: bg(l.kind), label: l.name, sub: "Open" })),
  ];
  return (
    <Band id="connect" lattice decor="left" rosettes="wide" light lightTone="rose" lightAt="top-left">
      <SectionCopy data={data} sectionKey="connect" />
      <InteractiveLinkGrid items={items} />
    </Band>
  );
}

/* Find Your People — link tiles with the "interactive grid" hover
   treatment (https://www.originkit.dev/components/interactive-grid): the
   tile under the cursor pops up and its four orthogonal neighbours (not
   diagonal) lift slightly with it, like a soft ripple through the grid.
   The reference component is a wall of bare logos with no labels; ours
   keeps icon + name + a one-line sub so it's still usable as real
   navigation, not just decoration. Neighbour math needs a fixed column
   count to know who's "above/below/left/right" of the hovered tile, so
   columns track viewport width the same way BoardSection's perPage does. */
function InteractiveLinkGrid({ items }) {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const calc = () => setCols(window.innerWidth < 560 ? 2 : window.innerWidth < 860 ? 3 : 4);
    calc();
    window.addEventListener("resize", calc, { passive: true });
    return () => window.removeEventListener("resize", calc);
  }, []);
  const [hovered, setHovered] = useState(null);
  const leaveTimer = useRef(null);
  const reduced = useReducedMotion();
  const n = items.length;

  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  const neighbours = React.useMemo(() => {
    if (hovered === null) return [];
    const out = [];
    if (hovered % cols !== 0) out.push(hovered - 1);
    if (hovered % cols !== cols - 1) out.push(hovered + 1);
    out.push(hovered - cols);
    out.push(hovered + cols);
    return out.filter((x) => x >= 0 && x < n);
  }, [hovered, cols, n]);

  const onEnter = (i) => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setHovered(i);
  };
  const onLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(null), 200);
  };

  return (
    <div onPointerLeave={onLeave} style={{ display: "grid",
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14 }}>
      {items.map((it, i) => {
        const isBig = !reduced && hovered === i;
        const isSmall = !reduced && !isBig && neighbours.includes(i);
        return (
          <Reveal key={it.key} delay={i * 55} variant="rise" distance={22}>
            <a href={it.href} target={it.external ? "_blank" : undefined}
              rel={it.external ? "noopener noreferrer" : undefined}
              onPointerEnter={() => onEnter(i)}
              style={{ ...card, position: "relative", display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 10, padding: "24px 14px",
                textDecoration: "none", height: "100%", boxSizing: "border-box",
                zIndex: isBig ? n + 1 : i + 1,
                transform: isBig ? "translate3d(0,-6px,0) scale(1.08)"
                  : isSmall ? "scale(1.035)" : "none",
                boxShadow: isBig ? "0 18px 36px rgba(20,17,24,.24)" : card.boxShadow,
                transition: reduced ? "none"
                  : `transform ${DUR.base}ms ${EASE.spring}, box-shadow ${DUR.base}ms ${EASE.out}` }}>
              <div style={{ width: 50, height: 50, borderRadius: 13, background: it.bg,
                display: "grid", placeItems: "center", flexShrink: 0 }}>
                {it.icon}
              </div>
              <div style={{ textAlign: "center", minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14.5 }}>{it.label}</div>
                {it.sub && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {it.sub}</div>
                )}
              </div>
            </a>
          </Reveal>
        );
      })}
    </div>
  );
}

function Footer({ onAdmin, data, onNav }) {
  const links = data?.links || [];
  const contact = data?.contact || seed.contact;
  const donate = data?.donate || seed.donate;
  const find = (kind, match) => links.find((l) =>
    l.kind === kind && (!match || new RegExp(match, "i").test(l.name || "")));
  const instagram = find("instagram");
  const discord = find("discord");
  const facebook = find("facebook");
  const tiktok = find("tiktok");
  const linkedin = find("linkedin");

  const socials = [
    instagram && { key: "ig", href: instagram.href, label: "Instagram", Icon: Instagram },
    tiktok && { key: "tt", href: tiktok.href, label: "TikTok", Icon: TikTokIcon },
    discord && { key: "dc", href: discord.href, label: "Discord", Icon: DiscordIcon },
    linkedin && { key: "li", href: linkedin.href, label: "LinkedIn", Icon: LinkedInIcon },
    facebook && { key: "fb", href: facebook.href, label: "Facebook", Icon: Facebook },
    { key: "mail", href: `mailto:${contact.email}`, label: "Email", Icon: Mail },
  ].filter(Boolean);

  const columns = [
    { title: "Explore", items: [
      { label: "About", id: "about" },
      { label: "Events", id: "events" },
      { label: "Programs", id: "programs" },
      { label: "Prayer", id: "prayer" },
    ]},
    { title: "Community", items: [
      { label: "Board", id: "board" },
      { label: "Islamic House", id: "islamic-house" },
      { label: "Announcements", id: "home" },
      { label: "Connect", id: "connect" },
    ]},
    { title: "Support", items: [
      { label: "Donate to MSA", href: safeHref(donate.msaUrl) },
      { label: "Support Islamic House", href: safeHref(donate.houseUrl) },
      { label: "Sponsors", id: "sponsors" },
    ]},
  ];

  return (
    <footer style={{ background: INK, color: "rgba(255,255,255,.72)", padding: 0,
      position: "relative", overflow: "hidden" }}>
      <GirihBand color="rgba(201,182,136,.35)" height={34} opacity={1} unit={48} />
      <div aria-hidden="true" style={{ position: "absolute", top: "20%", right: "-4%",
        pointerEvents: "none", zIndex: 0 }}>
        <ScrollSpin speed={-16}>
          <Rosette points={12} skip={5} size={280} color={GOLD} opacity={0.07} />
        </ScrollSpin>
      </div>

      <div style={{ position: "relative", zIndex: 1, padding: "48px 20px 30px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid",
          gridTemplateColumns: "1.4fr repeat(3, 1fr)", gap: 34 }} className="foot-grid">

          {/* Brand + socials */}
          <div>
            <button onClick={() => onNav?.("home")} style={{ display: "flex", alignItems: "center",
              gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer",
              marginBottom: 14 }}>
              <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="MSA at UW logo"
                style={{ width: 44, height: 44, objectFit: "contain" }} />
              <span style={{ fontWeight: 800, fontSize: 17, color: "#fff", letterSpacing: "-.3px" }}>
                MSA <span style={{ color: GOLD }}>UW</span>
              </span>
            </button>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.7, maxWidth: 300 }}>
              A home for Muslim students at the University of Washington — worship,
              learning, friendship, and service since 1968.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {socials.map(({ key, href, label, Icon }) => (
                <a key={key} href={href}
                  target={href.startsWith("mailto:") ? undefined : "_blank"}
                  rel={href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                  aria-label={label} title={label} className="socialbtn">
                  <Icon size={17} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "1.6px",
                textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 14 }}>
                {col.title}</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 9 }}>
                {col.items.map((it) => (
                  <li key={it.label}>
                    {it.href ? (
                      <a href={it.href} target="_blank" rel="noopener noreferrer" className="footlink">
                        {it.label}
                      </a>
                    ) : (
                      <button onClick={() => onNav?.(it.id)} className="footlink"
                        style={{ background: "none", border: "none", padding: 0,
                          cursor: "pointer", fontFamily: "inherit" }}>
                        {it.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Donate strip */}
        <div style={{ maxWidth: 1200, margin: "34px auto 0" }}>
          <a className="btn" href={safeHref(donate.msaUrl)} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              padding: "14px 22px", borderRadius: 12, textDecoration: "none",
              fontWeight: 700, fontSize: 15, color: "#2c2418",
              background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)` }}>
            <Heart size={17} /> Give today
          </a>
        </div>

        {/* Bottom bar */}
        <div style={{ maxWidth: 1200, margin: "26px auto 0", paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,.12)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 16, flexWrap: "wrap", fontSize: 12.5 }}>
            <div>
              © {new Date().getFullYear()} Muslim Students Association at the University of
              Washington. A UW Registered Student Organization.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <a href={`mailto:${contact.email}`} className="footlink">{contact.email}</a>
              <button onClick={onAdmin} className="footlink"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                  fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Lock size={13} /> Admin
              </button>
            </div>
          </div>

          {/* Lighter secondary line: RSO disclaimer + non-profit note + policy links.
              Kept visually quieter (smaller, dimmer) than the main copyright line above,
              per the request that this read as a lighter footnote underneath it. */}
          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: "8px 24px",
            alignItems: "baseline", justifyContent: "space-between" }}>
            <p style={{ margin: 0, maxWidth: 640, fontSize: 11, lineHeight: 1.6,
              color: "rgba(255,255,255,.4)" }}>
              MSA UW is a student-run, non-profit Registered Student Organization. Views and
              activities are those of the organization and do not represent official
              positions of the University of Washington.
            </p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <a href="https://www.washington.edu/online/privacy/" target="_blank"
                rel="noopener noreferrer" className="footlink-faint">Privacy</a>
              <a href="https://www.washington.edu/accessibility/" target="_blank"
                rel="noopener noreferrer" className="footlink-faint">Accessibility</a>
              <a href="https://www.washington.edu/civilrights/policies-and-guidance/statement-of-nondiscrimination/"
                target="_blank" rel="noopener noreferrer" className="footlink-faint">Non-Discrimination</a>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .footlink { color: rgba(255,255,255,.72); text-decoration: none; font-size: 13.5;
                    transition: color ${DUR.fast}ms ${EASE.out}, transform ${DUR.fast}ms ${EASE.out};
                    display: inline-block; }
        .footlink:hover { color: ${GOLD}; transform: translateX(2px); }
        .footlink-faint { color: rgba(255,255,255,.4); text-decoration: none; font-size: 11px;
                    transition: color ${DUR.fast}ms ${EASE.out}; white-space: nowrap; }
        .footlink-faint:hover { color: ${GOLD}; }
        .socialbtn { width: 38px; height: 38px; border-radius: 11px; display: grid;
                     place-items: center; color: rgba(255,255,255,.82);
                     background: rgba(255,255,255,.07);
                     border: 1px solid rgba(255,255,255,.13);
                     transition: transform ${DUR.fast}ms ${EASE.spring},
                                 background ${DUR.fast}ms ${EASE.out},
                                 color ${DUR.fast}ms ${EASE.out},
                                 border-color ${DUR.fast}ms ${EASE.out}; }
        .socialbtn:hover { transform: translateY(-3px); color: ${INK};
                           background: ${GOLD}; border-color: ${GOLD}; }
        @media (max-width: 860px) {
          .foot-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 560px) {
          .foot-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </footer>
  );
}

/* ============================================================
   ADMIN
   ============================================================ */
function AdminPanel({ data, setData, isAdmin, setIsAdmin, persist, saving, onClose }) {
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
                { group: "Community", items: [["board", "Board members"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["mailing", "Mailing list"]] },
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
    const edit = (i, patch) => {
      const c = [...board]; c[i] = { ...c[i], ...patch }; setBoard(c);
    };
    const add = (status) => setBoard([...board, {
      id: Date.now(), name: "New member", role: "Role", status,
      img: "", href: "", bio: "",
    }]);
    const groups = [["current", "Current board"], ["previous", "Previous board"]];
    return (
      <Section title="Board members">
        <p style={{ margin: "-8px 0 18px", fontSize: 13, color: "var(--text-faint)", lineHeight: 1.6 }}>
          Photos upload to storage; the link is optional and opens when someone clicks the card.
          Move a member to “Previous” at the end of their term rather than deleting them.
        </p>
        {groups.map(([status, label]) => {
          const groupIdxs = board.reduce((acc, m, idx) => {
            if ((m.status || "current") === status) acc.push(idx);
            return acc;
          }, []);
          return (
          <div key={status} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--accent)" }}>
                {label}</h4>
              <button onClick={() => add(status)} style={miniBtn}>
                <Plus size={14} /> Add</button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              {board.filter((m) => (m.status || "current") === status).length === 0 && (
                <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8,
                  textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
                  None yet</div>
              )}
              {/* Reorder within a group (Current / Previous) by swapping with the
                  nearest neighbour that shares the same status — `i` below is
                  the real index into the full `board` array, but `pos`/`groupIdxs`
                  track this member's position within just its own group, since
                  Current and Previous members are interleaved in the array. */}
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
                      Link (optional)</label>
                    <input style={inpSm} placeholder="https://…" value={m.href || ""}
                      onChange={(e) => edit(i, { href: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>
                      Mini bio</label>
                    <textarea style={{ ...inpSm, minHeight: 70, resize: "vertical" }}
                      value={m.bio || ""} onChange={(e) => edit(i, { bio: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>Status</label>
                    <select style={inpSm} value={m.status || "current"}
                      onChange={(e) => edit(i, { status: e.target.value })}>
                      <option value="current">Current</option>
                      <option value="previous">Previous</option>
                    </select>
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
          </div>
          );
        })}
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

const lbl = { fontSize: 12, fontWeight: 600, color: "var(--text-faint)" };

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

/* ---------- shared styles ---------- */
const card = { background: "var(--surface)", borderRadius: 18, border: "1px solid var(--border)",
  boxShadow: "var(--card-shadow)" };
const btnGold = { background: GOLD, color: "#2c2418", border: "none", padding: "14px 28px",
  borderRadius: 12, fontWeight: 700, fontSize: 15.5, cursor: "pointer", fontFamily: "inherit" };
const btnGhost = { background: "rgba(255,255,255,.12)", color: "#fff",
  border: "1px solid rgba(255,255,255,.35)", padding: "14px 28px", borderRadius: 12,
  fontWeight: 600, fontSize: 15.5, cursor: "pointer", fontFamily: "inherit" };
const btnPurple = { background: PURPLE, color: "#fff", border: "none", padding: "11px 20px",
  borderRadius: 10, fontWeight: 600, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit" };
const inp = { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border-strong)",
  fontSize: 14.5, fontFamily: "inherit", outline: "none",
  background: "var(--surface)", color: "var(--text)" };
const inpSm = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border-strong)",
  fontSize: 13.5, fontFamily: "inherit", outline: "none",
  background: "var(--surface)", color: "var(--text)" };
const miniBtn = { display: "inline-flex", alignItems: "center", gap: 5, background: PURPLE, color: "#fff",
  border: "none", padding: "5px 11px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit" };
const delBtn = { background: "rgba(192,57,43,.1)", color: "#c0392b", border: "none", borderRadius: 8,
  width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer" };

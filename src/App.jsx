import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase, loadContent, saveContent, uploadImage, deleteImage, pathFromUrl,
  subscribe, listSubscribers } from "./supabase";
// Lazy — keeps anime.js out of the initial bundle. It only downloads when
// a visitor actually scrolls near the Quad section.
const QuadTree = React.lazy(() => import("./QuadTree.jsx"));
import {
  Menu, X, Heart, MapPin, Clock, Calendar, Users, BookOpen,
  ShoppingBag, Instagram, Facebook, MessageCircle, Link2,
  Lock, LogOut, Plus, Trash2, Edit3, ChevronLeft, ChevronRight,
  Home, Star, HandHeart, GraduationCap, Sparkles, ExternalLink, Save,
  Sun, Moon, ChevronDown, Mail, Send, CalendarDays, LayoutGrid, Info, Search
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

const MERCH_URL = "https://intentionshq.com/products/msa-x-intentions-off-white-hoodie";

/* Nav is grouped so it stays readable as the site grows. Top-level items
   show on desktop; `children` render in a dropdown. On mobile everything
   flattens into one scrollable list. */
const NAV = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "prayer", label: "Prayer" },
  { id: "events", label: "Events" },
  {
    label: "Community", children: [
      { id: "programs", label: "Programs" },
      { id: "board", label: "Board" },
      { id: "islamic-house", label: "Islamic House" },
      { id: "sponsors", label: "Sponsors" },
    ],
  },
  {
    label: "More", children: [
      { id: "announcements", label: "Announcements" },
      { id: "connect", label: "Connect" },
      { id: "contact", label: "Contact" },
      { id: "merch", label: "Merch", external: true, href: MERCH_URL },
    ],
  },
  { id: "donate", label: "Donate", cta: true },
];

// Flat list of in-page section ids, used by the scroll spy.
const SECTION_IDS = NAV.flatMap((n) =>
  n.children ? n.children.filter((c) => !c.external).map((c) => c.id)
             : (n.id ? [n.id] : [])
);

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
  const id = "girih-" + Math.round(unit) + "-" + color.replace("#", "");
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

// Single source of truth for the reduced-motion preference, kept live so
// the site responds if the user changes it mid-session.
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = (e) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
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
      const href = tok.slice(close + 2, -1);
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

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => { target.current = (window.scrollY / 100) * speed; };
    const tick = () => {
      current.current += (target.current - current.current) * 0.07;
      el.style.transform = `rotate(${current.current.toFixed(2)}deg)`;
      raf.current = requestAnimationFrame(tick);
    };
    measure();
    current.current = target.current;
    el.style.transform = `rotate(${current.current.toFixed(2)}deg)`;
    raf.current = requestAnimationFrame(tick);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("scroll", measure);
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

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;

    // Read scroll position into a target, then ease toward it every frame.
    // The interpolation is what removes the "stepping" feel of raw scroll
    // parallax and gives it the smooth, weighted quality of a good agency site.
    const measure = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (r.top + r.height / 2 - vh / 2) / vh;
      target.current = progress * speed * 100;
    };

    const tick = () => {
      current.current += (target.current - current.current) * 0.085; // lerp
      if (el) el.style.transform = `translate3d(0, ${current.current.toFixed(2)}px, 0)`;
      raf.current = requestAnimationFrame(tick);
    };

    measure();
    current.current = target.current;
    el.style.transform = `translate3d(0, ${current.current.toFixed(2)}px, 0)`;
    raf.current = requestAnimationFrame(tick);

    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
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
function Blossom({ size = 18, color = PINK, cx = 0, cy = 0, rot = 0 }) {
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 - 90) * (Math.PI / 180);
    const px = cx + Math.cos(a) * size * 0.28, py = cy + Math.sin(a) * size * 0.28;
    petals.push(
      <ellipse key={i} cx={px} cy={py} rx={size * 0.26} ry={size * 0.34}
        transform={`rotate(${i * 72 + rot} ${px} ${py})`} fill={color} opacity="0.9" />
    );
  }
  return <g>{petals}<circle cx={cx} cy={cy} r={size * 0.11} fill={GOLD} opacity="0.95" /></g>;
}

function SakuraBranch({ width = 260, flip = false, opacity = 0.9, style }) {
  return (
    <svg width={width} height={width * 0.62} viewBox="0 0 260 160" aria-hidden="true"
      style={{ transform: flip ? "scaleX(-1)" : "none", opacity, display: "block", ...style }}>
      <path d="M-5 26 C60 34, 96 52, 132 78 C158 96, 190 106, 232 106"
        stroke="#5a4636" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M60 33 C74 46, 82 60, 84 76" stroke="#5a4636" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M132 78 C138 62, 150 50, 168 44" stroke="#5a4636" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M186 100 C196 86, 208 78, 224 74" stroke="#5a4636" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <Blossom cx={26} cy={28} size={22} color={PINK} rot={10} />
      <Blossom cx={70} cy={36} size={17} color="#e8c4d4" rot={30} />
      <Blossom cx={86} cy={78} size={19} color={MAUVE} rot={-15} />
      <Blossom cx={134} cy={80} size={22} color={PINK} rot={22} />
      <Blossom cx={168} cy={44} size={18} color="#e8c4d4" rot={-8} />
      <Blossom cx={192} cy={100} size={16} color={MAUVE} rot={40} />
      <Blossom cx={226} cy={72} size={20} color={PINK} rot={-25} />
      <Blossom cx={236} cy={108} size={15} color="#e8c4d4" rot={12} />
    </svg>
  );
}

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
    <section style={{ position: "relative", overflow: "hidden", background: INK,
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
      <Parallax speed={0.25} float style={{ top: -30, left: -40, opacity: .5 }}>
        <SakuraBranch width={240} opacity={.55} />
      </Parallax>
      <Parallax speed={-0.2} float style={{ bottom: -20, right: -30, opacity: .5 }}>
        <SakuraBranch width={220} flip opacity={.55} />
      </Parallax>
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
  // ── Hero background video ─────────────────────────────────────────────
  // Drop a file in public/ (e.g. public/hero.mp4) and put its name here.
  // Leave `src` blank and the hero keeps its gradient — nothing breaks.
  heroVideo: {
    src: "",           // e.g. "hero.mp4"
    poster: "",        // e.g. "hero-poster.jpg" — shown while the video loads
    dim: 0.55,         // 0–1, how much to darken the footage for text contrast
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
    features: [
      { id: 1, title: "Daily prayers", text: "All five prayers in congregation, every day." },
      { id: 2, title: "Jummah", text: "Two khutbahs each Friday — check the prayer section for times." },
      { id: 3, title: "Ramadan", text: "Nightly iftars and taraweeh throughout the month." },
      { id: 4, title: "Community space", text: "A place to study, rest, and gather between classes." },
    ],
    photos: [],
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
  prayerSpaces: [
    { id: 1, name: "HUB Reflection Room", loc: "Husky Union Building, Room 145", note: "Open during building hours · wudu station nearby" },
    { id: 2, name: "Islamic House", loc: "Near NE 45th St", note: "Full masjid · all five daily prayers" },
    { id: 3, name: "Odegaard Quiet Room", loc: "Odegaard Library, Ground Floor", note: "Quiet reflection · prayer mats available" },
    { id: 4, name: "Engineering Prayer Space", loc: "ECE Building", note: "Reservable · check MSA Discord for access" },
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
    { id: 6, name: "Guide to being a Muslim at UW", href: "https://docs.google.com/document/d/16K_gyLqsaIWM-s6BXqNTarokx8q9srlzK3433G9VFZ0/edit?usp=sharing", kind: "link" },
    { id: 7, name: "Donate to MSA UW 💜", href: "https://www.zeffy.com/en-US/donation-form/44131d7a-557e-4fdc-9a70-14e9f67206ef", kind: "donate" },
    { id: 8, name: "Donate to the Islamic House", href: "https://www.zeffy.com/en-US/donation-form/0b12beb3-2da5-4c6b-87b9-cfc84cf47e6a", kind: "donate" },
  ],
};

const progIcon = (k, c = PURPLE) => {
  const p = { size: 26, color: c };
  return { book: <BookOpen {...p} />, star: <Star size={26} color={c} />, grad: <GraduationCap {...p} />,
    sparkles: <Sparkles {...p} />, hand: <HandHeart {...p} />, users: <Users {...p} /> }[k] || <Star size={26} color={c} />;
};

const linkIcon = (k) => {
  const p = { size: 24, color: "#fff" };
  return { link: <Link2 {...p} />, discord: <MessageCircle {...p} />, facebook: <Facebook {...p} />,
    instagram: <Instagram {...p} />, donate: <Heart {...p} /> }[k] || <Link2 {...p} />;
};

/* Merges saved content over the built-in defaults. Nested objects
   (sections, prayerTimes, hero, events) merge key-by-key so a field the
   admin has never touched keeps its default instead of vanishing. Arrays
   are replaced wholesale — an admin deleting the last item must stick. */
function mergeContent(base, saved) {
  const out = { ...base, ...saved };
  for (const key of ["hero", "sections", "prayerTimes", "events", "about",
                     "islamicHouse", "contact", "donate", "eventsExtra",
                     "bar", "heroVideo", "mailing"]) {
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
  const [data, setData] = useState(seed);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("home");
  const [adminOpen, setAdminOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

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
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    return true;
  });
  useEffect(() => {
    try { localStorage.setItem("msa-petals", petals ? "on" : "off"); } catch {}
  }, [petals]);

  // On load: pull saved content from Supabase (fall back to seed if empty),
  // and check whether an admin session is already active.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await loadContent();
      if (!cancelled && remote) setData(mergeContent(seed, remote));
      const { data: { session } } = await supabase.auth.getSession();
      if (!cancelled) { setIsAdmin(!!session); setLoaded(true); }
    })();
    // keep isAdmin in sync if the session changes (login/logout/expiry)
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAdmin(!!session);
    });
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

  const scrollTo = useCallback((id) => {
    setMenuOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // scroll spy
  useEffect(() => {
    const ids = SECTION_IDS;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [loaded]);

  return (
    <div data-theme={dark ? "dark" : "light"}
      style={{ fontFamily: "'Poppins', system-ui, sans-serif",
        color: "var(--text)", background: "var(--bg)", minHeight: "100vh" }}>
      <StyleTag />
      {petals && <SakuraWind dark={dark} />}
      <AnnouncementBar bar={data.bar} onNav={scrollTo} />
      <Nav active={active} onNav={scrollTo} menuOpen={menuOpen} setMenuOpen={setMenuOpen}
           onAdmin={() => setAdminOpen(true)} isAdmin={isAdmin}
           dark={dark} onToggleDark={() => setDark((d) => !d)}
           petals={petals} onTogglePetals={() => setPetals((p) => !p)}
           onSearch={() => setSearchOpen(true)} />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)}
        data={data} onNav={scrollTo} />
      <main>
        <HomeSection data={data} onNav={scrollTo} />
        <AnnouncementsSection data={data} />
        <DonateSection data={data} />
        <AboutSection data={data} />
        <QuadSection data={data} />
        <PrayerSection data={data} />
        <IslamicHouseSection data={data} />
        <SponsorsSection data={data} />
        <EventsSection data={data} />
        <StatsBand stats={data.stats || []} />
        <ProgramsSection data={data} />
        <BoardSection data={data} />
        <ConnectSection data={data} />
        <MailingList data={data} />
        <ContactSection data={data} />
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
  );
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

function Nav({ active, onNav, menuOpen, setMenuOpen, onAdmin, dark, onToggleDark,
  petals, onTogglePetals, onSearch }) {
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

  const groupActive = (item) =>
    item.children?.some((c) => c.id === active);

  const go = (id) => { setOpenMenu(null); setMenuOpen(false); onNav(id); };

  return (
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
        <button className="btn logomark" onClick={() => go("home")} aria-label="MSA at UW — home"
          style={{ display: "flex", alignItems: "center", gap: 10, background: "none",
            border: "none", cursor: "pointer", padding: 0, height: 44, flexShrink: 0 }}>
          <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="MSA at UW logo"
            style={{ height: 44, width: 44, borderRadius: 10, objectFit: "cover",
              transformOrigin: "left center",
              transform: solid ? "scale(.86)" : "scale(1)",
              transition: `transform ${DUR.base}ms ${EASE.out}` }} />
        </button>

        {/* ── Desktop ─────────────────────────────────────────────────── */}
        <div className="desk" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {NAV.map((item) => {
            if (item.children) {
              const isOpen = openMenu === item.label;
              return (
                <div key={item.label} style={{ position: "relative" }}>
                  <button className="navlink"
                    onClick={() => setOpenMenu(isOpen ? null : item.label)}
                    aria-expanded={isOpen} aria-haspopup="true"
                    style={{ ...navLink(groupActive(item)), display: "inline-flex",
                      alignItems: "center", gap: 5 }}>
                    {item.label}
                    <ChevronDown size={13} style={{
                      transform: isOpen ? "rotate(180deg)" : "none",
                      transition: `transform ${DUR.fast}ms ${EASE.out}` }} />
                  </button>
                  <div role="menu" style={{
                    position: "absolute", top: "calc(100% + 8px)", left: 0, minWidth: 190,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 14, padding: 6, boxShadow: "var(--card-shadow-hover)",
                    transformOrigin: "top left",
                    opacity: isOpen ? 1 : 0,
                    transform: isOpen ? "translate3d(0,0,0) scale(1)" : "translate3d(0,-6px,0) scale(.97)",
                    pointerEvents: isOpen ? "auto" : "none",
                    transition: `opacity ${DUR.fast}ms ${EASE.out}, transform ${DUR.fast}ms ${EASE.out}`,
                  }}>
                    {item.children.map((c) => c.external ? (
                      <a key={c.id} href={c.href} target="_blank" rel="noopener noreferrer"
                        role="menuitem" onClick={() => setOpenMenu(null)} style={dropItem(false)}>
                        {c.label} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <button key={c.id} role="menuitem" onClick={() => go(c.id)}
                        style={dropItem(active === c.id)}>{c.label}</button>
                    ))}
                  </div>
                </div>
              );
            }
            if (item.cta) {
              return (
                <button key={item.id} className="btn" onClick={() => go(item.id)}
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
              <button key={item.id} className="navlink" onClick={() => go(item.id)}
                style={navLink(active === item.id)}>{item.label}</button>
            );
          })}

          <button className="btn" onClick={onSearch} aria-label="Search the site"
            title="Search (⌘K)" style={iconBtn}>
            <Search size={16} color="var(--accent)" />
          </button>
          <button className="btn" onClick={onTogglePetals} aria-pressed={!!petals}
            title={petals ? "Turn off falling petals" : "Turn on falling petals"}
            aria-label={petals ? "Turn off falling petals" : "Turn on falling petals"}
            style={iconBtn}>
            <span style={{ display: "grid", placeItems: "center",
              opacity: petals ? 1 : .45,
              transform: petals ? "rotate(0deg) scale(1)" : "rotate(-18deg) scale(.9)",
              transition: `transform ${DUR.base}ms ${EASE.spring}, opacity ${DUR.fast}ms ${EASE.out}` }}>
              <PetalIcon size={17} color="var(--accent)" />
            </span>
          </button>
          <button className="btn themetoggle" onClick={onToggleDark}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} style={iconBtn}>
            <span style={{ display: "grid", placeItems: "center",
              transform: dark ? "rotate(0deg)" : "rotate(-90deg) scale(.8)",
              transition: `transform ${DUR.base}ms ${EASE.spring}` }}>
              {dark ? <Sun size={16} color="var(--accent)" /> : <Moon size={16} color="var(--accent)" />}
            </span>
          </button>
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

      {/* ── Mobile sheet ──────────────────────────────────────────────────
          Fixed below the bar and scrollable, so a long list can never run
          off-screen no matter how many items there are. */}
      <div className="mob" style={{
        display: "none", position: "fixed", left: 0, right: 0, top: 68, bottom: 0,
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
          {NAV.map((item) => {
            if (item.children) {
              return (
                <div key={item.label} style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "1.4px",
                    textTransform: "uppercase", color: "var(--text-faint)",
                    padding: "12px 8px 4px" }}>{item.label}</div>
                  {item.children.map((c) => c.external ? (
                    <a key={c.id} href={c.href} target="_blank" rel="noopener noreferrer"
                      onClick={() => setMenuOpen(false)} style={mobLink}>
                      {c.label} <ExternalLink size={14} />
                    </a>
                  ) : (
                    <button key={c.id} onClick={() => go(c.id)}
                      style={{ ...mobLink, color: active === c.id ? "var(--accent)" : "var(--nav-idle)" }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              );
            }
            if (item.cta) {
              return (
                <button key={item.id} onClick={() => go(item.id)}
                  style={{ ...mobLink, marginTop: 14, justifyContent: "center",
                    borderRadius: 12, borderBottom: "none", color: "#2c2418",
                    background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)`, fontWeight: 700 }}>
                  <Heart size={16} /> {item.label}
                </button>
              );
            }
            return (
              <button key={item.id} onClick={() => go(item.id)}
                style={{ ...mobLink, color: active === item.id ? "var(--accent)" : "var(--nav-idle)" }}>
                {item.label}
              </button>
            );
          })}

          <div style={{ height: 1, background: "var(--border)", margin: "14px 0 6px" }} />
          <button onClick={() => { setMenuOpen(false); onSearch?.(); }} style={mobLink}>
            <Search size={15} /> Search
          </button>
          <button onClick={onToggleDark} style={mobLink}>
            {dark ? <Sun size={15} /> : <Moon size={15} />} {dark ? "Light mode" : "Dark mode"}
          </button>
          <button onClick={onTogglePetals} style={mobLink} aria-pressed={!!petals}>
            <PetalIcon size={15} color="var(--accent)" />
            {petals ? "Petals: on" : "Petals: off"}
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
    </header>
  );
}

const iconBtn = {
  marginLeft: 6, display: "grid", placeItems: "center", width: 38, height: 38,
  borderRadius: 10, border: "1px solid var(--border-strong)",
  background: "var(--surface)", cursor: "pointer", flexShrink: 0,
};

const dropItem = (on) => ({
  display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
  padding: "10px 12px", borderRadius: 9, border: "none", cursor: "pointer",
  fontFamily: "inherit", fontSize: 14, fontWeight: 600, textDecoration: "none",
  background: on ? "var(--nav-active-bg)" : "transparent",
  color: on ? "var(--accent)" : "var(--nav-idle)",
  transition: `background ${DUR.fast}ms ${EASE.out}, color ${DUR.fast}ms ${EASE.out}`,
});

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
      padding: "92px 20px", background: alt ? "var(--surface)" : "transparent", ...style }}>
      {light && <SectionLight tone={lightTone} placement={lightAt} />}
      {lattice && <StarLatticeBg color="var(--lattice)" opacity={alt ? 0.055 : 0.05} unit={66} />}
      {rosettes && <EdgeRosettes arrangement={rosettes} />}
      {floats}
      {/* Parallax botanicals framing the section. `decor` picks the arrangement. */}
      {decor === "left" && (
        <>
          <Parallax speed={0.22} float style={{ top: -40, left: -70 }}>
            <SakuraBranch width={230} opacity={.16} />
          </Parallax>
          <Parallax speed={-0.16} float style={{ bottom: -30, right: -60 }}>
            <CrescentAccent size={130} opacity={.09} />
          </Parallax>
        </>
      )}
      {decor === "right" && (
        <>
          <Parallax speed={0.2} float style={{ top: -50, right: -70 }}>
            <SakuraBranch width={230} flip opacity={.16} />
          </Parallax>
          <Parallax speed={-0.18} float style={{ bottom: 10, left: -40 }}>
            <Lantern size={80} opacity={.12} />
          </Parallax>
        </>
      )}
      {decor === "both" && (
        <>
          <Parallax speed={0.24} float style={{ top: -46, left: -70 }}>
            <SakuraBranch width={210} opacity={.15} />
          </Parallax>
          <Parallax speed={0.18} float style={{ top: -30, right: -60 }}>
            <SakuraBranch width={210} flip opacity={.15} />
          </Parallax>
          <Parallax speed={-0.2} float style={{ bottom: -10, left: "45%" }}>
            <CrescentAccent size={100} opacity={.08} />
          </Parallax>
        </>
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
      <span style={{ textTransform: "uppercase", letterSpacing: "2px", fontSize: 12.5,
        fontWeight: 700, color: GOLD,
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
function HomeSection({ data, onNav }) {
  return (
    <>
      <section id="home" className="grain vignette" style={{ position: "relative", overflow: "hidden",
        background: GRAD_DEEP,   // stays as the base layer when no video is set
        color: "#fff", padding: "104px 20px 0" }}>
        <HeroVideo config={data.heroVideo} />
        <AmbientGlow />
        <PatternField />
        {/* large medallion behind the hero content, turning with scroll */}
        <div aria-hidden="true" style={{ position: "absolute", top: "8%", left: "50%",
          marginLeft: -260, pointerEvents: "none", zIndex: 0 }}>
          <ScrollSpin speed={14}>
            <Rosette points={16} skip={7} size={520} color={GOLD}
              opacity={0.11} strokeWidth={1} />
          </ScrollSpin>
        </div>
        <HangingLanterns />
        {/* central mihrab arch silhouette — strokes draw themselves in */}
        <HeroArch />
        <div style={{ maxWidth: 900, margin: "0 auto", position: "relative", zIndex: 2,
          textAlign: "center", paddingBottom: 90 }}>
          <HeroIntro delay={120} variant="scale">
            <AnimatedLogo />
          </HeroIntro>
          <HeroIntro delay={300} variant="scale">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8,
              padding: "7px 16px", borderRadius: 999, background: "rgba(201,182,136,.16)",
              border: `1px solid rgba(201,182,136,.4)`, marginBottom: 24 }}>
              <Star8 size={16} color={GOLD} /> <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".5px" }}>
                {data.hero.kicker ?? seed.hero.kicker}</span>
            </div>
          </HeroIntro>
          <h1 style={{ fontSize: "clamp(32px,5.5vw,58px)", fontWeight: 800, lineHeight: 1.08,
            letterSpacing: "-1.5px", margin: "0 0 22px" }}>
            <HeroWords text={data.hero.title} delay={430} step={62} />
          </h1>
          <HeroIntro delay={900}>
            <p style={{ fontSize: "clamp(16px,2vw,20px)", color: "rgba(255,255,255,.85)",
              maxWidth: 640, margin: "0 auto 36px", lineHeight: 1.6 }}>
              {data.hero.mission}
            </p>
          </HeroIntro>
          <HeroIntro delay={1060}>
            <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => onNav("connect")} style={btnGold}>Join MSA</button>
              <button className="btn" onClick={() => onNav("events")} style={btnGhost}>See what's on</button>
              <button className="btn donatepulse" onClick={() => onNav("donate")}
                style={{ ...btnGhost, borderColor: "rgba(201,182,136,.65)", color: GOLD,
                  display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Heart size={17} /> Donate
              </button>
            </div>
          </HeroIntro>
        </div>
        <ScrollCue onClick={() => onNav("gallery")} />
        {/* girih band along the base of the hero */}
        <div style={{ position: "relative" }}>
          <GirihBand color="rgba(183,165,122,.45)" height={54} opacity={1} unit={54} />
        </div>
      </section>

      {/* Gallery */}
      <Band id="gallery" lattice decor="left" rosettes="left" light lightTone="violet" lightAt="top-left" floats={<>
        <Parallax speed={.12} float style={{ top: 20, right: "8%" }}>
          <Star8 size={64} color="var(--rosette)" opacity={.10} /></Parallax>
        <Parallax speed={-.08} float style={{ bottom: 40, left: "4%" }}>
          <Star8 size={38} color={GOLD} opacity={.16} /></Parallax>
      </>}>
        <SectionCopy data={data} sectionKey="gallery" />
        <Gallery items={data.gallery} />
      </Band>

    </>
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
                <a href={s.url} target="_blank" rel="noopener noreferrer"
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

/* ── Hero entrance primitives ───────────────────────────────────────────
   The hero animates on mount (not on scroll — it's already in view), so
   these use a timed reveal rather than IntersectionObserver. */
function HeroIntro({ children, delay = 0, variant = "up", distance = 24,
  duration = DUR.hero, style }) {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (reduced) { setShow(true); return; }
    const t = setTimeout(() => setShow(true), 40);
    return () => clearTimeout(t);
  }, [reduced]);
  const from = variant === "scale"
    ? "translate3d(0,14px,0) scale(.94)"
    : `translate3d(0,${distance}px,0)`;
  return (
    <div style={{
      opacity: show ? 1 : 0,
      transform: show ? "translate3d(0,0,0) scale(1)" : from,
      transition: reduced ? "none"
        : `opacity ${duration}ms ${EASE.outSoft} ${delay}ms, transform ${duration}ms ${EASE.outSoft} ${delay}ms`,
      ...style,
    }}>{children}</div>
  );
}

/* Headline words rising in sequence from behind a mask. */
function HeroWords({ text, delay = 0, step = 60 }) {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (reduced) { setShow(true); return; }
    const t = setTimeout(() => setShow(true), 40);
    return () => clearTimeout(t);
  }, [reduced]);
  const words = String(text).split(" ");
  return (
    <>
      {words.map((w, i) => (
        <span key={i} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}>
          <span style={{
            display: "inline-block",
            opacity: show ? 1 : 0,
            transform: show ? "translate3d(0,0,0)" : "translate3d(0,1em,0)",
            transition: reduced ? "none"
              : `opacity ${DUR.slow}ms ${EASE.outSoft} ${delay + i * step}ms, transform ${DUR.slow}ms ${EASE.outSoft} ${delay + i * step}ms`,
          }}>{w}</span>
          {i < words.length - 1 && <span>&nbsp;</span>}
        </span>
      ))}
    </>
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

/* Hero logo — breathes gently, sits inside a soft halo, and lifts on hover.
   The halo and the float live on separate wrappers so their transforms
   never fight each other. */
function AnimatedLogo() {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block", marginBottom: 26 }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* halo */}
      <div aria-hidden="true" className={reduced ? "" : "logohalo"} style={{
        position: "absolute", left: "50%", top: "50%", width: 230, height: 230,
        marginLeft: -115, marginTop: -115, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(201,182,136,.34) 0%, transparent 66%)",
        filter: "blur(16px)", pointerEvents: "none",
      }} />
      {/* slow orbiting ring of tiny stars */}
      {!reduced && (
        <div aria-hidden="true" className="logoorbit" style={{
          position: "absolute", left: "50%", top: "50%", width: 186, height: 186,
          marginLeft: -93, marginTop: -93, pointerEvents: "none",
        }}>
          {[0, 90, 180, 270].map((deg) => (
            <span key={deg} style={{ position: "absolute", left: "50%", top: "50%",
              transform: `rotate(${deg}deg) translateY(-93px)` }}>
              <Star8 size={9} color={GOLD} opacity={.5} />
            </span>
          ))}
        </div>
      )}
      <div className={reduced ? "" : "logofloat"} style={{ position: "relative" }}>
        <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="MSA at UW logo"
          style={{ width: 132, height: 132, borderRadius: 24, objectFit: "cover",
            display: "block",
            boxShadow: hover
              ? "0 20px 54px rgba(0,0,0,.55), 0 0 0 1px rgba(201,182,136,.55)"
              : "0 12px 40px rgba(0,0,0,.5), 0 0 0 1px rgba(201,182,136,.3)",
            transform: hover ? "scale(1.045)" : "scale(1)",
            transition: `transform ${DUR.base}ms ${EASE.spring}, box-shadow ${DUR.base}ms ${EASE.out}` }} />
      </div>
    </div>
  );
}

/* ── Tasbih (misbaha) ───────────────────────────────────────────────────
   A strand of prayer beads that sways like a pendulum, with a single bead
   catching the light as it travels the loop. Drawn as one SVG so it stays
   crisp, and animated purely with transform/opacity. */
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
function HeroArch() {
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (reduced) { setDrawn(true); return; }
    const t = setTimeout(() => setDrawn(true), 120);
    return () => clearTimeout(t);
  }, [reduced]);
  // NOTE: the centering translate and the float animation must live on
  // separate elements — a CSS animation that sets `transform` would otherwise
  // overwrite `translateX(-50%)` and knock the arch off-centre.
  return (
    <div aria-hidden="true"
      style={{ position: "absolute", top: 40, left: "50%",
        transform: "translateX(-50%)", width: "min(560px, 88%)", height: "82%",
        opacity: 0.5, pointerEvents: "none" }}>
      <div className={reduced ? "" : "floaty-slow"} style={{ width: "100%", height: "100%" }}>
        <svg viewBox="0 0 200 280" width="100%" height="100%" preserveAspectRatio="none">
          <path d={archPath(200, 280, 150)} fill="none" stroke="rgba(201,182,136,.5)"
            strokeWidth="1.2" pathLength="1"
            style={{
              strokeDasharray: 1,
              strokeDashoffset: drawn ? 0 : 1,
              transition: reduced ? "none" : `stroke-dashoffset 2600ms ${EASE.outSoft} 200ms`,
            }} />
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

function Gallery({ items }) {
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const DWELL = 5600;

  const go = useCallback((n) => {
    setI((cur) => {
      if (n === cur) return cur;
      setPrev(cur);
      return (n + items.length) % items.length;
    });
  }, [items.length]);

  // Auto-advance. Pauses on hover/focus, when the tab is hidden, and for
  // reduced-motion users. Restarts cleanly whenever the slide changes.
  useEffect(() => {
    if (paused || reduced || items.length < 2) return;
    const t = setInterval(() => {
      if (!document.hidden) go(i + 1);
    }, DWELL);
    return () => clearInterval(t);
  }, [paused, reduced, items.length, i, go]);

  const grad = (n) => {
    const g = [
      `linear-gradient(135deg,${PURPLE},${VIOLET})`, `linear-gradient(135deg,${MAUVE},${PINK})`,
      `linear-gradient(135deg,${PURPLE_D},${PURPLE})`, `linear-gradient(135deg,${VIOLET},${MAUVE})`,
      `linear-gradient(135deg,${INK},${PURPLE})`, `linear-gradient(135deg,${PINK},${PURPLE})`,
    ];
    return g[n % g.length];
  };

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
         onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      {/* Featured slide — every slide is layered and crossfaded, so there is
          never a hard swap. The active slide also drifts (Ken Burns). */}
      <Reveal variant="rise" distance={34} duration={DUR.slow}>
        <div style={{ position: "relative", borderRadius: 22, overflow: "hidden",
          aspectRatio: "16 / 9", background: grad(i), marginBottom: 16,
          boxShadow: "0 24px 60px rgba(20,17,24,.22)" }}>

          {items.map((it, n) => {
            const active = n === i;
            const wasActive = n === prev;
            return (
              <div key={it.id ?? n} aria-hidden={!active} style={{
                position: "absolute", inset: 0,
                background: grad(n),
                opacity: active ? 1 : 0,
                transition: reduced ? "none"
                  : `opacity 900ms ${EASE.outSoft}`,
                zIndex: active ? 2 : wasActive ? 1 : 0,
              }}>
                {it.img ? (
                  <img src={it.img} alt={it.caption} loading={active ? "eager" : "lazy"}
                    style={{
                      position: "absolute", inset: 0, width: "100%", height: "100%",
                      objectFit: "cover",
                      transform: active ? "scale(1.06)" : "scale(1)",
                      transition: reduced ? "none" : `transform ${DWELL + 1800}ms linear`,
                      willChange: "transform",
                    }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, opacity: .15 }}><PatternField /></div>
                )}
                {/* readability scrim */}
                <div style={{ position: "absolute", inset: 0,
                  background: it.img
                    ? "linear-gradient(to top, rgba(20,17,24,.62) 0%, rgba(20,17,24,.12) 42%, transparent 68%)"
                    : "none" }} />
              </div>
            );
          })}

          {/* Caption — re-animates on each slide change via the key */}
          <div key={i} style={{ position: "absolute", inset: 0, zIndex: 3,
            display: "grid", placeItems: "center", alignContent: "end",
            textAlign: "center", color: "#fff", paddingBottom: 34,
            pointerEvents: "none" }}>
            {!items[i].img && <Star8 size={54} color="#fff" opacity={.9} />}
            <div style={{ fontSize: 13, letterSpacing: "2px", textTransform: "uppercase",
              color: "rgba(255,255,255,.85)",
              animation: reduced ? "none" : `rise ${DUR.slow}ms ${EASE.outSoft} 120ms both` }}>
              {items[i].tag}</div>
            <div style={{ fontSize: "clamp(20px,2.6vw,28px)", fontWeight: 700, marginTop: 6,
              textShadow: "0 2px 18px rgba(0,0,0,.5)",
              animation: reduced ? "none" : `rise ${DUR.slow}ms ${EASE.outSoft} 210ms both` }}>
              {items[i].caption}</div>
          </div>

          <button className="btn" onClick={() => go(i - 1)} aria-label="Previous photo"
            style={carBtn("left")}><ChevronLeft size={22} color={PURPLE} /></button>
          <button className="btn" onClick={() => go(i + 1)} aria-label="Next photo"
            style={carBtn("right")}><ChevronRight size={22} color={PURPLE} /></button>

          {/* Progress dots — active one stretches into a bar */}
          <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, zIndex: 4,
            display: "flex", justifyContent: "center", gap: 7 }}>
            {items.map((_, n) => (
              <button key={n} onClick={() => go(n)} aria-label={`Photo ${n + 1}`}
                style={{ width: 26, height: 8, borderRadius: 99, border: "none",
                  background: "transparent", cursor: "pointer", padding: 0,
                  display: "grid", placeItems: "center" }}>
                {/* scaleX rather than width so the dot never triggers layout */}
                <span aria-hidden="true" style={{ display: "block", width: 26, height: 8,
                  borderRadius: 99, transformOrigin: "50% 50%",
                  transform: n === i ? "scaleX(1)" : "scaleX(.31)",
                  background: n === i ? GOLD : "rgba(255,255,255,.55)",
                  transition: `transform ${DUR.base}ms ${EASE.out}, background ${DUR.base}ms ${EASE.out}` }} />
              </button>
            ))}
          </div>
        </div>
      </Reveal>

      {/* Thumbnails — stagger in, and the active one lifts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 10 }}>
        {items.map((it, n) => (
          <Reveal key={it.id ?? n} delay={n * 60} variant="up" distance={16} duration={DUR.base}>
            <button onClick={() => go(n)} aria-label={it.caption} className="zoomable"
              style={{ width: "100%", height: 66, borderRadius: 12,
                border: n === i ? `2px solid ${GOLD}` : "2px solid transparent",
                background: grad(n), cursor: "pointer", padding: 0,
                position: "relative", overflow: "hidden",
                opacity: n === i ? 1 : .72,
                transform: n === i ? "translate3d(0,-3px,0)" : "none",
                boxShadow: n === i ? "0 10px 24px rgba(75,46,131,.24)" : "none",
                transition: `opacity ${DUR.fast}ms ${EASE.out}, transform ${DUR.fast}ms ${EASE.out}, border-color ${DUR.fast}ms ${EASE.out}, box-shadow ${DUR.fast}ms ${EASE.out}` }}>
              {it.img && <img src={it.img} alt="" loading="lazy"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
              <span style={{ position: "absolute", bottom: 4, left: 6, fontSize: 10.5, fontWeight: 600,
                color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,.7)", zIndex: 1 }}>{it.tag}</span>
            </button>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
const carBtn = (side) => ({
  position: "absolute", top: "50%", transform: "translateY(-50%)", [side]: 14,
  width: 42, height: 42, borderRadius: 999, border: "none", background: "rgba(255,255,255,.9)",
  cursor: "pointer", display: "grid", placeItems: "center",
});

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

function MonthCalendar({ events }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [picked, setPicked] = useState(null);
  const reduced = useReducedMotion();

  // Index events by YYYY-MM-DD for O(1) lookup per cell.
  const byDate = React.useMemo(() => {
    const map = {};
    (events || []).forEach((e) => {
      if (!e.date) return;
      (map[e.date] = map[e.date] || []).push(e);
    });
    return map;
  }, [events]);

  const cells = monthMatrix(cursor.y, cursor.m);
  const key = (d) =>
    `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const shift = (delta) => {
    setPicked(null);
    setCursor(({ y, m }) => {
      const nm = m + delta;
      if (nm < 0) return { y: y - 1, m: 11 };
      if (nm > 11) return { y: y + 1, m: 0 };
      return { y, m: nm };
    });
  };

  const isToday = (d) =>
    d && today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === d;

  const pickedEvents = picked ? (byDate[picked] || []) : [];

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "16px 18px", background: "var(--tint)" }}>
        <button className="btn" onClick={() => shift(-1)} aria-label="Previous month"
          style={boardNavBtn}><ChevronLeft size={17} color="var(--accent)" /></button>
        <div style={{ fontWeight: 800, fontSize: 16.5, color: "var(--accent)" }}>
          {MONTH_NAMES[cursor.m]} {cursor.y}
        </div>
        <button className="btn" onClick={() => shift(1)} aria-label="Next month"
          style={boardNavBtn}><ChevronRight size={17} color="var(--accent)" /></button>
      </div>

      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4,
          marginBottom: 6 }}>
          {DOW_SHORT.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700,
              letterSpacing: ".6px", textTransform: "uppercase", color: "var(--text-faint)",
              padding: "4px 0" }}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const k = key(d);
            const evs = byDate[k] || [];
            const has = evs.length > 0;
            const sel = picked === k;
            return (
              <button key={i} onClick={() => has && setPicked(sel ? null : k)}
                aria-label={has ? `${d}: ${evs.length} event${evs.length > 1 ? "s" : ""}` : String(d)}
                disabled={!has}
                style={{
                  aspectRatio: "1 / 1", minHeight: 38, borderRadius: 10, padding: 0,
                  cursor: has ? "pointer" : "default", fontFamily: "inherit",
                  border: sel ? `2px solid ${GOLD}`
                    : isToday(d) ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: has ? "var(--tint-2)" : "transparent",
                  color: has ? "var(--accent)" : "var(--text-faint)",
                  fontWeight: has || isToday(d) ? 700 : 500, fontSize: 13.5,
                  display: "grid", placeItems: "center", position: "relative",
                  transition: reduced ? "none"
                    : `background ${DUR.fast}ms ${EASE.out}, border-color ${DUR.fast}ms ${EASE.out}, transform ${DUR.fast}ms ${EASE.out}`,
                  transform: sel ? "translate3d(0,-2px,0)" : "none",
                }}>
                {d}
                {has && (
                  <span aria-hidden="true" style={{ position: "absolute", bottom: 5,
                    display: "flex", gap: 2 }}>
                    {evs.slice(0, 3).map((_, n) => (
                      <span key={n} style={{ width: 4, height: 4, borderRadius: 99,
                        background: GOLD }} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected day detail — animates open without measuring height */}
        <div style={{ display: "grid",
          gridTemplateRows: pickedEvents.length ? "1fr" : "0fr",
          opacity: pickedEvents.length ? 1 : 0,
          marginTop: pickedEvents.length ? 12 : 0,
          transition: reduced ? "none"
            : `grid-template-rows ${DUR.base}ms ${EASE.out}, opacity ${DUR.base}ms ${EASE.out}, margin-top ${DUR.base}ms ${EASE.out}` }}>
          <div style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gap: 8 }}>
              {pickedEvents.map((e) => (
                <div key={e.id} style={{ borderRadius: 10, padding: "12px 14px",
                  background: "var(--tint)", border: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>
                    {e.name}</div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                    {e.time && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>
                        <Clock size={12} /> {e.time}</span>
                    )}
                    {e.loc && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
                        fontSize: 12.5, color: "var(--text-faint)" }}>
                        <MapPin size={12} /> {e.loc}</span>
                    )}
                  </div>
                  {e.desc && (
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--text-muted)",
                      lineHeight: 1.55 }}>{e.desc}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {Object.keys(byDate).length === 0 && (
          <div style={{ marginTop: 12, textAlign: "center", fontSize: 13,
            color: "var(--text-faint)", padding: "10px 0" }}>
            No dated events yet — add them from the admin panel.
          </div>
        )}
      </div>
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
        : <Reveal variant="rise" distance={24}><MonthCalendar events={data.calendar || []} /></Reveal>}

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
  const [dismissed, setDismissed] = useState(true);
  // Hash the text so a new message counts as a new bar.
  const sig = React.useMemo(() => {
    const t = `${bar?.text || ""}|${bar?.linkLabel || ""}|${bar?.href || ""}`;
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return String(h);
  }, [bar]);

  useEffect(() => {
    try { setDismissed(localStorage.getItem("msa-bar") === sig); }
    catch { setDismissed(false); }
  }, [sig]);

  if (!bar?.on || !bar?.text || dismissed) return null;

  const close = () => {
    setDismissed(true);
    try { localStorage.setItem("msa-bar", sig); } catch {}
  };

  const isInternal = bar.href && bar.href.startsWith("#");
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
            <button onClick={() => onNav?.(bar.href.slice(1))} className="barlink">
              {label} <ChevronRight size={13} />
            </button>
          ) : (
            <a href={bar.href} target="_blank" rel="noopener noreferrer" className="barlink">
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
function HeroVideo({ config }) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const ref = useRef(null);

  const src = config?.src || "";
  const poster = config?.poster || "";
  const dim = typeof config?.dim === "number" ? config.dim : 0.55;

  useEffect(() => {
    if (!src || reduced) { setAllowed(false); return; }
    // Respect data-saver and very slow connections.
    const c = navigator.connection;
    const slow = c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""));
    setAllowed(!slow);
  }, [src, reduced]);

  if (!src) return null;

  const url = (p) => (/^https?:\/\//i.test(p) ? p : `${import.meta.env.BASE_URL}${p}`);

  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden",
      zIndex: 0, pointerEvents: "none" }}>
      {poster && (
        <img src={url(poster)} alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover",
            opacity: ready ? 0 : 1,
            transition: `opacity 900ms ${EASE.outSoft}` }} />
      )}
      {allowed && (
        <video ref={ref} autoPlay muted loop playsInline preload="metadata"
          poster={poster ? url(poster) : undefined}
          onCanPlay={() => setReady(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover",
            opacity: ready ? 1 : 0,
            transform: ready ? "scale(1)" : "scale(1.04)",
            transition: `opacity 1200ms ${EASE.outSoft}, transform 2200ms ${EASE.outSoft}` }}>
          <source src={url(src)} type="video/mp4" />
        </video>
      )}
      {/* Scrim — keeps headline contrast regardless of how bright the footage is */}
      <div style={{ position: "absolute", inset: 0,
        background: `linear-gradient(180deg, rgba(20,17,24,${(dim * 0.9).toFixed(2)}) 0%, rgba(20,17,24,${(dim * 0.62).toFixed(2)}) 45%, rgba(20,17,24,${Math.min(dim + 0.24, 0.95).toFixed(2)}) 100%)` }} />
      <div style={{ position: "absolute", inset: 0,
        background: `radial-gradient(ellipse at 50% 45%, transparent 0%, rgba(20,17,24,.42) 78%)` }} />
    </div>
  );
}

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

  if (!cfg?.on) return null;

  const submit = async (e) => {
    e?.preventDefault?.();
    setMsg(null); setBusy(true);
    const res = await subscribe({ firstName: first, lastName: last, email, status });
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
  (data.announcements || []).forEach((a) => push("Announcement", a.title, a.body, "announcements"));
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
   to the viewport, so the initial page load stays light. */
function LazyQuadTree({ reduced }) {
  const [ref, near] = useInView({ threshold: 0, rootMargin: "600px 0px" });
  return (
    <div ref={ref} style={{ minHeight: 430 }}>
      {near && (
        <React.Suspense fallback={<div style={{ height: 430 }} />}>
          <QuadTree reduced={reduced} height={430}
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
      background: GRAD_DEEP, color: "#fff", padding: "96px 20px 0" }}>
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
  return (
    <Band id="about" lattice rosettes="right" decor="left" light lightTone="violet" lightAt="top-right">
      <SectionCopy data={data} sectionKey="about" />
      {about.intro && (
        <Reveal delay={200} variant="up" distance={18}>
          <div style={{ maxWidth: 720, marginBottom: 34, color: "var(--text-muted)",
            fontSize: 16.5, lineHeight: 1.7 }}>
            <Markdown text={about.intro} style={{ margin: "0 0 12px" }} />
          </div>
        </Reveal>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
        gap: 18 }}>
        {(about.pillars || []).map((p, n) => (
          <Reveal key={p.id} delay={n * 85} variant="rise" distance={28} duration={DUR.slow}>
            <div className="lift" style={{ ...card, padding: "26px 24px", height: "100%" }}>
              <div style={{ width: 50, height: 58, position: "relative", display: "grid",
                placeItems: "center", marginBottom: 14 }}>
                <div style={{ position: "absolute", inset: 0 }}>
                  <Arch w={50} h={58} spring={36} stroke="rgba(183,165,122,.5)" sw={1.2}
                    fill="rgba(183,165,122,.15)" style={{ width: "100%", height: "100%" }} />
                </div>
                <div style={{ position: "relative", marginTop: 8 }}>{progIcon(p.icon)}</div>
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700,
                color: "var(--accent)" }}>{p.title}</h3>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14.5,
                lineHeight: 1.65 }}>{p.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Band>
  );
}

/* ---------- ANNOUNCEMENTS ---------- */
const ANN_KINDS = {
  notice:   { label: "Notice",   color: "#8c78b4" },
  deadline: { label: "Deadline", color: "#b4788c" },
  event:    { label: "Event",    color: "#c9b688" },
  ramadan:  { label: "Ramadan",  color: "#7fa08c" },
};

function AnnouncementsSection({ data }) {
  const items = data.announcements || [];
  // Pinned first, otherwise keep admin ordering.
  const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  return (
    <Band id="announcements" alt lattice rosettes="left" light lightTone="gold" lightAt="top-left">
      <SectionCopy data={data} sectionKey="announcements" />
      {sorted.length === 0 ? (
        <Reveal>
          <div style={{ ...card, padding: "26px 24px", color: "var(--text-faint)",
            fontSize: 14.5 }}>Nothing new right now — check back soon.</div>
        </Reveal>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
          gap: 16 }}>
          {sorted.map((a, n) => {
            const kind = ANN_KINDS[a.kind] || ANN_KINDS.notice;
            const Wrapper = a.href ? "a" : "div";
            const wrapProps = a.href
              ? { href: a.href, target: "_blank", rel: "noopener noreferrer" } : {};
            return (
              <Reveal key={a.id} delay={n * 75} variant="rise" distance={26}>
                <Wrapper {...wrapProps} className="lift" style={{ ...card, display: "block",
                  padding: 0, overflow: "hidden", height: "100%", textDecoration: "none",
                  position: "relative" }}>
                  {/* colour spine marks the kind at a glance */}
                  <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 0,
                    bottom: 0, width: 4, background: kind.color }} />
                  <div style={{ padding: "20px 22px 20px 26px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                      flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "1.2px",
                        textTransform: "uppercase", color: kind.color }}>{kind.label}</span>
                      {a.pinned && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".6px",
                          textTransform: "uppercase", color: "var(--text-faint)",
                          border: "1px solid var(--border-strong)", borderRadius: 99,
                          padding: "2px 8px" }}>Pinned</span>
                      )}
                      {a.date && (
                        <span style={{ marginLeft: "auto", fontSize: 12.5,
                          color: "var(--text-faint)" }}>{a.date}</span>
                      )}
                    </div>
                    <h3 style={{ margin: "0 0 8px", fontSize: 17.5, fontWeight: 700,
                      color: "var(--text)" }}>{a.title}</h3>
                    {a.body && (
                      <div style={{ color: "var(--text-muted)", fontSize: 14.5, lineHeight: 1.6 }}>
                        <Markdown text={a.body} style={{ margin: "0 0 8px" }} />
                      </div>
                    )}
                    {a.href && (
                      <div style={{ marginTop: 10, color: "var(--accent)", fontSize: 13,
                        fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 5 }}>
                        Read more <ExternalLink size={12} />
                      </div>
                    )}
                  </div>
                </Wrapper>
              </Reveal>
            );
          })}
        </div>
      )}
    </Band>
  );
}

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
            <a className="btn" href={d.msaUrl} target="_blank" rel="noopener noreferrer"
              style={{ ...btnGold, textDecoration: "none", display: "inline-flex",
                alignItems: "center", gap: 9, fontSize: 16, padding: "15px 32px" }}>
              <Heart size={18} /> Donate to MSA
            </a>
            <a className="btn" href={d.houseUrl} target="_blank" rel="noopener noreferrer"
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
  return (
    <Band id="islamic-house" lattice rosettes="both" decor="right" light lightTone="gold" lightAt="bottom-right">
      <SectionCopy data={data} sectionKey="islamicHouse" />
      {/* tasbih swaying quietly in the margin */}
      <Parallax speed={0.16} style={{ top: 90, right: "2%" }}>
        <Tasbih height={230} opacity={0.32} color="var(--rosette)" />
      </Parallax>
      <div style={{ display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 26,
        alignItems: "start" }} className="house-grid">
        <div>
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

        {/* Info card */}
        <Reveal variant="right" distance={26} delay={140} duration={DUR.slow}>
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
                  <a className="btn" href={h.mapUrl} target="_blank" rel="noopener noreferrer"
                    style={{ ...btnPurple, textDecoration: "none", textAlign: "center",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                    <MapPin size={15} /> Open in Maps
                  </a>
                )}
                {h.donateUrl && (
                  <a className="btn" href={h.donateUrl} target="_blank" rel="noopener noreferrer"
                    style={{ ...btnGold, textDecoration: "none", textAlign: "center",
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                    <Heart size={15} /> Support the House
                  </a>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {/* Photos */}
      {(h.photos || []).length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 14, marginTop: 26 }}>
          {h.photos.map((p, n) => (
            <Reveal key={p.id ?? n} delay={n * 70} variant="scale" distance={20}>
              <div className="zoomable" style={{ ...card, padding: 0, overflow: "hidden",
                aspectRatio: "4 / 3" }}>
                {p.img
                  ? <img src={p.img} alt={p.caption || ""} loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", height: "100%",
                      background: `linear-gradient(140deg, ${PURPLE_D}, ${VIOLET})` }} />}
              </div>
            </Reveal>
          ))}
        </div>
      )}
      <style>{`@media (max-width:880px){.house-grid{grid-template-columns:1fr !important;}}`}</style>
    </Band>
  );
}

/* ---------- CONTACT ---------- */
function ContactSection({ data }) {
  const c = data.contact || seed.contact;
  const socials = (data.links || []).filter((l) =>
    ["instagram", "discord", "facebook"].includes(l.kind));
  return (
    <Band id="contact" alt lattice rosettes="wide" decor="left" light lightTone="rose" lightAt="top-right">
      <SectionCopy data={data} sectionKey="contact" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
        gap: 18 }}>
        <Reveal variant="rise" distance={26}>
          <a className="lift" href={`mailto:${c.email}`}
            style={{ ...card, padding: "26px 24px", display: "block", textDecoration: "none",
              height: "100%" }}>
            <div style={{ width: 50, height: 50, borderRadius: 13, display: "grid",
              placeItems: "center", background: `linear-gradient(135deg, ${PURPLE}, ${VIOLET})`,
              marginBottom: 14 }}>
              <Mail size={22} color="#fff" />
            </div>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700,
              color: "var(--accent)" }}>Email us</h3>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text)" }}>{c.email}</div>
            {c.note && (
              <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--text-muted)",
                lineHeight: 1.6 }}>{c.note}</p>
            )}
          </a>
        </Reveal>

        {socials.map((l, n) => (
          <Reveal key={l.id} delay={(n + 1) * 80} variant="rise" distance={26}>
            <LinkCard link={l} bg={socialBg(l.kind)} />
          </Reveal>
        ))}
      </div>
    </Band>
  );
}

const socialBg = (k) => ({
  discord: "#5865F2",
  instagram: "linear-gradient(135deg,#833AB4,#FD1D1D,#FCB045)",
  facebook: "#1877F2",
}[k] || PURPLE);

/* ---------- BOARD MEMBERS ---------- */
/* Compact revolving carousel, deliberately smaller in scale than the main
   gallery. Tabs switch between current and previous board. Clicking a card
   opens its bio; if the member has a link, the bio panel offers it. */
function BoardSection({ data }) {
  const [tab, setTab] = useState("current");
  const [open, setOpen] = useState(null);   // id of expanded member
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(4);
  const reduced = useReducedMotion();

  // How many cards fit at once — recalculated on resize.
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setPerPage(w < 560 ? 1 : w < 860 ? 2 : w < 1120 ? 3 : 4);
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
          {/* Track — translated by page, so it revolves rather than reflowing */}
          <div style={{ overflow: "hidden" }}>
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
                      <a className="btn" href={openMember.href} target="_blank" rel="noopener noreferrer"
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

/* ---------- CONNECT ---------- */
function ConnectSection({ data }) {
  const bg = (k) => ({
    discord: "#5865F2", instagram: "linear-gradient(135deg,#833AB4,#FD1D1D,#FCB045)",
    facebook: "#1877F2", donate: `linear-gradient(135deg,${PURPLE},${GOLD})`, link: PURPLE,
  }[k] || PURPLE);
  return (
    <Band id="connect" lattice decor="left" rosettes="wide" light lightTone="rose" lightAt="top-left">
      <SectionCopy data={data} sectionKey="connect" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 16 }}>
        {(data.links || []).map((l, n) => (
          <Reveal key={l.id} delay={n * 65} variant="rise" distance={26}>
            <LinkCard link={l} bg={bg(l.kind)} />
          </Reveal>
        ))}
      </div>
    </Band>
  );
}

/* Connect card — icon tile tilts, arrow slides out on hover. */
function LinkCard({ link: l, bg }) {
  const [hover, setHover] = useState(false);
  return (
    <a href={l.href} target="_blank" rel="noopener noreferrer" className="lift"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...card, padding: "22px 24px", display: "flex", alignItems: "center", gap: 16,
        textDecoration: "none", height: "100%" }}>
      <div style={{ width: 50, height: 50, borderRadius: 13, background: bg,
        display: "grid", placeItems: "center", flexShrink: 0,
        transform: hover ? "translate3d(0,-2px,0) scale(1.07) rotate(-3deg)" : "none",
        boxShadow: hover ? "0 10px 22px rgba(20,17,24,.22)" : "0 0 0 rgba(0,0,0,0)",
        transition: `transform ${DUR.base}ms ${EASE.spring}, box-shadow ${DUR.base}ms ${EASE.out}` }}>
        {linkIcon(l.kind)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 16 }}>{l.name}</div>
        <div style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600, display: "flex",
          alignItems: "center", gap: 4, marginTop: 2 }}>
          Open
          <span style={{ display: "inline-flex",
            transform: hover ? "translate3d(4px,-2px,0)" : "none",
            transition: `transform ${DUR.base}ms ${EASE.spring}` }}>
            <ExternalLink size={12} />
          </span>
        </div>
      </div>
    </a>
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

  const socials = [
    instagram && { key: "ig", href: instagram.href, label: "Instagram", Icon: Instagram },
    discord && { key: "dc", href: discord.href, label: "Discord", Icon: MessageCircle },
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
      { label: "Announcements", id: "announcements" },
      { label: "Connect", id: "connect" },
    ]},
    { title: "Support", items: [
      { label: "Donate to MSA", href: donate.msaUrl },
      { label: "Support Islamic House", href: donate.houseUrl },
      { label: "Sponsors", id: "sponsors" },
      { label: "Contact", id: "contact" },
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
              <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="MSA at UW logo"
                style={{ width: 44, height: 44, borderRadius: 11, objectFit: "cover",
                  border: "1px solid rgba(201,182,136,.3)" }} />
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
          <a className="btn" href={donate.msaUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              padding: "14px 22px", borderRadius: 12, textDecoration: "none",
              fontWeight: 700, fontSize: 15, color: "#2c2418",
              background: `linear-gradient(120deg, ${GOLD}, #e0cf9f)` }}>
            <Heart size={17} /> Give today
          </a>
        </div>

        {/* Bottom bar */}
        <div style={{ maxWidth: 1200, margin: "26px auto 0", paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,.12)", display: "flex",
          alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
          fontSize: 12.5 }}>
          <div>
            © {new Date().getFullYear()} Muslim Students Association at the University of
            Washington. A registered UW Registered Student Organization.
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
      </div>

      <style>{`
        .footlink { color: rgba(255,255,255,.72); text-decoration: none; font-size: 13.5;
                    transition: color ${DUR.fast}ms ${EASE.out}, transform ${DUR.fast}ms ${EASE.out};
                    display: inline-block; }
        .footlink:hover { color: ${GOLD}; transform: translateX(2px); }
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

  const save = async () => {
    setSavedMsg("");
    const res = await persist(data);
    if (res.ok) { setSavedMsg("Saved — changes are now live."); setTimeout(() => setSavedMsg(""), 3000); }
    else setSavedMsg("Save failed: " + res.error);
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
                ["hero", "Home / Hero"], ["bar", "Top bar & video"],
                ["copy", "Section text"], ["mailing", "Mailing list"],
                ["announce", "Announcements"], ["about", "About"],
                ["donate", "Donate"], ["house", "Islamic House"],
                ["gallery", "Photos"], ["sponsors", "Sponsors"], ["board", "Board members"],
                ["spaces", "Prayer spaces"], ["times", "Prayer times"],
                ["events", "Events"], ["calendar", "Calendar"],
                ["programs", "Programs"], ["stats", "Stats"],
                ["links", "Links"], ["contact", "Contact"],
              ].map(([k, lbl]) => (
                <button key={k} onClick={() => setTab(k)} style={{ display: "block", width: "100%",
                  textAlign: "left", padding: "10px 12px", borderRadius: 9, border: "none",
                  background: tab === k ? PURPLE : "transparent",
                  color: tab === k ? "#fff" : "var(--text-soft)",
                  fontWeight: 600, fontSize: 13.5, cursor: "pointer", marginBottom: 3,
                  fontFamily: "inherit" }}>{lbl}</button>
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
        blank={{ name: "New space", loc: "Location", note: "" }}
        fields={[["name", "Name"], ["loc", "Location"], ["note", "Note"]]} />
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
      ["contact", "Contact"],
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
        {groups.map(([status, label]) => (
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
              {board.map((m, i) => (m.status || "current") !== status ? null : (
                <div key={m.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
                  padding: 14, display: "grid", gap: 8, position: "relative" }}>
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
                  <button onClick={() => setBoard(board.filter((_, n) => n !== i))}
                    style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                    aria-label={`Delete ${m.name}`}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
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
              padding: 14, display: "grid", gap: 8, position: "relative" }}>
              <ImageField label="Photo" value={p.img || ""} folder="house"
                onChange={(url) => editPh(i, { img: url })} />
              <div><label style={lbl}>Caption (optional)</label>
                <input style={inpSm} value={p.caption || ""}
                  onChange={(e) => editPh(i, { caption: e.target.value })} /></div>
              <button onClick={() => setH({ photos: photos.filter((_, n) => n !== i) })}
                style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
                aria-label="Delete photo"><Trash2 size={15} /></button>
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
          time: "", loc: "", desc: "" }])}
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
              <div><label style={lbl}>Location</label>
                <input style={inpSm} value={e.loc || ""}
                  onChange={(ev) => edit(i, { loc: ev.target.value })} /></div>
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
        <p style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
          With no form URL set, the suggestion button opens an email to the address above instead.
        </p>
      </Section>
    );
  }

  if (tab === "bar") {
    const bar = data.bar || seed.bar;
    const setBar = (patch) => up({ bar: { ...bar, ...patch } });
    const hv = data.heroVideo || seed.heroVideo;
    const setHV = (patch) => up({ heroVideo: { ...hv, ...patch } });
    return (
      <Section title="Top bar & hero video">
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
        <p style={{ margin: "-4px 0 22px", fontSize: 12.5, color: "var(--text-faint)",
          lineHeight: 1.6 }}>
          Editing the message shows the bar again to everyone who dismissed the previous one.
          Use <b>#events</b>, <b>#donate</b> etc. to scroll to a section instead of leaving the site.
        </p>

        <div style={{ height: 1, background: "var(--border)", margin: "6px 0 20px" }} />

        <h4 style={{ margin: "0 0 6px", fontSize: 14.5, fontWeight: 700,
          color: "var(--accent)" }}>Hero background video</h4>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--text-faint)",
          lineHeight: 1.65 }}>
          Upload the file to the site's <b>public/</b> folder on GitHub, then put its
          filename here (e.g. <b>hero.mp4</b>). Leave blank and the hero keeps its gradient.
          Keep it under about 6&nbsp;MB, muted, and 8–15 seconds so it loops cleanly.
        </p>
        <Field label="Video filename or URL">
          <input style={inp} value={hv.src || ""} placeholder="hero.mp4"
            onChange={(e) => setHV({ src: e.target.value })} />
        </Field>
        <Field label="Poster image (shown while the video loads)">
          <input style={inp} value={hv.poster || ""} placeholder="hero-poster.jpg"
            onChange={(e) => setHV({ poster: e.target.value })} />
        </Field>
        <Field label={`Darkening: ${Math.round((hv.dim ?? 0.55) * 100)}% — raise it if the headline is hard to read`}>
          <input type="range" min="0" max="0.9" step="0.05" style={{ width: "100%" }}
            value={hv.dim ?? 0.55}
            onChange={(e) => setHV({ dim: parseFloat(e.target.value) })} />
        </Field>
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
        fields={[["name", "Label"], ["href", "URL"], ["kind", "Icon (link/discord/facebook/instagram/donate)"]]} />
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
function ListEditor({ title, items, onChange, blank, fields }) {
  const add = () => onChange([...items, { id: Date.now(), ...blank }]);
  const del = (i) => onChange(items.filter((_, n) => n !== i));
  const edit = (i, key, val) => { const c = [...items]; c[i] = { ...c[i], [key]: val }; onChange(c); };
  return (
    <Section title={title}>
      <button className="btn" onClick={add} style={{ ...btnPurple, marginBottom: 16, display: "inline-flex",
        alignItems: "center", gap: 6 }}><Plus size={16} /> Add</button>
      <div style={{ display: "grid", gap: 14 }}>
        {items.map((it, i) => (
          <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 12,
            padding: 14, display: "grid", gap: 8, position: "relative" }}>
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
            <button onClick={() => del(i)} style={{ ...delBtn, position: "absolute", top: 10, right: 10 }}
              aria-label="Delete"><Trash2 size={15} /></button>
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

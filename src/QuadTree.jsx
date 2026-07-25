import React, { useEffect, useMemo, useRef, useState } from "react";
import { animate, createDrawable, onScroll, stagger, utils } from "animejs";

/* ════════════════════════════════════════════════════════════════════════
   QuadTree — a cherry blossom tree, like the ones on the UW Quad, that
   draws itself branch-by-branch as you scroll and then sheds petals.

   Uses anime.js v4 for two things CSS genuinely can't do well:
     • createDrawable — stroke-dash line drawing on SVG paths
     • onScroll({ sync }) — tying that drawing to scroll position, so
       scrubbing back up un-draws the tree.

   Everything else stays on the site's existing motion system.
   Respects prefers-reduced-motion: the tree renders fully drawn, static.
   ════════════════════════════════════════════════════════════════════════ */

// Deterministic PRNG so the tree is identical on every visit and between
// server/client — a random tree that reshuffles on refresh looks broken.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTree({ seed = 7, depth = 6, height = 78 } = {}) {
  const rnd = mulberry32(seed);
  const branches = [];
  const blossoms = [];

  const grow = (x, y, angle, length, width, d) => {
    if (d === 0 || length < 6) {
      blossoms.push({ x, y, r: 2.2 + rnd() * 2.6, d });
      return;
    }
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    // Perpendicular offset gives each limb a natural bend.
    const curve = length * 0.22 * (rnd() - 0.5);
    const mx = (x + ex) / 2 + Math.cos(angle + Math.PI / 2) * curve;
    const my = (y + ey) / 2 + Math.sin(angle + Math.PI / 2) * curve;
    branches.push({
      d: `M${x.toFixed(1)},${y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`,
      w: width,
      depth: d,
    });
    const n = d > 2 ? 2 : rnd() < 0.5 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const spread = 0.42 + rnd() * 0.38;
      const na = angle + (i % 2 === 0 ? spread : -spread) + (rnd() - 0.5) * 0.25;
      grow(ex, ey, na, length * (0.68 + rnd() * 0.12), width * 0.66, d - 1);
      if (d > 3 && rnd() < 0.4) blossoms.push({ x: ex, y: ey, r: 2 + rnd() * 2, d });
    }
  };

  grow(200, 340, -Math.PI / 2, height, 9, depth);
  // Trunk first, twigs last — so the draw order looks like growth.
  branches.sort((a, b) => b.depth - a.depth);
  return { branches, blossoms };
}

/* A single petal drifting down, purely CSS-animated. */
function FallingPetal({ left, delay, duration, size, drift, spin, color }) {
  return (
    <span className="qt-petal" style={{
      left: `${left}%`,
      animationDelay: `${delay}s`,
      animationDuration: `${duration}s`,
      "--qt-drift": `${drift}px`,
      "--qt-spin": `${spin}deg`,
    }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 C15 7, 20 9, 21 14 C21.6 18, 17 22, 12 22 C7 22, 2.4 18, 3 14 C4 9, 9 7, 12 2 Z"
          fill={color} opacity="0.85" />
      </svg>
    </span>
  );
}

export default function QuadTree({
  accent = "#b4788c",
  bark = "#6b5545",
  gold = "#c9b688",
  petalColors = ["#b4788c", "#e8c4d4", "#a078a8"],
  reduced = false,
  height = 420,
  // Drives both the branch layout and the petal scatter. Different seeds
  // (e.g. when rendering several trees together as a grove) produce
  // genuinely different-looking trees instead of identical clones —
  // still deterministic per seed, so the same tree redraws the same way
  // on every visit.
  seed = 11,
  depth = 6,
}) {
  const rootRef = useRef(null);
  const [drawn, setDrawn] = useState(reduced);
  const { branches, blossoms } = useMemo(() => buildTree({ seed, depth }), [seed, depth]);

  const petals = useMemo(() => {
    const rnd = mulberry32(seed * 2 + 7);
    return Array.from({ length: 18 }, (_, i) => ({
      id: i,
      left: 8 + rnd() * 84,
      delay: -rnd() * 14,
      duration: 8 + rnd() * 9,
      size: 9 + rnd() * 9,
      drift: (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 70),
      spin: (rnd() < 0.5 ? -1 : 1) * (200 + rnd() * 400),
      color: petalColors[i % petalColors.length],
    }));
  }, [petalColors, seed]);

  useEffect(() => {
    if (reduced) { setDrawn(true); return; }
    const root = rootRef.current;
    if (!root) return;

    const paths = root.querySelectorAll(".qt-branch");
    const flowers = root.querySelectorAll(".qt-blossom");
    if (!paths.length) return;

    // Branches draw themselves, scrubbed by scroll position. sync:true means
    // scrolling back up reverses the draw — that's the effect CSS can't do.
    const drawAnim = animate(createDrawable(".qt-branch"), {
      draw: ["0 0", "0 1"],
      ease: "inOut(2)",
      duration: 900,
      delay: stagger(26),
      autoplay: onScroll({
        target: root,
        enter: "bottom-=10% top",
        leave: "top+=20% bottom",
        sync: 0.55,          // eased scrub rather than 1:1 snapping
        onEnter: () => setDrawn(true),
      }),
    });

    // Blossoms pop in after their branch has drawn.
    const bloomAnim = animate(flowers, {
      scale: [0, 1],
      opacity: [0, 1],
      ease: "outBack(1.7)",
      duration: 620,
      delay: stagger(14, { start: 260 }),
      autoplay: onScroll({
        target: root,
        enter: "bottom-=25% top",
        leave: "top bottom",
        sync: 0.5,
      }),
    });

    return () => {
      drawAnim?.revert?.();
      bloomAnim?.revert?.();
      utils.remove(paths);
      utils.remove(flowers);
    };
  }, [reduced]);

  return (
    <div ref={rootRef} className="qt-root" aria-hidden="true"
      style={{ position: "relative", width: "100%", height, pointerEvents: "none" }}>
      <style>{`
        .qt-root { --qt-fall: 1; }
        .qt-branch { fill: none; stroke-linecap: round; }
        .qt-blossom { transform-box: fill-box; transform-origin: center; }
        @keyframes qtFall {
          0%   { transform: translate3d(0,-8%,0) rotate(0deg); opacity: 0; }
          9%   { opacity: .9; }
          88%  { opacity: .75; }
          100% { transform: translate3d(var(--qt-drift), 118%, 0) rotate(var(--qt-spin));
                 opacity: 0; }
        }
        .qt-petal { position: absolute; top: 0; will-change: transform;
                    animation-name: qtFall; animation-timing-function: linear;
                    animation-iteration-count: infinite; }
        @media (prefers-reduced-motion: reduce) {
          .qt-petal { display: none; }
          .qt-branch { stroke-dasharray: none !important; stroke-dashoffset: 0 !important; }
          .qt-blossom { opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* soft ground glow so the tree sits in the scene rather than floating */}
      <div style={{ position: "absolute", left: "50%", bottom: "6%", width: 320, height: 60,
        marginLeft: -160, borderRadius: "50%", filter: "blur(22px)",
        background: `radial-gradient(ellipse, ${gold}33 0%, transparent 70%)` }} />

      <svg viewBox="0 0 400 360" width="100%" height="100%"
        preserveAspectRatio="xMidYMax meet"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {branches.map((b, i) => (
          <path key={i} className="qt-branch" d={b.d}
            stroke={bark} strokeWidth={b.w.toFixed(1)}
            style={reduced ? undefined : { strokeDasharray: 1, strokeDashoffset: 1 }} />
        ))}
        {blossoms.map((f, i) => (
          <circle key={i} className="qt-blossom" cx={f.x} cy={f.y} r={f.r.toFixed(1)}
            fill={i % 5 === 0 ? gold : accent}
            opacity={reduced ? 0.85 : 0}
            style={reduced ? undefined : { opacity: 0 }} />
        ))}
      </svg>

      {/* petals only start falling once the tree has drawn */}
      {drawn && !reduced && (
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          {petals.map((p) => <FallingPetal key={p.id} {...p} />)}
        </div>
      )}
    </div>
  );
}

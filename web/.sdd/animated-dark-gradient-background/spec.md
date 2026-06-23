# Spec: Animated Dark Gradient Background

Canonical store: empty (no previous implementation).

## Delta: All ADDED

### A1 — CSS `@keyframes` animation

| Key | Value |
|---|---|
| name | `gradient-shift` |
| 0% | `translate3d(0,0,0) scale(1)` |
| 25% | `translate3d(8vmax,-6vmax,0) scale(1.12)` |
| 50% | `translate3d(-10vmax,4vmax,0) scale(0.92)` |
| 75% | `translate3d(6vmax,8vmax,0) scale(1.08)` |
| 100% | `translate3d(0,0,0) scale(1)` (identical to 0%) |

### A2 — Gradient layer elements (3 layers)

| Layer | Colors | Radial center |
|---|---|---|
| 1 | `#7c3aed` (purple), `#2563eb` (blue) | 30% 30% |
| 2 | `#06b6d4` (cyan), `#db2777` (pink) | 70% 20% |
| 3 | `#4f46e5` (indigo), `#9333ea` (purple) | 50% 80% |

Each layer: `position: fixed; inset: -55vmax; animation: gradient-shift <duration> ease-in-out infinite alternate; z-index: 0;`

Durations: layer 1 = 18s, layer 2 = 24s, layer 3 = 20s (desynchronize for organic feel).

### A3 — Vignette overlay

`position: fixed; inset: 0; pointer-events: none; z-index: 1; background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.35) 100%);`

### A4 — Grain texture overlay

`position: fixed; inset: 0; pointer-events: none; z-index: 2; opacity: 0.04;` — pseudo-element with base64 SVG noise pattern (small PNG/SVG data URI to avoid extra request).

### A5 — `prefers-reduced-motion`

Media query `@media (prefers-reduced-motion: no-preference)` wraps animation properties. Without animation, static gradient layers display at 0% position.

### A6 — `useAnimatedGradient` hook

| Behaviour | Detail |
|---|---|
| Input | mouse position via `mousemove` listener on `window` |
| State | Object `{ x: number, y: number }` lerp-interpolated |
| Rate | `requestAnimationFrame` (no interval) |
| Lerp factor | `0.045` (smooth catch-up) |
| Output | CSS translation string applied to a chosen gradient layer via inline style |
| Cleanup | Remove listener on unmount |

### A7 — `AnimatedGradientBackground` React component

Renders fixed container div with three gradient layer divs + vignette div + grain div. Consumes `useAnimatedGradient` for layer 1 mouse-follow. Mounted once at root layout in `App.tsx`.

### A8 — Tailwind classes on content (z-3)

No change. Existing content already renders above gradient because `position: fixed` gradient layers are in normal flow `z-index` stacking. `App.tsx` wrapper `min-h-screen bg-transparent` ensures content above gradient.

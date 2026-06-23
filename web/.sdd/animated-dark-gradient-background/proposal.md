# Proposal: Animated Dark Gradient Background

## Change Intent

Replace current static body background in `index.css` with a multi-layer animated dark gradient background system. Three layers (animated morphing gradient, vignette overlay, grain texture) controlled via pure CSS animation + minimal JS for optional mouse-follow glow.

## Scope

**In scope:**
1. CSS-only animated radial-gradient layers (purple, blue, cyan, pink) with smooth GPU-accelerated `translate3d` + `scale` transforms
2. Prevents black border artifacts via `inset: -55vmax`
3. Vignette overlay (fixed, darkens edges)
4. Grain/scanline texture overlay (static CSS `::after` SVG noise or pseudo-element)
5. `prefers-reduced-motion` — disables all animations, keeps static gradient
6. Mouse-follow glow via JS — one `useAnimatedGradient` hook with lerp interpolation, `requestAnimationFrame`, `mousemove` listener
7. z-index layering: background (z=0) → vignette (z=1) → grain (z=2) → content (z=3)
8. New files only — no existing logic altered beyond index.css body rule

**Out of scope:**
- No new dependencies
- No test runner setup (no test infra in repo)
- No build config changes
- No React component refactors
- No existing component or page modifications

## Rationale

- Dark theme project needs richer background to match Figma-like design intent
- CSS-only animation avoids heavy JS libraries; mouse glow is progressive enhancement
- GPU transforms keep 60fps without layout thrash
- `prefers-reduced-motion` ensures accessibility compliance

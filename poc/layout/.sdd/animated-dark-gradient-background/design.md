# Design: Animated Dark Gradient Background

## Code roots (from explore)

```
src/
├── main.tsx          # Entry, renders <RouterProvider>
├── App.tsx           # Root layout: TooltipProvider > div.bg-transparent > Navbar + Outlet
├── index.css         # Tailwind v4 + @theme + body static radial gradient
├── router.tsx        # BrowserRouter with App as parent layout
├── hooks/            # useDragAndDrop, useLocalStorage, useSearchParamsState
├── components/       # layout/, kanban/, projects/, settings/, ui/
└── mocks/            # Mock data
```

- Tailwind v4, no CSS modules, no CSS-in-JS
- No test runner (no vitest/jest in package.json)
- No existing animation or @keyframes
- No `prefers-reduced-motion` usage
- Body uses `radial-gradient` + `linear-gradient` in index.css
- "react": "^19.2.6", "react-dom": "^19.2.6"
- No framer-motion or animation library

## Architecture

```
┌───────────────────────────────────────────────┐
│  .fixed.inset-0.z-0 (bg-gradient-wrapper)     │
│  ├── div.fixed.inset--55vmax.z-0 (layer 1)   │ ← mouse-follow via JS
│  ├── div.fixed.inset--55vmax.z-0 (layer 2)   │
│  └── div.fixed.inset--55vmax.z-0 (layer 3)   │
├── div.fixed.inset-0.z-1 (vignette)            │
├── div.fixed.inset-0.z-2 (grain)              │
└── content (z-auto via App div.bg-transparent) │
```

## File plan

| New file | Purpose |
|---|---|
| `src/components/background/AnimatedGradientBackground.tsx` | Container component, renders layers+vignette+grain |
| `src/components/background/gradients.module.css` | CSS Module (or inline styles) — using `style={}` objects for each layer to avoid CSS Module overhead in v4 Tailwind. CSS animations defined in `index.css` |
| `src/hooks/useAnimatedGradient.ts` | Mouse-follow lerp hook |

Alternative chosen: put `@keyframes` + layer base styles in `index.css` (single CSS file already loaded). This keeps `index.css` as the sole CSS entry, consistent with existing pattern. Hook + component handle JS concern.

## Data flow

```
window.mousemove
    │
    ▼
useAnimatedGradient ──lerp──► { x, y }
    │
    ▼
AnimatedGradientBackground
    │ applies as inline transform: translate(x, y)
    ▼
Layer 1 div (mouse-follow)
```

## Edge cases

| Case | Handling |
|---|---|
| prefers-reduced-motion | Wrap animation, transition, @keyframes in media query; static layers remain |
| SSR (none here, but safe) | Component uses `useEffect` + `useState`, no hydration mismatch |
| Mobile touch | Add `touchmove` listener in addition to `mousemove` |
| Unmount cleanup | `useEffect` returns removeEventListener for both `mousemove` and `touchmove` |
| Multiple rapid mouse events | `requestAnimationFrame` throttles naturally; lerp smooths |
| Window resize | No special handling — `inset: -55vmax` ensures coverage at any viewport |

## Performance

- GPU compositing: `translate3d` + `scale` (no layout, no paint)
- `will-change: transform` on animated layers (hint browser)
- One RAF loop for mouse glow, not per-frame style recalc
- No ResizeObserver, no scroll listener
- Grain uses static opacity + base64, no animation

# Tasks: Animated Dark Gradient Background

TDD mode: **no tests** (no test runner in project). Skip test file creation.

Dependency order enforced. Phase boundary: after each task, verify with `rtk npm run dev` that page loads without errors.

---

### T1 — `index.css`: add @keyframes + gradient layer styles + reduced-motion  [x]

**Files:** `src/index.css`

**What:**
1. [x] Add 4 `@keyframes` (driftOne, driftTwo, driftThree, driftFour) with 5 keyframes each — 0% and 100% identical
2. [x] Add `.bg-gradient-layer` class
3. [x] Add `.bg-vignette` class
4. [x] Add `.bg-grain` class with grain SVG data URI
5. [x] Add `@media (prefers-reduced-motion: reduce)` disabling animation
6. [x] Remove body background gradient, replace with `background: #0f1419`
7. [x] Add `html, body { overflow: hidden }`
8. [x] Add `.bg-content` class

**Evidence:** `tsc --noEmit` passes on new files.

---

### T2 — `useAnimatedGradient` hook  [x]

**Files:** `src/hooks/useAnimatedGradient.ts`

**What:**
1. [x] Export `interface AnimatedGradientState { x: number; y: number }`
2. [x] Export `function useAnimatedGradient(lerpFactor = 0.055)` returning `{ x, y }`
3. [x] Internal `useRef` for target position, `useRef` for animation frame ID
4. [x] `useEffect` with `pointermove` listener on `window`
5. [x] RAF loop: lerp current toward target
6. [x] Cleanup: cancel RAF, remove listener

**Evidence:** Module compiles clean with `tsc --noEmit`.

---

### T3 — `AnimatedGradientBackground` component  [x]

**Files:** `src/components/background/AnimatedGradientBackground.tsx`

**What:**
1. [x] Export component function
2. [x] Fixed container: `fixed inset-0 z-[-1] pointer-events-none overflow-hidden`
3. [x] 4 gradient layer divs with `.bg-gradient-layer` + inline animation + radial-gradient backgrounds (purple, blue, cyan, pink)
4. [x] Layer 1 applies `translate3d` offset from `useAnimatedGradient`
5. [x] Vignette div + Grain div

**Evidence:** Module compiles clean with `tsc --noEmit`.

---

### T4 — Integrate in `App.tsx`  [x]

**Files:** `src/App.tsx`

**What:**
1. [x] Import `AnimatedGradientBackground`
2. [x] Render `<AnimatedGradientBackground />` as first child inside root div (before Navbar)

**Evidence:** `tsc --noEmit` passes.

---

### T5 — Remove old static background from `index.css` body  [x]

**Files:** `src/index.css`

**What:**
1. [x] Replace body `background:` property with simple `background: #0f1419` (fallback)
2. [x] Keep all other body styles (min-height, color, font-family, etc.)

**Evidence:** Clean background definition; component layers handle gradient.

---

### T6 — Final validation [x]

**What:**
1. `rtk npm run dev` — app starts without errors
2. Visual: gradient shifts smoothly across viewport
3. Visual: no black edges at any viewport size
4. Visual: vignette darkens edges
5. Visual: grain texture visible (subtle)
6. Browser devtools: computed transform uses `matrix3d` (GPU)
7. Browser devtools: test `prefers-reduced-motion: reduce` in DevTools Rendering tab → animation stops
8. Mouse movement: layer 1 follows with smooth lerp
9. Console: no errors or warnings

**Evidence:** Screenshot + DevTools timeline showing GPU composite layers.

---

## Review Workload

### Files created
| File | Lines (est.) | Risk |
|---|---|---|
| `src/hooks/useAnimatedGradient.ts` | ~45 | Low: standard RAF + lerp pattern |
| `src/components/background/AnimatedGradientBackground.tsx` | ~60 | Low: declarative layer divs |

### Files modified
| File | Lines changed | Risk |
|---|---|---|
| `src/index.css` | ~20 added, ~5 removed | Low: additive CSS, no existing style broken |
| `src/App.tsx` | +2 lines (import + element) | Low: no prop changes |

### Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Animation jank on low-end GPU | Low | Medium | GPU transforms only; test on integrated GPU |
| Grain base64 bloat | Low | Low | 256px SVG, ~2KB compressed |
| Mouse glow flickers on touch | Low | Low | Touch listener debounces naturally |
| CSS layer overlap with Radix/portal content | Low | Medium | pointer-events: none on all bg layers; fixed stacking |

# Project Setup Design

Date: 2026-06-16

## Code roots

```
/home/allanbatista/Workspaces/allanbatista/kanban-code-agent/   (project root)
├── .gitignore
├── AGENTS.md
├── package.json                 ← NEW (root)
├── tsconfig.json                ← NEW (root)
├── tsconfig.build.json          ← NEW
├── eslint.config.js             ← NEW
├── .prettierrc                  ← NEW
├── .prettierignore              ← NEW
├── vitest.config.ts             ← NEW
├── poc/                         ← EXISTING (untouched)
│   ├── index.ts
│   ├── package.json
│   └── layout/
├── src/                         ← NEW (skeleton)
│   ├── domain/
│   │   └── index.ts
│   ├── application/
│   │   └── index.ts
│   ├── infrastructure/
│   │   └── index.ts
│   └── cli/
│       └── index.ts
└── docs/                        ← NEW
    ├── usage/
    │   └── .gitkeep
    └── software/
        └── CODE_GUIDELINE.md
```

## Architecture

Root-level config that coexists with PoC. PoC remains self-contained with its own `package.json`. Root config targets future `src/` code.

### Layer mapping (for future extraction)

- `src/domain/` — Types, interfaces, value objects (TaskStatus, SwarmEventType, etc.)
- `src/application/` — Orchestration logic (Orquestrator, SwarmStateStore)
- `src/infrastructure/` — External integrations (PiAgentClient, file system, events)
- `src/cli/` — Entry point, CLI argument parsing

### Config coexistence

- Root `tsconfig.json` has `include: ["src"]`, excludes `poc/`
- Root ESLint ignores `poc/`
- Root Prettier ignores `poc/`
- Root Vitest searches `src/**/*.test.ts`

### Dependencies

Root `package.json` dependencies:
- `typescript` (dev)
- `vitest` (dev)
- `eslint` + `@eslint/js` + `typescript-eslint` (dev)
- `prettier` (dev)
- `tsx` (dev, for running TypeScript directly)
- `@types/node` (dev)

No runtime dependencies yet — they'll be added when PoC code migrates.

## Constraints

- `"type": "module"` everywhere (ESM)
- `strict: true` in TypeScript
- No breaking changes to PoC scripts
- Config via envvar preferred over files (per AGENTS.md rules)

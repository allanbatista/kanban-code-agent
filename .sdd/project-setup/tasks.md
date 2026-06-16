# Project Setup Tasks

Date: 2026-06-16

## T001: Root package.json

Create root `package.json` with workspace scripts and dev dependencies.

- files:
  - `package.json`: Root package.json with type:module, engines, scripts (build, dev, test, lint, typecheck, format), devDependencies (typescript, vitest, eslint, @eslint/js, typescript-eslint, prettier, tsx, @types/node)
- evidence:
  - `rtk node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts)"` outputs expected scripts
- review:
  - complexity: low
  - changed_lines: ~40
  - estimated_minutes: 5

- [x] DONE

## T002: TypeScript root config

Create root `tsconfig.json` and `tsconfig.build.json`.

- files:
  - `tsconfig.json`: strict, moduleResolution bundler, paths alias @/* → ./src/*, include src, exclude poc + node_modules
  - `tsconfig.build.json`: extends tsconfig.json, exclude **/*.test.ts, **/*.spec.ts
- evidence:
  - `rtk npx tsc --noEmit` passes with empty src/
- review:
  - complexity: low
  - changed_lines: ~35
  - estimated_minutes: 5

- [x] DONE

## T003: ESLint configuration

Create `eslint.config.js` flat config for TypeScript.

- files:
  - `eslint.config.js`: Flat config with @eslint/js recommended, typescript-eslint, ignores for dist/ node_modules/ poc/
- evidence:
  - `rtk npx eslint src/` exits 0 on empty/placeholder files
- review:
  - complexity: low
  - changed_lines: ~30
  - estimated_minutes: 5

- [x] DONE

## T004: Prettier configuration

Create `.prettierrc` and `.prettierignore`.

- files:
  - `.prettierrc`: singleQuote, trailingComma all, printWidth 100, semi true
  - `.prettierignore`: dist, node_modules, poc, coverage, .swarm
- evidence:
  - `rtk npx prettier --check .` runs without error
- review:
  - complexity: low
  - changed_lines: ~20
  - estimated_minutes: 3

- [x] DONE

## T005: Vitest setup

Create `vitest.config.ts`.

- files:
  - `vitest.config.ts`: defineConfig for vitest, include src/**/*.test.ts, src/**/*.spec.ts
- evidence:
  - `rtk npx vitest run` exits 0 (no tests yet)
- review:
  - complexity: low
  - changed_lines: ~15
  - estimated_minutes: 3

- [x] DONE

## T006: src/ directory skeleton

Create `src/` directory structure with barrel files.

- files:
  - `src/domain/index.ts`: export placeholder
  - `src/application/index.ts`: export placeholder
  - `src/infrastructure/index.ts`: export placeholder
  - `src/cli/index.ts`: main entry placeholder
- evidence:
  - `rtk ls -R src/` shows 4 directories with index.ts files
  - `rtk npx tsc --noEmit` passes
- review:
  - complexity: low
  - changed_lines: ~20
  - estimated_minutes: 5

- [x] DONE

## T007: docs/ directory structure

Create `docs/` with usage/ and software/ subdirectories and CODE_GUIDELINE.md.

- files:
  - `docs/usage/.gitkeep`: placeholder
  - `docs/software/CODE_GUIDELINE.md`: Coding standards covering SOLID, event-driven, naming conventions, file structure, auditability, config via envvar
- evidence:
  - `rtk ls -R docs/` shows usage/ and software/ with files
  - `docs/software/CODE_GUIDELINE.md` contains SOLID and event-driven sections
- review:
  - complexity: low
  - changed_lines: ~80
  - estimated_minutes: 10

- [x] DONE

## T008: .gitignore updates

Update `.gitignore` with additional Node.js patterns.

- files:
  - `.gitignore`: Add *.tsbuildinfo, .eslintcache, coverage/, .vitest/, *.js.map
- evidence:
  - `rtk cat .gitignore | grep tsbuildinfo` returns match
- review:
  - complexity: low
  - changed_lines: ~10
  - estimated_minutes: 2

- [x] DONE

## T009: Install dependencies and verify

Run `pnpm install` (or npm install) to create lockfile and verify all configs work together.

- files:
  - `pnpm-lock.yaml` or `package-lock.json`: generated lockfile
- evidence:
  - `rtk pnpm install` exits 0
  - `rtk npx tsc --noEmit` exits 0
  - `rtk npx eslint src/` exits 0
  - `rtk npx vitest run` exits 0
- review:
  - complexity: low
  - changed_lines: 0
  - estimated_minutes: 5

- [x] DONE

---

## Review Workload

| Task | Lines | Minutes | Complexity |
|------|-------|---------|------------|
| T001 | 40 | 5 | low |
| T002 | 35 | 5 | low |
| T003 | 30 | 5 | low |
| T004 | 20 | 3 | low |
| T005 | 15 | 3 | low |
| T006 | 20 | 5 | low |
| T007 | 80 | 10 | low |
| T008 | 10 | 2 | low |
| T009 | 0 | 5 | low |
| **Total** | **250** | **43** | |

All tasks under 400 changed lines. Total effort ~43 minutes.

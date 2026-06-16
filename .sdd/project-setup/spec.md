# Project Setup Spec

Date: 2026-06-16

## ADDED

### REQ: Root package.json

Root `package.json` with workspace configuration. Scripts: `build`, `dev`, `test`, `lint`, `typecheck`. Must declare `"type": "module"` to match PoC convention. Must not conflict with `poc/layout/package.json` scripts.

### REQ: TypeScript root configuration

Root `tsconfig.json` with `strict: true`, `moduleResolution: "bundler"`, path alias `@/*` → `./src/*`. Separate `tsconfig.build.json` excluding test files. Must not break existing `poc/layout/tsconfig.json`.

### REQ: ESLint configuration

ESLint flat config (`eslint.config.js`) for TypeScript + Node.js. Must extend `@eslint/js` recommended rules. Must support `.ts` and `.mts` files. Must include ignores for `dist/`, `node_modules/`, `poc/`.

### REQ: Prettier configuration

`.prettierrc` with project-standard formatting: singleQuote, trailingComma, printWidth 100. `.prettierignore` for dist, node_modules, poc.

### REQ: Vitest test framework

Vitest configuration at root. Test directory at `src/__tests__/` or `tests/`. Script `test` runs vitest. Must support TypeScript out of the box.

### REQ: src/ directory skeleton

Prepare `src/` with subdirectories: `domain/`, `application/`, `infrastructure/`, `cli/`. Each with an `index.ts` barrel file. These correspond to the 3 layers mentioned in AGENTS.md plus a CLI entry point.

### REQ: docs/ directory structure

Create `docs/usage/` and `docs/software/` as referenced in AGENTS.md. Create `docs/software/CODE_GUIDELINE.md` with coding standards covering: SOLID principles, event-driven patterns, naming conventions, file structure rules, auditability requirements.

### REQ: .gitignore updates

Add standard Node.js ignores: `*.tsbuildinfo`, `.eslintcache`, `.prettierignore`, `coverage/`, `.vitest/`. Ensure no conflicts with existing ignores.

### REQ: Root scripts

Root package.json must have these scripts:
- `build`: `tsc -b` (or similar)
- `dev`: placeholder or nodemon-style runner
- `test`: `vitest`
- `lint`: `eslint .`
- `typecheck`: `tsc --noEmit`
- `format`: `prettier --write .`

### REQ: CI preparation

No pipeline files yet. But package.json scripts must be CI-ready (runnable non-interactively). Add `engines` field for Node.js minimum version.

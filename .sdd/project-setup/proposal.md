# Project Setup

Date: 2026-06-16

## Problem

The kanban-code-agent project has no proper project scaffolding. The PoC lives in `poc/` as a monolithic ~2320-line file with no root package.json, no TypeScript config at root, no tests, no linting, no directory structure for a real src/ layout. The referenced `docs/` directory and `CODE_GUIDELINE.md` don't exist. This blocks organized development and extraction of the PoC into proper layers.

## Solution

Set up a proper Node.js/TypeScript monorepo-style project structure:

- Root `package.json` with workspace scripts (build, dev, test, lint)
- Root `tsconfig.json` with path aliases
- ESLint + Prettier configuration
- Vitest for testing
- `src/` directory skeleton prepared for 3-layer extraction (domain, application, infrastructure)
- `docs/software/CODE_GUIDELINE.md` and directory structure
- Updated `.gitignore` with standard Node.js ignores
- Basic CI preparation (scripts only, no pipeline files yet)

## Scope

- IN: Project scaffolding, config files, directory structure, docs skeleton
- OUT: Actual code migration from `poc/index.ts`, new feature code, CI pipeline files

## Risks

- PoC `poc/layout/` already has its own Vite/React setup. Root config must not conflict.
- PoC uses `tsx` for direct execution. Root build must coexist.

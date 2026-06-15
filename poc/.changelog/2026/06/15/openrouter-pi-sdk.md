# OpenRouter Pi SDK

Date: 2026-06-15

## Changed

- Integrated the swarm POC with Pi SDK using OpenRouter `openai/gpt-5.4-nano` at high thinking level.
- Replaced the mocked LLM delay/result with real per-task Pi agent sessions using `OPENROUTER_API_KEY`.

## Files

- `index.ts`: adds Pi SDK runtime setup, read-only tools, and task prompt execution.
- `package.json`: adds a typecheck script and Node.js types for local validation.
- `tsconfig.json`: configures TypeScript validation for this POC.

## Validation

- `rtk env -u OPENROUTER_API_KEY npm start`: fails with `OPENROUTER_API_KEY não configurada`.
- `rtk npm start`: completed the full swarm flow with `Status Final da Task Principal: COMPLETED`.
- `rtk npm run typecheck`: passed.

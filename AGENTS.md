# Kanban Code Agent Guidance

## Technical Debt: Agent Filesystem Sandbox

Task agents are currently scoped by prompt contract and `cwd` conventions only. This is not a hard filesystem sandbox: an agent or provider tool may still attempt absolute paths outside the task sandbox/worktree.

Required future fix: implement real per-task filesystem isolation for agent runs, while preserving KCA tool access to task artifacts.

Current contract until that fix exists:
- Agents must work through KCA tools for task state, comments, routing, and artifacts.
- Agents must treat the task sandbox/worktree shown in their prompt as the only allowed workspace.
- The manager should choose the simplest action first: answer by comment, ask for input, route to a persona, or use sandbox/worktree only when needed.

## Frontend Interaction Rule

Frontend interactions should be optimistic by default: update the visible UI immediately for user actions such as moving cards, then reconcile with the backend response or rollback on failure.

## Cleanup Rule

After finishing any test, validation, preview, or manual QA flow, stop and release every process, server, watcher, browser session, port, or temporary resource the agent started.

## Regression Validation Rule

Do not take implementation action based on a probable cause. First verify the behavior with concrete evidence and create tasks to validate the regression. Only after the regression is confirmed should an agent implement the correction.

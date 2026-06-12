# Project Agent Workflow Rules

Follow the project instructions supplied for this workspace: use concise responses, read applicable AGENTS.md before implementation, prefix shell commands with `rtk`, create `.features/{YYYYMMDD-HHMM}-{feature-name}/plan.md` for complex/cross-cutting work, create `.changelog/{YYYY}/{MM}/{DD}/{feature-name}.md` after implementation code changes, record pending work in `.memory/TODO.md`, and finish task reports with the `task-completion-report` format.

# Product Ready Definition

For Kanban Code Agent, "pronto" means the user can start the application, create a task, and see the autonomous end-to-end flow working through integrated functionality: concurrent tasks, role-specific agents, filesystem persistence, global and task-scoped assistants, planning that creates N DAG subtasks, orchestrator-controlled semaphores, review, deployment, and visible runtime evidence. Tests, mock/fake-only behavior, static UI, or isolated commands do not count as product ready.

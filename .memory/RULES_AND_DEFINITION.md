# Regression Validation Before Correction

Do not take implementation action based on a probable cause. First verify the behavior with concrete evidence and create tasks to validate the regression. Only after the regression is confirmed should an agent implement the correction.

# Orchestrator Execution Role

The orchestrator role is to execute the task flow. It must not decide what should be executed or where it should be executed. Those routing and work-definition decisions belong to the task/manager/product flow, not to orchestration guards.

# Agent-Driven Work Decisions

There must be no code-implemented rule that decides what will be done, which persona/agent will do it, or which subtasks should exist. The agent always decides the work, routing, and needed subtasks. Runtime/orchestrator code may only validate mechanical readiness and execute typed commands.

# Task Agent Movement Workflow

Agents must never move an existing task or subtask between agent columns. If an agent needs work or input from another agent inside a task, it must create a subtask for that agent. The system must remove agent-driven task movement between agent columns. Exception: direct movement is allowed only between the three operational columns Entrada (`inbox`), Manager (`manager`), and Pronto (`done`). Human waits must not use a separate "aguardando humano" column; the task stays in its current place and changes status to waiting for human input. When a subtask finishes, the parent task must be notified and then inspect the subtask output to decide the next action.

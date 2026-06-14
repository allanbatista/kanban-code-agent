# Regression Validation Before Correction

Do not take implementation action based on a probable cause. First verify the behavior with concrete evidence and create tasks to validate the regression. Only after the regression is confirmed should an agent implement the correction.

# Orchestrator Execution Role

The orchestrator role is to execute the task flow. It must not decide what should be executed or where it should be executed. Those routing and work-definition decisions belong to the task/manager/product flow, not to orchestration guards.

# Agent-Driven Work Decisions

There must be no code-implemented rule that decides what will be done, which persona/agent will do it, or which subtasks should exist. The agent always decides the work, routing, and needed subtasks. Runtime/orchestrator code may only validate mechanical readiness and execute typed commands.

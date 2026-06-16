# Event-driven subtask orchestration

Subtasks must not be awaited by blocking loops. Agents create subtasks through tools, receive metadata for created tasks, and return structured output declaring whether they are waiting for all listed tasks at once or processing listed tasks as each completion event arrives. When a task finishes, it must notify its parent by event; the parent agent then decides whether to call the AI again or continue waiting.


# Requirements — POC → Production Integration

## Core Mission

User can **create a task**, **delegate to a manager agent**, and **observe the entire process through delivery** of the completed task.

## User Stories

### US-1: Task Creation
As a user, I want to create a task with a title, description, and optional configuration (model, effort level) so that I can initiate work.

**Acceptance Criteria:**
- User fills a form with title, description, and optional agent/model/effort selection
- Task appears in Kanban board in "Inbox" column immediately
- Task persists across server restarts

### US-2: Task Delegation to Manager
As a user, I want to delegate a task to the Manager agent so that it orchestrates subtasks automatically.

**Acceptance Criteria:**
- User clicks "Delegate" or task auto-enters Manager queue
- Manager agent receives task and creates subtasks
- Subtasks appear in Kanban under appropriate agent columns
- Parent-child relationships are visible

### US-3: Real-Time Process Observation
As a user, I want to see task progress in real time so that I can monitor execution without refreshing.

**Acceptance Criteria:**
- Kanban board updates live via WebSocket when task status changes
- Task drawer shows chat messages streaming in real time
- Workflow view shows dependency tree with live status updates

### US-4: Task Lifecycle Visibility
As a user, I want to see the full lifecycle of a task from creation to delivery.

**Acceptance Criteria:**
- Task status transitions visible: PENDING → QUEUED → RUNNING → WAITING → COMPLETED/FAILED/CANCELLED
- History tab shows timestamped events
- Summary tab shows final output, token usage, cost

### US-5: Agent Visibility
As a user, I want to see which agents are available and their current workload.

**Acceptance Criteria:**
- Agent list page shows all 7 agents (Manager, Produto, Generic, Architecture, Engineer, CodeReviewer, QA)
- Each agent shows current task count and status

### US-6: Project Organization
As a user, I want to organize tasks into projects so that I can group related work.

**Acceptance Criteria:**
- Projects persist to filesystem (not just in-memory)
- Tasks can be associated with a project
- Project detail view shows all tasks in that project

## Gaps from Exploration

| Gap | Priority | Requirement |
|-----|----------|-------------|
| Frontend not connected to API | P0 | Replace mocks with real HTTP/WS calls |
| No Kanban UI in production | P0 | Port KanbanBoard from POC |
| No TaskDrawer in production | P0 | Port TaskDrawer from POC |
| No CreateTaskDialog in production | P0 | Port CreateTaskDialog from POC |
| No real-time hooks | P0 | Create useWebSocket hook |
| 3 agents missing (Architecture, CodeReviewer, QA) | P1 | Add to orquestrator-factory |
| Projects not persisted | P1 | Create ProjectFileStore |
| No workflow graph endpoint | P1 | Add GET /api/report/graph |
| No chat history endpoint | P2 | Add GET /api/tasks/:taskId/chat |
| No file upload endpoint | P2 | Add POST /api/tasks/:taskId/attachments |
| Frontend build pipeline missing | P1 | Setup web/ with Vite build → web/dist |

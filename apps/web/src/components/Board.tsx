import { GitBranch, MoreHorizontal, MoveRight, Plus } from "lucide-react";
import clsx from "clsx";
import type { Column, Task } from "../types";

const PRIMARY_COLUMN_IDS = ["inbox", "manager", "human_wait", "done"];
const AGENT_COLUMN_PAIRS = [
  ["product", "design"],
  ["architecture", "generalist"],
  ["engineering", "quality"],
  ["review", "deployment"]
];
const CREATE_COLUMN_IDS = new Set(["inbox", "manager"]);

type Props = {
  columns: Column[];
  tasks: Task[];
  loading: boolean;
  statusFilter: string;
  search: string;
  onFilter: (value: string) => void;
  onSearch: (value: string) => void;
  onOpenTask: (taskId: string) => void;
  onNewTask: (columnId: string) => void;
  onMoveTask: (taskId: string, columnId: string) => void;
};

export function Board({ columns, tasks, loading, statusFilter, search, onFilter, onSearch, onOpenTask, onNewTask, onMoveTask }: Props) {
  const filters = [
    { id: "all", label: "Tudo" },
    { id: "running", label: "Rodando" },
    { id: "queued", label: "Fila" },
    { id: "failed", label: "Falhas" },
    { id: "merge_pending", label: "Merge" },
    { id: "done", label: "Concluídas" }
  ];
  const statusLabels: Record<string, string> = {
    idle: "Fila",
    queued: "Fila",
    running: "Rodando",
    failed: "Falhou",
    waiting: "Aguardando",
    done: "Concluída",
    merge_pending: "Merge",
    validating: "Validando"
  };
  const progressByStatus: Record<string, number> = { idle: 0, queued: 8, running: 50, blocked: 18, failed: 18, merge_pending: 92, validating: 80, done: 100 };
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const primaryColumns = PRIMARY_COLUMN_IDS.map((id) => columnById.get(id)).filter((column): column is Column => Boolean(column));
  const pairedColumnIds = new Set(AGENT_COLUMN_PAIRS.flat());
  const primaryColumnIds = new Set(primaryColumns.map((column) => column.id));
  const agentGroups = AGENT_COLUMN_PAIRS
    .map((pair) => pair.map((id) => columnById.get(id)).filter((column): column is Column => Boolean(column)))
    .filter((group) => group.length);
  const fallbackColumns = columns.filter((column) => !primaryColumnIds.has(column.id) && !pairedColumnIds.has(column.id));
  const renderColumn = (column: Column, stacked = false) => {
    const columnTasks = tasks.filter((task) => task.column === column.id);
    return (
      <section
        key={column.id}
        className={clsx("column", stacked && "stacked-column")}
        data-column-id={column.id}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const taskId = event.dataTransfer.getData("text/task-id");
          const task = tasks.find((item) => item.id === taskId);
          if (task && task.column !== column.id) onMoveTask(task.id, column.id);
        }}
      >
        <header className="column-head">
          <div className="column-title-row">
            <h2>{column.label}</h2>
            <span className="column-count" aria-label={`${columnTasks.length} tasks em ${column.label}`}>{columnTasks.length}</span>
          </div>
          {CREATE_COLUMN_IDS.has(column.id) ? <button className="add-card" aria-label={`Nova task em ${column.label}`} type="button" onClick={() => onNewTask(column.id)}><Plus size={15} /></button> : null}
        </header>
        <div className="cards">
          {columnTasks.map((task) => {
            const progress = progressByStatus[task.status] ?? 0;
            const isInboxIdle = task.column === "inbox" && task.status === "idle";
            const cardDescription = visibleCardDescription(task.description);
            return (
              <article
                key={task.id}
                data-task-id={task.id}
                className="task"
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}
              >
                <div
                  className="task-open"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenTask(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenTask(task.id);
                    }
                  }}
                >
                  <div className="task-head">
                    <div className="task-title">
                      <span className="task-id">{task.id}</span>
                      <strong>{task.title}</strong>
                    </div>
                    <MoreHorizontal className="task-menu" size={16} />
                  </div>
                  {cardDescription ? <p className="task-copy">{cardDescription}</p> : null}
                  {task.failure?.reason ? <p className="task-failure">Falha: {task.failure.reason}</p> : null}
                  <div className="task-tags">
                    {!isInboxIdle ? <span className={clsx("pill", task.status)}>{statusLabels[task.status] || task.status}</span> : null}
                    {task.routing?.nextSuggestedColumn ? <span className="pill soft">next {task.routing.nextSuggestedColumn}</span> : null}
                    {relationTaskIds(task).length ? (
                      <span className="task-relation-row">
                        {relationTaskIds(task).map((taskId) => (
                          <button
                            className="pill soft relation-pill"
                            key={taskId}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenTask(taskId);
                            }}
                          >
                            {taskId}
                          </button>
                        ))}
                      </span>
                    ) : null}
                    {task.subtasksSummary ? <span className="pill soft">sub {task.subtasksSummary.done}/{task.subtasksSummary.total} · {task.subtasksSummary.running} run</span> : null}
                    {(task.projectTargets || []).map((project) => <span className="pill" key={project}>{project}</span>)}
                  </div>
                  <div className="progress" aria-label={`Progresso ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                  <div className="task-footer">
                    <span className="mini-meta"><GitBranch size={13} />{task.worktree?.branch || "sem branch"}</span>
                  </div>
                  <div className="task-timing-row" aria-label="Criacao e tempo total">
                    <time dateTime={task.createdAt || undefined}>{formatTaskDateTime(task.createdAt)}</time>
                    <span>{formatTaskDuration(task.usage?.total?.durationMs)}</span>
                  </div>
                </div>
                <div className="task-actions">
                  {columns.filter((item) => item.id !== column.id).slice(0, 2).map((target) => (
                    <button className="mini-button" key={target.id} type="button" onClick={() => onMoveTask(task.id, target.id)}><MoveRight size={13} />{target.label}</button>
                  ))}
                </div>
              </article>
            );
          })}
          {!columnTasks.length ? <div className="empty-state"><strong>Nenhuma task</strong><span>Crie uma task ou arraste uma existente para cá.</span></div> : null}
        </div>
      </section>
    );
  };

  return (
    <div className="main-area">
      <div className="control-row">
        <div className="search">
          <label className="sr-only" htmlFor="board-search">Buscar tasks</label>
          <input id="board-search" placeholder="Buscar task, agent, branch, skill ou dependência" value={search} onChange={(event) => onSearch(event.target.value)} />
        </div>
        <div className="segmented" aria-label="Filtro operacional">
          {filters.map((filter) => (
            <button className={filter.id === statusFilter ? "active" : ""} key={filter.id} type="button" onClick={() => onFilter(filter.id)}>
              {filter.id === "all" && loading ? "Carregando" : filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="board-scroll">
        <div aria-label="Board Kanban" className="kanban">
          {primaryColumns.map((column) => renderColumn(column))}
          {agentGroups.map((group) => (
            <div className="column-stack" data-column-stack={group.map((column) => column.id).join("+")} key={group.map((column) => column.id).join("+")}>
              {group.map((column) => renderColumn(column, true))}
            </div>
          ))}
          {fallbackColumns.map((column) => renderColumn(column))}
        </div>
      </div>
    </div>
  );
}

function relationTaskIds(task: Task) {
  return [...new Set([task.worktree?.mainTaskId, task.worktree?.parentTaskId].filter((id): id is string => Boolean(id && id !== task.id)))];
}

function visibleCardDescription(value?: string) {
  return String(value || "").split(/\n\s*\n/)[0]?.trim() || "";
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function formatTaskDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}/${date.getFullYear()} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

function formatTaskDuration(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60000) return `${Math.round(value / 1000)}s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}

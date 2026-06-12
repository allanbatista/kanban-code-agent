import { GitBranch, MoreHorizontal, MoveRight, Plus } from "lucide-react";
import clsx from "clsx";
import type { Column, Task } from "../types";

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
    { id: "blocked", label: "Bloqueadas" },
    { id: "merge_pending", label: "Merge" },
    { id: "done", label: "Concluídas" }
  ];
  const statusLabels: Record<string, string> = {
    idle: "Fila",
    queued: "Fila",
    running: "Rodando",
    blocked: "Bloqueada",
    done: "Concluída",
    merge_pending: "Merge",
    validating: "Validando"
  };
  const progressByStatus: Record<string, number> = { idle: 0, queued: 8, running: 50, blocked: 18, merge_pending: 92, validating: 80, done: 100 };

  return (
    <div className="main-area">
      <div className="control-row">
        <label className="search" aria-label="Buscar tasks">
          <span className="sr-only">Buscar tasks</span>
          <input aria-label="Buscar tasks" placeholder="Buscar task, agent, branch, skill ou dependência" value={search} onChange={(event) => onSearch(event.target.value)} />
        </label>
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
          {columns.map((column) => {
            const columnTasks = tasks.filter((task) => task.column === column.id);
            return (
              <section
                key={column.id}
                className="column"
                data-column-id={column.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const taskId = event.dataTransfer.getData("text/task-id");
                  if (taskId && taskId !== column.id) onMoveTask(taskId, column.id);
                }}
              >
                <header className="column-head">
                  <h2>{column.label}</h2>
                  <button className="add-card" aria-label={`Nova task em ${column.label}`} type="button" onClick={() => onNewTask(column.id)}><Plus size={15} /></button>
                </header>
                <div className="cards">
                  {columnTasks.map((task) => {
                    const progress = progressByStatus[task.status] ?? 0;
                    return (
                      <article
                        key={task.id}
                        data-task-id={task.id}
                        className="task"
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)}
                      >
                        <button className="task-open" type="button" onClick={() => onOpenTask(task.id)}>
                          <div className="task-head">
                            <div className="task-title">
                              <span className="task-id">{task.id}</span>
                              <strong>{task.title}</strong>
                            </div>
                            <MoreHorizontal className="task-menu" size={16} />
                          </div>
                          {task.description ? <p className="task-copy">{task.description}</p> : null}
                          <div className="task-tags">
                            <span className={clsx("pill", task.status)}>{statusLabels[task.status] || task.status}</span>
                            <span className="pill soft">{task.kind}</span>
                            <span className="pill soft">{task.priority}</span>
                            {task.routing?.currentAgent ? <span className="pill soft">{task.routing.currentAgent}</span> : null}
                            {task.routing?.lastAgent ? <span className="pill soft">prev {task.routing.lastAgent}</span> : null}
                            {task.routing?.nextSuggestedColumn ? <span className="pill soft">next {task.routing.nextSuggestedColumn}</span> : null}
                            {(task.projectTargets || []).map((project) => <span className="pill" key={project}>{project}</span>)}
                          </div>
                          <div className="progress" aria-label={`Progresso ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                          <div className="task-footer">
                            <span className="mini-meta"><GitBranch size={13} />{task.worktree?.branch || "sem branch"}</span>
                            <span className="mini-meta">role: {task.routing?.currentAgent || "user"}</span>
                            <span className="mini-meta">parallel: {["queued", "running"].includes(task.status) ? "ativo" : "idle"}</span>
                          </div>
                        </button>
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
          })}
        </div>
      </div>
    </div>
  );
}

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { OrchestratorStatus } from "../types";

export function OrchestratorPanel({ status, loading }: { status?: OrchestratorStatus; loading: boolean }) {
  const tokenData = Object.entries(status?.capacity.agentTokens || {}).map(([name, tokens]) => ({ name, tokens }));
  return (
    <section aria-label="Orchestrator" className="side-panel ops-panel active">
      <header className="ops-head">
        <strong>Orchestrator</strong>
        <span>{loading ? "sincronizando" : `${status?.capacity.running || 0}/${status?.capacity.maxParallelTasks || 0} running`}</span>
      </header>
      <div className="ops-grid">
        <div className="metric"><strong>{status?.queue.length || 0}</strong><span>fila</span></div>
        <div className="metric"><strong>{status?.blockers.length || 0}</strong><span>bloqueios</span></div>
        <div className="metric"><strong>{status?.merges.length || 0}</strong><span>merges</span></div>
        <div className="metric"><strong>{status?.worktrees.length || 0}</strong><span>worktrees ativos</span></div>
      </div>
      <div className="ops-chart">
        <ResponsiveContainer width="100%" height={128} minWidth={1} minHeight={1}>
          <BarChart data={tokenData}>
            <XAxis dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} allowDecimals={false} />
            <Bar dataKey="tokens" fill="var(--info)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

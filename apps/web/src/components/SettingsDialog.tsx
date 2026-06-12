import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSettings, AppSettings } from "../types";

export function SettingsDialog({
  open,
  settings,
  agents,
  onOpenChange,
  onSave,
  onSaveAgent
}: {
  open: boolean;
  settings?: AppSettings;
  agents: AgentSettings[];
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
  onSaveAgent: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const showProgress = settings?.ui?.showProgressOnCard ?? true;
  const allowNetwork = settings?.safety?.allowNetwork ?? false;
  const [selectedAgentId, setSelectedAgentId] = useState("assistant");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0];
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentSkills, setAgentSkills] = useState("");
  const [agentTokens, setAgentTokens] = useState(1);

  useEffect(() => {
    if (!selectedAgent) return;
    setSelectedAgentId(selectedAgent.id);
    setAgentPrompt(selectedAgent.instructionsBody || "");
    setAgentSkills((selectedAgent.skills || []).join(", "));
    setAgentTokens(selectedAgent.limits?.tokens ?? 1);
  }, [selectedAgent?.id, selectedAgent?.instructionsBody, selectedAgent?.skills, selectedAgent?.limits?.tokens]);

  async function saveAgent() {
    if (!selectedAgent) return;
    await onSaveAgent({
      id: selectedAgent.id,
      skills: agentSkills.split(",").map((item) => item.trim()).filter(Boolean),
      limits: { ...(selectedAgent.limits || {}), tokens: Number(agentTokens) || 1 },
      instructionsBody: agentPrompt
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog">
          <div className="flex items-center justify-between border-b border-zinc-800 p-4">
            <div>
              <Dialog.Title className="text-base font-semibold">Configurações</Dialog.Title>
              <Dialog.Description className="text-sm text-zinc-500">{settings?.storageRoot || "storage nao inicializado"}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button"><X size={16} /></Dialog.Close>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
            <nav aria-label="Menu de configurações" className="settings-tree">
              {["Workspace", "Interface", "Persistência", "Board", "Colunas", "Hooks por coluna", "Agents", "Skills", "Tools", "Concorrência", "Worktrees", "Sessões", "Repositórios", "Permissões"].map((item) => <button className="settings-nav" key={item}>{item}</button>)}
            </nav>
            <section className="settings-content">
              <h3 className="text-sm font-semibold">Interface</h3>
              <SettingRow label="Mostrar progresso no card">
                <Switch.Root
                  aria-label="Mostrar progresso no card"
                  className="switch-root"
                  checked={showProgress}
                  onCheckedChange={(checked) => void onSave({ ui: { showProgressOnCard: checked } })}
                >
                  <Switch.Thumb className="switch-thumb" />
                </Switch.Root>
              </SettingRow>
              <h3 className="text-sm font-semibold">Segurança</h3>
              <SettingRow label="Permitir rede para agents">
                <Switch.Root
                  aria-label="Permitir rede para agents"
                  className="switch-root"
                  checked={allowNetwork}
                  onCheckedChange={(checked) => void onSave({ safety: { allowNetwork: checked } })}
                >
                  <Switch.Thumb className="switch-thumb" />
                </Switch.Root>
              </SettingRow>
              <h3 className="text-sm font-semibold">Runtime</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="metric"><strong>{settings?.runtime?.maxParallelTasks || 0}</strong><span>max tasks</span></div>
                <div className="metric"><strong>{Object.keys(settings?.runtime?.agentTokens || {}).length}</strong><span>agents</span></div>
                <div className="metric"><strong>{Object.keys(settings?.runtime?.projectTokens || {}).length}</strong><span>projetos</span></div>
              </div>
              <h3 className="text-sm font-semibold">Agents</h3>
              <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
                <div className="space-y-1">
                  {agents.map((agent) => (
                    <button
                      type="button"
                      className={`settings-nav ${agent.id === selectedAgent?.id ? "active" : ""}`}
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                    >
                      {agent.label || agent.id}
                    </button>
                  ))}
                </div>
                {selectedAgent ? (
                  <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="field">Agent<input className="input" value={selectedAgent.id} readOnly /></label>
                      <label className="field">Tokens<input className="input" type="number" min={0} value={agentTokens} onChange={(event) => setAgentTokens(Number(event.target.value))} /></label>
                    </div>
                    <label className="field">Skills<input className="input" value={agentSkills} onChange={(event) => setAgentSkills(event.target.value)} /></label>
                    <label className="field">Prompt editável<textarea className="textarea min-h-52" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} /></label>
                    <button className="button-primary" type="button" onClick={() => void saveAgent()}>Salvar agent</button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

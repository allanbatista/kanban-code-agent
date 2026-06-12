import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSettings, AppSettings, ProviderStatus } from "../types";

export function SettingsDialog({
  open,
  settings,
  agents,
  providers,
  onOpenChange,
  onSave,
  onSaveAgent
}: {
  open: boolean;
  settings?: AppSettings;
  agents: AgentSettings[];
  providers: ProviderStatus[];
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
  onSaveAgent: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const showProgress = settings?.ui?.showProgressOnCard ?? true;
  const taskTextScale = settings?.ui?.taskTextScale ?? 100;
  const taskFontFamily = settings?.ui?.taskFontFamily || "sans-serif";
  const allowNetwork = settings?.safety?.allowNetwork ?? false;
  const [selectedAgentId, setSelectedAgentId] = useState("assistant");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0];
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentSkills, setAgentSkills] = useState("");
  const [agentTokens, setAgentTokens] = useState(1);
  const [agentProvider, setAgentProvider] = useState("pi");
  const [agentModel, setAgentModel] = useState("default");
  const [agentEffort, setAgentEffort] = useState<"minimal" | "low" | "medium" | "high">("medium");
  const selectedProvider = providers.find((provider) => provider.id === agentProvider);

  useEffect(() => {
    if (!selectedAgent) return;
    setSelectedAgentId(selectedAgent.id);
    setAgentPrompt(selectedAgent.instructionsBody || "");
    setAgentSkills((selectedAgent.skills || []).join(", "));
    setAgentTokens(selectedAgent.limits?.tokens ?? 1);
    setAgentProvider(selectedAgent.model?.provider || selectedAgent.provider || "pi");
    setAgentModel(selectedAgent.model?.name || "default");
    setAgentEffort(selectedAgent.model?.effort || "medium");
  }, [selectedAgent?.id, selectedAgent?.instructionsBody, selectedAgent?.skills, selectedAgent?.limits?.tokens, selectedAgent?.provider, selectedAgent?.model?.provider, selectedAgent?.model?.name, selectedAgent?.model?.effort]);

  async function saveAgent() {
    if (!selectedAgent) return;
    await onSaveAgent({
      id: selectedAgent.id,
      skills: agentSkills.split(",").map((item) => item.trim()).filter(Boolean),
      limits: { ...(selectedAgent.limits || {}), tokens: Number(agentTokens) || 1 },
      provider: agentProvider,
      model: { ...(selectedAgent.model || {}), provider: agentProvider, name: agentModel || "default", effort: agentEffort },
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
              <SettingRow label={`Tamanho dos textos: ${taskTextScale}%`}>
                <input
                  className="settings-range"
                  type="range"
                  min={50}
                  max={300}
                  step={25}
                  value={taskTextScale}
                  onChange={(event) => void onSave({ ui: { taskTextScale: Number(event.target.value) } })}
                />
              </SettingRow>
              <SettingRow label="Fonte dos textos">
                <select className="input settings-select" value={taskFontFamily} onChange={(event) => void onSave({ ui: { taskFontFamily: event.target.value } })}>
                  <option value="serif">serif</option>
                  <option value="sans-serif">sans-serif</option>
                </select>
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
                      <div className="field">
                        <label htmlFor="settings-agent-id">Agent</label>
                        <input id="settings-agent-id" className="input" value={selectedAgent.id} readOnly />
                      </div>
                      <div className="field">
                        <label htmlFor="settings-agent-tokens">Tokens</label>
                        <input id="settings-agent-tokens" className="input" type="number" min={0} value={agentTokens} onChange={(event) => setAgentTokens(Number(event.target.value))} />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="settings-agent-skills">Skills</label>
                      <input id="settings-agent-skills" className="input" value={agentSkills} onChange={(event) => setAgentSkills(event.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="field">
                        <label htmlFor="settings-agent-provider">Provider</label>
                        <select id="settings-agent-provider" className="input settings-select" value={agentProvider} onChange={(event) => setAgentProvider(event.target.value)}>
                          {providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.id}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="settings-agent-model">Modelo</label>
                        <input id="settings-agent-model" className="input" value={agentModel} onChange={(event) => setAgentModel(event.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor="settings-agent-effort">Effort</label>
                        <select id="settings-agent-effort" className="input settings-select" value={agentEffort} onChange={(event) => setAgentEffort(event.target.value as typeof agentEffort)}>
                          <option value="minimal">minimal</option>
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>
                    </div>
                    {selectedProvider ? (
                      <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-400">
                        <strong className={selectedProvider.configured ? "text-emerald-500" : "text-amber-500"}>{selectedProvider.configured ? "configured" : "missing_env"}</strong>
                        <span className="ml-2">{selectedProvider.type}</span>
                        <div className="mt-2">required: {selectedProvider.requiredEnv.join(", ") || "none"}</div>
                        {!selectedProvider.configured ? <div>missing: {selectedProvider.missingEnv.join(", ")}</div> : null}
                      </div>
                    ) : null}
                    <div className="field">
                      <label htmlFor="settings-agent-prompt">Prompt editável</label>
                      <textarea id="settings-agent-prompt" className="textarea min-h-52" value={agentPrompt} onChange={(event) => setAgentPrompt(event.target.value)} />
                    </div>
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

import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSettings, AppSettings, ProviderStatus } from "../types";

type AgentEffort = "minimal" | "low" | "medium" | "high";

type AgentDraft = {
  id: string;
  skills: string;
  tokens: number;
  provider: string;
  model: string;
  effort: AgentEffort;
  prompt: string;
};

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
  const currentShowProgress = settings?.ui?.showProgressOnCard ?? true;
  const currentTaskTextScale = settings?.ui?.taskTextScale ?? 100;
  const currentTaskFontFamily = settings?.ui?.taskFontFamily || "sans-serif";
  const currentAllowNetwork = settings?.safety?.allowNetwork ?? false;
  const [showProgress, setShowProgress] = useState(currentShowProgress);
  const [taskTextScale, setTaskTextScale] = useState(currentTaskTextScale);
  const [taskFontFamily, setTaskFontFamily] = useState(currentTaskFontFamily);
  const [allowNetwork, setAllowNetwork] = useState(currentAllowNetwork);
  const [selectedAgentId, setSelectedAgentId] = useState("assistant");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0];
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [saving, setSaving] = useState(false);
  const selectedAgentDraft = selectedAgent ? agentDrafts[selectedAgent.id] || agentToDraft(selectedAgent) : null;
  const selectedProvider = providers.find((provider) => provider.id === selectedAgentDraft?.provider);
  const changedAgents = agents.filter((agent) => {
    const draft = agentDrafts[agent.id];
    return draft ? isAgentChanged(agent, draft) : false;
  });
  const appChanged = showProgress !== currentShowProgress
    || taskTextScale !== currentTaskTextScale
    || taskFontFamily !== currentTaskFontFamily
    || allowNetwork !== currentAllowNetwork;
  const hasChanges = appChanged || changedAgents.length > 0;

  useEffect(() => {
    if (!open || hasChanges) return;
    setShowProgress(currentShowProgress);
    setTaskTextScale(currentTaskTextScale);
    setTaskFontFamily(currentTaskFontFamily);
    setAllowNetwork(currentAllowNetwork);
    setAgentDrafts(Object.fromEntries(agents.map((agent) => [agent.id, agentToDraft(agent)])));
    setSelectedAgentId((current) => agents.some((agent) => agent.id === current) ? current : agents[0]?.id || "assistant");
  }, [open, hasChanges, currentShowProgress, currentTaskTextScale, currentTaskFontFamily, currentAllowNetwork, agents]);

  function resetDrafts() {
    setShowProgress(currentShowProgress);
    setTaskTextScale(currentTaskTextScale);
    setTaskFontFamily(currentTaskFontFamily);
    setAllowNetwork(currentAllowNetwork);
    setAgentDrafts(Object.fromEntries(agents.map((agent) => [agent.id, agentToDraft(agent)])));
  }

  function updateSelectedAgentDraft(patch: Partial<AgentDraft>) {
    if (!selectedAgent) return;
    setAgentDrafts((drafts) => ({
      ...drafts,
      [selectedAgent.id]: { ...agentToDraft(selectedAgent), ...drafts[selectedAgent.id], ...patch }
    }));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetDrafts();
    onOpenChange(nextOpen);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      if (appChanged) {
        await onSave({
          ui: { showProgressOnCard: showProgress, taskTextScale, taskFontFamily },
          safety: { allowNetwork }
        });
      }
      for (const agent of changedAgents) {
        const draft = agentDrafts[agent.id];
        if (draft) await onSaveAgent(agentPatch(agent, draft));
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog">
          <header className="settings-header">
            <div>
              <Dialog.Title className="text-base font-semibold">Configurações</Dialog.Title>
              <Dialog.Description className="settings-description">{settings?.storageRoot || "storage nao inicializado"}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Fechar configurações"><X size={16} /></Dialog.Close>
          </header>
          <div className="settings-body">
            <nav aria-label="Menu de configurações" className="settings-tree">
              <a className="settings-nav" href="#settings-interface">Interface</a>
              <a className="settings-nav" href="#settings-security">Segurança</a>
              <a className="settings-nav" href="#settings-runtime">Runtime</a>
              <a className="settings-nav" href="#settings-agents">Agents</a>
            </nav>
            <section className="settings-content">
              <section className="settings-section" id="settings-interface">
                <SectionHead title="Interface" description="Preferências visuais do board." />
                <SettingRow label="Mostrar progresso no card" description="Exibe a barra de progresso nos cards do board.">
                  <Switch.Root
                    aria-label="Mostrar progresso no card"
                    className="switch-root"
                    checked={showProgress}
                    onCheckedChange={setShowProgress}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label={`Tamanho dos textos: ${taskTextScale}%`} description="Controla a escala dos textos dos cards e detalhes.">
                  <input
                    className="settings-range"
                    type="range"
                    min={50}
                    max={300}
                    step={25}
                    value={taskTextScale}
                    onChange={(event) => setTaskTextScale(Number(event.target.value))}
                  />
                </SettingRow>
                <SettingRow label="Fonte dos textos" description="Define a família usada no conteúdo das tasks.">
                  <select className="input settings-select" value={taskFontFamily} onChange={(event) => setTaskFontFamily(event.target.value as "serif" | "sans-serif")}>
                    <option value="serif">serif</option>
                    <option value="sans-serif">sans-serif</option>
                  </select>
                </SettingRow>
              </section>

              <section className="settings-section" id="settings-security">
                <SectionHead title="Segurança" description="Permissões operacionais disponíveis para agents." />
                <SettingRow label="Permitir rede para agents" description="Autoriza agents a usar rede quando o runtime permitir.">
                  <Switch.Root
                    aria-label="Permitir rede para agents"
                    className="switch-root"
                    checked={allowNetwork}
                    onCheckedChange={setAllowNetwork}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
              </section>

              <section className="settings-section" id="settings-runtime">
                <SectionHead title="Runtime" description="Resumo dos limites ativos do orquestrador." />
                <div className="settings-metrics">
                  <div className="metric"><strong>{settings?.runtime?.maxParallelTasks || 0}</strong><span>max tasks</span></div>
                  <div className="metric"><strong>{Object.keys(settings?.runtime?.agentTokens || {}).length}</strong><span>agents</span></div>
                  <div className="metric"><strong>{Object.keys(settings?.runtime?.projectTokens || {}).length}</strong><span>projetos</span></div>
                </div>
              </section>

              <section className="settings-section" id="settings-agents">
                <SectionHead title="Agents" description="Modelo, limites, skills e prompt de cada agent." />
                <div className="settings-agent-grid">
                  <div className="settings-agent-list">
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
                  {selectedAgent && selectedAgentDraft ? (
                    <div className="settings-agent-panel">
                      <div className="settings-agent-summary">
                        <div>
                          <span>Agent</span>
                          <strong>{selectedAgent.label || selectedAgent.id}</strong>
                        </div>
                        <code>{selectedAgent.id}</code>
                      </div>
                      <div className="settings-form-grid two">
                        <div className="field">
                          <label htmlFor="settings-agent-id">Agent</label>
                          <input id="settings-agent-id" className="input" value={selectedAgent.id} readOnly />
                        </div>
                        <div className="field">
                          <label htmlFor="settings-agent-tokens">Tokens</label>
                          <input id="settings-agent-tokens" className="input" type="number" min={0} value={selectedAgentDraft.tokens} onChange={(event) => updateSelectedAgentDraft({ tokens: Number(event.target.value) })} />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="settings-agent-skills">Skills</label>
                        <input id="settings-agent-skills" className="input" value={selectedAgentDraft.skills} onChange={(event) => updateSelectedAgentDraft({ skills: event.target.value })} />
                      </div>
                      <div className="settings-form-grid three">
                        <div className="field">
                          <label htmlFor="settings-agent-provider">Provider</label>
                          <select id="settings-agent-provider" className="input settings-select" value={selectedAgentDraft.provider} onChange={(event) => updateSelectedAgentDraft({ provider: event.target.value })}>
                            {providers.some((provider) => provider.id === selectedAgentDraft.provider) ? null : <option value={selectedAgentDraft.provider}>{selectedAgentDraft.provider}</option>}
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.id}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor="settings-agent-model">Modelo</label>
                          <input id="settings-agent-model" className="input" value={selectedAgentDraft.model} onChange={(event) => updateSelectedAgentDraft({ model: event.target.value })} />
                        </div>
                        <div className="field">
                          <label htmlFor="settings-agent-effort">Effort</label>
                          <select id="settings-agent-effort" className="input settings-select" value={selectedAgentDraft.effort} onChange={(event) => updateSelectedAgentDraft({ effort: event.target.value as AgentEffort })}>
                            <option value="minimal">minimal</option>
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </div>
                      </div>
                      {selectedProvider ? (
                        <div className="settings-provider-status">
                          <strong className={selectedProvider.configured ? "text-emerald-500" : "text-amber-500"}>{selectedProvider.configured ? "configured" : "missing_env"}</strong>
                          <span>{selectedProvider.type}</span>
                          <div>required: {selectedProvider.requiredEnv.join(", ") || "none"}</div>
                          {!selectedProvider.configured ? <div>missing: {selectedProvider.missingEnv.join(", ")}</div> : null}
                        </div>
                      ) : null}
                      <div className="field">
                        <label htmlFor="settings-agent-prompt">Prompt editável</label>
                        <textarea id="settings-agent-prompt" className="textarea settings-prompt" value={selectedAgentDraft.prompt} onChange={(event) => updateSelectedAgentDraft({ prompt: event.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div className="settings-empty">Nenhum agent configurado.</div>
                  )}
                </div>
              </section>
            </section>
          </div>
          <footer className="settings-footer">
            <span className="settings-save-state">{hasChanges ? "Alterações não salvas" : "Sem alterações"}</span>
            <div className="settings-footer-actions">
              <button className="quiet" type="button" onClick={() => handleOpenChange(false)}>Cancelar</button>
              <button className="button-primary" type="button" disabled={!hasChanges || saving} onClick={() => void saveChanges()}>
                <Save size={15} />
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div className="settings-section-head">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {children}
    </div>
  );
}

function agentToDraft(agent: AgentSettings): AgentDraft {
  return {
    id: agent.id,
    skills: (agent.skills || []).join(", "),
    tokens: agent.limits?.tokens ?? 1,
    provider: agent.model?.provider || agent.provider || "pi",
    model: agent.model?.name || "default",
    effort: agent.model?.effort || "medium",
    prompt: agent.instructionsBody || ""
  };
}

function skillsFromDraft(skills: string) {
  return skills.split(",").map((item) => item.trim()).filter(Boolean);
}

function isAgentChanged(agent: AgentSettings, draft: AgentDraft) {
  const current = agentToDraft(agent);
  return skillsFromDraft(current.skills).join("\n") !== skillsFromDraft(draft.skills).join("\n")
    || current.tokens !== draft.tokens
    || current.provider !== draft.provider
    || current.model !== draft.model
    || current.effort !== draft.effort
    || current.prompt !== draft.prompt;
}

function agentPatch(agent: AgentSettings, draft: AgentDraft) {
  return {
    id: agent.id,
    skills: skillsFromDraft(draft.skills),
    limits: { ...(agent.limits || {}), tokens: Number(draft.tokens) || 1 },
    provider: draft.provider,
    model: { ...(agent.model || {}), provider: draft.provider, name: draft.model || "default", effort: draft.effort },
    instructionsBody: draft.prompt
  };
}

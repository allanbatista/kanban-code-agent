import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSettings, AppSettings, ProviderModel, ProviderStatus } from "../types";

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
  onSaveAgent,
  onLoadProviderModels
}: {
  open: boolean;
  settings?: AppSettings;
  agents: AgentSettings[];
  providers: ProviderStatus[];
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
  onSaveAgent: (patch: Record<string, unknown>) => Promise<unknown>;
  onLoadProviderModels: (providerId: string) => Promise<ProviderModel[]>;
}) {
  const currentShowProgress = settings?.ui?.showProgressOnCard ?? true;
  const currentTaskTextScale = settings?.ui?.taskTextScale ?? 100;
  const currentTaskFontFamily = settings?.ui?.taskFontFamily || "sans-serif";
  const currentAllowNetwork = settings?.safety?.allowNetwork ?? false;
  const currentDefaultProvider = settings?.ai?.defaultProvider || "openai";
  const currentDefaultModel = settings?.ai?.defaultModel || "";
  const currentDefaultEffort = settings?.ai?.defaultEffort || "medium";
  const currentEnabledProviders = settings?.ai?.enabledProviders || [];
  const currentProviderDefaults = settings?.ai?.providers || {};
  const [showProgress, setShowProgress] = useState(currentShowProgress);
  const [taskTextScale, setTaskTextScale] = useState(currentTaskTextScale);
  const [taskFontFamily, setTaskFontFamily] = useState(currentTaskFontFamily);
  const [allowNetwork, setAllowNetwork] = useState(currentAllowNetwork);
  const [defaultProvider, setDefaultProvider] = useState(currentDefaultProvider);
  const [defaultModel, setDefaultModel] = useState(currentDefaultModel);
  const [defaultEffort, setDefaultEffort] = useState<AgentEffort>(currentDefaultEffort);
  const [enabledProviders, setEnabledProviders] = useState<string[]>(currentEnabledProviders);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, { defaultModel?: string; defaultEffort?: AgentEffort }>>(providerDefaultsToDraft(currentProviderDefaults));
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModel[]>>({});
  const [providerModelLoading, setProviderModelLoading] = useState<Record<string, boolean>>({});
  const [selectedAgentId, setSelectedAgentId] = useState("assistant");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0];
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [saving, setSaving] = useState(false);
  const selectedAgentDraft = selectedAgent ? agentDrafts[selectedAgent.id] || agentToDraft(selectedAgent) : null;
  const selectedProviderId = selectedAgentDraft?.provider === "inherit" ? defaultProvider : selectedAgentDraft?.provider;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const activeProviders = providers.filter((provider) => enabledProviders.includes(provider.id));
  const globalProviderOptions = activeProviders.length ? activeProviders : providers.filter((provider) => provider.id === defaultProvider);
  const changedAgents = agents.filter((agent) => {
    const draft = agentDrafts[agent.id];
    return draft ? isAgentChanged(agent, draft) : false;
  });
  const appChanged = showProgress !== currentShowProgress
    || taskTextScale !== currentTaskTextScale
    || taskFontFamily !== currentTaskFontFamily
    || allowNetwork !== currentAllowNetwork
    || defaultProvider !== currentDefaultProvider
    || defaultModel !== currentDefaultModel
    || defaultEffort !== currentDefaultEffort
    || enabledProviders.join("\n") !== currentEnabledProviders.join("\n")
    || JSON.stringify(providerDefaults) !== JSON.stringify(providerDefaultsToDraft(currentProviderDefaults));
  const hasChanges = appChanged || changedAgents.length > 0;

  useEffect(() => {
    if (!open || hasChanges) return;
    setShowProgress(currentShowProgress);
    setTaskTextScale(currentTaskTextScale);
    setTaskFontFamily(currentTaskFontFamily);
    setAllowNetwork(currentAllowNetwork);
    setDefaultProvider(currentDefaultProvider);
    setDefaultModel(currentDefaultModel);
    setDefaultEffort(currentDefaultEffort);
    setEnabledProviders(currentEnabledProviders);
    setProviderDefaults(providerDefaultsToDraft(currentProviderDefaults));
    setAgentDrafts(Object.fromEntries(agents.map((agent) => [agent.id, agentToDraft(agent)])));
    setSelectedAgentId((current) => agents.some((agent) => agent.id === current) ? current : agents[0]?.id || "assistant");
  }, [open, hasChanges, currentShowProgress, currentTaskTextScale, currentTaskFontFamily, currentAllowNetwork, currentDefaultProvider, currentDefaultModel, currentDefaultEffort, currentEnabledProviders, currentProviderDefaults, agents]);

  function resetDrafts() {
    setShowProgress(currentShowProgress);
    setTaskTextScale(currentTaskTextScale);
    setTaskFontFamily(currentTaskFontFamily);
    setAllowNetwork(currentAllowNetwork);
    setDefaultProvider(currentDefaultProvider);
    setDefaultModel(currentDefaultModel);
    setDefaultEffort(currentDefaultEffort);
    setEnabledProviders(currentEnabledProviders);
    setProviderDefaults(providerDefaultsToDraft(currentProviderDefaults));
    setAgentDrafts(Object.fromEntries(agents.map((agent) => [agent.id, agentToDraft(agent)])));
  }

  async function loadModels(providerId: string) {
    if (!providerId || providerModels[providerId]) return;
    setProviderModelLoading((current) => ({ ...current, [providerId]: true }));
    try {
      const models = await onLoadProviderModels(providerId);
      setProviderModels((current) => ({ ...current, [providerId]: models }));
    } catch {
      setProviderModels((current) => ({ ...current, [providerId]: [] }));
    } finally {
      setProviderModelLoading((current) => ({ ...current, [providerId]: false }));
    }
  }

  useEffect(() => {
    if (!open) return;
    const providerIds = [...new Set([defaultProvider, selectedProviderId || defaultProvider, ...enabledProviders].filter(Boolean))];
    for (const providerId of providerIds) void loadModels(providerId);
  }, [open, defaultProvider, selectedProviderId, enabledProviders.join("\n")]);

  function toggleProvider(providerId: string, checked: boolean) {
    setEnabledProviders((current) => {
      const next = checked ? [...new Set([...current, providerId])] : current.filter((id) => id !== providerId);
      if (!next.includes(defaultProvider)) {
        const fallback = next[0] || "";
        setDefaultProvider(fallback);
        setDefaultModel(providerDefaults[fallback]?.defaultModel || "");
        setDefaultEffort(providerDefaults[fallback]?.defaultEffort || "medium");
      }
      return next;
    });
    if (checked) void loadModels(providerId);
  }

  function updateProviderDefault(providerId: string, patch: { defaultModel?: string; defaultEffort?: AgentEffort }) {
    setProviderDefaults((current) => ({ ...current, [providerId]: { ...(current[providerId] || {}), ...patch } }));
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
          safety: { allowNetwork },
          ai: { defaultProvider, defaultModel, defaultEffort, enabledProviders, providers: providerDefaults }
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
              <a className="settings-nav" href="#settings-providers">Providers</a>
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

              <section className="settings-section" id="settings-providers">
                <SectionHead title="Providers" description="Provider padrão, modelo padrão e providers ativos." />
                <div className="settings-form-grid three">
                  <div className="field">
                    <label htmlFor="settings-default-provider">Provider padrão</label>
                    <select id="settings-default-provider" className="input settings-select" value={defaultProvider} onFocus={() => void loadModels(defaultProvider)} onChange={(event) => { const providerId = event.target.value; setDefaultProvider(providerId); setDefaultModel(providerDefaults[providerId]?.defaultModel || ""); setDefaultEffort(providerDefaults[providerId]?.defaultEffort || "medium"); void loadModels(providerId); }}>
                      {globalProviderOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="settings-default-model">Modelo padrão</label>
                    <ModelInput id="settings-default-model" value={defaultModel} models={providerModels[defaultProvider] || []} loading={Boolean(providerModelLoading[defaultProvider])} onFocus={() => void loadModels(defaultProvider)} onChange={setDefaultModel} />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-default-effort">Effort padrão</label>
                    <EffortSelect id="settings-default-effort" value={defaultEffort} onChange={setDefaultEffort} />
                  </div>
                </div>
                <div className="settings-provider-list">
                  {providers.map((provider) => (
                    <div className="settings-provider-row" key={provider.id}>
                      <input type="checkbox" checked={enabledProviders.includes(provider.id)} onChange={(event) => toggleProvider(provider.id, event.target.checked)} />
                      <span>
                        <strong>{provider.label || provider.id}</strong>
                        <small>{provider.type}</small>
                      </span>
                      <em className={provider.configured ? "text-emerald-500" : "text-amber-500"}>{enabledProviders.includes(provider.id) && provider.configured ? "active" : provider.configured ? "configured" : "missing_env"}</em>
                      <code>{provider.requiredEnv.join(", ") || "none"}</code>
                      {enabledProviders.includes(provider.id) ? (
                        <>
                          <ModelInput id={`settings-provider-model-${provider.id}`} value={providerDefaults[provider.id]?.defaultModel || ""} models={providerModels[provider.id] || []} loading={Boolean(providerModelLoading[provider.id])} placeholder={provider.defaultModel || "Modelo default"} onFocus={() => void loadModels(provider.id)} onChange={(value) => updateProviderDefault(provider.id, { defaultModel: value })} />
                          <EffortSelect id={`settings-provider-effort-${provider.id}`} value={providerDefaults[provider.id]?.defaultEffort || "medium"} onChange={(value) => updateProviderDefault(provider.id, { defaultEffort: value })} />
                        </>
                      ) : null}
                    </div>
                  ))}
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
                          <label htmlFor="settings-agent-tokens">Concorrência</label>
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
                          <input id="settings-agent-provider" className="input" list="settings-agent-provider-options" value={selectedAgentDraft.provider === "inherit" ? "" : selectedAgentDraft.provider} placeholder={`Herda padrão (${defaultProvider || "nenhum"})`} onFocus={() => void loadModels(selectedProviderId || defaultProvider)} onChange={(event) => { const providerId = event.target.value || "inherit"; updateSelectedAgentDraft({ provider: providerId, model: "" }); void loadModels(providerId === "inherit" ? defaultProvider : providerId); }} />
                          <datalist id="settings-agent-provider-options">
                            {activeProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>)}
                          </datalist>
                        </div>
                        <div className="field">
                          <label htmlFor="settings-agent-model">Modelo</label>
                          <ModelInput id="settings-agent-model" value={selectedAgentDraft.model} models={providerModels[selectedProviderId || defaultProvider] || []} loading={Boolean(providerModelLoading[selectedProviderId || defaultProvider])} placeholder={selectedAgentDraft.provider === "inherit" ? `Herda ${defaultModel || "modelo padrão"}` : ""} onFocus={() => void loadModels(selectedProviderId || defaultProvider)} onChange={(model) => updateSelectedAgentDraft({ model })} />
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

function ModelInput({ id, value, models, loading = false, placeholder, onFocus, onChange }: { id: string; value: string; models: ProviderModel[]; loading?: boolean; placeholder?: string; onFocus: () => void; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLowerCase();
  const options = models
    .filter((model) => {
      if (!query) return true;
      return model.id.toLowerCase().includes(query) || (model.name || "").toLowerCase().includes(query);
    })
    .slice(0, 50);
  const listId = `${id}-listbox`;
  function choose(model: ProviderModel) {
    onChange(model.id);
    setOpen(false);
    setActiveIndex(0);
  }
  return (
    <div className="model-combobox">
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        autoComplete="off"
        onFocus={() => { onFocus(); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && options[activeIndex]) {
            event.preventDefault();
            choose(options[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div id={listId} className="model-combobox-options" role="listbox">
          {loading ? <div className="model-combobox-empty">Carregando modelos...</div> : null}
          {!loading && options.length === 0 ? <div className="model-combobox-empty">Nenhum modelo encontrado</div> : null}
          {!loading && options.map((model, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              key={model.id}
              onMouseDown={(event) => { event.preventDefault(); choose(model); }}
            >
              <span>{model.id}</span>
              <small>{model.contextWindow ? formatTokens(model.contextWindow) : model.name || "modelo"}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EffortSelect({ id, value, onChange }: { id: string; value: AgentEffort; onChange: (value: AgentEffort) => void }) {
  return (
    <select id={id} className="input settings-select" value={value} onChange={(event) => onChange(event.target.value as AgentEffort)}>
      <option value="minimal">minimal</option>
      <option value="low">low</option>
      <option value="medium">medium</option>
      <option value="high">high</option>
    </select>
  );
}

function formatTokens(value: number) {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M ctx`;
  if (value >= 1000) return `${Math.round(value / 1000)}k ctx`;
  return `${value} ctx`;
}

function providerDefaultsToDraft(value: AppSettings["ai"] extends infer Ai ? Ai extends { providers?: infer Providers } ? Providers : never : never) {
  const source = value && typeof value === "object" ? value as Record<string, { defaultModel?: string; defaultEffort?: AgentEffort }> : {};
  return Object.fromEntries(Object.entries(source).map(([id, config]) => [id, { defaultModel: config?.defaultModel || "", defaultEffort: config?.defaultEffort || "medium" as AgentEffort }]));
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
  const provider = agent.model?.provider || agent.provider || "inherit";
  const model = agent.model?.name || "";
  return {
    id: agent.id,
    skills: (agent.skills || []).join(", "),
    tokens: agent.limits?.tokens ?? 1,
    provider: provider === "pi" ? "inherit" : provider,
    model: model === "default" ? "" : model,
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
    model: { ...(agent.model || {}), provider: draft.provider || "inherit", name: draft.model || "", effort: draft.effort },
    instructionsBody: draft.prompt
  };
}

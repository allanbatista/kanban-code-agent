import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSettings, AppSettings, ProviderModel, ProviderStatus } from "../types";

type AgentEffort = "minimal" | "none" | "low" | "medium" | "high" | "xhigh";
type ComboOption = { value: string; label?: string; description?: string };

type AgentDraft = {
  id: string;
  skills: string;
  maxParallelTasks: number;
  provider: string;
  model: string;
  effort: AgentEffort;
  prompt: string;
};

type WorkflowDraft = NonNullable<AppSettings["workflow"]>;

const defaultWorkflowDraft: WorkflowDraft = {
  requireSpec: true,
  allowMiniSpec: true,
  requireTechnicalPlanForCode: true,
  requireQaBeforeReview: true,
  requireReviewBeforeDone: true,
  requireDeploymentEvidence: true,
  requireDocumentationDecision: true,
  requireSummaryBeforeDone: true,
  requireUserSpecApproval: false,
  preventAutomaticDeployDone: true,
  sandboxPolicy: "prompt_only",
  retryPolicy: { maxAttempts: 2, timeoutMs: 120000 }
};

const standardEfforts: AgentEffort[] = ["none", "low", "medium", "high", "xhigh"];

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
  const currentGlobalMaxParallelTasks = settings?.runtime?.maxParallelTasks ?? 1000;
  const currentWorkflow = normalizeWorkflowDraft(settings?.workflow);
  const currentWorkflowKey = JSON.stringify(currentWorkflow);
  const [showProgress, setShowProgress] = useState(currentShowProgress);
  const [taskTextScale, setTaskTextScale] = useState(currentTaskTextScale);
  const [taskFontFamily, setTaskFontFamily] = useState(currentTaskFontFamily);
  const [allowNetwork, setAllowNetwork] = useState(currentAllowNetwork);
  const [defaultProvider, setDefaultProvider] = useState(currentDefaultProvider);
  const [defaultModel, setDefaultModel] = useState(currentDefaultModel);
  const [defaultEffort, setDefaultEffort] = useState<AgentEffort>(currentDefaultEffort);
  const [enabledProviders, setEnabledProviders] = useState<string[]>(currentEnabledProviders);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, { defaultModel?: string; defaultEffort?: AgentEffort }>>(providerDefaultsToDraft(currentProviderDefaults));
  const [globalMaxParallelTasks, setGlobalMaxParallelTasks] = useState(currentGlobalMaxParallelTasks);
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft>(currentWorkflow);
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModel[]>>({});
  const [providerModelLoading, setProviderModelLoading] = useState<Record<string, boolean>>({});
  const [selectedAgentId, setSelectedAgentId] = useState("assistant");
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0];
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const selectedAgentDraft = selectedAgent ? agentDrafts[selectedAgent.id] || agentToDraft(selectedAgent) : null;
  const selectedProviderId = selectedAgentDraft?.provider === "inherit" ? defaultProvider : selectedAgentDraft?.provider;
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const activeProviders = providers.filter((provider) => enabledProviders.includes(provider.id));
  const globalProviderOptions = activeProviders.length ? activeProviders : providers.filter((provider) => provider.id === defaultProvider);
  const settingsSignature = JSON.stringify({
    ui: { currentShowProgress, currentTaskTextScale, currentTaskFontFamily },
    safety: { currentAllowNetwork },
    ai: { currentDefaultProvider, currentDefaultModel, currentDefaultEffort, currentEnabledProviders, currentProviderDefaults },
    runtime: { currentGlobalMaxParallelTasks },
    workflow: currentWorkflowKey,
    agents: agents.map(agentToDraft)
  });
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
    || globalMaxParallelTasks !== currentGlobalMaxParallelTasks
    || JSON.stringify(workflowDraft) !== currentWorkflowKey
    || enabledProviders.join("\n") !== currentEnabledProviders.join("\n")
    || JSON.stringify(providerDefaults) !== JSON.stringify(providerDefaultsToDraft(currentProviderDefaults));
  const hasChanges = appChanged || changedAgents.length > 0;

  useEffect(() => {
    if (!open || draftDirty) return;
    setShowProgress(currentShowProgress);
    setTaskTextScale(currentTaskTextScale);
    setTaskFontFamily(currentTaskFontFamily);
    setAllowNetwork(currentAllowNetwork);
    setDefaultProvider(currentDefaultProvider);
    setDefaultModel(currentDefaultModel);
    setDefaultEffort(currentDefaultEffort);
    setGlobalMaxParallelTasks(currentGlobalMaxParallelTasks);
    setWorkflowDraft(currentWorkflow);
    setEnabledProviders(currentEnabledProviders);
    setProviderDefaults(providerDefaultsToDraft(currentProviderDefaults));
    setAgentDrafts(Object.fromEntries(agents.map((agent) => [agent.id, agentToDraft(agent)])));
    setSelectedAgentId((current) => agents.some((agent) => agent.id === current) ? current : agents[0]?.id || "assistant");
  }, [open, draftDirty, settingsSignature]);

  function resetDrafts() {
    setDraftDirty(false);
    setShowProgress(currentShowProgress);
    setTaskTextScale(currentTaskTextScale);
    setTaskFontFamily(currentTaskFontFamily);
    setAllowNetwork(currentAllowNetwork);
    setDefaultProvider(currentDefaultProvider);
    setDefaultModel(currentDefaultModel);
    setDefaultEffort(currentDefaultEffort);
    setGlobalMaxParallelTasks(currentGlobalMaxParallelTasks);
    setWorkflowDraft(currentWorkflow);
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

  useEffect(() => {
    if (!open) return;
    let changed = false;
    const nextDefaultEffort = normalizeEffortForModel(defaultEffort, providerModels[defaultProvider] || [], defaultModel);
    if (nextDefaultEffort !== defaultEffort) {
      changed = true;
      setDefaultEffort(nextDefaultEffort);
    }
    const nextProviderDefaults = Object.fromEntries(Object.entries(providerDefaults).map(([providerId, config]) => {
      const defaultEffort = normalizeEffortForModel(config.defaultEffort || "medium", providerModels[providerId] || [], config.defaultModel || "");
      if (defaultEffort !== config.defaultEffort) changed = true;
      return [providerId, { ...config, defaultEffort }];
    }));
    const nextAgentDrafts = Object.fromEntries(Object.entries(agentDrafts).map(([agentId, draft]) => {
      const providerId = draft.provider === "inherit" ? defaultProvider : draft.provider;
      const effort = normalizeEffortForModel(draft.effort, providerModels[providerId] || [], draft.model);
      if (effort !== draft.effort) changed = true;
      return [agentId, { ...draft, effort }];
    }));
    if (changed) {
      setProviderDefaults(nextProviderDefaults);
      setAgentDrafts(nextAgentDrafts);
    }
    if (changed) setDraftDirty(true);
  }, [open, providerModels, defaultProvider, defaultModel, defaultEffort, providerDefaults, agentDrafts]);

  function toggleProvider(providerId: string, checked: boolean) {
    setDraftDirty(true);
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
    setDraftDirty(true);
    setProviderDefaults((current) => ({ ...current, [providerId]: { ...(current[providerId] || {}), ...patch } }));
  }

  function updateSelectedAgentDraft(patch: Partial<AgentDraft>) {
    if (!selectedAgent) return;
    setDraftDirty(true);
    setAgentDrafts((drafts) => ({
      ...drafts,
      [selectedAgent.id]: { ...agentToDraft(selectedAgent), ...drafts[selectedAgent.id], ...patch }
    }));
  }

  function updateWorkflowDraft(patch: Partial<WorkflowDraft>) {
    setDraftDirty(true);
    setWorkflowDraft((current) => ({ ...current, ...patch, retryPolicy: { ...(current.retryPolicy || {}), ...(patch.retryPolicy || {}) } }));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetDrafts();
    onOpenChange(nextOpen);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      const aiProviders = Object.fromEntries(Object.entries(providerDefaults).map(([providerId, config]) => [
        providerId,
        {
          ...config,
          defaultEffort: normalizeEffortForModel(config.defaultEffort || "medium", providerModels[providerId] || [], config.defaultModel || "")
        }
      ]));
      if (appChanged) {
        await onSave({
          ui: { showProgressOnCard: showProgress, taskTextScale, taskFontFamily },
          safety: { allowNetwork },
          runtime: { maxParallelTasks: globalMaxParallelTasks },
          workflow: workflowDraft,
          ai: { defaultProvider, defaultModel, defaultEffort: normalizeEffortForModel(defaultEffort, providerModels[defaultProvider] || [], defaultModel), enabledProviders, providers: aiProviders }
        });
      }
      for (const agent of changedAgents) {
        const draft = agentDrafts[agent.id];
        if (draft) await onSaveAgent(agentPatch(agent, { ...draft, effort: normalizeEffortForModel(draft.effort, providerModels[draft.provider === "inherit" ? defaultProvider : draft.provider] || [], draft.model) }));
      }
      setDraftDirty(false);
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
              <a className="settings-nav" href="#settings-workflow">Workflow</a>
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
                    onCheckedChange={(value) => { setDraftDirty(true); setShowProgress(value); }}
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
                    onChange={(event) => { setDraftDirty(true); setTaskTextScale(Number(event.target.value)); }}
                  />
                </SettingRow>
                <SettingRow label="Fonte dos textos" description="Define a família usada no conteúdo das tasks.">
                  <select className="input settings-select" value={taskFontFamily} onChange={(event) => { setDraftDirty(true); setTaskFontFamily(event.target.value as "serif" | "sans-serif"); }}>
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
                    onCheckedChange={(value) => { setDraftDirty(true); setAllowNetwork(value); }}
                  >
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
              </section>

              <section className="settings-section" id="settings-runtime">
                <SectionHead title="Runtime" description="Resumo dos limites ativos do orquestrador." />
                <SettingRow label="Max tasks globais" description="Limite global de tasks rodando em paralelo.">
                  <input
                    id="settings-runtime-max-parallel-tasks"
                    className="input"
                    type="number"
                    min={1}
                    value={globalMaxParallelTasks}
                    onChange={(event) => { setDraftDirty(true); setGlobalMaxParallelTasks(Math.max(1, Number(event.target.value) || 1)); }}
                  />
                </SettingRow>
                <div className="settings-metrics">
                  <div className="metric"><strong>{globalMaxParallelTasks}</strong><span>max tasks</span></div>
                  <div className="metric"><strong>{agents.length}</strong><span>agents</span></div>
                  <div className="metric"><strong>{Object.keys(settings?.runtime?.projectTokens || {}).length}</strong><span>projetos</span></div>
                </div>
              </section>

              <section className="settings-section" id="settings-workflow">
                <SectionHead title="Workflow" description="Policies para gates, artefatos e hardening." />
                <SettingRow label="Exigir spec" description="Toda task precisa de task-spec.md ou Mini Spec antes de execução técnica.">
                  <Switch.Root aria-label="Exigir spec" className="switch-root" checked={workflowDraft.requireSpec ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireSpec: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="Permitir Mini Spec" description="Permite specs curtas para tarefas simples sem pular DoD.">
                  <Switch.Root aria-label="Permitir Mini Spec" className="switch-root" checked={workflowDraft.allowMiniSpec ?? true} onCheckedChange={(value) => updateWorkflowDraft({ allowMiniSpec: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="Plano técnico para código" description="DoR exige technical-plan.md em trabalho técnico complexo.">
                  <Switch.Root aria-label="Plano técnico para código" className="switch-root" checked={workflowDraft.requireTechnicalPlanForCode ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireTechnicalPlanForCode: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="QA antes de review" description="Review depende de validation-report.md.">
                  <Switch.Root aria-label="QA antes de review" className="switch-root" checked={workflowDraft.requireQaBeforeReview ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireQaBeforeReview: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="Review antes de Done" description="DoD exige review-report.md ou evidência equivalente.">
                  <Switch.Root aria-label="Review antes de Done" className="switch-root" checked={workflowDraft.requireReviewBeforeDone ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireReviewBeforeDone: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="Evidência de deploy" description="DoD exige deployment-report.md, deployment real ou N/A explícito.">
                  <Switch.Root aria-label="Evidência de deploy" className="switch-root" checked={workflowDraft.requireDeploymentEvidence ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireDeploymentEvidence: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="Decisão de documentação" description="DoD exige decisão registrada sobre docs.">
                  <Switch.Root aria-label="Decisão de documentação" className="switch-root" checked={workflowDraft.requireDocumentationDecision ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireDocumentationDecision: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <SettingRow label="Resumo antes de Done" description="DoD exige summary.md.">
                  <Switch.Root aria-label="Resumo antes de Done" className="switch-root" checked={workflowDraft.requireSummaryBeforeDone ?? true} onCheckedChange={(value) => updateWorkflowDraft({ requireSummaryBeforeDone: value })}>
                    <Switch.Thumb className="switch-thumb" />
                  </Switch.Root>
                </SettingRow>
                <div className="settings-form-grid three">
                  <div className="field">
                    <label htmlFor="settings-workflow-sandbox">Sandbox policy</label>
                    <select id="settings-workflow-sandbox" className="input settings-select" value={workflowDraft.sandboxPolicy || "prompt_only"} onChange={(event) => updateWorkflowDraft({ sandboxPolicy: event.target.value as WorkflowDraft["sandboxPolicy"] })}>
                      <option value="prompt_only">prompt_only</option>
                      <option value="worktree_only">worktree_only</option>
                      <option value="isolated">isolated</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="settings-workflow-retries">Retry attempts</label>
                    <input id="settings-workflow-retries" className="input" type="number" min={0} value={workflowDraft.retryPolicy?.maxAttempts ?? 2} onChange={(event) => updateWorkflowDraft({ retryPolicy: { maxAttempts: Math.max(0, Number(event.target.value) || 0) } })} />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-workflow-timeout">Timeout ms</label>
                    <input id="settings-workflow-timeout" className="input" type="number" min={1000} step={1000} value={workflowDraft.retryPolicy?.timeoutMs ?? 120000} onChange={(event) => updateWorkflowDraft({ retryPolicy: { timeoutMs: Math.max(1000, Number(event.target.value) || 1000) } })} />
                  </div>
                </div>
              </section>

              <section className="settings-section" id="settings-providers">
                <SectionHead title="Providers" description="Provider padrão, modelo padrão e providers ativos." />
                <div className="settings-form-grid three">
                  <div className="field">
                    <label htmlFor="settings-default-provider">Provider padrão</label>
                    <ProviderInput id="settings-default-provider" value={defaultProvider} providers={globalProviderOptions} onFocus={() => void loadModels(defaultProvider)} onChange={(providerId) => { setDraftDirty(true); setDefaultProvider(providerId); setDefaultModel(providerDefaults[providerId]?.defaultModel || ""); setDefaultEffort(providerDefaults[providerId]?.defaultEffort || "medium"); void loadModels(providerId); }} />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-default-model">Modelo padrão</label>
                    <ModelInput id="settings-default-model" value={defaultModel} models={providerModels[defaultProvider] || []} loading={Boolean(providerModelLoading[defaultProvider])} onFocus={() => void loadModels(defaultProvider)} onChange={(model) => { setDraftDirty(true); setDefaultModel(model); setDefaultEffort(normalizeEffortForModel(defaultEffort, providerModels[defaultProvider] || [], model)); }} />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-default-effort">Effort padrão</label>
                    <EffortInput id="settings-default-effort" value={normalizeEffortForModel(defaultEffort, providerModels[defaultProvider] || [], defaultModel)} models={providerModels[defaultProvider] || []} modelId={defaultModel} onChange={(value) => { setDraftDirty(true); setDefaultEffort(value); }} />
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
                          <ModelInput id={`settings-provider-model-${provider.id}`} value={providerDefaults[provider.id]?.defaultModel || ""} models={providerModels[provider.id] || []} loading={Boolean(providerModelLoading[provider.id])} placeholder={provider.defaultModel || "Modelo default"} onFocus={() => void loadModels(provider.id)} onChange={(value) => updateProviderDefault(provider.id, { defaultModel: value, defaultEffort: normalizeEffortForModel(providerDefaults[provider.id]?.defaultEffort || "medium", providerModels[provider.id] || [], value) })} />
                          <EffortInput id={`settings-provider-effort-${provider.id}`} value={normalizeEffortForModel(providerDefaults[provider.id]?.defaultEffort || "medium", providerModels[provider.id] || [], providerDefaults[provider.id]?.defaultModel || "")} models={providerModels[provider.id] || []} modelId={providerDefaults[provider.id]?.defaultModel || ""} onChange={(value) => updateProviderDefault(provider.id, { defaultEffort: value })} />
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
                          <label htmlFor="settings-agent-max-parallel-tasks">Max tasks paralelas</label>
                          <input id="settings-agent-max-parallel-tasks" className="input" type="number" min={0} value={selectedAgentDraft.maxParallelTasks} onChange={(event) => updateSelectedAgentDraft({ maxParallelTasks: Math.max(0, Number(event.target.value) || 0) })} />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="settings-agent-skills">Skills</label>
                        <input id="settings-agent-skills" className="input" value={selectedAgentDraft.skills} onChange={(event) => updateSelectedAgentDraft({ skills: event.target.value })} />
                      </div>
                      <div className="settings-form-grid three">
                        <div className="field">
                          <label htmlFor="settings-agent-provider">Provider</label>
                          <ProviderInput id="settings-agent-provider" value={selectedAgentDraft.provider} providers={activeProviders} includeInherit inheritLabel={`Herda padrão (${defaultProvider || "nenhum"})`} onFocus={() => void loadModels(selectedProviderId || defaultProvider)} onChange={(providerId) => { updateSelectedAgentDraft({ provider: providerId || "inherit", model: "" }); void loadModels(providerId === "inherit" ? defaultProvider : providerId); }} />
                        </div>
                        <div className="field">
                          <label htmlFor="settings-agent-model">Modelo</label>
                          <ModelInput id="settings-agent-model" value={selectedAgentDraft.model} models={providerModels[selectedProviderId || defaultProvider] || []} loading={Boolean(providerModelLoading[selectedProviderId || defaultProvider])} placeholder={selectedAgentDraft.provider === "inherit" ? `Herda ${defaultModel || "modelo padrão"}` : ""} onFocus={() => void loadModels(selectedProviderId || defaultProvider)} onChange={(model) => updateSelectedAgentDraft({ model, effort: normalizeEffortForModel(selectedAgentDraft.effort, providerModels[selectedProviderId || defaultProvider] || [], model) })} />
                        </div>
                        <div className="field">
                          <label htmlFor="settings-agent-effort">Effort</label>
                          <EffortInput id="settings-agent-effort" value={normalizeEffortForModel(selectedAgentDraft.effort, providerModels[selectedProviderId || defaultProvider] || [], selectedAgentDraft.model)} models={providerModels[selectedProviderId || defaultProvider] || []} modelId={selectedAgentDraft.model} onChange={(effort) => updateSelectedAgentDraft({ effort })} />
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

function Combobox({ id, value, options, loading = false, placeholder, emptyLabel = "Nenhum item encontrado", loadingLabel = "Carregando...", onFocus, onChange }: { id: string; value: string; options: ComboOption[]; loading?: boolean; placeholder?: string; emptyLabel?: string; loadingLabel?: string; onFocus?: () => void; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLowerCase();
  const filteredOptions = options
    .filter((option) => {
      if (!query) return true;
      return option.value.toLowerCase().includes(query) || (option.label || "").toLowerCase().includes(query);
    })
    .slice(0, 50);
  const listId = `${id}-listbox`;
  function choose(option: ComboOption) {
    onChange(option.value);
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
        onFocus={() => { onFocus?.(); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); setActiveIndex(0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && filteredOptions[activeIndex]) {
            event.preventDefault();
            choose(filteredOptions[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div id={listId} className="model-combobox-options" role="listbox">
          {loading ? <div className="model-combobox-empty">{loadingLabel}</div> : null}
          {!loading && filteredOptions.length === 0 ? <div className="model-combobox-empty">{emptyLabel}</div> : null}
          {!loading && filteredOptions.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              key={option.value}
              onMouseDown={(event) => { event.preventDefault(); choose(option); }}
            >
              <span>{option.value}</span>
              <small>{option.description || option.label || "opção"}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProviderInput({ id, value, providers, includeInherit = false, inheritLabel = "Herda padrão", onFocus, onChange }: { id: string; value: string; providers: ProviderStatus[]; includeInherit?: boolean; inheritLabel?: string; onFocus: () => void; onChange: (value: string) => void }) {
  const options = [
    ...(includeInherit ? [{ value: "inherit", label: inheritLabel, description: "inherit" }] : []),
    ...providers.map((provider) => ({ value: provider.id, label: provider.label || provider.id, description: provider.type }))
  ];
  return <Combobox id={id} value={value} options={options} placeholder={includeInherit ? inheritLabel : undefined} emptyLabel="Nenhum provider encontrado" onFocus={onFocus} onChange={onChange} />;
}

function ModelInput({ id, value, models, loading = false, placeholder, onFocus, onChange }: { id: string; value: string; models: ProviderModel[]; loading?: boolean; placeholder?: string; onFocus: () => void; onChange: (value: string) => void }) {
  const options = models.map((model) => ({
    value: model.id,
    label: model.name || model.id,
    description: model.contextWindow ? formatTokens(model.contextWindow) : model.name || "modelo"
  }));
  return <Combobox id={id} value={value} options={options} loading={loading} placeholder={placeholder} emptyLabel="Nenhum modelo encontrado" loadingLabel="Carregando modelos..." onFocus={onFocus} onChange={onChange} />;
}

function EffortInput({ id, value, models, modelId, onChange }: { id: string; value: AgentEffort; models: ProviderModel[]; modelId: string; onChange: (value: AgentEffort) => void }) {
  const options = effortOptionsForModel(models, modelId, value).map((effort) => ({ value: effort, label: effort, description: effort === "minimal" ? "legacy" : "effort" }));
  return <Combobox id={id} value={value} options={options} emptyLabel="Nenhum effort permitido" onChange={(next) => onChange(next as AgentEffort)} />;
}

function effortOptionsForModel(models: ProviderModel[], modelId: string, current?: AgentEffort): AgentEffort[] {
  const model = models.find((item) => item.id === modelId);
  const supported = model?.supportedEfforts;
  const options = Array.isArray(supported) ? supported.filter(isAgentEffort) : [...standardEfforts];
  const normalized = options.length ? options : ["none" as AgentEffort];
  if (current === "minimal" && !normalized.includes("minimal")) return ["minimal", ...normalized];
  return normalized;
}

function normalizeEffortForModel(value: AgentEffort, models: ProviderModel[], modelId: string): AgentEffort {
  const options = effortOptionsForModel(models, modelId, value);
  return options.includes(value) ? value : options[0] || "none";
}

function isAgentEffort(value: unknown): value is AgentEffort {
  return ["minimal", "none", "low", "medium", "high", "xhigh"].includes(String(value));
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

function normalizeWorkflowDraft(value?: AppSettings["workflow"]): WorkflowDraft {
  return {
    ...defaultWorkflowDraft,
    ...(value || {}),
    retryPolicy: { ...defaultWorkflowDraft.retryPolicy, ...(value?.retryPolicy || {}) }
  };
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
    maxParallelTasks: agent.limits?.maxParallelTasks ?? agent.limits?.tokens ?? 50,
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
    || current.maxParallelTasks !== draft.maxParallelTasks
    || current.provider !== draft.provider
    || current.model !== draft.model
    || current.effort !== draft.effort
    || current.prompt !== draft.prompt;
}

function agentPatch(agent: AgentSettings, draft: AgentDraft) {
  return {
    id: agent.id,
    skills: skillsFromDraft(draft.skills),
    limits: { ...(agent.limits || {}), maxParallelTasks: Math.max(0, Number(draft.maxParallelTasks) || 0) },
    provider: draft.provider,
    model: { ...(agent.model || {}), provider: draft.provider || "inherit", name: draft.model || "", effort: draft.effort },
    instructionsBody: draft.prompt
  };
}

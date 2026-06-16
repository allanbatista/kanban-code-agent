# Graph Report - /home/allanbatista/Workspaces/allanbatista/kanban-code-agent  (2026-06-16)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 698 nodes · 980 edges · 77 communities (57 shown, 20 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 44 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d61d76d1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]

## God Nodes (most connected - your core abstractions)
1. `Orquestrator` - 54 edges
2. `cn()` - 24 edges
3. `compilerOptions` - 18 edges
4. `compilerOptions` - 16 edges
5. `compilerOptions` - 16 edges
6. `getTaskDir()` - 13 edges
7. `serializeTaskYaml()` - 13 edges
8. `ensureTaskArtifacts()` - 13 edges
9. `scripts` - 10 edges
10. `normalizeRuntimeConfig()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Project Setup Design` --references--> `CLI Entry Point`  [EXTRACTED]
  .sdd/project-setup/design.md → src/cli/index.ts
- `Project Setup Design` --references--> `Infrastructure Layer`  [EXTRACTED]
  .sdd/project-setup/design.md → src/infrastructure/index.ts
- `Project Setup Design` --references--> `Application Layer`  [EXTRACTED]
  .sdd/project-setup/design.md → src/application/index.ts
- `Project Setup Design` --references--> `Domain Layer`  [EXTRACTED]
  .sdd/project-setup/design.md → src/domain/index.ts
- `ColumnHeader()` --calls--> `cn()`  [INFERRED]
  poc/layout/src/components/kanban/AgentColumn.tsx → poc/layout/src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (77 total, 20 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (53): PoC Fixes v1, addSessionStats(), AgentDecision, AgentOutputMessage, AgentWaitGroup, ALLOWED_EFFORTS, ALLOWED_MODELS, AttachmentRef (+45 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (38): DROP_AGENT_MAP, useDragAndDrop(), UseDragAndDropOptions, AgentColumn(), CreateTaskDialog(), COLUMNS, KanbanBoard(), STATUS_CONFIG (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (8): createAgents(), isTerminalTaskStatus(), main(), normalizeRuntimeConfig(), Orquestrator, runNormal(), runRestartSimulation(), Task

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (33): dependencies, class-variance-authority, clsx, cmdk, date-fns, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities (+25 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (14): absPath(), Agent, AgentOutputInvalidError, BudgetExceededError, copyFileAtomic(), isSerializedTask(), mergeWaitGroups(), normalizeTaskOptions() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (24): devDependencies, eslint, @eslint/js, prettier, tsx, @types/node, typescript, typescript-eslint (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (23): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, @types/node, @types/react (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (20): assertValidTaskId(), copyTaskAttachments(), createTaskArtifact(), ensureTaskArtifacts(), getTaskArtifactsDir(), getTaskAttachmentsDir(), getTaskChatFile(), getTaskDir() (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (19): compilerOptions, baseUrl, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, module, moduleResolution (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (13): AgentColumnProps, AgentPanel, AgentPanelProps, ColumnBody(), ColumnHeader(), AgentConfigDialog(), IconDict, CodeField() (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (15): aliases, components, hooks, lib, ui, utils, rsc, $schema (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (14): dependencies, @earendil-works/pi-coding-agent, tsx, typescript, devDependencies, @types/node, name, scripts (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.19
Nodes (8): ProjectCard(), ProjectCardProps, ProjectDetail(), ProjectDialog(), ProjectDialogProps, ProjectsGrid(), ProjectsState, useProjectsStore

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (10): AnimatedEdge(), formatDuration(), iconMap, TaskNode(), TaskNodeData, WorkflowTaskNode, edgeTypes, LayoutNode (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (11): Agent, Artifact, Attachment, ChatMessage, EffortLevel, ModelAlias, Task, TaskMetrics (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (7): PageContainer(), PageContainerProps, cn(), EmptyState(), EmptyStateProps, DropdownMenuShortcut(), Skeleton()

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (5): AdvancedSettings(), AppearanceSettings(), ProvidersSettings(), SettingsState, useSettingsStore

### Community 19 - "Community 19"
Cohesion: 0.22
Nodes (9): errorMessage(), isEffortLevel(), isModelAlias(), normalizeAgentMessages(), parseAgentWaitGroups(), parseCliArgs(), parseEffortLevel(), parseModelAlias() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (8): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut()

### Community 21 - "Community 21"
Cohesion: 0.31
Nodes (3): mergeRuntimeConfig(), PiAgentClient, withTimeout()

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (8): compilerOptions, module, moduleResolution, skipLibCheck, strict, target, types, include

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (8): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (8): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSubContent, DropdownMenuSubTrigger

### Community 25 - "Community 25"
Cohesion: 0.39
Nodes (8): assertInsideDir(), assertNoSymlinkPath(), assertSafeRelativePath(), normalizeSessionFile(), resolveInsideDir(), resolveTaskPath(), separatorForPath(), toTaskRelativePath()

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (7): SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (5): AnimatedGradientBackground(), animations, layerGradients, AnimatedGradientState, useAnimatedGradient()

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (4): CodeBlock(), CodeBlockProps, MarkdownPreview(), MarkdownPreviewProps

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (6): Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (6): DialogContent, DialogDescription, DialogFooter(), DialogHeader(), DialogOverlay, DialogTitle

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (4): STATUS_CLASSES, StatusDot(), StatusDotProps, TaskStatus

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (5): DENSITIES, FONT_FAMILIES, THEMES, EffortLevel, ModelAlias

### Community 34 - "Community 34"
Cohesion: 0.53
Nodes (6): Project Setup Design, Project Setup Proposal, Application Layer, CLI Entry Point, Domain Layer, Infrastructure Layer

### Community 35 - "Community 35"
Cohesion: 0.40
Nodes (4): STATUS_CLASSES, StatusDot(), StatusDotProps, TaskStatus

### Community 37 - "Community 37"
Cohesion: 0.40
Nodes (4): AdvancedSettings, AppearanceSettings, ProviderConfig, SettingsSection

### Community 38 - "Community 38"
Cohesion: 0.50
Nodes (4): Kanban Code Agent, Code Guideline, PoC Layout, UI Specification

### Community 40 - "Community 40"
Cohesion: 0.50
Nodes (3): formatCost(), formatDuration(), formatMarkdownTable()

### Community 41 - "Community 41"
Cohesion: 0.50
Nodes (4): formatMessages(), formatOrchestratorLog(), formatSwarmEvent(), truncateLogValue()

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (3): Avatar, AvatarFallback, AvatarImage

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (3): Badge(), BadgeProps, badgeVariants

### Community 44 - "Community 44"
Cohesion: 0.50
Nodes (3): Button, ButtonProps, buttonVariants

### Community 45 - "Community 45"
Cohesion: 0.50
Nodes (3): TabsContent, TabsList, TabsTrigger

## Knowledge Gaps
- **346 isolated node(s):** `name`, `version`, `type`, `node`, `build` (+341 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Community 17` to `Community 32`, `Community 1`, `Community 35`, `Community 10`, `Community 43`, `Community 15`, `Community 18`, `Community 20`, `Community 23`, `Community 26`, `Community 29`, `Community 31`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `Orquestrator` connect `Community 2` to `Community 0`, `Community 4`, `Community 40`, `Community 8`, `Community 19`, `Community 21`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `TaskCard()` connect `Community 1` to `Community 17`, `Community 10`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `cn()` (e.g. with `ColumnBody()` and `ColumnHeader()`) actually correct?**
  _`cn()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `type` to the rest of the system?**
  _346 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.036297640653357534 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.055218855218855216 - nodes in this community are weakly interconnected._
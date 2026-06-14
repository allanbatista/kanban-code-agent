import { expect, test } from "@playwright/test";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

test.describe.configure({ mode: "serial" });
const daemonUrl = process.env.KCA_DAEMON_URL || "http://127.0.0.1:15000";
const storageRoot = resolve(process.env.KCA_E2E_STORAGE_ROOT || "tmp/playwright-fsdb");

async function createTask(request, title, extra = {}) {
  const response = await request.post(`${daemonUrl}/api/command`, {
    data: {
      type: "task.create",
      commandId: `e2e-create-${Date.now()}-${Math.random()}`,
      input: { title, description: "Criada pelo teste E2E.", projectTargets: ["kanban-code-agent"], ...extra }
    }
  });
  await expect(response).toBeOK();
  return (await response.json()).task;
}

test("starts from a clean daemon storage without fixture tasks", async ({ page, request }) => {
  const state = await request.get(`${daemonUrl}/api/state`);
  await expect(state).toBeOK();
  expect((await state.json()).tasks).toHaveLength(0);

  await page.goto("/");
  await expect(page.getByText("Kanban Code Agent")).toBeVisible();
  await expect(page.getByLabel("Board Kanban")).toBeVisible();
  await expect(page.locator(".top-actions").getByRole("button", { name: "Nova task", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-column-id="inbox"]').getByRole("button", { name: /Nova task em Entrada/ })).toBeVisible();
  await expect(page.locator('[data-column-id="manager"]').getByRole("button", { name: /Nova task em Manager/ })).toBeVisible();
  await expect(page.locator('[data-column-id="product"]').getByRole("button", { name: /Nova task em Produto/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="design"]').getByRole("button", { name: /Nova task em Design/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="architecture"]').getByRole("button", { name: /Nova task em Arquitetura/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="generalist"]').getByRole("button", { name: /Nova task em Generalista/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="engineering"]').getByRole("button", { name: /Nova task em Engenharia/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="quality"]').getByRole("button", { name: /Nova task em Qualidade/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="review"]').getByRole("button", { name: /Nova task em Review/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="deployment"]').getByRole("button", { name: /Nova task em Deployment/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="human_wait"]').getByRole("button", { name: /Nova task em Aguardando Humano/ })).toHaveCount(0);
  await expect(page.locator('[data-column-id="done"]').getByRole("button", { name: /Nova task em Pronto/ })).toHaveCount(0);
  expect(await page.locator(".kanban").evaluate((node) =>
    Array.from(node.children).map((child) => child.getAttribute("data-column-id") || child.getAttribute("data-column-stack"))
  )).toEqual(["inbox", "manager", "human_wait", "done", "product+design", "architecture+generalist", "engineering+quality", "review+deployment"]);
  await expect.poll(async () => page.locator('[data-column-stack="product+design"]').evaluate((node) => {
    const boxes = Array.from(node.children).map((child) => child.getBoundingClientRect());
    return Math.abs(boxes[0].height - boxes[1].height) <= 2;
  })).toBe(true);
  await expect(page.getByLabel("Filtro operacional").getByRole("button", { name: "Tudo" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Assistant do board" }).getByLabel("Novo chat")).toBeVisible();
  await expect(page.getByText("Nenhuma task").first()).toBeVisible();
});

test("creates a task through React UI and persists it in FSDB", async ({ page, request }) => {
  const marker = `Draft UI ${Date.now()}`;
  await page.goto("/");
  await page.locator('[data-column-id="inbox"]').getByRole("button", { name: /Nova task em Entrada/ }).click();
  await page.locator(".cm-content").fill(`Persistir via daemon ${marker}.`);
  await page.locator(".new-task-draft-form").evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["png-data"], "pasted.png", { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.getByRole("button", { name: "Salvar", exact: true }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(async () => {
    const ids = await readdir(resolve(storageRoot, "tasks")).catch(() => []);
    for (const id of ids) {
      const task = YAML.parse(await readFile(resolve(storageRoot, "tasks", id, "task.yaml"), "utf8"));
      if (String(task.title).includes(marker)) return task;
    }
    return null;
  }).not.toBe(null);
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.some((task) => task.title.includes(marker));
  }).toBe(false);
  await expect.poll(async () => {
    const ids = await readdir(resolve(storageRoot, "tasks")).catch(() => []);
    for (const id of ids) {
      const files = await readdir(resolve(storageRoot, "tasks", id, "attachments")).catch(() => []);
      if (files.includes("pasted.png") || files.some((file) => file.endsWith("-pasted.png"))) return true;
    }
    return false;
  }).toBe(true);

  await page.getByRole("button", { name: "Salvar e executar" }).click();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    const task = (await state.json()).tasks.find((item) => item.title.includes(marker));
    return { column: task?.column, active: ["queued", "running"].includes(task?.status) };
  }, { timeout: 7000 }).toEqual({ column: "manager", active: true });
});

test("refreshes the board when FSDB task files change externally", async ({ page, request }) => {
  const task = await createTask(request, `Watched task ${Date.now()}`);
  await page.goto("/");
  await expect(page.getByText(task.title)).toBeVisible();
  await expect(page.locator(`[data-task-id="${task.id}"]`).getByLabel("Criacao e tempo total")).not.toContainText("n/d");

  const taskFile = resolve(storageRoot, "tasks", task.id, "task.yaml");
  const data = YAML.parse(await readFile(taskFile, "utf8"));
  data.title = `${task.title} externo`;
  data.updatedAt = new Date().toISOString();
  await writeFile(taskFile, YAML.stringify(data));

  await expect(page.getByText(data.title)).toBeVisible({ timeout: 7000 });
});

test("edits and moves a persisted card through daemon commands", async ({ page, request }) => {
  const task = await createTask(request, `Task edit ${Date.now()}`);
  const editedTitle = `${task.title} updated`;
  await page.goto("/");
  await page.getByText(task.title).click();
  await page.getByLabel("Título").fill(editedTitle);
  await page.getByRole("button", { name: "Salvar task" }).click();
  await expect(page.locator(`[data-task-id="${task.id}"]`).getByText(editedTitle)).toBeVisible();

  const moved = await request.post(`${daemonUrl}/api/command`, {
    data: { type: "task.move", commandId: `e2e-move-${Date.now()}`, taskId: task.id, toColumn: "product", mode: "soft" }
  });
  await expect(moved).toBeOK();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.column;
  }).toBe("product");
});

test("board assistant runs as agent and creates a real task", async ({ page, request }) => {
  const title = `Assistant task ${Date.now()}`;
  await page.goto("/");
  await page.getByPlaceholder("Peça ao agent principal").fill(`criar task ${title}`);
  await page.getByLabel("Enviar").click();
  await expect(page.getByText(/Criei KCA-/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(`criar task ${title}`)).toBeVisible();
  await expect(page.getByText(/Criei KCA-/)).toBeVisible();

  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    const body = await state.json();
    return {
      task: body.tasks.some((item) => item.title === title),
      event: body.events.some((event) => event.type === "agent.event" && event.actor === "assistant")
    };
  }).toEqual({ task: true, event: true });
});

test("board assistant starts a blank chat from header action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Assistant do board" }).getByText("Sem task selecionada")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Assistant do board" }).getByRole("button", { name: "Próxima ação" })).toHaveCount(0);
  await page.getByPlaceholder("Peça ao agent principal").fill("status do board");
  await page.getByRole("region", { name: "Assistant do board" }).getByLabel("Enviar").click();
  await expect(page.getByRole("region", { name: "Assistant do board" }).getByText("status do board")).toBeVisible();
  await expect(page.getByRole("region", { name: "Assistant do board" }).getByText(/Analisei o board/)).toBeVisible();
  await page.getByRole("region", { name: "Assistant do board" }).getByLabel("Novo chat").click();
  await expect(page.getByRole("region", { name: "Assistant do board" }).getByText("status do board")).toHaveCount(0);
});

test("board assistant moves the selected task through a typed command", async ({ page, request }) => {
  const task = await createTask(request, `Assistant move ${Date.now()}`);
  await page.goto("/");
  await page.getByPlaceholder("Peça ao agent principal").fill(`mover ${task.id} para build`);
  await page.getByRole("region", { name: "Assistant do board" }).getByLabel("Enviar").click();
  await expect(page.getByText(new RegExp(`Movi ${task.id}`))).toBeVisible();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.column;
  }).toBe("engineering");
});

test("task modal exposes tabs and runs the assigned agent", async ({ page, request }) => {
  await request.post(`${daemonUrl}/api/settings.update`, {
    data: { scope: "app", patch: { runtime: { maxParallelTasks: 10, agentTokens: { manager: 10 }, projectTokens: { "kanban-code-agent": 10 } } } }
  });
  const task = await createTask(request, `Runtime task ${Date.now()}`, {
    column: "inbox",
    status: "idle",
    routing: { currentAgent: "manager", currentRole: "manager", manualOverride: { active: false } }
  });
  await page.goto("/");
  await page.getByText(task.title).click();
  for (const tab of ["resumo", "execucao", "logs", "worktree", "dependencias", "subtasks", "hooks", "eventos", "arquivos"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  await page.getByRole("tab", { name: "execucao" }).click();
  await page.getByRole("button", { name: "Rodar" }).click();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.status;
  }).toBe("running");
  const decomposed = await request.post(`${daemonUrl}/api/command`, {
    data: { type: "task.decompose", commandId: `e2e-decompose-${Date.now()}`, taskId: task.id }
  });
  await expect(decomposed).toBeOK();
  await page.getByRole("tab", { name: "subtasks" }).click();
  await expect(page.getByRole("dialog").getByText(new RegExp(`${task.id}-01 \\[`))).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(`parent ${task.id}`);
  await expect(page.getByRole("dialog")).toContainText(`main ${task.id}`);
  await page.getByRole("tab", { name: "resumo" }).click();
  await page.getByLabel("Título").fill(`${task.title} editado`);
  await page.getByRole("button", { name: "Salvar task" }).click();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.title;
  }).toContain("editado");
});

test("subtask relation id opens the related task modal", async ({ page, request }) => {
  const task = await createTask(request, `Parent relation ${Date.now()}`, {
    column: "generalist",
    status: "queued",
    routing: { currentAgent: "generalist", currentRole: "generalist", manualOverride: { active: false } }
  });
  const decomposed = await request.post(`${daemonUrl}/api/command`, {
    data: { type: "task.decompose", commandId: `e2e-relation-${Date.now()}`, taskId: task.id }
  });
  await expect(decomposed).toBeOK();
  const childId = (await decomposed.json()).subtasks[0].id;

  await page.goto("/");
  const subtaskCard = page.locator(`[data-task-id="${childId}"]`);
  await expect(subtaskCard).toBeVisible();
  await expect(subtaskCard).not.toContainText("main ");
  await expect(subtaskCard).not.toContainText("parent ");
  await subtaskCard.getByRole("button", { name: task.id, exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Título")).toHaveValue(task.title);
});

test("task files open text and images inline and download binaries", async ({ page, request }) => {
  const task = await createTask(request, `File actions ${Date.now()}`);
  const taskDir = resolve(storageRoot, "tasks", task.id);
  await mkdir(resolve(taskDir, "artifacts"), { recursive: true });
  await writeFile(resolve(taskDir, "artifacts", "notes.txt"), "plain text\n");
  await writeFile(resolve(taskDir, "artifacts", "pixel.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(resolve(taskDir, "artifacts", "archive.bin"), Buffer.from([0, 1, 2, 3]));

  const textResponse = await request.get(`${daemonUrl}/api/task-file?${new URLSearchParams({ taskId: task.id, path: "artifacts/notes.txt" })}`);
  await expect(textResponse).toBeOK();
  expect(textResponse.headers()["content-type"]).toContain("text/plain");
  expect(textResponse.headers()["content-disposition"]).toContain("inline");

  const imageResponse = await request.get(`${daemonUrl}/api/task-file?${new URLSearchParams({ taskId: task.id, path: "artifacts/pixel.png" })}`);
  await expect(imageResponse).toBeOK();
  expect(imageResponse.headers()["content-type"]).toContain("image/png");
  expect(imageResponse.headers()["content-disposition"]).toContain("inline");

  const binaryResponse = await request.get(`${daemonUrl}/api/task-file?${new URLSearchParams({ taskId: task.id, path: "artifacts/archive.bin" })}`);
  await expect(binaryResponse).toBeOK();
  expect(binaryResponse.headers()["content-disposition"]).toContain("attachment");

  const traversal = await request.get(`${daemonUrl}/api/task-file?${new URLSearchParams({ taskId: task.id, path: "../task.yaml" })}`);
  expect(traversal.status()).toBe(400);

  await page.goto("/");
  await page.getByText(task.title).click();
  await page.getByRole("tab", { name: "arquivos" }).click();
  await expect(page.getByRole("link", { name: "Abrir arquivo artifacts/notes.txt" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir arquivo artifacts/pixel.png" })).toBeVisible();

  const textPopupPromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Abrir arquivo artifacts/notes.txt" }).click();
  const textPopup = await textPopupPromise;
  await expect(textPopup.locator("body")).toContainText("plain text");
  await textPopup.close();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Baixar arquivo artifacts/archive.bin" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("archive.bin");
});

test("shows real token usage on task card timing and modal", async ({ page, request }) => {
  const startedAt = "2026-06-14T00:00:00.000Z";
  const endedAt = "2026-06-14T00:01:05.000Z";
  const task = await createTask(request, `Usage UI ${Date.now()}`, {
    column: "engineering",
    status: "running",
    routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } }
  });
  await writeFile(resolve(storageRoot, "tasks", task.id, "events.jsonl"), `${JSON.stringify({
    ts: startedAt,
    type: "agent.transcript",
    actor: "engineering",
    taskId: task.id,
    runId: "run-usage-e2e",
    providerEventType: "agent_start"
  })}\n${JSON.stringify({
    ts: endedAt,
    type: "agent.usage",
    actor: "engineering",
    taskId: task.id,
    runId: "run-usage-e2e",
    agentId: "engineering",
    role: "engineering",
    responseId: "chatcmpl-usage-e2e",
    provider: "openai",
    model: "model-a",
    usage: { inputTokens: 1000, outputTokens: 250, totalTokens: 1250, cacheTokens: 125, contextWindow: 4000, contextPercent: 25 }
  })}\n${JSON.stringify({
    ts: endedAt,
    type: "agent.usage",
    actor: "engineering",
    taskId: task.id,
    runId: "run-usage-e2e",
    agentId: "engineering",
    role: "engineering",
    responseId: "chatcmpl-usage-e2e-b",
    provider: "openai",
    model: "model-b",
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheTokens: 0, contextWindow: 4000, contextPercent: 2.5 }
  })}\n`, { flag: "a" });

  await page.goto("/");
  const card = page.locator(`[data-task-id="${task.id}"]`);
  await expect(card.getByLabel("Uso de tokens")).toHaveCount(0);
  await expect(card.getByLabel("Criacao e tempo total")).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  await expect(card.getByLabel("Criacao e tempo total")).toContainText("1m5s");
  await card.getByRole("button").first().click();
  await page.getByRole("tab", { name: "execucao" }).click();
  await expect(page.getByRole("table", { name: "Uso real de tokens por agent" })).toContainText("engineering");
  await expect(page.getByRole("table", { name: "Uso real de tokens por agent" })).toContainText("openai/model-a");
  await expect(page.getByRole("table", { name: "Uso real de tokens por agent" })).toContainText("openai/model-b");
  await expect(page.getByRole("table", { name: "Uso real de tokens por agent" })).toContainText("1m 5s");
  await expect(page.getByRole("table", { name: "Uso real de tokens por agent" })).toContainText("1.250");
  await expect(page.getByRole("table", { name: "Uso real de tokens por agent" })).toContainText("125");
});

test("daemon scheduler starts tasks from persona events", async ({ request }) => {
  await request.post(`${daemonUrl}/api/settings.update`, {
    data: { scope: "app", patch: { runtime: { maxParallelTasks: 10, agentTokens: { product: 10 }, projectTokens: { "kanban-code-agent": 10 } } } }
  });
  const task = await createTask(request, `Scheduled task ${Date.now()}`, { projectTargets: [] });
  const moved = await request.post(`${daemonUrl}/api/task.move`, {
    data: { taskId: task.id, toColumn: "product" }
  });
  await expect(moved).toBeOK();
  expect((await moved.json()).scheduler.started.map((item) => item.taskId)).toContain(task.id);

  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.status;
  }, { timeout: 7000 }).toBe("running");

  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).events.some((event) => event.type === "scheduler.tick" && event.started?.includes(task.id));
  }).toBe(true);
});

test("saving and executing a new task sends it to manager workflow", async ({ page, request }) => {
  const title = `Direct product task ${Date.now()}`;
  await request.post(`${daemonUrl}/api/settings.update`, {
    data: { scope: "app", patch: { runtime: { maxParallelTasks: 10, agentTokens: { manager: 10 }, projectTokens: { "kanban-code-agent": 10 } } } }
  });
  await page.goto("/");
  await page.locator('[data-column-id="inbox"]').getByRole("button", { name: /Nova task em Entrada/ }).click();
  await page.getByLabel("Título").fill(title);
  await page.locator(".cm-content").fill("Criada como draft e enviada ao manager.");
  await page.getByRole("button", { name: "Salvar e executar" }).click();
  await expect(page.locator('[data-column-id="manager"]').getByText(title)).toBeVisible();

  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    const task = (await state.json()).tasks.find((item) => item.title === title);
    return { column: task?.column, active: ["queued", "running"].includes(task?.status), role: task?.routing?.currentRole };
  }, { timeout: 7000 }).toEqual({ column: "manager", active: true, role: "manager" });
});

test("task comments answer agent questions and logs are paginated", async ({ page, request }) => {
  await request.post(`${daemonUrl}/api/settings.update`, {
    data: { scope: "app", patch: { runtime: { maxParallelTasks: 10, agentTokens: { engineering: 10 }, projectTokens: { "kanban-code-agent": 10 } } } }
  });
  const initialState = await request.get(`${daemonUrl}/api/state`);
  const columns = (await initialState.json()).columns.map((column) => column.id === "engineering" ? { ...column, wip: 20, wipLimit: 20 } : column);
  await request.post(`${daemonUrl}/api/settings.update`, {
    data: { scope: "columns", patch: { columns } }
  });
  const task = await createTask(request, `Task comments ${Date.now()}`, {
    column: "inbox",
    status: "idle",
    routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } }
  });
  const inputRequest = await request.post(`${daemonUrl}/api/command`, {
    data: {
      type: "agent.request_user_input",
      commandId: `e2e-request-input-${Date.now()}`,
      taskId: task.id,
      question: "Qual ambiente alvo?"
    }
  });
  await expect(inputRequest).toBeOK();
  await page.goto("/");
  await page.getByText(task.title).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Comentarios" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Qual ambiente alvo?")).toBeVisible();
  await page.getByPlaceholder("Comente ou responda ao agent").fill("Use staging.");
  await page.getByRole("dialog").getByLabel("Enviar").click();
  await expect(page.getByRole("dialog").getByText("Use staging.")).toBeVisible();
  await expect(page.locator(".task-comment-card.user", { hasText: "Use staging." }).locator(".task-comment-meta span")).toHaveText(/human/i);
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    const item = (await state.json()).tasks.find((candidate) => candidate.id === task.id);
    return item?.column;
  }).toBe("engineering");
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).events.some((event) => event.type === "scheduler.tick" && event.started?.includes(task.id));
  }).toBe(true);
  await page.getByRole("tab", { name: "logs" }).click();
  await expect(page.getByRole("region", { name: "Logs dos agents" })).toBeVisible();
  await expect(page.locator(".pretty-log-entry").first()).toBeVisible();
  await expect(page.locator(".pretty-log-title").first()).toBeVisible();
  await expect(page.locator(".pretty-log-row").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog").getByText("Use staging.")).toBeVisible();
  const history = await request.post(`${daemonUrl}/api/query`, { data: { type: "task.comments", taskId: task.id } });
  expect((await history.json()).length).toBeGreaterThanOrEqual(2);
});

test("settings modal persists scoped settings through the daemon", async ({ page, request }) => {
  const providerModel = `openrouter/test-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.locator(".settings-provider-row", { hasText: "OpenRouter" }).getByRole("checkbox").check();
  await page.locator("#settings-provider-model-openrouter").fill(providerModel);
  await page.locator("#settings-provider-effort-openrouter").selectOption("high");
  await page.locator("#settings-default-provider").selectOption("openrouter");
  const toggle = page.getByLabel("Mostrar progresso no card");
  const nextValue = !(await toggle.isChecked());
  await toggle.click();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Configurações" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#settings-provider-model-openrouter")).toHaveValue(providerModel);
  await expect(page.locator("#settings-provider-effort-openrouter")).toHaveValue("high");
  await page.getByRole("button", { name: "Cancelar" }).click();

  await expect.poll(async () => {
    const settings = await request.post(`${daemonUrl}/api/query`, {
      data: { type: "settings.scope", scope: "app" }
    });
    const body = await settings.json();
    return {
      progress: body.ui.showProgressOnCard,
      provider: body.ai.defaultProvider,
      enabled: body.ai.enabledProviders.includes("openrouter"),
      providerModel: body.ai.providers.openrouter.defaultModel,
      providerEffort: body.ai.providers.openrouter.defaultEffort
    };
  }).toEqual({ progress: nextValue, provider: "openrouter", enabled: true, providerModel, providerEffort: "high" });
});

test("settings modal edits an agent prompt and persists it", async ({ page, request }) => {
  const marker = `Prompt especializado ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.locator(".settings-provider-row", { hasText: "OpenAI Compatible" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Engineering", exact: true }).click();
  await page.locator("#settings-agent-provider").fill("openai_compatible");
  await page.locator("#settings-agent-model").fill("gpt-test-e2e");
  await page.locator("#settings-agent-effort").selectOption("high");
  await expect(page.locator(".settings-provider-status").getByText("missing_env")).toBeVisible();
  await expect(page.locator(".settings-provider-status").getByText(/^missing: OPENAI_COMPATIBLE_API_KEY, OPENAI_COMPATIBLE_BASE_URL$/)).toBeVisible();
  await page.getByLabel("Prompt editável").fill(`# Engineering\n\n${marker}`);
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect.poll(async () => {
    const settings = await request.post(`${daemonUrl}/api/query`, {
      data: { type: "settings.scope", scope: "agents" }
    });
    const engineer = (await settings.json()).agents.find((agent) => agent.id === "engineering");
    return { prompt: engineer.instructionsBody, model: engineer.model };
  }).toEqual({ prompt: `# Engineering\n\n${marker}`, model: { provider: "openai_compatible", name: "gpt-test-e2e", effort: "high" } });
});

test("agentic task workflow persists handoffs, human wait, delegation, compaction and done", async ({ request }) => {
  const task = await createTask(request, `Agentic flow ${Date.now()}`, {
    column: "product",
    status: "queued",
    routing: { currentAgent: "product", currentRole: "product", manualOverride: { active: false } }
  });
  const command = (data) => request.post(`${daemonUrl}/api/command`, { data: { commandId: `e2e-agentic-${Date.now()}-${Math.random()}`, ...data } });

  await expect(await command({ type: "agent.message", message: { scope: "task", taskId: task.id, persona: "product", agentId: "product", text: "Aceite definido.", visibility: "both" } })).toBeOK();
  await expect(await command({ type: "agent.wait_for_persona", taskId: task.id, targetRole: "generalist", question: "Preparar evidência operacional." })).toBeOK();
  const delegated = await command({ type: "agent.delegate_task", taskId: task.id, fromPersona: "generalist", toPersona: "engineering", wait: true, request: "Implementar ajuste técnico." });
  await expect(delegated).toBeOK();
  const delegatedBody = await delegated.json();
  expect(delegatedBody.task.column).toBe("generalist");
  expect(delegatedBody.task.status).toBe("waiting");
  expect(delegatedBody.subtask.column).toBe("engineering");
  await expect(await command({ type: "agent.wait_for_human", taskId: task.id, requestedByRole: "engineering", question: "Aprovar risco?", options: ["Aprovar"] })).toBeOK();
  await expect(await command({ type: "task.answer_input", taskId: task.id, answer: "Aprovado", returnRole: "engineering" })).toBeOK();
  await expect(await command({ type: "agent.wait_for_persona", taskId: task.id, targetRole: "quality", question: "Validar aceite." })).toBeOK();
  await expect(await command({ type: "agent.wait_for_persona", taskId: task.id, targetRole: "review", question: "Revisar evidências." })).toBeOK();
  await expect(await command({ type: "chat.compact", taskId: task.id, persona: "product", summary: "Product definiu aceite e delegou execução.", tokenStats: { before: 50, after: 10 } })).toBeOK();
  await expect(await command({ type: "agent.review_task", taskId: task.id, findings: [], evidence: ["E2E pass"] })).toBeOK();
  await expect(await command({ type: "agent.deploy_task", taskId: task.id, command: process.execPath, args: ["-e", "process.stdout.write('released')"], rollback: "none" })).toBeOK();

  const detail = await request.post(`${daemonUrl}/api/query`, { data: { type: "task.detail", taskId: task.id } });
  await expect(detail).toBeOK();
  expect(await detail.json()).toMatchObject({ column: "done", status: "done" });

  const files = await request.post(`${daemonUrl}/api/query`, { data: { type: "task.files", taskId: task.id } });
  const events = (await files.json()).events;
  expect(events.some((event) => event.type === "role.handoff" && event.toRole === "generalist")).toBe(true);
  expect(events.some((event) => event.type === "delegation.requested")).toBe(true);
  expect(events.some((event) => event.type === "human.input_requested")).toBe(true);
  expect(events.some((event) => event.type === "chat.compacted")).toBe(true);
  expect(events.some((event) => event.type === "gate.passed")).toBe(true);
});

test("orchestrator panel exposes runtime capacity and worktree metrics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Orchestrator" }).click();
  await expect(page.getByRole("region", { name: "Orchestrator" })).toBeVisible();
  await expect(page.getByText("worktrees ativos")).toBeVisible();
  await expect(page.getByText("leases")).toBeVisible();
  await expect(page.getByText("semaforos")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

test.describe.configure({ mode: "serial" });
const daemonUrl = process.env.KCA_DAEMON_URL || "http://127.0.0.1:4175";
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
  await expect(page.getByLabel("Filtro operacional").getByRole("button", { name: "Tudo" })).toBeVisible();
  await expect(page.getByLabel("Painel lateral").getByText("0 tasks")).toBeVisible();
  await expect(page.getByText("Nenhuma task").first()).toBeVisible();
});

test("creates a task through React UI and persists it in FSDB", async ({ page, request }) => {
  const title = `Task UI ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Nova task" }).click();
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Descrição").fill("Persistir via daemon.");
  await page.getByRole("button", { name: "Salvar task" }).click();

  await expect(page.getByText(title)).toBeVisible();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.some((task) => task.title === title);
  }).toBe(true);
});

test("refreshes the board when FSDB task files change externally", async ({ page, request }) => {
  const task = await createTask(request, `Watched task ${Date.now()}`);
  await page.goto("/");
  await expect(page.getByText(task.title)).toBeVisible();

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

  await page.locator(`[data-task-id="${task.id}"]`).dragTo(page.locator(`[data-column-id="definition"]`));
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.column;
  }).toBe("definition");
});

test("board assistant runs as agent and creates a real task", async ({ page, request }) => {
  const title = `Assistant task ${Date.now()}`;
  await page.goto("/");
  await page.getByPlaceholder("Peça ao agent principal").fill(`criar task ${title}`);
  await page.getByLabel("Enviar").click();
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

test("board assistant moves the selected task through a typed command", async ({ page, request }) => {
  const task = await createTask(request, `Assistant move ${Date.now()}`);
  await page.goto("/");
  await page.getByPlaceholder("Peça ao agent principal").fill(`mover ${task.id} para build`);
  await page.getByRole("region", { name: "Assistant do board" }).getByLabel("Enviar").click();
  await expect(page.getByText(new RegExp(`Movi ${task.id}`))).toBeVisible();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.column;
  }).toBe("build");
});

test("task modal exposes tabs and runs the assigned agent", async ({ page, request }) => {
  const task = await createTask(request, `Runtime task ${Date.now()}`);
  await page.goto("/");
  await page.getByText(task.title).click();
  for (const tab of ["aceite", "execucao", "worktree", "dependencias", "subtasks", "hooks", "eventos", "arquivos"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  await page.getByRole("tab", { name: "execucao" }).click();
  await page.getByRole("button", { name: "Rodar" }).click();
  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.status;
  }).toBe("running");
});

test("daemon scheduler auto-starts queued runnable tasks", async ({ request }) => {
  const task = await createTask(request, `Scheduled task ${Date.now()}`, {
    column: "definition",
    status: "queued",
    routing: { currentAgent: "engineer", manualOverride: { active: false } }
  });

  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).tasks.find((item) => item.id === task.id)?.status;
  }, { timeout: 7000 }).toBe("running");

  await expect.poll(async () => {
    const state = await request.get(`${daemonUrl}/api/state`);
    return (await state.json()).events.some((event) => event.type === "scheduler.tick" && event.started?.includes(task.id));
  }).toBe(true);
});

test("task assistant responds inside the task modal", async ({ page, request }) => {
  const task = await createTask(request, `Task chat ${Date.now()}`);
  await page.goto("/");
  await page.getByText(task.title).click();
  await page.getByPlaceholder("Pergunte sobre escopo").fill("por que não iniciou?");
  await page.getByRole("dialog").getByLabel("Enviar").click();
  await expect(page.getByRole("dialog").getByText(/Tokens do agent assistant|está pronta para executar/)).toBeVisible();
});

test("settings modal persists scoped settings through the daemon", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações" }).click();
  const toggle = page.getByLabel("Mostrar progresso no card");
  const nextValue = !(await toggle.isChecked());
  await toggle.click();

  await expect.poll(async () => {
    const settings = await request.post(`${daemonUrl}/api/query`, {
      data: { type: "settings.scope", scope: "app" }
    });
    return (await settings.json()).ui.showProgressOnCard;
  }).toBe(nextValue);
});

test("settings modal edits an agent prompt and persists it", async ({ page, request }) => {
  const marker = `Prompt especializado ${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByRole("button", { name: "Engineer" }).click();
  await page.getByLabel("Prompt editável").fill(`# Engineer\n\n${marker}`);
  await page.getByRole("button", { name: "Salvar agent" }).click();
  await expect.poll(async () => {
    const settings = await request.post(`${daemonUrl}/api/query`, {
      data: { type: "settings.scope", scope: "agents" }
    });
    const engineer = (await settings.json()).agents.find((agent) => agent.id === "engineer");
    return engineer.instructionsBody;
  }).toContain(marker);
});

test("orchestrator panel exposes runtime capacity and worktree metrics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Orchestrator" }).click();
  await expect(page.getByRole("region", { name: "Orchestrator" })).toBeVisible();
  await expect(page.getByText("worktrees ativos")).toBeVisible();
  await expect(page.getByText("bloqueios")).toBeVisible();
});

import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { CodexRunner } from '../../cli/codex-runner.js';
import { ensureCodexHomeAt } from '../../infrastructure/security/codex-home.js';
import { closeServer, listenToolServer } from '../../infrastructure/process/worker-supervisor.js';
import { RunCancelledError, type CustomToolSpec } from '../../application/pi-client.js';

// ---------------------------------------------------------------------------
// PROVA LIVE do bug de producao "o codex nunca ve as tools MCP do Master".
// Roda um turno REAL do codex (auth ChatGPT via proxy Headroom local, model
// gpt-5.6-terra) contra o config.toml gerado pelo ensureCodexHomeAt CORRIGIDO e
// prova, ponta-a-ponta, que o codex agora ENXERGA as tools do Master:
//
//   codex app-server --(config.toml)--> spawn do MCP bridge --(KCA_TOOLS_SOCKET)-->
//   bridge conecta ao UDS do tool server do Master --(GET /tools)--> lista de tools.
//
// A chegada de GET /tools no tool server e o round-trip COMPLETO codex -> bridge ->
// UDS: prova determinista (o codex lista as tools MCP no inicio do thread) de que
// os DOIS bugs corrigidos sumiram:
//   (1) env table: antes o config usava `env_vars` (o codex 0.144.1 nao reconhece);
//       o bridge subia SEM KCA_TOOLS_SOCKET, saia 1 ("obrigatorio"), zero tools.
//   (2) tsx absoluto: o app-server spawna o bridge com cwd = workspace da task;
//       `--import tsx` bare dava ERR_MODULE_NOT_FOUND (sem node_modules no cwd).
// Com o config quebrado o bridge nao sobe e GET /tools NUNCA chega — a assertion falha.
//
// A CHAMADA da tool (tools/call) e verificada de forma OPORTUNISTA (nao obrigatoria):
// o gpt-5.6-terra via proxy invoca tools MCP pela "code mode" do codex
// (`tools.mcp__*` num exec sandbox), que trava e nao emite tools/call — comportamento
// interno do codex+modelo, alheio ao nosso config. O round-trip tools/call -> POST
// /tool do bridge esta provado em isolado (teste unitario do bridge). Quando o modelo
// DE FATO chama, validamos o marker; senao, a prova determinista e o GET /tools.
//
// Gate: SWARM_VALIDATION=1 + ~/.codex/auth.json + provider custom no ~/.codex/config.toml
// (o proxy Headroom que a auth ChatGPT atravessa). Segredos: auth.json e COPIADO
// (0600), NUNCA lido/logado, removido no teardown; a secao de provider (sem segredos)
// e lida do config do host, nunca impressa com tokens.
// ---------------------------------------------------------------------------

const hasValidationFlag = process.env.SWARM_VALIDATION === '1';
const HOST_CODEX_DIR = join(homedir(), '.codex');
const HOST_CODEX_AUTH = join(HOST_CODEX_DIR, 'auth.json');
const HOST_CODEX_CONFIG = join(HOST_CODEX_DIR, 'config.toml');
const LIVE_MODEL = process.env.SWARM_CODEX_LIVE_MODEL ?? 'gpt-5.6-terra';
// Aborta o turno se o modelo travar na code-mode; a prova (GET /tools) ja ocorreu.
const TURN_MAX_MS = 90_000;

// Extrai APENAS a secao de provider (sem segredos) do config do host: as chaves
// top-level model_provider/openai_base_url + a tabela [model_providers.<name>].
// Sao os overrides que o CODEX_HOME sandbox precisa p/ a auth ChatGPT atravessar
// o proxy local. Retorna '' se o host nao usa provider custom (backend default).
function extractProviderSnippet(hostToml: string): string {
  const providerMatch = hostToml.match(/^\s*model_provider\s*=\s*"([^"]+)"/m);
  if (!providerMatch || providerMatch[1] === 'openai') return '';
  const name = providerMatch[1];
  const lines = [`model_provider = "${name}"`];
  const baseUrl = hostToml.match(/^\s*openai_base_url\s*=\s*"([^"]+)"/m);
  if (baseUrl) lines.push(`openai_base_url = "${baseUrl[1]}"`);
  // Tabela [model_providers.<name>] ate o proximo header de tabela ou EOF.
  const tableRe = new RegExp(`\\[model_providers\\.${name}\\][\\s\\S]*?(?=\\n\\[|$)`);
  const table = hostToml.match(tableRe);
  if (table) lines.push('', table[0].replace(/\s+$/, ''));
  return `${lines.join('\n')}\n`;
}

function readProviderSnippet(): string | undefined {
  try {
    return extractProviderSnippet(readFileSync(HOST_CODEX_CONFIG, 'utf-8')) || undefined;
  } catch {
    return undefined;
  }
}

const providerSnippet = hasValidationFlag && existsSync(HOST_CODEX_AUTH) ? readProviderSnippet() : undefined;
const runLive = hasValidationFlag && existsSync(HOST_CODEX_AUTH) && !!providerSnippet;

describe.skipIf(!runLive)('LIVE: codex enxerga as tools MCP do Master (env table + tsx absoluto)', () => {
  it(
    `codex spawna o bridge e busca as tools do Master via UDS (round-trip real, model ${LIVE_MODEL})`,
    async () => {
      // Sandbox CODEX_HOME isolado (fora do projeto). config.toml/auth.json nao tem
      // limite de sun_path; o SOCKET sim -> dir curto separado sob /tmp.
      const codexHome = mkdtempSync(join(tmpdir(), 'kca-codexhome-'));
      const socketDir = mkdtempSync(join(tmpdir(), 'kca-live-'));
      const workdir = mkdtempSync(join(tmpdir(), 'kca-live-cwd-'));
      const socketPath = join(socketDir, 't.sock');
      const seededAuth = join(codexHome, 'auth.json');

      // Seed do auth ChatGPT: COPIA (nao move) o auth.json do host, 0600. NUNCA
      // logado/lido; removido no finally.
      copyFileSync(HOST_CODEX_AUTH, seededAuth);
      chmodSync(seededAuth, 0o600);

      // config.toml = overrides de provider (sem segredos) + o bloco kca_tools do
      // ensureCodexHomeAt CORRIGIDO. Escreve o provider PRIMEIRO (chaves top-level
      // antes de qualquer tabela = TOML valido); o merge preserva-o e anexa o kca.
      writeFileSync(join(codexHome, 'config.toml'), providerSnippet!, { mode: 0o600 });
      ensureCodexHomeAt(codexHome, { toolsSocket: socketPath });

      // Prova estatica dos DOIS fixes no config gerado: tabela env com o socket
      // (nao env_vars) e tsx resolvido p/ path absoluto (nao o bare 'tsx').
      const generatedToml = readFileSync(join(codexHome, 'config.toml'), 'utf-8');
      expect(generatedToml).toContain('[mcp_servers.kca_tools.env]');
      expect(generatedToml).toContain(`KCA_TOOLS_SOCKET = "${socketPath}"`);
      expect(generatedToml).not.toContain('env_vars');
      expect(generatedToml).not.toContain('"--import", "tsx"');

      // Tool server real (listenToolServer) com um stub de post_message.
      let toolCallText: string | undefined;
      let toolCalls = 0;
      const tools: CustomToolSpec[] = [
        {
          name: 'post_message',
          description: 'Publica uma mensagem no chat da tarefa. Chame exatamente uma vez.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['text'],
            properties: { text: { type: 'string', description: 'texto exato da mensagem' } },
          },
          execute: async (params: Record<string, unknown>) => {
            toolCalls += 1;
            if (typeof params.text === 'string') toolCallText = params.text;
            return 'entregue';
          },
        },
      ];
      const toolServer = await listenToolServer(socketPath, tools);
      // Observa (sem consumir) o GET /tools: o round-trip codex -> bridge -> UDS que
      // prova que o codex enxergou as tools. Listener adicional ao do listenToolServer.
      let sawToolsList = false;
      toolServer.on('request', (req: IncomingMessage) => {
        if (req.method === 'GET' && req.url === '/tools') sawToolsList = true;
      });

      const marker = `KCA-LIVE-${Date.now()}`;
      const started = Date.now();
      const controller = new AbortController();
      // Aborta se o turno travar na code-mode; a prova (GET /tools) e no inicio do thread.
      const killTimer = setTimeout(() => controller.abort(), TURN_MAX_MS);
      const runner = new CodexRunner({ codexHome });
      let turnStatus = 'ok';
      let tokens: { input?: number; output?: number; total?: number } = {};
      try {
        try {
          const result = await runner.runTurn({
            cwd: workdir,
            model: LIVE_MODEL,
            effort: 'low',
            sandboxPolicy: 'workspaceWrite',
            toolsSocket: socketPath,
            systemPrompt:
              'Voce tem uma tool MCP chamada post_message. Siga a instrucao do usuario a risca e nao invente conteudo.',
            prompt:
              `Chame a tool post_message EXATAMENTE uma vez, com o argumento text ` +
              `contendo EXATAMENTE este marcador (sem aspas, sem nada a mais): ${marker}. ` +
              `Depois de a tool retornar, responda apenas "feito".`,
            signal: controller.signal,
          });
          tokens = result.usage;
        } catch (error) {
          // Abort (code-mode travada) e esperado e NAO invalida a prova: o GET /tools
          // ja aconteceu no inicio do thread. Qualquer outro erro propaga.
          if (!(error instanceof RunCancelledError)) throw error;
          turnStatus = 'aborted (code-mode; GET /tools ja round-trippou)';
        }
      } finally {
        clearTimeout(killTimer);
        rmSync(seededAuth, { force: true }); // credencial copiada NUNCA persiste.
        await closeServer(toolServer).catch(() => undefined);
        rmSync(socketDir, { recursive: true, force: true });
        rmSync(workdir, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }

      // eslint-disable-next-line no-console
      console.log(
        `[live codex-mcp] model=${LIVE_MODEL} sawToolsList=${sawToolsList} toolCalls=${toolCalls} ` +
          `markerLanded=${toolCallText === marker} turn=${turnStatus} ` +
          `tokens(in/out/total)=${tokens.input}/${tokens.output}/${tokens.total} dur=${Date.now() - started}ms`,
      );

      // PROVA DETERMINISTA: o codex spawnou o bridge (env table + tsx absoluto) a
      // partir do cwd da task, o bridge conectou ao UDS do Master e o codex buscou a
      // lista de tools. Com o config quebrado (o bug), isto NUNCA acontece.
      expect(sawToolsList).toBe(true);
      // OPORTUNISTA: se o modelo de fato chamou a tool, o marker tem de bater
      // (valida o round-trip tools/call -> POST /tool ponta-a-ponta quando ocorre).
      if (toolCalls > 0) expect(toolCallText).toBe(marker);
    },
    TURN_MAX_MS + 30_000,
  );
});

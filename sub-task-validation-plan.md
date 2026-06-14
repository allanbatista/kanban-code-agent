# Goal: Validar workflow de execução com subtasks

Valide a implementação atual de **subtask-based delegation** para garantir que o novo workflow de geração, execução e consolidação de subtasks funciona corretamente em cenários simples, médios e compostos.

## Objetivo principal

Comprovar, por execução prática, que:

1. Uma task pode ser executada diretamente com sucesso.
2. Uma task pode gerar subtasks executáveis.
3. As subtasks recebem contexto mínimo, suficiente e autocontido.
4. O parent permanece no estado/coluna correto enquanto aguarda subtasks.
5. O parent é reativado/requeued corretamente quando as subtasks terminam.
6. Os resultados das subtasks são reportados e consolidados no parent.
7. O workflow respeita os timeouts definidos.
8. Todas as tasks de validação abaixo terminam com sucesso.

Não considere a validação concluída apenas porque testes unitários passaram. É obrigatório executar os cenários descritos e registrar evidências do comportamento observado.

---

## Contexto da implementação que deve ser validada

A implementação esperada é:

* `agent.delegate_task` deve criar uma child task, não mover a task original.
* `task.decompose` / `spawn_subtasks` deve criar N subtasks diretas com `parentTaskId` e `mainTaskId` corretos.
* A parent task deve permanecer na coluna atual e ficar com status `waiting` enquanto aguarda subtasks.
* Quando uma child task termina, o resultado deve ser reportado ao parent.
* Quando uma child task esperada termina, o parent deve ser requeued na mesma coluna/agente.
* Subtasks devem aparecer como cards próprios.
* O board/modal deve exibir relações parent/main e contadores diretos de subtasks.
* Contadores diretos não devem incluir descendentes aninhados.

---

## Cenários obrigatórios de validação

Execute os 5 cenários abaixo.

### Cenário 1 — Task mínima

**Task:**
Responda “oi” em japonês.

**Timeout máximo:** 1 minuto.

**Resultado esperado:**
A resposta final deve ser exatamente uma saudação equivalente a “oi” em japonês, por exemplo:

```text
こんにちは
```

**Critérios de sucesso:**

* A task termina com status de sucesso.
* O tempo total fica abaixo de 1 minuto.
* Não há loop, espera desnecessária ou criação indevida de subtasks.
* O output é curto, direto e correto.

---

### Cenário 2 — Task simples de geração textual

**Task:**
Crie uma história infantil com até 100 palavras.

**Timeout máximo:** 2 minutos.

**Resultado esperado:**
Uma história infantil original, coerente e com no máximo 100 palavras.

**Critérios de sucesso:**

* A task termina com status de sucesso.
* O tempo total fica abaixo de 2 minutos.
* A história tem até 100 palavras.
* O output não inclui explicações extras fora da história, a menos que seja necessário para informar a contagem.

---

### Cenário 3 — Task com pesquisa atual

**Task:**
Pesquise e faça uma lista com os top 10 países com as menores temperaturas hoje.

**Timeout máximo:** 3 minutos.

**Resultado esperado:**
Uma lista com 10 países, ordenada do mais frio para o menos frio entre os encontrados, contendo:

* posição;
* país;
* temperatura observada ou estimada;
* localidade usada como referência;
* fonte ou método usado;
* data da consulta.

**Critérios de sucesso:**

* A task termina com status de sucesso.
* O tempo total fica abaixo de 3 minutos.
* O resultado não inventa dados.
* O resultado deixa claro qual localidade representa cada país.
* Se houver limitação de fonte, registrar a limitação sem falhar a task, desde que entregue uma lista plausível e rastreável.

---

### Cenário 4 — Task de código

**Task:**
Crie um script em Python que consulte as temperaturas de todos os estados brasileiros e imprima no terminal.

**Timeout máximo:** 5 minutos.

**Resultado esperado:**
Um script Python funcional que:

* consulta uma fonte pública de clima ou meteorologia;
* percorre todos os 26 estados brasileiros + Distrito Federal;
* usa uma capital ou cidade representativa por UF;
* imprime no terminal UF, cidade consultada e temperatura;
* trata erro de rede, timeout e resposta inválida;
* possui instruções simples de execução.

**Critérios de sucesso:**

* A task termina com status de sucesso.
* O tempo total fica abaixo de 5 minutos.
* O script é salvo em arquivo `.py`.
* O script passa por uma validação mínima de sintaxe.
* Sempre que possível, execute o script ou uma versão de teste com timeout controlado.
* Se a execução real depender de internet indisponível, registrar isso como limitação e validar pelo menos sintaxe + fluxo de tratamento de erro.

---

### Cenário 5 — Task composta com subtasks

**Task:**
Execute as quatro tarefas anteriores dentro de uma única task principal.

**Timeout máximo:** 5 minutos.

**Resultado esperado:**
A task principal deve decompor o trabalho em exatamente 4 subtasks diretas, uma para cada cenário anterior:

1. saudação em japonês;
2. história infantil;
3. top 10 países mais frios hoje;
4. script Python de temperaturas dos estados brasileiros.

**Critérios de sucesso da task composta:**

* A parent task cria 4 subtasks diretas.
* Cada subtask possui `parentTaskId` apontando para a task composta.
* Cada subtask possui `mainTaskId` correto.
* A parent task permanece na coluna original.
* A parent task entra em `waiting` enquanto aguarda as subtasks.
* Cada subtask executa com sucesso dentro do seu timeout individual.
* O parent recebe os resultados das subtasks.
* O parent é requeued após conclusão das subtasks.
* O parent consolida os 4 resultados em uma resposta final.
* O tempo total da task composta fica abaixo de 5 minutos.
* Os contadores diretos da parent mostram total 4, done 4, running 0 ao final.
* Nenhum contador direto deve incluir subtasks aninhadas inexistentes.

---

## Regras de execução

* Execute os cenários na ordem apresentada.
* Registre tempo de início, tempo de fim e duração de cada cenário.
* Não aceite sucesso silencioso: cada task precisa ter output final verificável.
* Não faça alterações estruturais antes de observar uma falha real.
* Se uma task entrar em loop, travar ou ultrapassar timeout, interrompa, analise a causa e faça o menor ajuste necessário.
* Após qualquer ajuste, reexecute o cenário que falhou.
* Se o ajuste puder afetar cenários anteriores, reexecute também os cenários anteriores impactados.
* Não mascarar falhas usando outputs hardcoded, exceto quando estiver usando adapter fake explicitamente para validar apenas o mecanismo de workflow.
* Se usar adapter fake, deixe claro quais partes foram validadas com fake e quais foram validadas com execução real.
* Preserve mudanças não relacionadas existentes no worktree.
* Não modifique arquivos fora do escopo da validação, a menos que sejam necessários para corrigir o workflow.

---

## O que observar durante a validação

Durante a execução, verifique explicitamente:

### Criação de subtasks

* A task composta cria exatamente 4 subtasks diretas.
* Cada subtask tem descrição autocontida.
* Cada subtask possui acceptance criteria claro.
* Cada subtask sabe qual output deve produzir.
* Cada subtask não depende implicitamente do histórico completo da parent.

### Estado da parent

* A parent não muda de coluna por causa da delegação.
* A parent fica `waiting` enquanto aguarda subtasks.
* A parent é requeued quando as subtasks reportam resultado.
* A parent consolida os resultados sem duplicar execução.

### Resultado das subtasks

* Cada subtask gera resultado próprio.
* O resultado de cada subtask é reportado para a parent.
* A parent sabe distinguir subtasks concluídas e pendentes.
* Não há requeue infinito.
* Não há repetição da mesma subtask sem necessidade.

### UI / projeção, se aplicável

Se houver interface disponível, validar também:

* Cards de subtasks aparecem no board.
* Cards mostram badges de parent/main.
* Parent mostra contador direto de subtasks.
* Modal da parent lista as 4 subtasks diretas.
* Modal de cada subtask mostra parent/main corretamente.
* Resultado ou summary mais recente aparece no modal.

---

## Critérios globais de aceite

A validação só pode ser considerada concluída quando todos os itens abaixo forem verdadeiros:

* Os 5 cenários foram executados.
* Os 5 cenários terminaram com sucesso.
* Nenhum cenário ultrapassou o timeout máximo.
* A task composta gerou exatamente 4 subtasks diretas.
* A parent da task composta ficou `waiting` enquanto aguardava.
* A parent foi requeued corretamente.
* Os resultados das 4 subtasks foram consolidados.
* Não houve loop infinito.
* Não houve criação duplicada indevida de subtasks.
* Não houve movimentação indevida da parent entre colunas.
* Foram registradas evidências suficientes para reproduzir ou auditar a validação.

---

## Em caso de falha

Se qualquer cenário falhar:

1. Identifique o ponto exato da falha.
2. Classifique a falha em uma das categorias:

   * decomposição incorreta;
   * subtask sem contexto suficiente;
   * parent não ficou `waiting`;
   * parent não foi requeued;
   * resultado da child não foi reportado;
   * timeout;
   * loop/reexecução indevida;
   * erro de tool/runtime;
   * erro de UI/projeção;
   * erro no próprio prompt da task.
3. Faça o menor ajuste possível.
4. Registre o arquivo alterado e o motivo.
5. Reexecute o cenário.
6. Só avance quando o cenário passar.

---

## Relatório final obrigatório

Ao final, entregue um relatório com este formato:

````markdown
# Relatório de Validação — Subtask Workflow

## Resumo

Status geral: PASSOU ou FALHOU

## Cenários executados

| Cenário | Status | Duração | Timeout | Observações |
|---|---:|---:|---:|---|
| 1. Oi em japonês |  |  | 1min |  |
| 2. História infantil |  |  | 2min |  |
| 3. Top 10 países mais frios hoje |  |  | 3min |  |
| 4. Script Python temperaturas BR |  |  | 5min |  |
| 5. Task composta com 4 subtasks |  |  | 5min |  |

## Evidências do workflow

- Parent task id:
- Main task id:
- Subtasks criadas:
  - Subtask 1:
  - Subtask 2:
  - Subtask 3:
  - Subtask 4:

## Validação da parent task

- Parent permaneceu na coluna original: sim/não
- Parent entrou em waiting: sim/não
- Parent foi requeued: sim/não
- Parent consolidou resultados: sim/não
- Contador direto final: total X, running Y, done Z

## Outputs finais

### Cenário 1

```text
...
````

### Cenário 2

```text
...
```

### Cenário 3

```text
...
```

### Cenário 4

Arquivo criado:

```text
...
```

Validação executada:

```text
...
```

### Cenário 5

Resumo consolidado:

```text
...
```

## Ajustes realizados

Liste todos os arquivos alterados, ou informe:

Nenhum ajuste foi necessário.

## Riscos ou débitos restantes

Liste qualquer limitação, ou informe:

Nenhum débito restante identificado.

```

---

## Definition of Done

Considere o goal concluído somente quando:

- todos os cenários estiverem PASSANDO;
- o relatório final estiver preenchido;
- qualquer ajuste necessário estiver implementado;
- testes relevantes tiverem sido executados;
- não houver timeout, loop ou inconsistência de estado;
- não houver débito não registrado.
```


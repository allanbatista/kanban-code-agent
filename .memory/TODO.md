# [high] Implementar Kanban multiagente v2

O projeto ainda nao entrega o objetivo completo de equipe gerente/produto/design/engenharia/qualidade/review/deployment com planning em DAG, scheduler paralelo, semaforos atomicos, chats persistentes por escopo e deployment. O plano executavel esta em `plan-v2.md`.

# [high] Implementar loop autonomo do scheduler no daemon

F2 entregou `scheduler.tick`, state machine e runtime semaphores com testes unitarios, mas o daemon ainda nao roda um loop autonomo configuravel que publique eventos e mova tasks queued para running sem clique manual. Proximo passo: implementar `F2.S1.T5` em `apps/daemon/src/server.js` com validacao E2E.

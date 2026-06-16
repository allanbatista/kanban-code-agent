# Kanban Code Agent

O objetivo deve projeto é entregar 3 camadas qu

## Proof of Concept

Para a prova de conceito foi implementado uma arquitetura totalmente event driven em `./poc/index.ts` e a base do layout em `./poc/layout`.

## Documentação

- usage documentation: ./docs/usage/
- software documentation: ./docs/software/

## Rules

- Convention over configuration
- Utilize padroes de projeto, solid e event-driven.
- Sempre priorize consistência e resiliencia
- Utilize Stack node
- Tudo precisa ser auditável e rastreável
- Database as filesystem
- Configurações podem ser feitas via file ou envvar, sempre priorizando a envvar.
- Siga os guidelines de codificação em ./docs/software/CODE_GUIDELINE.md
- Utilize o graphify desde o começo. após grandes alterações, atualize o graphify com `graphify update`

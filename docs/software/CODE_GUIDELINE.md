# Code Guideline

## SOLID

- **S**ingle Responsibility: Cada módulo, classe ou função deve ter uma única razão para mudar.
- **O**pen/Closed: Entidades abertas para extensão, fechadas para modificação.
- **L**iskov Substitution: Subtipos devem ser substituíveis por seus tipos base.
- **I**nterface Segregation: Interfaces pequenas e específicas, não genéricas.
- **D**ependency Inversion: Depender de abstrações, não de implementações concretas.

## Event-Driven

- Utilize eventos para comunicação entre camadas.
- Emissores de eventos não devem conhecer os consumidores.
- Eventos devem ser imutáveis e conter apenas dados.
- Prefira pub/sub acoplado a chamadas diretas entre módulos.

## Convention over Configuration

- Estrutura de pastas segue as camadas: domain, application, infrastructure, cli.
- Nomes de arquivos em kebab-case.
- Nomes de classes em PascalCase.
- Nomes de variáveis e funções em camelCase.
- Constantes em UPPER_SNAKE_CASE.
- Exportações nomeadas preferidas sobre default exports.

## Estrutura de Arquivos

```
src/
├── domain/         # Entidades, value objects, eventos de domínio
├── application/    # Casos de uso, serviços, orquestração
├── infrastructure/ # Adaptadores, persistência, integrações externas
└── cli/            # Entry point CLI, parsing de argumentos
```

## Auditabilidade e Rastreabilidade

- Toda ação deve ser logável.
- Preferir configuração via variáveis de ambiente sobre arquivos de config.
- Quando usar arquivos de config, envvar tem prioridade.
- Logs devem incluir timestamp, contexto e nível de severidade.

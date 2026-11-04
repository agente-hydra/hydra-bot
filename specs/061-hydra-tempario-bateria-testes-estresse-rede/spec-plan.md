# Spec 061 — Plano de Implementação: Tempário Comercial Completo (Mão de Obra R$ 270/h + Associativa de Peças e Ferramentas + Pesquisa Web Real + Testes nas 10 Lojas)

**ID da Spec:** `061-hydra-tempario-bateria-testes-estresse-rede`  
**Data:** 03/11/2026  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA / HARD STOP ATIVO  
**Suíte de Testes:** `src/hydra-sync/tests/test_harness_tempario_stress.ts`  

---

## 1. Mapa de Módulos (Novos vs. Modificados)

| Caminho do Arquivo | Tipo | Responsabilidade |
| :--- | :---: | :--- |
| `src/hydra-sync/types/tempario_contract.ts` | **MODIFICAR** | Adicionar `TemparioPartItem`, `taxaHorariaPadrao`, `valorMaoDeObraSugerido`, `pecasNecessarias` e `ferramentasNecessarias`. |
| `src/hydra-sync/tempario_graph_repository.ts` | **MODIFICAR** | Criar tabela `tempario_operation_parts`, fixtures das 4 novas plataformas (Onix, Civic, Corolla, Renegade) com peças e ferramentas, e agregação de peças no resultado do CTE. |
| `src/hydra-sync/tempario_web_researcher.ts` | **NOVO** | Módulo de pesquisa técnica ativa na Web para veículos/serviços não homologados, extraindo tempos de montadora, ferramentas de fasagem e peças associadas com precificação a R$ 270/h. |
| `src/hydra-sync/tempario_hybrid_coordinator.ts` | **MODIFICAR** | Integrar `TemparioWebResearcher` no fluxo de fallback e aplicar taxa horária de R$ 270,00/h. |
| `src/hydra-sync/balloon_composer.ts` | **MODIFICAR** | Atualizar `composeTemparioHermesBalloon()` para formatar a seção comercial de mão de obra (R$ 270/h), a lista de peças `[x]` e as ferramentas especiais exigidas. |
| `src/hydra-sync/tests/test_harness_tempario_stress.ts` | **NOVO** | Suíte de testes com 10 cenários (C01 a C10), incluindo cálculo de R$ 270/h, associativa de peças e ferramentas, matriz das 10 lojas físicas e teste com pesquisa web real. |
| `tsconfig.tempario.json` | **MODIFICAR** | Incluir novos arquivos na verificação estrita de compilação. |

---

## 2. Tarefas Atômicas de Implementação

### Fase 1: Contratos Comerciais, Associativa de Peças e Grafo Expandido

- [x] `[LEAD]` **Task 1.1: Expandir Contratos em `tempario_contract.ts`**
  - **Arquivo:** `src/hydra-sync/types/tempario_contract.ts`
  - **Descrição:**
    - Criar interface `TemparioPartItem` (`nomePeca`, `codigoReferencia`, `quantidade`, `unidade`, `obrigatoria`, `especificacaoTecnica`).
    - Adicionar a `DeduplicatedGraphChainResult`: `pecasNecessarias`, `ferramentasNecessarias`, `torquesEspecificados`, `taxaHorariaPadrao` (270.00), `valorMaoDeObraSugerido`, `valorMaoDeObraBrutoSemAssociativa`, `economiaMaoDeObraReais`.

- [x] `[LEAD]` **Task 1.2: Criar Tabela `tempario_operation_parts` e Fixtures Oficiais das 5 Plataformas**
  - **Arquivo:** `src/hydra-sync/tempario_graph_repository.ts`
  - **Descrição:**
    - Criar DDL da tabela `tempario_operation_parts`.
    - Popular peças e ferramentas para as 5 plataformas:
      1. *Golf 1.4 TSI:* Bloco óptico farol, radiador, 3L aditivo G13, 3L água, abraçadeiras; ferramentas Torx T25/T30, regloscópio, vácuo.
      2. *Onix 1.0 Turbo:* Kit correia dentada banhada a óleo, tensor, junta de distribuição, retentor virabrequim, bomba d'água, 4L óleo Dexos 1 Gen 3, filtro óleo, 3L aditivo Dex-Cool, 3L água; ferramentas de fasagem Raven 131003, trava de volante.
      3. *Civic 2.0:* Platô, disco, atuador hidráulico concêntrico, retentor traseiro do virabrequim, 6 parafusos volante, fluido DOT4; ferramentas de centralização, cavalete de câmbio, torquímetro angular.
      4. *Corolla 2.0:* Pastilhas dianteiras com lâminas antirruído, discos ventilados, fluido DOT4, spray limpa-freios; ferramentas encolhedor de êmbolo, relógio comparador, torquímetro.
      5. *Renegade 1.3 Turbo:* Par amortecedores dianteiros, par kits de coxim/batente; ferramentas encolhedor de molas, soquete de amortecedor 21mm/22mm, torquímetro.
    - Atualizar `resolveDeduplicatedServiceChain` para agregar peças associadas sem duplicatas e calcular os valores em reais a R$ 270,00/h.

---

### Fase 2: Pesquisa Técnica Real na Web e Balão Comercial Hermes

- [x] `[LEAD]` **Task 2.1: Implementar `TemparioWebResearcher` (`tempario_web_researcher.ts`)**
  - **Arquivo:** `src/hydra-sync/tempario_web_researcher.ts`
  - **Descrição:**
    - Criar módulo de busca técnica automotiva na Web.
    - Executar busca com termos calibrados (manuais de reparação, tempo padrão, ferramentas de fasagem, peças obrigatórias).
    - Extrair tempo estimado, lista de ferramentas especiais e peças de reposição.
    - Aplicar precificação comercial a R$ 270,00/h e salvar em staging com proveniência `PESQUISA_TECNICA_WEB`.

- [x] `[LEAD]` **Task 2.2: Conectar Coordenador e Compositor Hermes**
  - **Arquivos:** `src/hydra-sync/tempario_hybrid_coordinator.ts`, `src/hydra-sync/balloon_composer.ts`
  - **Descrição:**
    - No coordenador, acionar `TemparioWebResearcher` quando o catálogo local não cobrir o veículo/serviço.
    - Em `balloon_composer.ts`, formatar o balão Hermes com:
      - Bloco de Mão de Obra com valor a cobrar (`R$ 270,00/h`), valor bruto e desconto de acesso compartilhado em R$.
      - Bloco de Associativa de Peças com checkboxes `- [x]`.
      - Bloco de Ferramentas Especiais na Bancada.

---

### Fase 3: Suíte de Testes de Estresse (`test_harness_tempario_stress.ts`) e Validação das 10 Lojas

- [x] `[LEAD]` **Task 3.1: Implementar Suíte com os 10 Cenários Contratuais**
  - **Arquivo:** `src/hydra-sync/tests/test_harness_tempario_stress.ts`
  - **Cenários:**
    - **C01 (Golf Farol + Radiador):** Tempo 3,05h, mão de obra R$ 823,50, economia de R$ 202,50, peças (radiador, farol, aditivo) e ferramentas.
    - **C02 (Onix Correia + Bomba d'Água):** Tempo 5,10h, mão de obra R$ 1.377,00, economia de R$ 702,00, 9 peças associadas e ferramentas de fasagem.
    - **C03 (Civic Embreagem + Retentor):** Tempo 4,60h, mão de obra R$ 1.242,00, economia de R$ 1.134,00, peças de embreagem e retentor.
    - **C04 (Corolla Freios Completos):** Tempo 1,10h, mão de obra R$ 297,00, economia de R$ 216,00, pastilhas e discos.
    - **C05 (Renegade Suspensão):** Tempo 2,20h, mão de obra R$ 594,00, economia de R$ 540,00, amortecedores e coxins.
    - **C06 (Rede 10 Lojas Físicas para Sócio):** Amostras de todas as 10 lojas consolidadas com tempos e valores.
    - **C07 (Isolamento 10x10 de Gerentes):** 100 asserções de segurança (cada gerente acessa só sua loja, bloqueio nas outras 9).
    - **C08 (Expurgo Absoluto de MPMaster):** Zero OSs da unidade administrativa nas métricas da rede.
    - **C09 (Pesquisa Real na Web):** Disparo de pesquisa técnica na web para veículo não cadastrado (ex: Tracker 1.2 Turbo), capturando tempo, ferramentas de fasagem e cálculo a R$ 270/h.
    - **C10 (Estresse de 100 Requisições):** 100 chamadas consecutivas/concorrentes medindo estabilidade de heap e tempo de resposta.

---

### Fase 4: Build Gate e Execução Determinística

- [x] `[LEAD]` **Task 4.1: Build Gate TypeScript**
  - **Comando:** `npx tsc -p tsconfig.tempario.json`
  - **Critério:** Zero erros TypeScript (strict mode, zero `any`, zero `@ts-ignore`).

- [x] `[LEAD]` **Task 4.2: Execução do Harness Completo de Estresse**
  - **Comando:** `npx tsx src/hydra-sync/tests/test_harness_tempario_stress.ts`
  - **Critério:** 10/10 cenários aprovados (incluindo as 100 verificações multi-gerente e a pesquisa web real) com exit code 0.

- [x] `[LEAD]` **Task 4.3: Regressão Zero na Suíte Base 054**
  - **Comando:** `npx tsx src/hydra-sync/tests/test_harness_tempario.ts`
  - **Critério:** 7/7 testes originais continuam 100% verdes.

---

## 3. Circuit Breaker e Hard Stop

Após a criação e aprovação desta spec, o agente entra em **HARD STOP** obrigatório e aguarda a autorização do usuário via `/sdd-apply` ou `/vibe-apply 061`.

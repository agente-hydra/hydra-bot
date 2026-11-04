# Spec 066 — Tempário Híbrido com IA + MCP, Pesquisa Técnica Web Real e Blindagem Anti-Alucinação

## 1. Diagnóstico Forense (Código + Banco de Dados da VPS + Logs Reais)

A partir da análise ponta a ponta do trajeto da conversa no WhatsApp e da auditoria direta no banco SQLite de produção (`/home/operacional/hydra-data/hydra_ops.db` na VPS `100.126.50.101`), identificamos **6 causas raízes exatas** que produziram o comportamento relatado pelo usuário (*"alucinando, e era pra usar ia com mcp ao inves de ser busca semantica, ia com pesquisa mano"*):

### 1.1. Evidência no WhatsApp (O que aconteceu)
1. **Caso 1 (`FCK2E73 \n\ntroca da bieleta dianteira direita` -> Opção `3`):**
   - O bot respondeu `> TRACKER (2002-2012) · Motor Motor Padrão` com `1,00h (R$ 270,00)` e, ao pedir o passo a passo (`3`), retornou apenas um passo genérico inútil:
     `- 1. Execução de troca da bieleta dianteira direita (Pesquisa Técnica Web) (Execução): 1,00h (60 min) | Ferramentas: Ferramentas manuais de oficina, Torquímetro de precisão`.
2. **Caso 2 (`EUS5006 \n\ntroca de motor de partida`):**
   - O bot alucinou completamente o veículo e vazou o serviço do turno anterior:
     `> Veículo Veículo Passeio (2002-2012) · Motor Motor Padrão`
     `- Serviços: Substituição da bieleta dianteira direita + Troca da bieleta dianteira`
     `- Tempo líquido cobrado: 2,50h (2h 30 min) | Total Mão de Obra a Cobrar: R$ 675,00`

---

### 1.2. As 6 Causas Raízes Comprovadas no Código e no SQLite

1. **Causa Raiz 1 — Poluição do Catálogo SQLite por Auto-Persistência Sem Filtro (`tempario_graph_repository.ts:1807-1895`):**
   - A inspeção direta na tabela `tempario_vehicles` e `tempario_operations` da VPS revelou 4 registros espúrios gravados por `persistLearnedTemparioCatalog` durante fallbacks anteriores:
     - `veh_veculo_veculopasseio_2002_2012` (`marca: 'Veículo'`, `modelo: 'Veículo Passeio'`) vinculado à operação `op_veculo_veculopasseio_substitui__o_da_bieleta_dianteira_direita___troca_da_bieleta_dianteira_2002` (`2.5h`, `status_evidencia: 'HISTORICO_OS_REDE'`).
     - `veh_nacional_veculo_2002_2012` (`marca: 'Nacional'`, `modelo: 'Veículo'`) vinculado a `Serviço Mecânico Geral` (`2.5h`).
     - `veh_nacional_tracker_2002_2012` (`marca: 'Nacional'`, `modelo: 'TRACKER'`, `2002-2012`) vinculado a `op_nacional_tracker_troca_da_bieleta_dianteira_direita_2002` (`1.0h` com 1 passo genérico `WEB-EST-01`).
     - `veh_nacional_corsa_2002_2012` (`marca: 'Nacional'`, `modelo: 'corsa'`, `2002-2012`) vinculado a `op_nacional_corsa_farol_2002` (`0.9h`).
   - Como `persistLearnedTemparioCatalog` gravava esses fallbacks com `status_evidencia = 'HISTORICO_OS_REDE'` (em vez de quarentena ou validação real), o coordenador passou a tratá-los como dados canônicos homologados nas consultas seguintes!

2. **Causa Raiz 2 — Sequestro de Operações via Stopword SQL `LIKE '%troca%'` (`tempario_hybrid_coordinator.ts:358-381`):**
   - No Passo 3 do `coordinateQuery` (linhas 358-381), o código quebrava `input.rawQuery` em todas as palavras com `>= 3` letras (incluindo verbos genéricos como `"troca"`, `"motor"`, `"para"`) e executava:
     ```sql
     SELECT operation_id FROM tempario_operations
     WHERE vehicle_id = ? AND (LOWER(titulo) LIKE ? OR LOWER(categoria_servico) LIKE ?)
     ```
     forçando `maxRrfConfidence = Math.max(maxRrfConfidence, 0.88)`.
   - Quando Davi enviou `"EUS5006 \n\ntroca de motor de partida"`:
     - A placa `EUS5006` não existia em `ordens_servico` e a APIBrasil retornou `HTTP 404: {"error":true,"message":"Plano ativo não encontrado."}`.
     - `targetVeiculo` caiu no fallback `'Veículo'`, que deu match em `veh_veculo_veculopasseio_2002_2012` (`Veículo Passeio`).
     - Em seguida, o token `"troca"` (extraído de `"troca de motor de partida"`) deu match no SQL `LOWER(titulo) LIKE '%troca%'` contra a operação `"Substituição da bieleta dianteira direita + Troca da bieleta dianteira"` daquele veículo fantasma, elevando a confiança para `0.88` e retornando **bieleta (2,50h = R$ 675,00)** para uma pergunta de **motor de partida**!

3. **Causa Raiz 3 — Bloqueio de Atualização do Seed Canônico em Produção (`tempario_hybrid_coordinator.ts:212-215`):**
   - O construtor do `TemparioHybridCoordinator` só chamava `seedCanonicalTemparioCatalog(this.db)` se `opCount.c === 0`.
   - Como o banco de produção `hydra_ops.db` já tinha operações antigas, os novos veículos e grafos adicionados na Spec 065 (como `gm_tracker_2020_2025` e os 3 passos reais da bieleta) **nunca foram inseridos no banco da VPS**, fazendo a consulta da Tracker cair no registro poluído `veh_nacional_tracker_2002_2012` (`2002-2012 · Motor Padrão`).

4. **Causa Raiz 4 — Falso "Web Researcher" Baseado em Regex Cego e 6 If/Elses (`tempario_web_researcher.ts:248-363`):**
   - O módulo `tempario_web_researcher.ts` **não utilizava IA/LLM nem MCP**.
   - Ele fazia um `fetch` simples no DuckDuckGo HTML, aplicava uma regex cega `/(\d+)\s*horas/` no primeiro snippet de blog que aparecesse (ex: *"Tabela 2026: 1 hora técnica..."* -> `1.00h`), e caía num `if/else` engessado de apenas 6 serviços (`correia`, `embreagem`, `freio`, `suspensao`, `farol`, `radiador`).
   - Qualquer outro serviço do mundo automotivo (como `motor de partida`, `alternador`, `bomba de combustível`, `caixa de direção`, `junta de cabeçote`, etc.) caía no `else` genérico de `2.50h`, com 1 única etapa `"Execução de [serviço] (Pesquisa Técnica Web)"` e peça `"Kit de reposição para [serviço]"`.

5. **Causa Raiz 5 — Extrator Sintático Engessado e Poluição da String de Serviço com a Placa (`intent_rewriter.ts:1393-1515`):**
   - Em `extractAdaptiveTemparioQuery`, quando o serviço não estava na lista fechada `recognizedComponents` (como `motor de partida`), `componentes` retornava vazio `[]`.
   - Com `componentes` vazio, `extractTemparioEntitiesFromText` (linha 1506) definia `serviceTerms = [rawText.trim()]`, injetando a placa e a quebra de linha dentro do nome do serviço: `["EUS5006 \n\ntroca de motor de partida"]`.
   - Além disso, quando havia placa (`if (!veiculo && !placa)` na linha 1465), o extrator nem sequer separava a placa da descrição do serviço.

6. **Causa Raiz 6 — Falta de Fluxo Conversacional Inteligente para Placa Não Resolvida (`agent_dispatcher.ts:1398-1425`):**
   - Quando uma placa externa (como `EUS5006`) não está no ERP da rede e a API externa falha/não encontra, o sistema jamais pode inventar `veiculoMarcaModelo: 'Veículo'` e fingir que sabe qual é o carro.
   - O sistema deve: (a) tentar resolver a placa via busca web/cache; e (b) se a placa continuar sem identificação de modelo, informar claramente que a placa `EUS5006` não consta no cadastro e perguntar qual é o carro/ano, mantendo o serviço (`troca de motor de partida`) salvo no contexto pendente para responder imediatamente assim que o usuário disser o modelo (e já vinculando essa placa ao modelo no banco para sempre!).

---

## 2. Arquitetura Proposta (Híbrida: Grafo OEM + IA com MCP & Pesquisa Web Real)

Em vez de depender de listas fechadas de regex ou busca semântica cega que alucina quando um modelo de carro (seja ano 2000, 2010 ou 2025) ou serviço novo é perguntado, o pipeline passa a operar em **Arquitetura Híbrida Real em 3 Camadas com IA + MCP**:

### 2.1. Camada 1: Resolução Inteligente de Identidade do Veículo (Placa / Modelo / Contexto)
1. **Extração Limpa de Placa vs. Serviço Livre:**
   - Qualquer placa (`ABC1234` ou `ABC1D23`) é extraída e **removida** do texto do serviço, preservando a descrição natural do serviço solicitado pelo operador (ex: `"troca de motor de partida"`, `"troca da bieleta dianteira direita"`, `"reparo na caixa de direção"`), sem depender de lista fechada de palavras!
2. **Lookup Multi-Fonte de Placa:**
   - **Fonte A:** Cache permanente `veiculos_placas_cache` (SQLite) + histórico de `ordens_servico` do ERP das 10 lojas.
   - **Fonte B:** APIBrasil (quando ativa) + **Pesquisa Web de Placa** (busca em indexadores públicos de placas via web search para extrair Marca/Modelo/Ano/Motor).
   - **Fonte C (Guarda Anti-Alucinação + Vínculo Conversacional):** Se nenhuma fonte identificar o carro da placa (ex: `EUS5006`), o bot **NÃO inventa `"Veículo Passeio"`**. Ele:
     - Salva no contexto da conversa: `pendingPlateResolution = { placa: 'EUS5006', servicos: ['troca de motor de partida'] }`.
     - Responde de forma curta e direta: informa que a placa `EUS5006` não está cadastrada no sistema e pergunta qual é o veículo/ano (ou já entrega a estimativa técnica base do serviço perguntando o veículo para cravar o tempo exato e salvar a placa no banco).
     - Quando o usuário responde o carro no turno seguinte (ex: `"Palio 1.0 2012"` ou `"Corsa"`), o bot grava `EUS5006 -> Fiat Palio 1.0 2012` em `veiculos_placas_cache` e já entrega o tempário completo do serviço que estava pendente!

### 2.2. Camada 2: Catálogo OEM Homologado (Sem Poluição e Sempre Sincronizado)
1. **Expurgo Total de Registros Fantasmas no SQLite:**
   - Remoção imediata de `veh_veculo_veculopasseio_2002_2012`, `veh_nacional_veculo_2002_2012`, `veh_nacional_tracker_2002_2012`, `veh_nacional_corsa_2002_2012` e todas as suas operações/sub-operações espúrias no `hydra_ops.db` da VPS e local.
2. **Idempotência de Seed por Versão de Catálogo (`CATALOG_SEED_VERSION`):**
   - Remover a trava falha `if (opCount.c === 0)` no `TemparioHybridCoordinator` e usar controle de versão em memória por processo (`let isCatalogSeededInProcess = false`), garantindo que `seedCanonicalTemparioCatalog(db)` execute seus `ON CONFLICT DO UPDATE` na inicialização do processo e mantenha `gm_tracker_2020_2025` e demais veículos canônicos sempre presentes na VPS.
3. **Matching Estrito de Operação (Fim do Sequestro por Stopword `LIKE '%troca%'`):**
   - Proibir que verbos genéricos (`troca`, `trocar`, `substituicao`, `substituir`, `reparo`, `servico`, `motor`) façam match em `tempario_operations`. O match local no catálogo só ocorre se o **componente nuclear** solicitado pelo usuário (ex: `motor de partida`, `bieleta`, `farol`, `correia`) estiver comprovadamente presente no título ou sinônimos da operação do veículo!

### 2.3. Camada 3: Agente de IA com MCP & Pesquisa Técnica Web Real (`tempario_ai_web_researcher`)
Quando o veículo (ex: `Corsa 2010`, `Palio 2008`, `BYD Dolphin`, `Haval H6`, `Golf 1.4 TSI`) ou o serviço (ex: `troca de motor de partida`, `troca da bomba d'água`, `troca do atuador`) **não** estiver no grafo OEM estático:
1. **Coleta de Evidências Reais (Web + MCP Interno):**
   - Executa busca ativa na web por manuais técnicos, tempos de reparo, etapas de desmontagem/montagem, ferramentas e torques específicos para `{veiculo} {ano} {motor} {servico}`.
   - Consulta em paralelo via repositório/MCP o histórico real de OSs das 10 lojas (`ordens_servico`) para verificar se esse serviço já foi executado na rede.
2. **Síntese Técnica Estruturada via IA (LLM Gemini via `hydraDualRouter` / CLI com Fallback Determinístico Rico):**
   - Os snippets da pesquisa web e os dados do veículo são processados pela IA (com prompt técnico automotivo estrito e schema JSON determinístico) para gerar:
     - **Identificação correta do veículo:** Marca, Modelo, Geração/Ano real (nunca `"Nacional"` ou `"2002-2012"` inventado) e Motorização real.
     - **Tempo técnico líquido em horas** condizente com a engenharia do veículo (ex: se precisa desmontar coletor/protetor de cárter para acessar o motor de partida, a IA considera o acesso compartilhado).
     - **Sequência Técnica Real de Montagem (3 a 6 etapas reais):** dividida em `DESMONTAGEM`, `ACESSO`, `EXECUCAO` e `FINALIZACAO`, com tempos individuais que somam exatamente o tempo líquido total, ferramentas reais (chaves em mm, Torx, Allen, multímetro, etc.) e torques em Nm — eliminando para sempre o passo genérico `"1. Execução de ... (Pesquisa Técnica Web)"`!
     - **Lista de Peças Necessárias (`pecasNecessarias`):** peças reais da operação (ex: Motor de partida / automático / escovas, porcas, juntas, fluidos quando aplicável).
     - **Cálculo Financeiro Determinístico em TypeScript:** O valor de mão de obra é sempre calculado no código por `tempoLiquidoTotalHoras * 270.00` (**R$ 270,00/h** fixo da rede).
3. **Auto-Aprendizado Seguro no Banco (Cache Persistente de IA Validada):**
   - Somente quando o veículo é um modelo automotivo real validado (`isValidAutomotiveModel`) e a síntese possui etapas completas (`steps.length >= 2`), o pacote aprendido é salvo no SQLite com as sub-operações completas. Na próxima consulta para o mesmo carro e serviço, a resposta sai em `< 15ms` com todas as etapas, peças e ferramentas reais!

---

## 3. Contratos de Dados & Regras Inegociáveis

- **Taxa Horária da Rede:** Estritamente **R$ 270,00/h** (`DEFAULT_HOURLY_RATE = 270.00`).
- **Progressive Disclosure UX (Spec 063):**
  - Balão 1 (Executivo): Veículo real, serviços solicitados, tempo líquido cobrado, valor de mão de obra a R$ 270,00/h, complexidade e menu interativo (`1️⃣ Peças`, `2️⃣ Ferramentas e torques`, `3️⃣ Passo a passo da montagem`, `4️⃣ Tudo completo`).
  - Quando o operador digita `1`, `2`, `3` ou `4` (ou pede "com peças", "passo a passo"), os itens exibidos são 100% técnicos, detalhados e específicos daquele veículo e serviço.
- **Isolamento Absoluto de Turno:**
  - Uma nova consulta de tempário (nova placa, novo veículo ou novo serviço) limpa imediatamente qualquer `tempario_pending_context` anterior de outro serviço e nunca mescla `servicos` do `previousState` se a mensagem atual já contém uma ação/serviço novo.
- **Segurança de WhatsApp:**
  - Proibição absoluta de envio por instâncias de gerentes de loja (`Maua`, `Kennedy`, `Dom Pedro`, `Rudge`, `Jabaquara`, `Piraporinha`, `Planalto`, `Jorge Beretta`, etc.). Apenas `hydra` e `atendimento`.

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| Timeout ou oscilação da chamada LLM na pesquisa web | Atraso na resposta do WhatsApp | Timeout controlado de 15s na síntese IA + decomposição multi-etapa estruturada por subsistema mecânico (Elétrica/Partida, Suspensão, Freios, Motor/Distribuição, Arrefecimento, Transmissão, Carroceria) garantindo sempre 3 a 5 passos reais de oficina mesmo se a API oscilar. |
| Placa não encontrada na APIBrasil (HTTP 404) | Antes gerava "Veículo Passeio" e pegava serviço errado | Busca em `ordens_servico` + `veiculos_placas_cache` + busca web da placa. Se não achar, pede o modelo do carro em 1 linha e salva o contexto pendente da placa para completar no próximo turno. |
| Poluição futura do SQLite com termos genéricos | Retorno de dados errados em próximas buscas | Validador `isValidVehicleForPersistence(marca, modelo)` que bloqueia qualquer gravação contendo `veículo`, `passeio`, `nacional`, `multimarcas`, `desconhecido` ou strings com placa embutida. |

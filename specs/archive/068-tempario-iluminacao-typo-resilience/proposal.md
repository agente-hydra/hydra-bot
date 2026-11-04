# Proposta Técnica — Spec 068: Tempário Técnico de Iluminação, Resiliência a Typos e Neutralização de Alucinação LLM

## 1. Problema Factual e Diagnóstico
Em consulta real no WhatsApp (`[13:42, 04/11/2026] Davi: troca de laampadas traseiras tracker 2023`), o Hydra Bot gerou uma resposta fragmentada em dois balões contendo alucinações críticas:
```
[13:43, 04/11/2026] Hydra Agent: HYDRA | Tempário Técnico e Estimativa Operacional | Rede Mecânica Popular
[04/11/2026] · [13:42]
> Visão geral ...
- Tempo padrão sugerido: 0,4 h a 0,6 h (25 a 35 minutos para par ou unidade)
- Tempo referencial de tabela técnica cheia: Até 1,5 h
- Valor de mão de obra sugerido: R$ 108,00 a R$ 162,00 ... a R$ 405,00
[13:43, 04/11/2026] Hydra Agent: > Procedimento e Etapas de Execução
- Etapas necessárias: Não informado / Pendente
```
O usuário Davi sinalizou imediatamente: *"a ia errou a"*.

### Causa Raiz Auditada no Código
1. **Falha de Detecção Sintática (`isTemparioTechnicalQuery: false`):**
   - A query continha um typo frequente de digitação rápida móvel: `laampadas` (vogal duplicada `aa`).
   - O léxico mecânico de `mechanicalComponentPattern` em `src/hydra-sync/intent_rewriter.ts` não contemplava termos de sinalização e iluminação rápida (`lampada`, `lampadas`, `lanterna`, `lanternas`, `luz`, `luzes`, `iluminacao`, `pisca`, `seta`, `soquete`, `luz de freio`, `luz de re`, `luz de placa`, `drl`).
   - Sem casar `isTemparioTechnicalQuery`, a mensagem foi tratada como texto conversacional genérico e despachada ao LLM (`hydraDualRouter` / Gemini).

2. **Alucinação do Modelo Livre no Prompt Geral:**
   - O LLM no prompt geral tentou simular um relatório de tempário inventando o cabeçalho proibido `HYDRA | Tempário Técnico e Estimativa Operacional | Rede Mecânica Popular`.
   - O LLM gerou intervalos e faixas de preços (`R$ 108,00 a R$ 162,00 a R$ 405,00`), violando a regra de negócio da rede que exige valor líquido determinístico à taxa oficial de R$ 270,00/h.
   - O LLM emitiu a anomalia visual `- Etapas necessárias: Não informado / Pendente` no segundo balão.
   - O Progressive Disclosure (opções 1️⃣ a 4️⃣) não foi oferecido.

3. **Lacuna no Módulo de Subsistemas (`tempario_web_researcher.ts`):**
   - Caso a consulta tivesse entrado no coordenador de tempário, não havia subsistema dedicado a lâmpadas e sinalização rápida. O termo caía no fallback genérico de 1,50h (R$ 405,00) com desmontagem de elevador, quando a troca de lâmpada de lanterna traseira de um SUV urbano como o Tracker é um serviço rápido de bancada/box elétrico de **0,40h (24 min = R$ 108,00)**.

---

## 2. Solução Proposta

### 2.1 Normalização Resiliente de Typos e Expansão do Léxico de Sinalização
- Implementar normalização de repetição de caracteres no pré-processamento de intenções de tempário (ex: `laampadas` -> `lampadas`, `ree` -> `re`, `pneuus` -> `pneus`).
- Adicionar componentes de iluminação e sinalização a `mechanicalComponentPattern` e `recognizedComponents` em `intent_rewriter.ts`:
  `lampada`, `lampadas`, `lanterna`, `lanternas`, `luz de freio`, `luz de re`, `luz de placa`, `pisca`, `seta`, `soquete`, `drl`, `bloco optico`, `farolete`.
- No parser adaptativo de entidades (`extractTemparioEntitiesFromText`), expurgar modelo e ano da string residual do serviço para evitar termos poluídos como `"troca de laampadas traseiras tracker 2023"`.

### 2.2 Subsistema Especializado de Iluminação e Sinalização Rápida
- Em `src/hydra-sync/tempario_web_researcher.ts`, criar subsistema dedicado para lâmpadas e sinalização:
  - **Título:** `Substituição de Lâmpadas das Lanternas Traseiras (Sinalização)` ou `Substituição de Lâmpadas de Iluminação Externa`.
  - **Tempo Técnico Tabelado:** **0,40h (24 minutos)** (R$ 108,00 a R$ 270,00/h).
  - **Grafo de Acesso Otimizado (4 Etapas):**
    1. Desmontagem da forração/batente do porta-malas e soltura dos fixadores Torx/10mm da lanterna (0,10h / 6 min, Chave Torx T20 / 10mm, Torque: 3 Nm).
    2. Desencaixe nos pinos-guia de pressão e desacoplamento do chicote elétrico (0,10h / 6 min, Espátula de nylon).
    3. Substituição das lâmpadas avariadas nos soquetes tipo baioneta/trava (0,12h / 7 min, Luvas limpas para bulbo de vidro).
    4. Reinstalação da carcaça, aperto controlado e teste funcional de lanterna, freio, pisca e ré (0,08h / 5 min, Multímetro/Ponta de prova 12V, Torque: 3 Nm).
  - **Ferramentas:** Chaves Torx T20/T25, chave canhão 10mm, espátulas de nylon, multímetro digital, luvas para bulbo.
  - **Peças:** Lâmpadas automotivas 12V (P21W / W21W / W5W conforme aplicação).
  - **Torques:** 2,5 a 3,5 Nm nos parafusos de fixação à carroceria.

### 2.3 Trava Anti-Alucinação no Prompt Geral do LLM
- Em `agent_dispatcher.ts` (Hermes Directives), incluir proibição absoluta para impedir que o LLM simule balões de tempário ou emita cabeçalhos como `Tempário Técnico e Estimativa Operacional` com faixas de valores ou campos não informados.

### 2.4 Resiliência de Contrato em `TemparioHybridCoordinator`
- Proteger `buildCacheKey` contra `securityContext` indefinido (`input.securityContext?.persona || 'socio'`).

---

## 3. Contratos de Dados Afetados
- `AdaptiveTemparioExtraction`: `componentes` passa a conter tokens de lâmpada e iluminação.
- `WebResearchResult`: Subsistema retorna dados enriquecidos para iluminação rápida com tempo de 0,40h.
- Balão executivo: Formato nativo Hermes V2 com opções 1️⃣ a 4️⃣ e taxa oficial de R$ 270,00/h.

---

## 4. Riscos e Mitigações
- **Risco:** Reduzir caracteres duplicados legítimos (ex: `cooper`, `passat`, `nissan`).
  - *Mitigação:* A redução aplica-se apenas a vogais triplas ou sequências de vogais com padrão de erro ortográfico em termos de serviço mecânico (`laampadas` -> `lampadas`), sem afetar nomes próprios de veículos.
- **Risco:** Confundir troca de lâmpada com troca do conjunto óptico completo do farol dianteiro (que exige desmontagem de para-choque a 1,0h).
  - *Mitigação:* Se o termo contiver `lampada` ou `lanterna traseira`, direciona ao subsistema rápido (0,40h). Se for `farol completo` ou `bloco optico dianteiro`, direciona à troca do conjunto óptico (1,00h).

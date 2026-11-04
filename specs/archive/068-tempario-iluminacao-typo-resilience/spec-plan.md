# Plano de Execução — Spec 068: Tempário Técnico de Iluminação, Resiliência a Typos e Neutralização de Alucinação LLM

## Estratégia de Execução
Implementação focada em resiliência de parsing, acurácia técnica no subsistema de lâmpadas e trava anti-alucinação no prompt geral.

---

## Tasks

- [x] [LEAD] Task 1: Normalização de Typos e Expansão do Léxico de Iluminação em `src/hydra-sync/intent_rewriter.ts`
  - Criar `normalizeMechanicalQueryText` para tratar duplicidades como `laampadas` -> `lampadas`.
  - Integrar normalização ao início de `isTemparioTechnicalQuery` e `extractAdaptiveTemparioQuery`.
  - Adicionar termos de iluminação (`lampada`, `lanterna`, `luz de freio`, `luz de re`, `pisca`, `seta`, `soquete`, `drl`) em `mechanicalComponentPattern` e `recognizedComponents`.
  - No parser adaptativo, sanitizar `serviceTerms` removendo veículo e ano da string residual.

- [x] [LEAD] Task 2: Implementação do Subsistema Especializado de Iluminação e Lâmpadas em `src/hydra-sync/tempario_web_researcher.ts`
  - Adicionar ramo especializado para lâmpadas e sinalização rápida antes do bloco de farol completo.
  - Fixar tempo técnico de 0,40h (24 min) à taxa oficial da rede (R$ 270,00/h -> R$ 108,00).
  - Decompor em 4 etapas detalhadas de acesso e bancada com torques de fixação (2,5 a 3,5 Nm), ferramentas específicas (Torx T20, canhão 10mm, espátulas de nylon, luvas para bulbo) e peças obrigatórias.

- [x] [LEAD] Task 3: Guarda Defensiva em `src/hydra-sync/tempario_hybrid_coordinator.ts`
  - Adicionar fallback com encadeamento opcional `input.securityContext?.persona || 'socio'` em `buildCacheKey` prevenindo `TypeError` em chamadas diretas.

- [x] [LEAD] Task 4: Trava Anti-Alucinação de Tempário no Prompt Geral em `src/hydra-sync/agent_dispatcher.ts`
  - Incluir diretiva formal proibindo o LLM de gerar pseudo-relatórios de tempário com títulos inventados, intervalos de valores ou campos incompletos ("Não informado / Pendente").

- [x] [LEAD] Task 5: Suite de Testes Automatizada em `src/hydra-sync/tests/test_harness_spec068_lighting_and_typo.ts`
  - Testar cenário real `"troca de laampadas traseiras tracker 2023"` verificando:
    1. `isTemparioTechnicalQuery` retorna `true`.
    2. Coordenador retorna `0,40h` e `R$ 108,00`.
    3. Balão executivo oficial com opções 1️⃣ a 4️⃣.
    4. Resposta à opção `3` (Passo a passo com 4 etapas e torques).
  - Testar variantes de farol/lanterna (farol completo 1,00h vs lâmpada 0,40h).
  - Incluir arquivo em `tsconfig.tempario.json`.

- [x] [LEAD] Task 6: Build Gate, Validação E2E Local e Deploy na VPS
  - Rodar `cmd.exe /c "npx tsc -p tsconfig.tempario.json --noEmit"`.
  - Executar suite localmente com sucesso absoluto.
  - Transferir arquivos alterados via SCP para a VPS (`operacional@100.126.50.101`).
  - Recompilar e rodar suite na VPS.
  - Reiniciar PM2 `hydra-bot` na VPS e validar online.

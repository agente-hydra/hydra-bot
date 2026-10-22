# Plano de Implementação — Calendário de Feriados e Janela Acumulada Dinâmica (hydra-feriados-acumulado-pos-feriado)

**Spec ID:** `hydra-feriados-acumulado-pos-feriado`  
**Data:** 09/10/2026  
**Status:** Implementado & Homologado na VPS  
**Ambiente:** VPS Linux (`operacional@100.126.50.101`) + Local Windows  

---

## Critérios Obrigatórios de Aceite

- [x] **[HOLIDAY_DETECTION]** O sistema detecta com precisão os feriados nacionais fixos (incluindo 12/10 - N. Sra. Aparecida) e móveis do Brasil.
- [x] **[HOLIDAY_DISPATCH_SUPPRESSION]** Em dias de feriado (como 12/10/2026), o orquestrador matinal (`run_unified_morning_dispatch.js`) cancela o disparo automaticamente, registrando log claro e gerando ZERO mensagens no WhatsApp.
- [x] **[ACCUMULATED_POST_HOLIDAY_WINDOW]** Na terça-feira seguinte (13/10/2026), o sistema calcula a janela estendida automaticamente:
  - Data inicial: `09/10/2026` (sexta-feira pré-feriado).
  - Data final: `12/10/2026` (segunda-feira feriado).
  - Cobre Sexta, Sábado, Domingo e Segunda sem perder nenhum lançamento.
- [x] **[CONTAS_PAGAR_EXTENDED_CRAWL]** O crawler e exportador de Contas a Pagar utiliza a janela estendida pós-feriado de `09/10/2026` a `12/10/2026`.
- [x] **[JUROS_REDE_EXTENDED_RANGE]** O motor `date_resolver.js` inclui todas as datas da janela acumulada no array `targetDatesBR` e `targetDatesISO`.
- [x] **[AUTOMATED_TESTS_100_PASS]** Suíte de testes automatizados cobrindo os 4 cenários (segunda feriado, terça pós-feriado, dia comum e segunda normal).

---

## Fase 1: Módulo Central de Calendário de Feriados
- [x] **[TASK_HOLIDAY_CALENDAR_MODULE]** Criar `projects/hydra-rede/src/feriados_calendario.js` e `src/hydra-sync/feriados_calendario.ts`:
  - Algoritmo de Páscoa e cálculo de feriados móveis (Carnaval, Sexta Santa, Corpus Christi).
  - Tabela de feriados fixos nacionais (incluindo 12/10, 02/11, 15/11, 20/11, 25/12).
  - Função `verificarFeriado(data)`.
  - Função `calcularJanelaAcumulada(dataRef)`. [CONCLUÍDO]

---

## Fase 2: Trava de Supressão no Orquestrador Matinal
- [x] **[TASK_DISPATCH_HOLIDAY_GUARD]** Atualizar `projects/hydra-rede/src/run_unified_morning_dispatch.js`:
  - Verificar se `targetDate` é feriado nacional.
  - Se for feriado (e sem `--force`), registrar no log e abortar antes de qualquer geração ou envio.
  - Preservar opção `--force` para simulações técnicas. [CONCLUÍDO]

---

## Fase 3: Janela Acumulada em Juros Rede
- [x] **[TASK_JUROS_REDE_HOLIDAY_WINDOW]** Atualizar `projects/hydra-rede/src/date_resolver.js`:
  - Integrar `calcularJanelaAcumulada(baseDate)`.
  - Suportar períodos com mais de 3 dias acumulados quando houver feriado contíguo ao fim de semana. [CONCLUÍDO]

---

## Fase 4: Janela Acumulada no Contas a Pagar
- [x] **[TASK_CONTAS_PAGAR_HOLIDAY_WINDOW]** Atualizar `projects/hydra-rede/src/exportar_contas_pagar_cli.js` e `src/hydra-sync/contas_pagar_crawler.ts`:
  - Atualizar `calcularPeriodoContasPagar(dataRef)` para utilizar `calcularJanelaAcumulada`.
  - Garantir que na terça (13/10) a tela do ERP busque de `09/10/2026` até `12/10/2026`. [CONCLUÍDO]

---

## Fase 5: Suíte de Testes Automatizados
- [x] **[TASK_HOLIDAY_UNIT_TESTS]** Criar `projects/hydra-rede/src/test_feriados_calendario.js` e `src/hydra-sync/tests/test_feriados_calendario.ts`:
  - Validar feriado de 12/10/2026 (N. Sra. Aparecida).
  - Validar cálculo da terça-feira 13/10/2026: início em 09/10 e fim em 12/10.
  - Validar segunda-feira comum (início D-3 e fim D-1).
  - Validar dia comum de semana (ontem D-1).
  - Garantir 100% PASS. [CONCLUÍDO]

---

## Fase 6: Homologação e Deploy na VPS
- [x] **[TASK_DEPLOY_VPS_HOLIDAY]** Sincronizar arquivos na VPS (`operacional@100.126.50.101`):
  - Copiar arquivos atualizados para `/home/operacional/hydra-rede/src/` e `/home/operacional/hydra-deploy/current/src/hydra-sync/`.
  - Executar teste de simulação com `--date=2026-10-12` comprovando a supressão do envio (100% SUCESSO).
  - Executar teste de simulação com `--date=2026-10-13` comprovando a janela acumulada de 09/10 a 12/10 (100% SUCESSO). [CONCLUÍDO]

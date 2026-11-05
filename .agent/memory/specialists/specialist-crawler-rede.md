# Memória do Especialista — Especialista em Crawler & Rede (specialist-crawler-rede)

> Este arquivo registra aprendizados técnicos específicos e duradouros deste especialista.

<!-- sdd:managed:begin id="lessons" -->
<!-- /sdd:managed:end id="lessons" -->

## [2026-11-05] — [Feature: 071-rede-migracao-invisible-playwright]
- **Contexto:** Migração integral da automação da Rede para Invisible Playwright 0.45.0 com daemon TCP único (127.0.0.1:49222) e BatchAuditGuard hardened.
- **Regra aprendida:** Sempre utilizar arquitetura de processo único (daemon TCP) para navegação persistente e validar integridade binária OpenXML PK\x03\x04 com unicidade estrita dos 10 ECs oficiais.
- **Risco identificado:** Concorrência entre processos abrindo o mesmo perfil Firefox persistente se a trava de PID falhar.
- **Não fazer:** Nunca responder authenticated: true sem checagem de elementos reais do DOM e nunca gerar strings de texto com extensão .xlsx.
- **Âncora:** `projects/hydra-rede/src/invisible/rede_invisible_worker.py:210`

## [2026-11-05] — [Feature: 072-conciliacao-patio-rede-discrepancias]
- **Contexto:** Resolução de 6 discrepâncias contábeis entre os relatórios automatizados de pátio/Rede e a conciliação manual do financeiro.
- **Regra aprendida:** O multiconjunto de pagamentos (`extractPaymentsForReferenceDay`) deve rastrear ocorrências por assinatura e bloquear incondicionalmente repetições de transações já vistas em dias anteriores (`seenCount >= occurrenceCount`). O estimador `estimateTransactionDateBR` deve ancorar OSs antigas em suas datas reais de abertura e nunca permitir que a tolerância de 28-34 dias force transações passadas para D-1.
- **Risco identificado:** Trava permissiva de `isOsAberta` injetando pagamentos de meses atrás como candidatos em conciliações diárias da adquirente.
- **Não fazer:** Nunca atribuir `ehCandidatoAberto = true` cegamente para toda e qualquer transação de OS aberta sem conferir vencimento ou data estimada compatível com a janela auditada.
- **Âncora:** `projects/hydra-rede/src/patio_ledger_engine.js:236`

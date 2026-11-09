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

## [2026-11-09] — [Feature: 078-rede-matinal-cron-restoration-patio-sheets]
- **Contexto:** Restauração do motor Invisible Playwright 0.45.0 na VPS, eliminação de extrações noturnas no crontab, recálculo diurno fresco do Pátio e tolerância a erros HTML do Google Sheets.
- **Regra aprendida:** A automação da Rede não deve rodar na madrugada (zero execuções entre 23h e 04h59); apenas uma extração pós-compensação às 05:00 AM é necessária. `InvisiblePlaywright` deve ser inicializado como gerenciador assíncrono (`await self.invisible_mgr.__aenter__()`), e chamadas RPC de transição para modo assistido não podem bloquear a resposta síncrona com navegações de 30s. O recálculo de snapshot diurno do Pátio deve consumir `os_store_${slug}.json` mais recentes preservando `oldestSourceCapturedAt` inferior a 30 minutos.
- **Risco identificado:** Execuções noturnas redundantes consumindo recursos e provocando desafios Cloudflare/CAPTCHA fora da janela de compensação da adquirente.
- **Não fazer:** Nunca agendar coletas de vendas da Rede em horários noturnos múltiplos e nunca deixar endpoints do Google Apps Script silenciarem erros HTML retornando exit code 0 como se fossem sucesso.
- **Âncora:** `projects/hydra-rede/scripts/run-nightly-prep.sh:1`

## [2026-11-09] — [Feature: 079-rede-reparo-rapido-watchdog-invisible]
- **Contexto:** Implantação do motor de Reparo Rápido da Rede dentro do Watchdog com catálogo fechado estrito de 6 ações (`ALLOWED_REPAIR_ACTIONS`), executor na mesma sessão do Invisible Playwright sem reinício desnecessário de navegador, dedup por `${fluxo}:${periodo}:${ec}:${etapa}`, trava de no máximo 2 ações por incidente e promotor de contingência homologada staging->produção com selagem criptográfica `BatchAuditGuard`.
- **Regra aprendida:** O AGY atua exclusivamente como avaliador de log sanitizado e seletor de ação de catálogo fechado, sem permissão de execução de shell, escrita de código, alteração de crontab ou envio de WhatsApp. A validação de prova física (`verifyPhysicalProof`) deve exigir cabeçalho ZIP (`PK\x03\x04`), tamanho mínimo de 1.000 bytes e data de modificação recente na mesma janela horária. O promotor de contingência homologada deve auditar 10/10 ECs oficiais antes de emitir o recibo de auditoria `batch_audit_receipt.json`.
- **Risco identificado:** Ações de reparo concorrentes competindo pela mesma sessão Firefox do Invisible se o single-flight lock falhar.
- **Não fazer:** Nunca permitir execução de código JavaScript arbitrário ou comandos bash pelo AGY durante auto-reparo e nunca aceitar arquivos HTML/texto com extensão `.xlsx` para marcação de sucesso.
- **Âncora:** `projects/hydra-rede/src/rede_fast_repair_catalog.js:1`



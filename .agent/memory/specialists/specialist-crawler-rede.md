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

## [2026-11-09] — [Feature: 080-rede-tabela-repasse-10x-sem-juros]
- **Contexto:** Atualização da matriz de repasse de juros da Rede no gerador de Excel (`excel_processor.js`), demonstradores e motor de conciliação Pátio x Rede (`reconciliation_patio_rede_engine.js`), estabelecendo isenção comercial de juros de 1x até 10x (`taxa: 0.000, divisor: 1.000, label: '0,0%'`), com repasse de juros aplicado estritamente a partir de 11x (11x = 13,5% até 18x = 18,0%).
- **Regra aprendida:** Transações parceladas em até 10x agora possuem `vendaJuros = 0.00` e `valorOriginal = valorBruto`. No motor de conciliação, transações de 1x a 10x realizam match direto no valor bruto integral (Nível 1) sem dedução indevida de juros repassados. Apenas transações >= 11x ativam a dedução reversa e split Nível 6.
- **Risco identificado:** Conciliações antigas ou relatórios legados que deduziam juros em vendas de 2x a 10x gerando divergências com o valor cobrado na OS do Pátio.
- **Não fazer:** Nunca aplicar taxa de juros repassada maior que 0% para parcelamentos de 1 a 10 vezes.
- **Âncora:** `projects/hydra-rede/src/excel_processor.js:45`

## [2026-11-09] — [Feature: 081-patio-horario-pagamentos-live-probe-fix]
- **Contexto:** Correção de fuso UTC no SQLite, captura na aba tapPagamento e active recovery de troca de empresa no Oficina Inteligente.
- **Regra aprendida:** Timestamps SQLite YYYY-MM-DD HH:MM:SS devem receber sufixo Z para evitar avanço espúrio de fuso em SP. Extração de pagamentos exige clique em tapPagamento e soma de ucOrdemDeServicoPagamento_grd. Troca de empresa no ERP exige timeout delimitado e reload em caso de ViewState dirty.
- **Risco identificado:** Instâncias concorrentes de Playwright sob o mesmo usuário do ERP provocam desaceleração ou colisões de sessão.
- **Não fazer:** Nunca inferir que OS está sem pagamento olhando apenas a tela de busca da grade sem abrir a aba financeira.
- **Âncora:** `projects/hydra-rede/src/os_live_probe.js`

## [2026-11-10] — [Feature: 082-rede-single-collector-v045-consolidation-docs]
- **Contexto:** Unificação do coletor da Rede no ambiente isolado Invisible Playwright 0.45.0 (`/home/operacional/.venv-invisible/bin/python`), remoção de concorrências no PM2 (`rede-session-keeper`) e elaboração da documentação arquitetural e operacional completa.
- **Regra aprendida:** O `InvisiblePlaywright` é síncrono e deve ser instanciado via context manager ou `asyncio.to_thread` no venv isolado, garantindo propriedade única do perfil persistente sem bloqueio de porta 49222.
- **Risco identificado:** A coexistência de versões 0.43 e 0.45 travava o perfil `.rede_firefox_profile/firefox_data` por 180s. A remoção de `invisible_playwright` do Python do sistema e resolução prioritária do venv impedem esse conflito.
- **Não fazer:** Nunca chamar `el.is_visible()` em `ElementHandle` (usar `bounding_box()` ou locators nativos) e nunca usar gerador sintético de relatórios em ambiente de produção.
- **Âncora:** `projects/hydra-rede/src/invisible_bridge_client.js` e `projects/hydra-rede/src/invisible/rede_invisible_worker.py`

## [2026-11-10] — [Feature: 083-skills-playbooks-autohealing-agy-cli]
- **Contexto:** Criação e implantação das 5 skills auto-healing para AGY CLI na VPS (Rede 05h-08h, Pátio ERP & Balões WhatsApp, Margem CMV & Mão de Obra, Marketing & ROI, e CRM de Reativação), com testes reais via agy -p comprovando auto-healing, verificação de locks e blindagem de mensageria.
- **Regra aprendida:** O AGY CLI atua como orquestrador resiliente acionado deterministicamente pelo cron, capaz de auto-corrigir discrepâncias de caminho (como symlinks de downloads/output), validar frescor de dados de ERP (< 60 min), auditar limites de envio no WhatsApp e aplicar travas de segurança sem disparar mensagens acidentais.
- **Risco identificado:** Execução de agy -p em cron de alta frequência (a cada minuto) pode gerar latência e consumo de tokens; o cron deve acionar scripts com gates determinísticos ultra-rápidos e acionar o AGY nas janelas principais ou como watchdog de contingência.
- **Não fazer:** Nunca permitir que o cron rode comandos cegos sem pré-auditoria de locks ou instâncias da Evolution API, e nunca usar números/instâncias de gerentes como remetentes de mensageria.
- **Âncora:** `projects/hydra-rede/skills/ e .agents/skills/hydra-frentes-autohealing/`
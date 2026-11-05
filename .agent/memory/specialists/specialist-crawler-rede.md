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
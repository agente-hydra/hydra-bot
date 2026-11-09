# Memória do Especialista — Especialista em Mensageria WhatsApp & Ingress (specialist-messaging-whatsapp)

> Este arquivo registra aprendizados técnicos específicos e duradouros deste especialista.

<!-- sdd:managed:begin id="lessons" -->
<!-- /sdd:managed:end id="lessons" -->

## [2026-11-05] — [Feature: 073-squad-redirect-leads-webhook-hub]
- **Contexto:** Implementacao do Webhook Listener sab.analytics / JSON em /leads/api/webhook e Hub /leads com batimento automatico das conversas reais de entrada do WhatsApp IA (5511996274141).
- **Regra aprendida:** Batimento de conversao da pagina de redirect (Squad) com WhatsApp deve operar em 3 camadas determinísticas em ordem de precisao: (1) MATCH_CODE extraido do texto (Codigo: XXXXXX), (2) PHONE_E164 normalizado, e (3) TIME_CORRELATION estrita dentro da janela pós-redirect; o hook no watchdog/gateway.js deve ser fire-and-forget com timeout curto (1.5s) para nunca atrasar a fila de atendimento.
- **Risco identificado:** Queda temporaria do processo hydra-leads-hub perder eventos em tempo real se nao houver reconciliador retroativo em getDashboardData.
- **Não fazer:** Nunca acoplar gravacao de analytics de leads de forma sincrona bloqueante no pipeline de resposta do WhatsApp nem expor /leads sem cookie assinado hydra_session compativel com /live.

## [2026-11-09] — [Feature: 081-patio-horario-pagamentos-live-probe-fix]
- **Contexto:** Circuit Breaker de fuso UTC e injeção de snapshot diurno nos totais do Balão 1.
- **Regra aprendida:** O Balão 1 deve sobrepor os totais matinais com recalcularSnapshotDiurno() após a sonda pré-despacho, refletindo baixas de pagamentos parciais/totais ocorridas durante o expediente.
- **Risco identificado:** Despacho com dados antigos sem sonda ao vivo pode gerar falsos positivos de clientes inadimplentes para a diretoria.
- **Não fazer:** Nunca emitir alerta de veículo sem sinal usando dados com mais de 5 min sem verificação viva ou com Circuit Breaker desativado.
- **Âncora:** `projects/hydra-rede/src/run_group_balloon_dispatch.js`
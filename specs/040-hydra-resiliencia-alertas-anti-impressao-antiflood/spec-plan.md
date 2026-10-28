# Plano de Implementação — Spec 040: Resiliência Hydra, Hardware Guard & Alertas Hermes 2.0

## Fases de Execução

- [x] **Fase 1: Trava Absoluta de Impressão Física (Hardware Guard)**
  - [x] 1.1 Inspecionar e refatorar `checarStatusMatinal08h` em `projects/hydra-rede/src/hydra_printer_alert.js`. Adicionar trava estrita: se `wanProbe.isOnline === true`, abortar imediatamente com status `INTERNET_ONLINE_IMPRESSAO_SUPRIMIDA` e ZERO despacho de impressão.
  - [x] 1.2 Refatorar `emitirAlertaImpresso` para exigir `testHardware: true` caso chamada com WAN online, prevenindo disparos acidentais por código legado.
  - [x] 1.3 Dinamizar `gerarTextoBoletim` para que, na eventualidade de uma queda física real de WAN, o texto reflita dados aferidos pelo watchdog sem templates estáticos fictícios.

- [x] **Fase 2: Motor Anti-Flood & Deduplicação de Alertas WhatsApp**
  - [x] 2.1 Criar funções `carregarCooldownDev`, `avaliarCooldownAlertaDev`, `atualizarCooldownDev` e `registrarSucessoDev` em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`.
  - [x] 2.2 Configurar persistência em `dev_alert_cooldown.json` com detecção automática do diretório base (`/home/operacional/hydra-data/locks/` ou `%USERPROFILE%/.hydra/`).
  - [x] 2.3 Estabelecer TTL padrão de 180 minutos (3 horas) por hash SHA-256 (`subsistema + causaRaiz`), permitindo override via `{ force: true }`.

- [x] **Fase 3: Motor Hermes 2.0 & Normalizador Dinâmico de Alertas**
  - [x] 3.1 Implementar `formatarMensagemHermes2(payload)` com os blocos: Header dinâmico por subsistema, Diagnóstico Rápido (Causa, Impacto, Horário), Ação Necessária (com link direto) e Guardas Condicionais (Diretoria e Logs).
  - [x] 3.2 Implementar `normalizarPayloadAlertaDev(arg1, arg2)` para garantir compatibilidade 100% transparente com chamadas legadas `enviarAlertaDev(string, string)`.
  - [x] 3.3 Exportar `enviarAlertaDev` atualizado e `registrarSucessoDev` no `module.exports`.

- [x] **Fase 4: Modernização dos Chamadores Críticos**
  - [x] 4.1 Atualizar chamada em `projects/hydra-rede/src/run_evening_heartbeat.js` passando objeto estruturado Hermes 2.0 com link `https://bot.tork.services/rede-auth` e registrando sucesso com `registrarSucessoDev('MEU REDE')` ao logar com êxito.
  - [x] 4.2 Atualizar chamadas em `projects/hydra-rede/src/run_morning_watchdog_0600.js` passando objeto Hermes 2.0 sem menções fictícias à diretoria.
  - [x] 4.3 Atualizar chamadas em `projects/hydra-rede/src/run_unified_morning_dispatch.js` nos gates de Totalidade, Qualidade e Falha de Envio.
  - [x] 4.4 Atualizar chamadas em `projects/hydra-rede/src/run_cmv_kpi_gerentes.js`.

- [x] **Fase 5: Suíte de Testes Automatizada & Validação Local**
  - [x] 5.1 Criar `projects/hydra-rede/src/test_printer_antispam_hermes.js` testando:
    - Teste 1: Hardware Guard suprime impressão se WAN online (mesmo sem lock matinal).
    - Teste 2: Formatador Hermes 2.0 gera blocos corretos por subsistema e parseia chamadas legadas.
    - Teste 3: Gate Anti-Flood bloqueia 2º alerta idêntico dentro de 3h e libera com `--force` ou novo erro.
    - Teste 4: `registrarSucessoDev` reseta o cooldown do subsistema.
  - [x] 5.2 Executar testes locais via `node src/test_printer_antispam_hermes.js` e verificar aprovação 100%.

- [x] **Fase 6: Sincronização Headless & Teste de Fogo na VPS**
  - [x] 6.1 Sincronizar arquivos alterados via SCP para a VPS Linux (`operacional@100.126.50.101:/home/operacional/hydra-rede/`).
  - [x] 6.2 Executar a suíte de testes diretamente na VPS via SSH.
  - [x] 6.3 Testar simulação de heartbeat com probe-only para validar a entrega no WhatsApp do Dev.

# Spec 040: Resiliência Hydra — Trava Absoluta de Impressão Física, Alertas Hermes 2.0 Dinâmicos e Anti-Flood no WhatsApp

## 1. Visão Geral & Problema Factual

Atualmente, o sistema Hydra possui rotinas de auditoria, heartbeat e despacho matinal operando na VPS e no Windows Desktop. Dois problemas críticos foram identificados em produção:

### 1.1. Falso Positivo e Desperdício na Impressora Física (Brother DCP-B7535DW)
- **Causa Raiz Identificada:** Em `projects/hydra-rede/src/hydra_printer_alert.js` (linhas 189–205), a função `checarStatusMatinal08h` dispara a impressão física de um boletim em papel caso `lockSucessoExiste` seja falso, **mesmo quando a internet WAN está 100% online (`wanProbe.isOnline === true`)**.
- **Texto Engessado & Incorreto:** As linhas 92–94, 104 e 116 de `hydra_printer_alert.js` contêm textos estáticos afirmando que a rede está sem internet (`QUEDA DE CONEXÃO WAN (VIVO FIBRA)`, `Rede WAN: DESCONECTADA`, `Envio WhatsApp: RETIDO`), instruindo operadores a verificarem as luzes do roteador Vivo e reiniciarem o modem da tomada, **quando a internet está totalmente funcional**.
- **Diretriz do Usuário:** A impressora física deve operar **EXCLUSIVAMENTE em caso extremo de a internet ter caído de verdade** (quando é fisicamente impossível enviar WhatsApp). Se a internet estiver ativa, é terminantemente proibido imprimir qualquer papel. Erros de software ou rotinas devem ir exclusivamente por WhatsApp.

### 1.2. Alertas de Erro Engessados no WhatsApp e Ausência de Anti-Flood
- **Textos Travados & Falso Pânico:** Em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js` (linhas 1326–1343), a função `enviarAlertaDev` possui um template estático com:
  - Cabeçalho: `🚨 *[ALERTA DE CONTINGÊNCIA — HYDRA PÁTIO]*`
  - Status fixo: `*Status:* FALHA NA EXECUÇÃO MATINAL`
  - Ação fixa: `*Ação de Segurança:* O envio para o número da diretoria (+55 11 94066-7032) foi bloqueado preventivamente.`
  Isso gera inconsistências graves: o Heartbeat das 19:15 acusando sessão do Meu Rede expirada envia uma mensagem dizendo "FALHA NA EXECUÇÃO MATINAL" e "diretoria bloqueada" (às 19:16 da noite!), confundindo o operador.
- **Falta de Reconhecimento Imediato:** O usuário precisa ler blocos densos para entender o que houve. Exige o padrão **"só de bater o olho saber o erro exato que está acontecendo"**.
- **Flood no WhatsApp (+55 11 99624-2812):** Crons e retries sucessivos (19:15, 23:00, 01:00, 03:00, etc.) disparam o mesmo alerta repetidamente, inundando o WhatsApp do desenvolvedor com notificações duplicadas.

---

## 2. Objetivos Principais

1. **Trava Absoluta de Hardware (Zero Impressão com WAN Online):**
   - Garantir via código que se `wanProbe.isOnline === true`, a rotina de impressão física é **bloqueada imediatamente**, retornando status `INTERNET_ONLINE_IMPRESSAO_SUPRIMIDA`.
   - Nenhuma folha de papel é gasta por falhas de software, banco, scraping ou ausência de lock.
2. **Boletim de Impressão Dinâmico para Queda Real:**
   - Se a internet cair de verdade (`isOnline === false`), o boletim gerado deve refletir a medição real dos testes WAN, horários precisos e orientações operacionais sem templates estáticos fictícios.
3. **Padrão Hermes 2.0 Dinâmico no WhatsApp do Dev:**
   - Reformular `enviarAlertaDev` para aceitar parâmetros estruturados:
     - Subsistema real (ex: `MEU REDE`, `PÁTIO`, `CONCILIAÇÃO`, `CMV GERENTES`, `WATCHDOG 06:00`, `INFRA`).
     - Título descritivo em 1 linha.
     - Causa raiz objetiva e direta.
     - Impacto real (se bloqueou envio, se é teste preventivo vespertino, etc.).
     - Ação recomendada direta com link acionável (ex: link de auth).
   - Manter retrocompatibilidade com chamadores antigos via normalizador inteligente de strings.
4. **Gate Anti-Flood & Deduplicação com Cooldown de 3 Horas:**
   - Implementar deduplicação baseada em hash determinístico SHA-256 (`subsistema + erroRaiz`).
   - Cooldown de 3 horas (180 min): erros idênticos no mesmo subsistema são suprimidos no WhatsApp.
   - Suporte a `force: true` para ignorar cooldown em disparos manuais.
   - Auto-clear do cooldown quando o subsistema restabelecer a normalidade (`registrarSucessoDev`).

---

## 3. Escopo de Arquivos Afetados

| Arquivo | Responsabilidade |
| :--- | :--- |
| `projects/hydra-rede/src/hydra_printer_alert.js` | Trava absoluta de hardware (WAN check) e dinamização do boletim impresso |
| `projects/hydra-rede/src/whatsapp_patio_dispatcher.js` | Reformulação de `enviarAlertaDev`, formatador Hermes 2.0 e gate anti-flood persistente |
| `projects/hydra-rede/src/run_evening_heartbeat.js` | Chamada estruturada Hermes 2.0 no alerta de sessão Meu Rede |
| `projects/hydra-rede/src/run_morning_watchdog_0600.js` | Chamada estruturada Hermes 2.0 no watchdog prévio das 06:00 AM |
| `projects/hydra-rede/src/run_unified_morning_dispatch.js` | Chamada estruturada Hermes 2.0 nos gates matinais (Totalidade, Qualidade, Envio) |
| `projects/hydra-rede/src/run_cmv_kpi_gerentes.js` | Chamada estruturada Hermes 2.0 no monitor de CMV e serviços |
| `projects/hydra-rede/src/test_printer_antispam_hermes.js` | Nova suíte de testes unitários e de integração cobrindo os 3 pilares |

---

## 4. Critérios de Aceite

1. **Critério 1 (Hardware Gate):**
   - Executar `checarStatusMatinal08h` com internet online e sem lock matinal. O resultado DEVE ser `INTERNET_ONLINE_IMPRESSAO_SUPRIMIDA` com ZERO impressões despachadas.
2. **Critério 2 (Hermes 2.0 Visual):**
   - A mensagem de alerta no WhatsApp do desenvolvedor segue rigorosamente o layout:
     ```text
     🚨 *[HYDRA MEU REDE — SESSÃO EXPIRADA]*
     
     > *Diagnóstico Rápido*
     • *Causa:* Login bloqueado na tela inicial da Rede (reCAPTCHA pendente).
     • *Impacto:* Teste preventivo das 19:15. A esteira noturna das 23h será afetada se não reautenticado.
     • *Horário:* 28/10/2026, 19:16:11
     
     > *Ação Necessária*
     👉 Acesse https://bot.tork.services/rede-auth para reautenticar antes das 23h!
     ```
   - Nenhuma menção a "FALHA NA EXECUÇÃO MATINAL" ou "diretoria bloqueada" fora de contexto.
3. **Critério 3 (Anti-Flood WhatsApp):**
   - Dois disparos seguidos do mesmo erro em menos de 3 horas geram apenas 1 envio via WhatsApp; o segundo registra `[Anti-Flood] Alerta suprimido por cooldown ativo (restam X min)`.
   - Se um erro diferente ocorrer ou flag `--force` for usada, o envio ocorre imediatamente.
4. **Critério 4 (Segurança de Mensageria):**
   - Remetente exclusivo é a instância `hydra` (ou `atendimento`). Números de gerentes continuam com bloqueio absoluto.

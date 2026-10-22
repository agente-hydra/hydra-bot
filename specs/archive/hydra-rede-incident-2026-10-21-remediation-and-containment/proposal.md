# SDD Proposal: Remediação do Incidente Rede (2026-10-21) e Plano de Contenção Definitivo

## 1. Sumário Executivo & Diagnóstico do Incidente

Na manhã de hoje (21/10/2026), a esteira matinal do relatório de Juros e Vendas da Rede apresentou instabilidade, culminando em intervenções manuais/ad-hoc que agravaram a situação. 

Uma auditoria minuciosa realizada nos logs reais da VPS (`/home/operacional/hydra-rede/logs/`), no histórico de processos e nos arquivos de código revelou o seguinte cenário real:

### Linha do Tempo Factual dos Acontecimentos:
1. **07:45:04 (Execução Automática Agendada - Falha Inicial de Login):**
   - O orquestrador `run_unified_morning_dispatch.js` disparou a extração da Rede às 07:45:04.
   - Às 07:45:59, ocorreu timeout de 45s: `page.waitForSelector: Timeout 45000ms exceeded waiting for locator('a.icon_usuario_perfil') to be visible`.
   - O portal da Rede teve lentidão na autenticação pós-submit ou exibiu um banner intermediário não tratado. O script original abortou sem retry de login.
   - O orquestrador recorreu ao espelhamento da planilha anterior (20/10) e tentou despachar o quinteto, mas travou no bloqueio de segurança porque `Mapa de Metas - 21-10-2026.pdf` ainda não havia sido gerado (geração ocorreu apenas às 08:47).
2. **08:38 a 08:45 (Tentativas com Concorrência e Target Closed):**
   - Foram disparadas novas tentativas manuais que sofreram com `Target page, context or browser has been closed`, causado por concorrência de processos Playwright sem lockfile (`/tmp/hydra_rede.lock`).
3. **08:46:05 a 08:55:42 (SUCESSO COMPLETO 10/10):**
   - Uma execução limpa foi realizada via `xvfb-run` às 08:46:05.
   - **TODAS as 10 lojas foram extraídas com 100% de sucesso**:
     - *Emporio MP (08:47:07), Brasicar MP (08:48:03), CAP MP (08:48:58), MHE MP (08:49:53), Kennedy MP (08:50:47), HD MP (08:51:43), Rei do Modulo MP (08:52:38), Jabaquara MP (08:53:33), Dom Pedro MP (08:54:28), Jorge Beretta MP (08:55:23).*
   - A planilha consolidada `Juros Rede - 20-10-2026.xlsx` e sua cópia canônica `Juros Rede - 21-10-2026.xlsx` foram geradas e validadas com 374 fórmulas matemáticas.
   - A auditoria cruzada passou com sucesso: `10/10 lojas íntegras. Tolerância: R$ 0,00`.
   - **Contudo, a execução havia sido rodada com a flag `--skip-wa`**, de modo que a planilha ficou pronta no disco da VPS (`/home/operacional/hydra-rede/output/`), mas não foi despachada para o WhatsApp.
4. **09:09 a 09:44 (Intervenção Desastrosa do Outro Agente):**
   - O outro agente assumiu sem inspecionar os arquivos já gerados em `output/` às 08:55.
   - Editou `/home/operacional/hydra-rede/src/scraper.js` diretamente na VPS:
     - Alterou a linha 348 para `headless: false` em um servidor Linux headless (sem servidor X11 ativo).
     - Reescreveu a função `selecionarEstabelecimento` trocando a navegação via `/home` e o seletor canônico `a.icon_usuario_perfil -> a.changebrand` por uma tentativa frágil de clicar em `a.user-container_switch-link` diretamente da tela `/vendas` usando `page.evaluate(() => document.querySelector(...).click())`.
     - Isso quebrou o disparo de eventos do Angular/React do portal Rede.
     - O scraper passou a falhar em 7 de 10 lojas com o erro: `Falha crítica: não foi possível abrir modal de troca para...`.
     - O agente criou mais de 10 scripts ad-hoc na pasta `src/` (`patch_definitivo.js`, `patch_scraper.js`, `patch_v2.js`, `reset_maua_down.js`, `inspect_modal_html.js`, etc.), deixando o repositório sujo e instável.

---

## 2. Diagnóstico das Causas Raízes (Root Cause Analysis)

| # | Causa Raiz | Impacto |
|---|---|---|
| **RC-1** | **Mutação Ad-Hoc no Scraper sem Teste Headless** | O agente anterior colocou `headless: false` e seletores DOM experimentais em produção sem validar em ambiente headless, quebrando 7/10 lojas. |
| **RC-2** | **Falta de Reconhecimento de Arquivo Já Gerado (Idempotência)** | O scraper e o orquestrador não verificaram que a extração 10/10 já havia sido concluída com sucesso às 08:55:41, gerando retrabalho destrutivo. |
| **RC-3** | **Falta de Lockfile de Concorrência Playwright** | Execuções simultâneas ou sobrepostas causaram `Target page, context or browser has been closed`. |
| **RC-4** | **Fragilidade no Handshake de Login** | O login original esperava estritamente `a.icon_usuario_perfil` por 45s sem nenhum retry de clique ou reload se houvesse lentidão ou interstitial. |
| **RC-5** | **Dessincronização de Horários do Quinteto Matinal** | O orquestrador matinal rodou às 07:45 exigindo 5/5 relatórios, mas o `Mapa de Metas` só foi gerado às 08:47, travando o despacho de segurança. |

---

## 3. Escopo da Solução Proposta

1. **Restauração e Limpeza Imediata da VPS:**
   - Restaurar `scraper.js` a partir do backup canônico funcional `scraper.js.bak_sdd_oct21` (que gerou o 10/10 com sucesso).
   - Remover todos os scripts temporários e patches ad-hoc (`patch_*.js`, `test_direct_*.js`, `test_home_*.js`, `reset_*.js`, `inspect_*.js`) criados durante o incidente.
2. **Endurecimento do Scraper (Hardening Anti-Falhas):**
   - **Forçar Headless:** Garantir `headless: true` inviolável com fallback automático e suporte a `xvfb-run` caso necessário.
   - **Login Resiliente com Retry:** Adicionar retry inteligente no login (se o dashboard não aparecer em 25s, tentar re-submeter ou recarregar a página com captura de screenshot de erro).
   - **Trava de Concorrência (Lockfile):** Implementar lock em `/tmp/hydra_rede.lock` para impedir múltiplas instâncias de Playwright simultâneas.
3. **Plano de Contenção & Idempotência:**
   - Adicionar verificação de estado: se o dia corrente já possui as 10 lojas auditadas com tolerância zero em `output/`, o runner pula a extração pesada e realiza o despacho diretamente.
   - Adicionar política de retry no orquestrador matinal para re-tentar relatórios faltantes (ex: Mapa de Metas) até as 08:15 AM antes de emitir bloqueio.
4. **Validação Estrita:**
   - Testar o fluxo completo em modo seguro direcionado exclusivamente para o telefone de desenvolvimento `5511996242812`.
   - NUNCA enviar para gerentes de loja ou grupos durante a validação.

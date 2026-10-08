# Sessions Memory — AGY Workspace
> Criado em: 2026-09-13.
> Objetivo: Registro automático de contexto, decisões e tarefas concluídas entre sessões.

<!-- Entradas de sessão salvas aqui -->

## [2026-09-14] — Landing Page Oficial INFYNIX (Master Blueprint v1.0)
**Contexto:** Implementação completa da Landing Page institucional da INFYNIX em `projects/infinyx` baseada no arquivo `INFYNIX_Master_Blueprint_v1_0 (1).docx`.
**Decisões e Regras Aprendidas:**
- Removido vídeo de fundo pesado (`hero-bg.mp4`), substituído pelo Key Visual de titânio (`hero-poster.jpeg`) com iluminação volumétrica, grid e feixe em CSS.
- Implementados os 5 Pilares (`RULEX™`, `SYNX™`, `INTELLEX™`, `RPA ENGINE™`, `AUTONIX™`), simulador de pipeline do `INFYNIX OS™` & `CORE™`, ecossistema com 9 agentes `IAS™`, régua do `BI Maturity Model™` (Level 0 a 5), `Método 6D™`, vertical `Insurance OS™` e modal do `Business Intelligence Score™`.
- Build gate executado com 100% de sucesso via `npm run build` (Vite + TanStack Start + Nitro SSR Cloudflare module).
**Não fazer:** Nunca tentar rodar comandos de autenticação interativa OAuth/PKCE (`higgsfield auth login`) de forma síncrona/bloqueante no ambiente headless.

## [2026-09-18] — SDD Setup Infinyx (sdd-setup)
**Contexto:** Setup headless do ambiente para o projeto `mktfun/infinyx` em nova sessão de chat.
**O que foi feito:**
- Git identity configurada: `Antigravity AI <ai@clawhub.com>`
- GitHub CLI autenticado via `$env:GH_TOKEN` (conta `mktfun`, escopo total `repo`)
- Repositório verificado: `https://github.com/mktfun/infinyx.git`, branch `main`, HEAD `5c02866`
- Memória modular criada em `projects/infinyx/.agent/memory/` (ui, domain, infra, auth, supabase)
- Graphify indexado: 78 arquivos de código → 580 nós, 715 arestas, 85 comunidades (`--code-only`)
**Regra aprendida:** MinGit (`C:\Users\admin\...`) não existe neste usuário — usar `git` do PATH diretamente.
**Não fazer:** Não tentar `gh auth login --with-token` via pipe inline no PowerShell `-Command` — usar script `.ps1` separado.

## [2026-09-23] — Consolidação Spec 26 (Restauração Visual, WebGL, Footer e SVGs)
**Contexto:** Conclusão da Spec 26 e correções direcionadas na landing page INFYNIX (`projects/infinyx`).
**O que foi feito:**
- Hero: Montanhas restauradas (`.framer-u991jm`, `.framer-f7ktf5`, `.framer-13cc0rb` visíveis e opacidade 1); contraste preto corrigido nos botões e nos 4 badges do ciclo rotativo (S, Z, F, T).
- Core Features: Purgado `position: relative !important` para restabelecer aspecto 1080x607 dos mockups; Canvas WebGL idempotente com cleanup, `MutationObserver` e `ResizeObserver`; correção de escape XML (`&` -> `&amp;`) nos títulos de 3 mockups SVG, validando os 4 arquivos em W3C XML.
- CTA: Botão "Ver Fluxo" devidamente contido no card "Operações & ERP".
- Footer: Remoção definitiva das colunas legadas de SaaS e injeção do Footer semântico institucional INFYNIX no SSR e bundle Framer.
- Mobile: Bug dos 377px eliminado com `width: 100% !important; max-width: 100% !important;`.
- Validação: Build gate aprovado, testes automatizados no Chrome headless confirmando clique nas 4 abas e dimensões ativas de 1080x607.

## [2026-09-23] — Consolidação Spec 27 (Adaptação de #what-you-get para INFYNIX)
**Contexto:** Conclusão da Spec 27 na landing page INFYNIX (`projects/infinyx`).
**O que foi feito:**
- Abertura da Seção: Badge "Como trabalhamos", H2 "Da operação fragmentada a um sistema que trabalha." e parágrafo institucional.
- Card 1 (Descoberta): "01 · Descoberta", "Começamos pelo processo real.", mapeamento de entradas ERP/CRM/Planilhas e identificação de gargalos.
- Card 2 (Implementação): "02 · Implementação", "Construímos e conectamos a solução.", fluxo integrado e desvio para aprovação humana.
- Card 3 (Evolução): "03 · Evolução", "Acompanhamos o sistema em operação.", painel de governança, log de auditoria, versionamento v2.4 e card flutuante de aprovação operacional.
- Cenários Limpos: 3 WebPs (1064×1224) reconstruídos sem resíduos de interface Fora e vinculados via CSS de background nos wrappers originais.
- Mockups SVG: 4 SVGs transparentes desenhados, com conformidade estrita W3C XML.
- Bundles: 100% dos nomes legados e alts substituídos no bundle Framer (0 ocorrências residuais).
- Validações: Teste automatizado no Chrome headless via CDP confirmando render de 585x673 px e zero vazamento de scroll no mobile (390px).

## [2026-09-29] — Sessão: Missão 2 — Conversa Natural, WhatsApp & Produção Hydra
- **Objetivo:** Conectar o motor financeiro do Agente 1 (commit bf9a871) à experiência conversacional e publicar em produção.
- **Entregas:**
  - `intent_rewriter.ts`: Anáforas de loja ("E o CMV dela?", "Qual área tá pior?"), elipses com herança de operação financeira ("E Santo André?") e quebra de escopo para rede ("Agora o faturamento das lojas").
  - `operational_adapter.ts`: Formatação de WhatsApp nativa anti-slop, `cmvPercentual` como primeira métrica, destaque da pior área operacional, e cálculo explícito de falta percentual e atingimento.
  - Correção da regressão 15:29: Consulta de OS seguida de CMV da Jorge Beretta não colapsa mais em Raio-X Operacional.
  - Testes: 92/92 Financial Engine, 91/91 Layer A, 30/30 Layer B, 27/27 Layer C, 33/33 WhatsApp Format, 10/10 Fallback Router, 75/75 Natural Conversation.
  - Produção: Backup integral do banco SQLite e arquivos de código; deploy seletivo para `/opt/bots/src/hydra-sync/`; reload do PM2 `hydra-bot` (pid 260035); smoke test executado e entregue com sucesso via Evolution API no WhatsApp do Davi (+55 11 99624-2812) com status HTTP 201.

## [2026-09-29] — Sessão: Confirmação de Recebimento (👀) e Digitando Contínuo no WhatsApp
- **Objetivo:** Garantir que o usuário receba confirmação visual imediata com reação 👀 à mensagem enviada e manter o estado "digitando" (`composing`) ativo sem interrupções durante o tempo de execução da consulta, encerrando com `paused` antes da entrega do primeiro balão.
- **Entregas:**
  - `webhook-listener.js`: Reação 👀 não-bloqueante no ingress vinculada ao `messageId` opaco; tabela `message_reactions` para auditoria e idempotência; `TypingManager` com heartbeat de 3500ms e delay de 4500ms; execução assíncrona do dispatcher via `execFile` desimpedindo o event loop; filas per-chat (`chatQueues`) para isolamento de usuários; eliminação de atraso artificial no envio do primeiro balão.
  - `webhook-listener.d.ts`: Declarações estritas de tipos para o TypeScript (zero erros no typecheck).
  - `src/hydra-sync/tests/test_webhook_presence_reaction.ts`: Suíte de testes com 26 asserções cobrindo idempotência, deduplicação, heartbeat, teto de 65s, proteção anti-loop, concorrência per-chat e transporte simulado.
  - Testes: 26/26 PASS no harness de webhook, 75/75 PASS em conversação natural, 33/33 PASS em formato WhatsApp, 92/92 PASS no financial engine, 0 erros no typecheck (`npm run typecheck:hydra`).
  - Produção: Deploy validado em `/home/operacional/hydra/webhook-listener.js` e `/opt/bots/`; PM2 recarregado (`pm2 reload hydra-bot`); teste real executado no número do Davi (+55 11 99624-2812) confirmando reação 👀 enviada (HTTP 201 em 733ms), ingress em 110ms e resposta entregue (HTTP 201 em 603ms).

## [2026-09-29] — Sessão: Encavalamento de Mensagens, CMV da Rede e Evidências Multimodais
- **Objetivo:** Resolver mensagens fragmentadas e encavaladas no WhatsApp, eliminar o erro "não há CMV da loja LOJA", calcular CMV consolidado da rede (fórmula ponderada de 18.64%), ranquear lojas sem mascarar ausência como 0.00% e integrar evidências multimodais de áudio, imagem, vídeo e documentos.
- **Entregas:**
  - `message_batcher.ts` / `message_batcher.js`: Debounce deslizante de 700ms (teto de 2000ms), deduplicação, auditoria no SQLite (`hydra_message_batches`), unificação de mensagens e correções intra-lote.
  - `types/multimodal_contract.ts`: Contrato de dados e evidências multimodais (`InboundPart`, `MediaEvidence`, `CandidateEntity`, `VideoTimecode`, `FinancialExtractionEvidence`).
  - `db_repository.ts`: `queryNetworkCMV` (18.64% ponderado `sum(custos)/sum(fat)*100`), `queryAllStoresCMV` (ranking sem 0.00%), `queryStoreCMV` (blindagem anti-LOJA), `queryUnifiedCMV`.
  - `intent_rewriter.ts`: Resolução de escopos de CMV (`network`, `all_stores`, `store`, `worst_store`), adoção de entidades candidatas de mídia (placas, OSs), descarte de mídia fora de escopo.
  - `operational_adapter.ts`: Formatação nativa para WhatsApp com CMV% prioritário, pior loja, lojas apuradas e ressalva explícita de apuração parcial (3 de 10 lojas) e Master excluída.
  - `agent_dispatcher.ts` & `webhook-listener.js`: Ingress desacoplado acoplado ao `MessageBatcher`, digitação iniciada estritamente após fechamento do lote, integração com dual worker router.
  - Testes: 86/86 PASS (`test_batcher_multimodal_cmv.ts`), 75/75 PASS (`test_natural_conversation_mission2.ts`), 92/92 PASS (`test_financial_engine.ts`), 28/28 PASS (`test_webhook_presence_reaction.ts`), 0 erros em `npm run typecheck:hydra`.
  - Produção: Backup em `/home/operacional/backup_prod_m2_20260929_181400`, deploy em `/opt/bots/src/hydra-sync/` e `/home/operacional/hydra/webhook-listener.js`, PM2 `hydra-bot` ativo (PID 327957), testes reais de encavalamento ("qual o CMV" + "das lojas") e "Qual a pior?" executados com sucesso e auditados no SQLite.




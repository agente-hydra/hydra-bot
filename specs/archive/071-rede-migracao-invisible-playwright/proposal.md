# Proposta de Engenharia — Spec 071: Migração da Rede para Invisible Playwright

> **Data:** 05/11/2026  
> **Status:** PROPOSTA / PLANEJAMENTO  
> **Especialistas Ativados:** `specialist-crawler-rede`, `specialist-ops-infra`  
> **Contexto Operacional:** Unificação do motor de automação e login assistido do Portal Rede na VPS sob o Invisible Playwright 0.45.0 (Firefox patched), mantendo Node.js como orquestrador, auditor e conciliador.

---

## 1. Problema

1. **Dualidade de Executores & Conflito de Sessão:**
   - Na VPS de produção, `projects/hydra-rede/src/scraper.js` utiliza Chromium com `playwright-extra` + `stealth` para a coleta matinal automatizada dos 10 estabelecimentos (ECs).
   - Simultaneamente, o hub de autenticação assistida remota (`projects/hydra-rede/src/reconnect_system/rede_live_auth_hub.js`) utiliza Chromium nativo no display `:99` via noVNC.
   - Essa fragmentação gera concorrência sobre o perfil/storageState de cookies, descompasso de fingerprints e falsos positivos de desconexão.
2. **Exposição a Desafios & Falso Status 200:**
   - O Chromium com automação padrão é frequentemente flagrado por proteções de bot no portal Rede.
   - O monitoramento de sessão histórico utilizava verificação ingênua de HTTP 200, marcando sessão como "ativa" quando a página estava, na verdade, travada na tela de login ou modal de tutorial.
3. **Falta de Manifesto Único de Lote:**
   - O lote de 10 lojas por período necessita de um manifesto atômico selado por hash para garantir que a conciliação financeira e o despacho por WhatsApp só ocorram quando os 10 arquivos estiverem validados e íntegros.

---

## 2. Solução Proposta

1. **Fixação e Isolamento da Versão do Invisible Playwright:**
   - Adotar formalmente **Invisible Playwright `0.45.0`** (publicado em 04/11/2026) com **`invisible-core 55.50.0`** e Python 3.11+.
   - Download antecipado do build do Firefox correspondente via `invisible-playwright fetch`.
   - Ambiente virtual Python isolado (`.venv-invisible`) na VPS, com registro de hashes e manifesto de implantação. Manter versão anterior como plano de rollback imediato.
2. **Único Executor e Único Dono da Sessão (Single-Session Owner):**
   - Criação de um daemon/worker Python dedicado (`rede_invisible_worker.py`) que gerencia com exclusividade o perfil persistente do navegador Firefox camuflado.
   - Tanto a coleta automatizada (Node `scraper.js`) quanto a sessão assistida (`rede_live_auth_hub.js`) comunicam-se com esse único executor através de protocolo IPC estruturado (JSON-RPC via socket local ou stdin/stdout).
   - O canal assistido conecta ao display do executor apenas quando houver necessidade de intervenção do operador, sem destruir o contexto de navegação.
3. **Verificação de Sessão Forte, Tolerância a Pop-ups & Modais:**
   - Confirmação de acesso baseada em evidência física do DOM (elemento autenticado do relatório de vendas e texto do cabeçalho com o código do estabelecimento ativo).
   - Tratamento automático de pop-ups conhecidos (tutoriais Joyride, termos, pesquisas de satisfação) com dispensação controlada.
   - Detecção granular de CAPTCHA: ao identificar desafio, o worker pausa no perfil atual, aciona o hub de assistência e aguarda o operador sem timeout abrupto.
4. **Manifesto de Lote, Selagem Criptográfica e Despacho Idempotente:**
   - Exigência de 10 arquivos XLSX validados por período (código do EC, período compatível, timestamp e hash SHA-256).
   - O auditor financeiro gera um selo do lote completo. A conciliação e o despacho utilizam esse selo como chave de idempotência para impedir reenvios duplicados.

---

## 3. Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :-- | :-- | :-- |
| Nova versão do Invisible Playwright (0.45.0) apresentar regressão de compatibilidade no Firefox da VPS | Alto | Download prévio em `.venv` isolado, validação em janela de simulação com rollback imediato para 0.43.0 |
| Trava de concorrência bloquear reprocessamento manual enquanto há tentativa suspensa | Médio | Gerenciador de locks por período com expiração configurada e encerramento limpo de processos zumbis |
| Mudança de layout inesperada no portal Meu Rede | Médio | Captura de tela redigida armazenada como evidência de erro e preservação das lojas já coletadas no lote parcial |

---

## 4. Critérios de Aceite Globais

- [ ] **AC-1:** Um único processo Firefox Invisible controla o perfil de sessão da Rede; zero instâncias paralelas de Chromium ativas.
- [ ] **AC-2:** Coleta automatizada executa os 10 estabelecimentos e gera manifesto selado com 10 hashes SHA-256 válidos.
- [ ] **AC-3:** Quando houver desafio de login/CAPTCHA, o sistema entra em modo assistido sem reiniciar o navegador nem perder os cookies parciais.
- [ ] **AC-4:** O despacho via WhatsApp para os sócios só é disparado com lote 100% completo e selo de auditoria único.

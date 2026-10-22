# SDD Proposal: Atualização Horária Unificada de Crawlers & Blindagem do Pipeline Matinal

## 1. Sumário Executivo & Diagnóstico da Causa Raiz

Nas últimas semanas, a esteira operacional do Ecossistema Hydra na VPS Linux (`operacional@100.126.50.101`) apresentou falhas recorrentes na geração e despacho dos relatórios matinais (Juros Rede, Carros em Pátio, Mapa de Metas, Contas a Pagar e Conciliação). 

A análise factual dos logs reais (`/home/operacional/hydra-data/logs/matinal-trio.log`, `nightly-prep.log`, `matinal_dispatch_19-10-2026.log`) revelou as **4 falhas estruturais** que geraram o colapso do fluxo:

1. **O "Espelhamento Fantasma" de Relatórios Obsoletos (Causa dos dados de 15/10 no FDS/Segunda):**
   - No arquivo `src/run_unified_morning_dispatch.js` (linhas 304–325), quando o scraper da Rede falha por timeout, o orquestrador executa uma busca cega por planilhas antigas:
     ```javascript
     const jurosCands = fs.readdirSync(outputDir).filter(f => f.startsWith('Juros Rede - ') && f.endsWith('.xlsx'));
     jurosCands.sort().reverse();
     fs.copyFileSync(maisRecente, jurosHojePath);
     ```
   - No dia 19/10 (Segunda-feira), como o scraper falhou e o último arquivo válido no disco era do dia **15/10 (Quinta-feira)**, o script silenciosamente copiou o arquivo de 15/10 como se fosse do dia 19/10. A conciliação cruzou dados de 15/10 com o pátio de 19/10, gerando números fictícios e corrompidos.
2. **Gargalo no Horário de Despacho (07:45 AM tentando fazer tudo em 15 minutos):**
   - O orquestrador acorda às 07:45 e tenta, simultaneamente, abrir o Playwright na Rede, rodar o deep-crawler de 10 lojas no Oficina Inteligente, extrair Contas a Pagar e calcular a Conciliação.
   - Qualquer lentidão de rede, interstitial ou banner no portal Rede estoura o timeout de 45s, colapsando a esteira antes das 08:00 AM.
3. **Concorrência Destrutiva de Locks (`/tmp/hydra-data-refresh.lock`):**
   - No crontab, tanto o `run-hydra-hourly-finance.sh` quanto a esteira noturna (`run-nightly-prep.sh`) foram agendados exatamente no minuto `:00` (ex: 23:00, 01:00, 03:00, 05:00, 07:00).
   - Quando `run-hydra-daily-full.sh` tenta rodar, encontra o lock do hourly worker ocupado e executa `flock -n 9; exit 0`. O script encerra em **0 segundos** com exit code 0, enganando o orquestrador noturno, que presume sucesso sem que nenhuma OS ou PDF de Mapa de Metas tenha sido gerado.
4. **Falta de Ingestão Contínua de Pátio e Contas:**
   - Atualmente, apenas o faturamento/CMV (`hourly_finance_worker.ts`) roda de hora em hora. O pátio de veículos, OSs e contas a pagar ficam estagnados por mais de 12 horas, disparando o `[Adapter] ⛔ BLOQUEIO DE FRESCOR: Lojas com dados obsoletos (> 12h)`.

---

## 2. Solução Proposta

### 2.1 Daemon / Cron de Atualização Horária Unificada (Zero WhatsApp)
- Implementar um worker horário integrado (`hourly_ecosystem_worker.ts`) que roda a cada 1 hora no cron (`minuto :15`, evitando colisão com o minuto `:00` do financeiro):
  1. **Oficina Inteligente (Metas & CMV):** Ingestão contínua em `metas_horarias` (já existente).
  2. **Oficina Inteligente (Pátio & OS Ativas):** Sincronização incremental das OSs em pátio/abertas para as 10 lojas no SQLite WAL `hydra_ops.db`, mantendo os timestamps de frescor sempre < 1 hora.
  3. **Oficina Inteligente (Contas a Pagar):** Ingestão horária dos vencimentos do dia em `hydra_ops.db`.
  4. **Segurança de Mensageria:** 100% silencioso. NENHUM envio para WhatsApp, Chatwoot ou grupos nessas rodadas.

### 2.2 Pre-Flight Matinal Pré-Despacho (Janela 06:30 às 07:35 AM)
- Desacoplar a **Extração/Geração** do **Despacho**:
  - **06:30 às 07:00 AM:** O Deep Crawler unificado roda com antecedência na VPS, gerando com folga o `Mapa de Metas - DD-MM-AAAA.pdf` e consolidando o pátio noturno.
  - **07:05 às 07:25 AM:** O scraper da Rede executa com folga de 20 minutos (com headless travado, retry automático de login de 30s e lockfile `/tmp/hydra_rede.lock`).
  - **07:30 AM:** As planilhas derivadas (`Carros em Patio` e `Conciliacao Patio x Rede`) são pré-geradas e auditadas com tolerância zero.
  - **Alerta Precoce:** Se houver qualquer falha (portal indisponível, senha expirada, etc.), o alerta cai para o desenvolvedor (`5511996242812`) às **07:35 AM**, dando 25 minutos de reação ANTES da entrega oficial das 08:00 AM.
  - **07:45 às 08:00 AM (Despacho):** O script `run_unified_morning_dispatch.js` apenas valida que os arquivos pré-gerados estão íntegros e frescos, despachando pontualmente às 08:00:00 AM sem abrir navegadores pesados no momento do envio.

### 2.3 Expurgar 100% dos "Espelhamentos Fantasmas"
- Proibir incondicionalmente a cópia de planilhas de datas anteriores renomeadas para a data corrente.
- Se uma extração falhar:
  - O sistema **NÃO MASCARA O ERRO**.
  - O relatório ausente é explicitamente sinalizado no alerta técnico.
  - O despacho oficial só entrega arquivos cuja data de geração e dados internos correspondam estritamente à janela solicitada (D-1 para dias de semana; D-3 a D-1 para segunda-feira).

### 2.4 Resolução Estrita de Finais de Semana e Feriados
- No fim de semana (Sábado e Domingo), os crawlers continuam rodando de hora em hora em segundo plano alimentando o banco.
- Na Segunda-feira, a janela de consolidação abrange estritamente Sexta a Domingo (`16/10` a `18/10`), nunca aceitando dados de Quinta-feira (`15/10`).

---

## 3. Matriz de Riscos & Contratos de Dados

| Risco | Severidade | Probabilidade | Mitigação Arquitetural |
|---|---|---|---|
| Colisão de locks entre worker horário e rotinas noturnas | Alta | Alta | Escalonamento de horários no Cron: Hourly Finance no `:05`, Hourly Pátio no `:15`, Jobs Noturnos no `:30`. Troca de `flock -n` por fila ordenada `flock -w 300`. |
| Disparo involuntário de WhatsApp em rotinas horárias | Extrema | Baixa | Trava no código: flag `--no-dispatch` forçada por padrão; módulos horários sequer instanciam clientes WhatsApp. |
| Lentidão ou bloqueio no portal Oficina Inteligente | Alta | Média | Sync incremental por loja (salvando checkpoints no SQLite por EC); timeout individual de 4 minutos por loja. |
| Entrega de dados de dias anteriores por fallback | Extrema | Zero | Remoção de `fs.copyFileSync(maisRecente, jurosHojePath)`. Validação estrita de checksum e metadata de data em todo arquivo despachado. |

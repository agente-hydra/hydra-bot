# SKILL: Orquestrador de Pátio ERP e Balões da Diretoria
## Contexto e Regras Críticas
- **Canal de Destino**: Grupo Oficial da Diretoria/Sócios (`120363425738307789@g.us`).
- **Remetente Exclusivo**: Instância `hydra` (PROIBIDO usar números de gerentes).
- **Banco de Dados**: `/home/operacional/hydra/data/hydra_ops.db`
- **Arquivos JSON por Loja**: `/home/operacional/hydra-rede/data/os_store_<loja>.json`

## Passo Obrigatório Pré-Disparo (Self-Healing de Dados)
Antes de disparar QUALQUER balão (08h, 09h, 14h, 15h ou 19h):
1. Verifique o timestamp de modificação dos arquivos `/home/operacional/hydra-rede/data/os_store_*.json` e do banco `hydra_ops.db`.
2. Se os dados tiverem mais de 60 minutos de defasagem ou se alguma das 10 lojas estiver zerada por erro de scrape, force a atualização imediata rodando:
   `/home/operacional/hydra/scripts/run-hydra-hourly-finance.sh`
3. Rode um teste em modo simulação para garantir que o texto do balão não contém `NaN`, `undefined` ou valores corrompidos:
   `cd /home/operacional/hydra-rede && node src/run_group_balloon_dispatch.js --balloon=<NUMERO> --dry-run`
4. Se o `--dry-run` passar limpo, execute sem `--dry-run`.

---

## Estrutura e Mensagens de Cada Horário

### 🕗 08:00 AM — BALÃO 2 COMPLETO (Balanço Executivo Matinal)
- **Comando**: `node src/run_group_balloon_dispatch.js --balloon=2 --mode=full`
- **Conteúdo Obrigatório da Mensagem**:
  - 📈 *Faturamento Acumulado do Mês vs Meta*: Tabela comparativa das 10 lojas.
  - 🔧 *CMV Acumulado*: Custo de Mercadoria Vendida de peças por unidade.
  - 💰 *Fluxo de Caixa do Dia*: Total de boletos/despesas a pagar hoje, saldo bancário disponível e necessidade de caixa.

### 🕘 09:00 AM e 🕒 15:00 PM — BALÃO 1 (Operação / Pátio Vivo)
- **Comando**: `node src/run_group_balloon_dispatch.js --balloon=1`
- **Conteúdo Obrigatório da Mensagem**:
  - 🚗 *Pátio Físico Total*: Soma de carros presentes nas 10 lojas agora.
  - 💵 *Carteira de OSs Abertas*: Valor total em R$ de todas as OSs e saldo pendente a receber.
  - 🚨 *ALERTA CRÍTICO — CARROS SEM SINAL (>50% / 60% concluído)*:
    Lista detalhada contendo `[Loja] | [Modelo/Placa] | [Valor da OS] | [% Serviço Concluído]` para cobrança imediata dos gerentes antes da liberação do veículo.

### 🕑 14:00 PM — BALÃO 2 SIMPLIFICADO (Parcial Vespertina)
- **Comando**: `node src/run_group_balloon_dispatch.js --balloon=2 --mode=simple`
- **Conteúdo Obrigatório da Mensagem**:
  - ⚡ *Parcial do Dia (até 14h)*: Faturamento parcial atingido por loja e CMV do dia (sem a tabela de contas a pagar).

### 🕖 19:00 PM — BALÃO 3 (Fechamento Oficial do Dia)
- **Comando**: `node src/run_group_balloon_dispatch.js --balloon=3`
- **Conteúdo Obrigatório da Mensagem**:
  - 🏁 *Fechamento Oficial Loja a Loja*: Faturamento final do dia e % da meta diária atingida (bateu / não bateu).
  - ✅ *Produtividade*: Quantidade total de OSs entregues e faturadas hoje.
  - 📦 *CMV Consolidado*: Fechamento do custo de peças vendidas no dia.
  - 🌙 *Pátio Adormecido (Carga para Amanhã)*: Quantidade de veículos que permanecem nas lojas para o dia seguinte.

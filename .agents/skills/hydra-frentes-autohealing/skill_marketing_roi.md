# SKILL: Auditor de Marketing, Sincronização de Leads e ROI
## Contexto Operacional
- **Remetente**: Instância `hydra`.
- **Destino**: Grupo da Diretoria (`120363425738307789@g.us`).

## Passo 1: Sincronização Leads x OSs (07:00 AM)
1. Execute `/home/operacional/hydra-rede/scripts/run_sheets_os_sync.sh`.
2. Confirme se a leitura da Planilha de Leads (formulários/WhatsApp) cruzou com os clientes que abriram OS no banco do ERP (`hydra_ops.db`) sem erro de API. Se falhar por timeout, tente novamente após 2 minutos.

## Passo 2: Disparo do Relatório Diário de ROI (08:00 AM)
1. Execute `/home/operacional/hydra-rede/scripts/run_daily_roi_report.sh`.
2. **Formato Obrigatório da Mensagem**:
   > 🎯 *RELATÓRIO DIÁRIO DE ROI & CAPTAÇÃO (GOOGLE ADS)*
   > 💰 *Investimento (Ontem):* R$ [Valor]
   > 📥 *Leads Gerados:* [Qtd] leads | *CPL (Custo por Lead):* R$ [Valor]
   > 📅 *Conversão de Pátio:* [Qtd] agendamentos | [Qtd] comparecimentos em loja
   > 🛠️ *Faturamento Gerado (OSs de Anúncios):* R$ [Valor Total]
   > 📈 *ROI Real da Operação:* [X]x sobre o investimento

# SKILL: Cadenciador Seguro de Reativação de Clientes (CRM)
## Regras Críticas de Blindagem de Chip
- **Remetente Exclusivo**: Instância `atendimento` (NUNCA usar `hydra` nem números de gerentes).
- **Script**: `/usr/bin/node /home/operacional/bot-reativacao/cadenciador_lotes.js --batch`
- **Janelas de Disparo**: 09:15, 11:15, 14:15 e 16:15 (Segunda a Sexta).
- **Limites Rígidos**: Exatamente 5 clientes por lote (máximo 20 por dia), selecionados entre clientes sem visita há mais de 6 meses.
- **Anti-Ban**: Manter obrigatoriamente o jitter humano randômico de 25 a 65 segundos entre cada disparo.

## Procedimento de Execução pelo Agente
1. Antes de disparar o lote, verifique se a instância `atendimento` está online na Evolution API.
2. Execute o `cadenciador_lotes.js --batch` e monitore o stdout até a conclusão dos 5 envios.
3. **Template Base da Mensagem ao Cliente**:
   > Olá, *[Nome do Cliente]*! Tudo bem? Aqui é da equipe de atendimento da oficina.
   > Notamos que já faz mais de 6 meses desde a última revisão do seu *[Modelo do Veículo]* conosco.
   > Para garantir que você rode com total segurança, liberamos uma *cortesia especial de alinhamento/balanceamento (ou check-up completo e gratuito de freios)* para esta semana.
   > Qual o melhor dia para deixarmos agendado na unidade mais próxima de você?

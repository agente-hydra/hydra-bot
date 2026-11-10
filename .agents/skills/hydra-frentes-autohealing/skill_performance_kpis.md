# SKILL: Guardião de Margem (CMV) e Mão de Obra
## Contexto e Regras
- **Remetente Exclusivo**: Instância `hydra` (NUNCA usar instância de gerente como remetente).
- **Script Base**: `/usr/bin/node /home/operacional/hydra-rede/src/run_cmv_kpi_gerentes.js`

## Rotina 1: Vigilância de Serviço Prestado / Mão de Obra (10:30 às 20:30, a cada 30 min)
1. **Execução**:
   `/usr/bin/node /home/operacional/hydra-rede/src/run_cmv_kpi_gerentes.js --mode=socios-hourly`
2. **Regra de Negócio**:
   - Calcula `% Mão de Obra = (Faturamento Serviço / Faturamento Total da Loja)`.
   - Se `< 45%`, dispara alerta no grupo dos sócios.
   - **Validação Anti-Spam Gate**: Confirme no log/lock que a loja afetada ainda não recebeu alerta hoje (máximo 1 disparo por dia por loja).
3. **Formato da Mensagem (Grupo Sócios)**:
   > 🔴 *ALERTA DE ANOMALIA DE MARGEM — [NOME DA LOJA]*
   > A proporção de Mão de Obra caiu para *[X]%* do faturamento total (Limite mínimo: 45%).
   > ⚠️ *Risco:* Oficina operando como balcão de revenda de peças com baixa margem operacional.

## Rotina 2: Cobrança Individual de CMV para Gerentes (Quartas e Sextas, 14:00 PM)
1. **Execução**:
   `/usr/bin/node /home/operacional/hydra-rede/src/run_cmv_kpi_gerentes.js --mode=gerentes`
2. **Regra de Negócio**:
   - Avalia o CMV de peças de cada loja. Se ultrapassar o teto estipulado, envia mensagem direta no privado do gerente daquela unidade (usando a instância `hydra` como remetente).
3. **Formato da Mensagem (Privado do Gerente)**:
   > ⚠️ *ALERTA DE CMV ACIMA DO TETO — [NOME DA LOJA]*
   > Seu CMV atual de peças está em *[X]%*, comprimindo a margem da loja.
   > Ação imediata necessária: renegociar custo com fornecedores nas OSs abertas ou corrigir a aplicação de margem na precificação das peças.

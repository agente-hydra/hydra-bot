# SKILL: Orquestrador Resiliente Rede (Coleta, Auditoria e Disparo)
## Contexto Operacional
Você é o agente responsável pelo Pilar Financeiro (Adquirente Rede) das 10 lojas.
- **Diretório Base**: `/home/operacional/hydra-rede/`
- **Binário Python Obrigatório**: `/home/operacional/.venv-invisible/bin/python` (NUNCA use o Python global).
- **Catálogo de 10 ECs**: Piraporinha (47712201), Planalto (63304449), Rudge (71854878), Mauá (63034336), Kennedy (76347036), Santo André (101422997), RM (101423667), JAB (104112840), DP (102553424), JB (101423446).
- **Regra de Segurança Crítica**: Proibido usar números de gerentes. Remetente exclusivo: instância `hydra`.

## Fase 1: Coleta e Auto-Healing (05:00 AM / 06:00 AM)
1. **Verificação de Sessão**:
   Execute:
   `node -e "const { InvisibleBridgeClient } = require('./src/invisible_bridge_client'); (async () => { const c = new InvisibleBridgeClient(); await c.start(); console.log(await c.checkSession()); await c.close(); })();"`
2. **Limpeza Preventiva (Se a sessão travar ou der erro de porta 49222)**:
   Se houver erro de conexão no daemon TCP (127.0.0.1:49222) ou lock zumbi, execute:
   `pkill -f rede_invisible_worker.py 2>/dev/null || true`
   `rm -f /home/operacional/hydra-rede/.rede_firefox_profile/rede_invisible_worker.lock`
3. **Execução da Coleta**:
   Dispare a coleta das 10 lojas na fila S3 (`/api/fl2/prd/v1/downloads/queue`):
   `/home/operacional/.venv-invisible/bin/python src/invisible/homologated_contingency_collector.py --mode=full --date=$(date -d "yesterday" +%Y-%m-%d) --output-dir=/home/operacional/hydra-data/downloads/`
4. **Validação de Integridade (Golden Gate)**:
   Liste `/home/operacional/hydra-data/downloads/` e confirme se existem exatamente os 10 arquivos `.xlsx` referentes aos 10 ECs da data alvo com tamanho > 0 bytes. Se faltar alguma loja, rode novamente o coletor filtrando ou forçando a recuperação antes das 07:00 AM.

## Fase 2: Consolidação e Selo de Auditoria (07:00 AM)
1. **Processamento Contábil**:
   Execute:
   `/usr/bin/node src/index.js --audit-only --build-only --now --data=$(date -d "yesterday" +%Y-%m-%d)`
2. **Checagem de Saída (07:45 AM)**:
   - Verifique se a planilha consolidada `/home/operacional/hydra-data/output/Juros Rede - DD-MM-AAAA.xlsx` foi gerada (regra: 1x a 10x = 0% juros; 11x a 18x = juros regressivo).
   - Verifique se o selo `/home/operacional/hydra-data/locks/rede_audit_passed_DD-MM-AAAA.json` existe e está aprovado.
   - Se o selo não existir, releia os logs em `/home/operacional/hydra-data/logs/`, reexecute o `excel_processor.js` e o `audit_rede_pre_dispatch.js` até que o selo seja emitido.

## Fase 3: Disparo Matinal (08:00 AM)
1. **Trava Gatekeeper**: Só execute o envio se o arquivo `rede_audit_passed_DD-MM-AAAA.json` estiver presente e válido.
2. **Disparo**:
   `/usr/bin/node src/index.js --send-only --now --data=$(date -d "yesterday" +%Y-%m-%d)`
3. **Destinatários e Entregáveis**:
   - **Financeiro (+55 11 94066-7032)**: 5 relatórios (Planilha consolidada `Juros Rede`, analíticos por bandeira, extrato de taxas e fechamento por loja) via instância `hydra`.
   - **Davi**: Planilha de Conciliação Pátio x Rede (cruzamento de cada cartão com a OS da oficina) via instância `hydra`.

## Template da Mensagem de Envio (08:00 AM - Financeiro & Davi)
> 📊 *FECHAMENTO REDE & CONCILIAÇÃO — [DD/MM/AAAA]*
> ✅ *Status Auditoria:* 10/10 Lojas validadas (Selo OK)
> 💳 *Regra Aplicada:* 1x a 10x Isento (0,0%) | 11x a 18x Com Juros
> 📎 *Anexos Financeiro:* Consolidado Juros Rede, Analíticos por Bandeira, Extrato de Taxas e Fechamento por Loja.
> 📎 *Anexo Davi:* Conciliação Transações Cartão x OS Pátio.

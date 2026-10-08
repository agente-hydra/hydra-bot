# Plano de Implementação: Reutilização de Dados do Hydra Bot para Conciliação de Pátio

**Spec ID:** `hydra-patio-bot-bridge`  
**Data:** 07/10/2026

---

## Tasks

- [x] **[ADAPTER]** Criar `projects/hydra-rede/src/patio_hydra_bot_adapter.js`
  - Implementar parser dos arquivos `os_store_<slug>.json` (ou SQLite).
  - Implementar tabela de equivalência dos slugs das 10 lojas operacionais com descarte estrito de `MPMaster`.
  - Capturar timestamp de última atualização de cada arquivo para exibição no relatório.

- [x] **[FILTERS]** Implementar regras de filtragem e normalização de OS
  - Filtrar estritamente `tipo === 'OS'` (descartar `OR`).
  - Converter `data_inicio` para formato `DD/MM/YYYY` sem número serial.
  - Normalizar `restanteERP = valor_restante` e `valorTotal = total_os`.
  - Formatar composição de pagamentos a partir do array `pagamentos` (forma, parcelas e valor).

- [x] **[SYNC]** Implementar sincronização silenciosa VPS $\rightarrow$ Local
  - Função no adaptador para baixar os arquivos `os_store_*.json` da VPS (`/home/operacional/hydra-data/crawls/`) para `projects/hydra-rede/data/bot-crawls/` via SSH/SCP caso a máquina local não tenha os dados do dia.

- [x] **[RUNNER]** Integrar adaptador no orquestrador `run_patio_daily.js`
  - Conectar o adaptador em `fetchStoreOSData` priorizando o consumo de dados do Hydra Bot.
  - Adicionar flag `--source=bot` (modo padrão).
  - Incluir no payload do WhatsApp o timestamp da extração e a nota informativa de validação solicitada pelo usuário.

- [x] **[TEST & BUILD]** Gerar planilha de validação e verificar integridade
  - Rodar `node src/run_patio_daily.js --immediate --target=dev` para gerar `CONCILIACAO_PATIO_0710.xlsx`.
  - Verificar células: `OS:`, `Data Entrada:`, `Valor:`, `PAGAMENTOS:` e subtotais por loja.

- [x] **[DISPATCH]** Disparar planilha e mensagem para usuário e financeiro
  - Enviar arquivo Excel gerado via Evolution API.
  - Disparar texto explicativo contendo a data e hora dos dados e o disclaimer de relatório preliminar de validação.

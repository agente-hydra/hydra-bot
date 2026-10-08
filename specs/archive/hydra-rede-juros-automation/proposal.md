# Proposal — Automação Diária do Relatório de Juros Rede com Envio WhatsApp

**Spec ID:** `hydra-rede-juros-automation`  
**Data:** 06/10/2026  
**Origem:** `C:\Users\User\Downloads\hydra-rede-main.zip`  
**Destino do Projeto:** `C:\Users\User\Desktop\agy\projects\hydra-rede`  
**Template Excel Base:** `C:\Users\User\Desktop\conciliacao\08-26\06-08\JUROS REDE (1).xlsx`  
**Destinatário Teste WhatsApp:** `5511996242812` (Davi)  
**Status:** PROPOSTA FORMALIZADA (Aguardando `/vibe-apply hydra-rede-juros-automation`)

---

## 1. Contexto e Problema de Negócio

A operação do grupo necessita de conciliação diária das taxas de juros e parcelamento praticadas pela adquirente **Rede (Meu Rede)** em todas as suas 10 lojas (ECs). 

Atualmente:
1. O repositório contido em `C:\Users\User\Downloads\hydra-rede-main.zip` possui um crawler em Playwright (`scraper.js`) capaz de autenticar no portal `meu.userede.com.br`, iterar sobre os 10 estabelecimentos, solicitar downloads assíncronos da fila S3 da Rede (`/api/fl2/prd/v1/downloads/queue`) e preencher uma planilha Excel local.
2. **Defeito Crítico de Regra de Negócio no Script Original:**  
   O script original baixa um arquivo de exportação de 7 dias e **não aplica filtro de data** sobre as linhas extraídas (linhas 353–383 de `scraper.js`). Ele agrega indiscriminadamente todas as vendas da exportação de 7 dias no resumo de cada loja.
3. **Caminho Hardcoded Quebrado:**  
   O script original aponta para um caminho inexistente na máquina atual (`C:\Users\MKT\Downloads\JUROS REDE.xlsx`). O arquivo canônico real com fórmulas preservadas está em `C:\Users\User\Desktop\conciliacao\08-26\06-08\JUROS REDE (1).xlsx`.
4. **Ausência de Entrega:**  
   Não há integração no script para envio automático do arquivo gerado para os gestores via WhatsApp.
5. **Horário de Execução:**  
   A rotina precisa rodar autonomamente no Windows às **06:00 da manhã**, com regra dinâmica de janelas de datas de conciliação.

---

## 2. Regras de Negócio e Janela Temporal

O relatório deve rodar diariamente às **06:00**:

| Dia de Execução | Janela de Extração | Justificativa |
|---|---|---|
| **Terça-feira** | D-1 estrito (Segunda-feira) | Vendas do dia útil anterior. |
| **Quarta-feira** | D-1 estrito (Terça-feira) | Vendas do dia útil anterior. |
| **Quinta-feira** | D-1 estrito (Quarta-feira) | Vendas do dia útil anterior. |
| **Sexta-feira** | D-1 estrito (Quinta-feira) | Vendas do dia útil anterior. |
| **Segunda-feira** | D-3 a D-1 (Sexta, Sábado e Domingo) | Acumulado integral do fim de semana. |
| **Sábado / Domingo** | Opcional / Standby (ou D-1) | Geralmente consolidado na Segunda-feira. |

### Caso de Teste Imediato (Hoje — Terça-feira, 06/10/2026):
- A execução de teste E2E deve extrair **estritamente as vendas de ontem: Segunda-feira, 05/10/2026**.
- Parâmetro CLI de sobreposição explícita: `--data 2026-10-05` ou resolução automática de D-1 em dia de terça-feira.

---

## 3. Preservação de Fórmulas no Excel

O arquivo `JUROS REDE.xlsx` possui colunas operacionais e colunas analíticas com fórmulas pré-configuradas:
- **Colunas preenchidas pelo scraper (valores brutos):**  
  - Bloco Débito: colunas `B`, `C`, `D`, `E` (Qtde, Valor Bruto, Taxa, Valor Líquido)
  - Bloco Crédito À Vista: colunas `I`, `J`, `K`, `L`
  - Bloco Crédito Parcelado: colunas `P`, `Q`, `R`, `S`
- **Colunas com fórmulas existentes (NÃO PODEM SER SOBRESCRITAS):**  
  - Colunas `F`, `G` (Totais e % Débito)
  - Colunas `M`, `N` (Totais e % Crédito À Vista)
  - Colunas `T`, `U` (Totais e % Parcelado)
  - Linhas de Total Geral e consolidação no rodapé.
- **Garantia Técnica:** Utilização da biblioteca `xlsx` com leitura em modo `{ cellStyles: true, cellNF: true, cellFormula: true }`, limpando e escrevendo estritamente os intervalos de células de dados brutos por loja, sem tocar nas células que contêm o atributo `.f` (fórmulas).

---

## 4. Integração com Evolution API (WhatsApp Hydra)

Reutilização integral da infraestrutura ativa do Hydra documentada na memória de infraestrutura (`infra.md`):
- **Base URL:** `https://evo.tork.services`
- **Instância:** `hydra`
- **API Key:** `TorkEvoApiKey2026Secure!`
- **Endpoint:** `POST /message/sendMedia/hydra`
- **Destino do Teste:** `5511996242812` (Davi)
- **Formato:** Arquivo em base64 com mimetype `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, nome canônico `JUROS REDE - YYYY-MM-DD.xlsx` e legenda com resumo executivo da extração.

---

## 5. Arquitetura de Execução Local Autônoma

1. **Instalação e Isolamento:**  
   O projeto será instalado em `C:\Users\User\Desktop\agy\projects\hydra-rede`, mantendo suas dependências (`playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`, `xlsx`, `dotenv`, `axios`).
2. **Execução Headless:**  
   Playwright configurado com `headless: true`, timeout de fila assíncrona do S3 ajustado com retry determinístico e anti-captcha stealth.
3. **Agendamento Windows (Task Scheduler):**  
   Criação de tarefa no Agendador de Tarefas do Windows chamada `Hydra-Rede-Juros-Diario`:
   - Gatilho: Diariamente às 06:00 AM.
   - Ação: Executar `C:\Users\User\Desktop\agy\projects\hydra-rede\run_juros_rede.bat`.
   - Redirecionamento de logs estruturados para `logs/juros_rede_YYYYMMDD.log`.
   - Em caso de falha de extração ou indisponibilidade do Meu Rede, envio imediato de mensagem de alerta no WhatsApp com o diagnóstico.

---

## 6. Critérios de Sucesso (DoD)

1. [x] Proposta e design aprovados via `/vibe-apply hydra-rede-juros-automation`.
2. [ ] Projeto estruturado e dependências instaladas em `projects/hydra-rede`.
3. [ ] Filtro estrito de datas implementado: Terça a Sexta puxa D-1; Segunda puxa Sexta a Domingo.
4. [ ] Template canônico `JUROS REDE (1).xlsx` copiado e fórmulas 100% preservadas.
5. [ ] Módulo de entrega Evolution API integrado e testado.
6. [ ] Execução E2E com data de ontem (05/10/2026) concluída com sucesso.
7. [ ] Planilha entregue no WhatsApp `5511996242812` com legenda explicativa.
8. [ ] Script `.bat` e rotina do Task Scheduler configurados para rodar às 06:00.

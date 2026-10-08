# Design Técnico — Automação Diária do Relatório de Juros Rede

**Spec ID:** `hydra-rede-juros-automation`  
**Data:** 06/10/2026  
**Status:** ESPECIFICAÇÃO DE DESIGN TÉCNICO

---

## 1. Arquitetura Geral do Sistema

```
+-----------------------------------------------------------------------------------+
|                            AGENDADOR DE TAREFAS WINDOWS                           |
|                         (Execução Diária às 06:00 AM)                             |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                        projects/hydra-rede/run_juros_rede.bat                     |
|           Ativa Node.js -> scraper.js com captura de logs em logs/YYYY-MM-DD.log  |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------+
|                                  scraper.js                                       |
|                                                                                   |
|  1. Motor de Resolução de Datas:                                                 |
|     - Ter-Sex: D-1 (ontem)                                                        |
|     - Seg: D-3 a D-1 (Sex, Sáb, Dom)                                              |
|     - CLI Override: --data YYYY-MM-DD                                             |
|                                                                                   |
|  2. Playwright Stealth Session:                                                   |
|     - Login automático em meu.userede.com.br                                      |
|     - Loop nos 10 Estabelecimentos Comerciais (ECs / Loja Slugs)                  |
|                                                                                   |
|  3. Fila Assíncrona de Downloads S3:                                              |
|     - Solicita exportação analítica via API Meu Rede                              |
|     - Polling de status e download dos arquivos XLSX/CSV de cada EC               |
|                                                                                   |
|  4. Processamento & Filtro Linha a Linha:                                         |
|     - Inspeciona coluna de data ('Data da Venda' / 'Data da Transação')           |
|     - Descarta linhas fora da janela alvo                                         |
|     - Agrupa Débito, Crédito À Vista e Parcelado por Bandeira e Parcelas         |
|                                                                                   |
|  5. Gravação Excel com Preservação de Fórmulas:                                   |
|     - Abre template base 'JUROS REDE.xlsx' (copiado do canônico)                  |
|     - Limpa apenas células de dados brutos (B-E, I-L, P-S)                        |
|     - Escreve novos números calculados                                            |
|     - Preserva 100% das fórmulas analíticas (F, G, M, N, T, U e rodapés)          |
|     - Salva output: output/JUROS REDE - YYYY-MM-DD.xlsx                           |
|                                                                                   |
|  6. Entrega Evolution API (WhatsApp):                                             |
|     - Converte planilha gerada para Base64                                        |
|     - POST /message/sendMedia/hydra para 5511996242812                            |
|     - Emite legenda com resumo de lojas e volume conciliado                       |
+-----------------------------------------------------------------------------------+
```

---

## 2. Estrutura de Diretórios e Arquivos do Projeto

Local: `C:\Users\User\Desktop\agy\projects\hydra-rede`

```
projects/hydra-rede/
├── package.json                   # Dependências: playwright, playwright-extra, puppeteer-extra-plugin-stealth, xlsx, dotenv, axios
├── .env                           # Credenciais Meu Rede + Evolution API + Destinatários
├── .env.example                   # Template de variáveis sem segredos
├── template/
│   └── JUROS REDE.xlsx            # Cópia do template canônico com fórmulas íntegras
├── output/                        # Planilhas diárias geradas (JUROS REDE - YYYY-MM-DD.xlsx)
├── logs/                          # Logs de execução por data
├── downloads/                     # Diretório temporário para downloads brutos do S3
├── src/
│   ├── config.js                  # Carregamento de envs e validação de parâmetros
│   ├── date_resolver.js           # Lógica pura de cálculo de janelas temporais (Ter-Sex vs Seg)
│   ├── scraper.js                 # Crawler Playwright + download S3 Meu Rede
│   ├── excel_processor.js         # Filtro por data e escrita no Excel preservando fórmulas
│   ├── whatsapp_notifier.js       # Cliente HTTP Evolution API para envio de documentos
│   └── index.js                   # Orquestrador central e tratamento de erros
└── run_juros_rede.bat             # Script de inicialização silencioso para o Task Scheduler
```

---

## 3. Especificação do Algoritmo de Resolução de Datas (`date_resolver.js`)

A função deve determinar as datas a serem filtradas com base no dia da semana da execução ou permitir sobreposição manual:

```javascript
/**
 * Retorna array de strings de data no formato ['DD/MM/YYYY'] e ['YYYY-MM-DD']
 * @param {Date} [executionDate=new Date()]
 * @param {string} [cliOverride=null] - Formato YYYY-MM-DD
 * @returns {{ targetDates: string[], displayPeriod: string, mode: 'daily' | 'weekend' | 'override' }}
 */
function resolveTargetDates(executionDate = new Date(), cliOverride = null) {
  if (cliOverride) {
    // Ex: "2026-10-05" -> converte para formato comparativo
    const [year, month, day] = cliOverride.split('-');
    const formattedBR = `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    const formattedISO = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return {
      targetDatesBR: [formattedBR],
      targetDatesISO: [formattedISO],
      displayPeriod: formattedBR,
      mode: 'override'
    };
  }

  const dayOfWeek = executionDate.getDay(); // 0: Dom, 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sáb

  // Caso Segunda-feira (1): Sexta (D-3), Sábado (D-2) e Domingo (D-1)
  if (dayOfWeek === 1) {
    const dates = [];
    for (let offset = 3; offset >= 1; offset--) {
      const d = new Date(executionDate);
      d.setDate(d.getDate() - offset);
      dates.push(d);
    }
    const targetDatesBR = dates.map(d => formatDateBR(d));
    const targetDatesISO = dates.map(d => formatDateISO(d));
    return {
      targetDatesBR,
      targetDatesISO,
      displayPeriod: `${targetDatesBR[0]} a ${targetDatesBR[2]} (Fim de Semana)`,
      mode: 'weekend'
    };
  }

  // Caso Terça a Sexta (2, 3, 4, 5): Apenas D-1 (ontem)
  // Caso Sábado ou Domingo (execução manual fora de expediente): fallback para D-1
  const yesterday = new Date(executionDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateBR = formatDateBR(yesterday);
  const targetDateISO = formatDateISO(yesterday);

  return {
    targetDatesBR: [targetDateBR],
    targetDatesISO: [targetDateISO],
    displayPeriod: targetDateBR,
    mode: 'daily'
  };
}
```

---

## 4. Filtro Estrito de Linhas no Relatório Bruto da Rede (`excel_processor.js`)

Ao baixar o relatório analítico (XLSX ou CSV) da fila S3 do Meu Rede:
1. Normalizar o cabeçalho procurando pela coluna que contém a data da venda:
   - Variações conhecidas na Rede: `Data da Venda`, `Data da Transação`, `Data da Venda/Transação`, `Data`, `Data e Hora da Venda`.
2. Para cada linha de transação:
   - Extrair a data ignorando a hora (seja `DD/MM/YYYY`, `YYYY-MM-DD` ou número serial do Excel).
   - Verificar se a data da linha pertence ao array `targetDatesBR` ou `targetDatesISO`.
   - Se pertencer: processar e agregar aos contadores da loja.
   - Se NÃO pertencer: ignorar sumariamente a linha.
3. Isso corrige o bug existente onde as transações de até 7 dias eram somadas indistintamente.

---

## 5. Estratégia de Preservação de Fórmulas no Excel

O template canônico em `C:\Users\User\Desktop\conciliacao\08-26\06-08\JUROS REDE (1).xlsx` contém tabelas para 10 lojas:
1. **Leitura Segura:**
   ```javascript
   const workbook = xlsx.readFile(templatePath, {
     cellStyles: true,
     cellNF: true,
     cellFormula: true,
     cellDates: true
   });
   const sheet = workbook.Sheets['Planilha1'] || workbook.Sheets[workbook.SheetNames[0]];
   ```
2. **Atualização Cirúrgica de Células:**
   - Para cada bloco de loja mapeado por linhas (ex: linhas 5 a 15, etc.):
     - Limpar apenas o valor (`.v`) das colunas de entrada de dados: `B, C, D, E`, `I, J, K, L`, `P, Q, R, S`.
     - Escrever os novos valores brutos (`{ t: 'n', v: valor }`).
     - **Nunca tocar nas células com fórmula:** Colunas `F, G`, `M, N`, `T, U` e linhas de totais contêm fórmulas como `=SUM(...)`, `=C5*D5`, etc. Essas células permanecem intactas, preservando `.f` e os estilos visuais.
3. **Escrita:**
   - Salvar uma cópia com timestamp no diretório `output/`:
     `output/JUROS REDE - 2026-10-05.xlsx`.
   - Manter o template base intocado como fonte limpa.

---

## 6. Mapeamento das 10 Lojas (Estabelecimentos Comerciais)

O script original contém o mapeamento dos 10 ECs para as linhas correspondentes da planilha:
```javascript
const ESTABELECIMENTOS = [
  { ec: '071536750', nome: 'BARAO GERALDO',     bloco: 'BARAO' },
  { ec: '071536831', nome: 'AMOREIRAS',         bloco: 'AMOREIRAS' },
  { ec: '071536912', nome: 'TAQUARAL',          bloco: 'TAQUARAL' },
  { ec: '071537056', nome: 'JOHN BOYD',         bloco: 'JOHN BOYD' },
  { ec: '071537137', nome: 'SANTO ANDRE',       bloco: 'SANTO ANDRE' },
  { ec: '071537218', nome: 'JABAQUARA',         bloco: 'JABAQUARA' },
  { ec: '071537307', nome: 'SAO BERNARDO',      bloco: 'SAO BERNARDO' },
  { ec: '071537480', nome: 'SOROCABA IPANEMA',  bloco: 'SOROCABA IPANEMA' },
  { ec: '071537560', nome: 'SOROCABA CENTRO',   bloco: 'SOROCABA CENTRO' },
  { ec: '071537641', nome: 'PIRACICABA',        bloco: 'PIRACICABA' }
];
```
*Nota:* As linhas exatas de cada loja no template canônico serão validadas durante o teste E2E.

---

## 7. Integração Evolution API (`whatsapp_notifier.js`)

### Endpoint e Autenticação
- **URL:** `${EVO_URL}/message/sendMedia/${EVO_INSTANCE}`
  - Ex: `https://evo.tork.services/message/sendMedia/hydra`
- **Headers:**
  - `apikey`: `TorkEvoApiKey2026Secure!`
  - `Content-Type`: `application/json`

### Payload do Envio de Documento
```json
{
  "number": "5511996242812",
  "mediaMessage": {
    "mediatype": "document",
    "fileName": "JUROS REDE - 2026-10-05.xlsx",
    "caption": "📊 *Relatório Diário de Juros e Taxas — Rede*\n\n📅 *Período:* 05/10/2026\n🏢 *Lojas Processadas:* 10/10\n💰 *Total Bruto Conciliado:* R$ 142.850,20\n\n_Arquivo anexado gerado automaticamente pelo Hydra._",
    "media": "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBBQABgAIAAAAIQ..."
  }
}
```

### Tratamento de Falha / Notificação de Alerta
Se qualquer etapa crítica falhar (erro de login no portal da Rede, queda de captcha, timeout no S3, erro de leitura da planilha):
```json
{
  "number": "5511996242812",
  "textMessage": {
    "text": "⚠️ *ALERTA: Falha no Relatório de Juros Rede*\n\n📅 *Data Alvo:* 05/10/2026\n❌ *Erro:* Timeout ao baixar arquivo da loja Santo André no Meu Rede.\n⏱️ *Horário:* 06:14 AM\n\n_A intervenção manual pode ser necessária._"
  }
}
```

---

## 8. Automação no Windows (Task Scheduler & Batch)

### Arquivo `run_juros_rede.bat`
```bat
@echo off
setlocal
cd /d "C:\Users\User\Desktop\agy\projects\hydra-rede"

:: Nome do log baseado na data atual
for /f "tokens=1-3 delims=/- " %%a in ("%date%") do set TODAY=%%c-%%b-%%a
if not exist logs mkdir logs

echo [%date% %time%] Iniciando execucao do Relatorio de Juros Rede >> "logs\execucao.log"

:: Executa Node.js sem janela interativa
call node src/index.js >> "logs\juros_rede_%TODAY%.log" 2>&1

echo [%date% %time%] Finalizada execucao com status %ERRORLEVEL% >> "logs\execucao.log"
endlocal
```

### Agendamento Diário às 06:00
Comando PowerShell / CLI para criar a tarefa no Windows:
```powershell
schtasks /Create /TN "Hydra-Rede-Juros-Diario" /TR "C:\Users\User\Desktop\agy\projects\hydra-rede\run_juros_rede.bat" /SC DAILY /ST 06:00 /F /RL HIGHEST
```

---

## 9. Plano de Execução do Teste E2E (Hoje)
1. Instalar as dependências e o browser chromium no subprojeto `projects/hydra-rede`.
2. Executar manualmente com o parâmetro `--data 2026-10-05` (filtrando estritamente ontem, segunda-feira).
3. Monitorar a extração dos 10 ECs no portal Meu Rede.
4. Validar o arquivo gerado em `output/` confirmando que as fórmulas estão preservadas.
5. Disparar o envio via Evolution API para o número `5511996242812`.
6. Confirmar o recebimento no WhatsApp antes de programar o agendamento fixo das 06:00.

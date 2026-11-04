# Proposta de Arquitetura — Spec 064: Consulta Veicular Direta por Placa (APIBrasil & Cache SQLite Nativo)

**Status:** PROPOSTA DE ESPECIFICAÇÃO (Aguardando Aprovação)  
**Data:** 03/11/2026  
**Contexto:** Substituição de scraping/dependência exclusiva do ERP Oficina Inteligente para consultas de veículos por placa, integrando a API de Consulta Veicular da APIBrasil com cache atômico em SQLite.

---

## 1. Problema e Motivação

Atualmente, quando um operador ou sócio envia uma placa para o Hydra Bot (ex: `FOE6I25`, `EWB4J21` ou `quanto tempo pra trocar correia do carro placa ABC1234`), a resolução de modelo depende estritamente da existência prévia de uma Ordem de Serviço registrada na tabela `ordens_servico` sincronizada do ERP Oficina Inteligente (OI).

### Principais Dores:
1. **Carro Inédito / Novo Cliente Sem OS Aberta:** Se o veículo nunca deu entrada na rede ou ainda não teve OS cadastrada no ERP da unidade, o bot falha em identificar o modelo e devolve: `"> Aviso Operacional: Não encontrei nenhuma ordem de serviço aberta para os parâmetros informados"`.
2. **Dependência de Crawlers Pesados:** Buscar dados no portal Oficina Inteligente em tempo de execução via scraping (Playwright) é proibitivo em conversas de mensageria: demanda bypass de Cloudflare Turnstile, tem latência de 20s–45s e consome CPU desnecessariamente.
3. **Falta de Reconhecimento Automático no Tempário:** Para o módulo de Tempário Técnico (Spec 054 / 061 / 062 / 063), o bot exige saber o modelo/ano para calcular o tempo tabelado e a mão de obra a R$ 270,00/h. Se o usuário mandar só a placa de um carro novo, o tempário não tem como iniciar.
4. **Cota e Custos:** O uso de APIs veiculares comerciais requer gerenciamento rigoroso de requisições. Sem um cache persistente, perguntas repetidas sobre a mesma placa na rede esgotariam qualquer cota gratuita em minutos.

---

## 2. Solução Proposta

Implementar um microsserviço cliente desacoplado (`src/hydra-sync/apibrasil_plate_client.ts`) conectado ao Gateway da **APIBrasil** (`https://gateway.apibrasil.io/api/v2/vehicles/dados`) operando sob uma camada de **Cache Determinístico Local no SQLite** (`placa_lookup_cache`).

### Pilares da Solução:
1. **Cache-First Absoluto (Zero Desperdício de Cota):**
   - Antes de qualquer chamada externa, o bot consulta a tabela SQLite `placa_lookup_cache` e `ordens_servico`.
   - Se a placa já foi consultada alguma vez na rede, o retorno é instantâneo (**< 2ms**) diretamente do SQLite WAL local.
2. **Cliente HTTP Nativo com Timeout e Headers Homologados:**
   - Consome `/api/v2/vehicles/dados` via `fetch` nativo (Node 22+) com timeout de 3.500ms.
   - Cabeçalhos: `Authorization: Bearer <APIBRASIL_BEARER_TOKEN>` e `DeviceToken: <APIBRASIL_DEVICE_TOKEN>`.
   - Normalização rigorosa da placa: conversão de padrão antigo (`ABC1234`) e Mercosul (`ABC1D23`) para formato limpo alfanumérico em maiúsculas sem traços.
3. **Resolução Transparente no Tempário Técnico Híbrido:**
   - Em `resolveVehicleFromPlateOrOs`, caso a placa não pertença a nenhuma OS do pátio, a função invoca a resolução via APIBrasil e obtém marca, modelo, ano de fabricação, ano do modelo e motor.
   - O tempário recebe o modelo estruturado (ex: `Volkswagen Golf 1.4 TSI 2015`) e prossegue direto para o Fast-Path executivo.
4. **Comando Direto de Consulta Cadastral (Card Hermes V2):**
   - Usuário digita `"placa FOE6I25"` ou `"consulta placa EWB4J21"`:
   - O bot responde com um card visual de alta legibilidade trazendo dados da base nacional:
     - Marca / Modelo / Versão comercial
     - Ano Fabricação / Ano Modelo
     - Cor e Tipo de Combustível
     - Cilindradas e Potência
     - Município e UF de emplacamento
     - Status de circulação / Situação cadastral

---

## 3. Contrato de Dados & Schema SQLite

### Tabela: `placa_lookup_cache`
```sql
CREATE TABLE IF NOT EXISTS placa_lookup_cache (
  placa_limpa TEXT PRIMARY KEY,
  placa_formatada TEXT NOT NULL,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  submodelo TEXT,
  versao TEXT,
  ano_fabricacao INTEGER,
  ano_modelo INTEGER,
  cor TEXT,
  combustivel TEXT,
  motor TEXT,
  cilindrada INTEGER,
  potencia INTEGER,
  chassi_mascarado TEXT,
  municipio TEXT,
  uf TEXT,
  segmento TEXT DEFAULT 'AUTO',
  situacao TEXT DEFAULT 'CIRCULACAO',
  origem_dados TEXT NOT NULL CHECK (origem_dados IN ('APIBRASIL', 'ORDENS_SERVICO_REDE', 'MANUAL')),
  raw_payload_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_placa_lookup_modelo ON placa_lookup_cache(modelo);
```

---

## 4. Análise de Riscos e Mitigações

| Risco Identificado | Severidade | Estratégia de Mitigação |
| :--- | :---: | :--- |
| **Cota Gratuita da APIBrasil Esgotada** | Média | Tabela `placa_lookup_cache` garante que cada placa só seja consumida 1 vez. Se a API responder HTTP 403/429 ou erro de saldo, o bot cai suavemente avisando que a consulta externa atingiu a cota diária sem quebrar o fluxo. |
| **Credenciais / "Plano Ativo Não Encontrado"** | Média | Verificação preventiva do status da resposta; isolamento em variáveis de ambiente (`APIBRASIL_BEARER_TOKEN` e `APIBRASIL_DEVICE_TOKEN`) com validação de formato e logs de diagnóstico silenciosos. |
| **Latência de Rede na Chamada Externa** | Baixa | Timeout estrito de 3.500ms via `AbortController`. Se a APIBrasil demorar ou oscilar, aborta sem travar o worker do WhatsApp. |
| **Placa Inexistente ou Erro de Digitação** | Baixa | Validação sintática por Regex (`^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$`) antes de disparar HTTP, poupando requisições contra strings inválidas. |

---

## 5. Próximos Passos
1. Análise do design técnico detalhado em `design.md`.
2. Aprovação do plano de execução em `spec-plan.md`.
3. Início da implementação através do comando `/vibe-apply 064`.

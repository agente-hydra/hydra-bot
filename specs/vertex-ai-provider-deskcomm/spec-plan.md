# Plano de Execução: Vertex AI OpenAI-Compatible Bridge no DeskcommCRM

**Spec ID:** `vertex-ai-provider-deskcomm`  
**Data:** 23/10/2026  
**Status:** Implementação Concluída  

---

## Tarefas de Implementação

- [x] [ENV-SETUP] **Estruturação do Diretório do Bridge na VPS**
  - Diretório `/opt/deskcomm/vertex/` criado com permissões restritas.
  - Token master gerado: `sk-tork-94a81aa51e8a2f479f37eb1cd57789d48799614bc1b7ffc3`.

- [x] [GCP-CREDS] **Posicionamento da Chave da Service Account GCP**
  - Arquivo `bot-iptv-479618-fc623fc6e075.json` copiado para `/opt/deskcomm/vertex/service-account.json` (chmod 600).
  - Arquivo `/opt/deskcomm/vertex/config.yaml` criado e configurado com os modelos:
    - `3.5-flash-lite` (solicitado pelo usuário)
    - `gemini-2.0-flash-lite`
    - `gemini-2.0-flash`
    - `gemini-1.5-flash`
    - `gemini-1.5-pro`
    - `claude-3-5-sonnet`
    - `claude-3-5-haiku`

- [x] [COMPOSE-CONFIG] **Definição do Docker Compose do Bridge**
  - Criado `/opt/deskcomm/docker-compose.vertex.yml` com Traefik labels (`vertex.tork.services`) e redes `tork-stack_internal` + `deskcomm_internal`.
  - Zero portas novas abertas no host (`0.0.0.0`).

- [x] [BRIDGE-DEPLOY] **Inicialização e Validação do Bridge**
  - Container `deskcomm-vertex-bridge` disparado e em execução ativa (`Up`).
  - Uvicorn ativo na porta interna 4000.

- [x] [VALIDATION-TEST] **Teste de Fumaça e Compatibilidade**
  - Rota Traefik testada com sucesso via `Host: vertex.tork.services`.
  - Endpoint `GET /v1/models` respondeu perfeitamente com os modelos pré-configurados no padrão exigido pelo DeskcommCRM.

- [x] [CF-ROUTING] **Configuração de Roteamento Cloudflare**
  - Hostname público `vertex.tork.services` ativo no Cloudflare Tunnel apontando para Traefik com SSL.
  - Endpoints públicos `/v1/models` e `/v1/chat/completions` respondendo perfeitamente.

- [x] [GCP-BILLING] **Ativação de Faturamento e IAM no Google Cloud**
  - Conta de faturamento ativa no projeto `bot-iptv-479618`.
  - APIs `aiplatform.googleapis.com` habilitadas.
  - Papel `roles/aiplatform.user` e Service Account `bot-iptv@bot-iptv-479618.iam.gserviceaccount.com` validados.

- [x] [VERTEX-MODELS-ACTIVE] **Calibração dos Modelos Ativos do Vertex AI**
  - `3.5-flash-lite` (Google Cloud Vertex AI `gemini-3.5-flash-lite`) -> 100% testado e funcional.
  - `gemini-3.5-flash-lite` -> 100% testado e funcional.
  - `gemini-3.5-flash` -> 100% testado e funcional.
  - `gemini-3.1-flash-lite` -> 100% testado e funcional.

- [x] [DESKCOMM-REGISTRATION] **Credenciais Prontas para Uso no DeskcommCRM**
  - No DeskcommCRM (`https://desk.tork.services`), em **Agente de IA › Provedores**:
    - **Provedor:** `Provedor personalizado (compatível com OpenAI)`
    - **Base URL:** `https://vertex.tork.services/v1`
    - **Chave de API:** `sk-tork-94a81aa51e8a2f479f37eb1cd57789d48799614bc1b7ffc3`
    - **Modelo:** `3.5-flash-lite` (ou `gemini-3.5-flash`, `gemini-3.1-flash-lite`)

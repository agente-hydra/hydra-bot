# Proposta de Arquitetura: Integração do Google Cloud Vertex AI no DeskcommCRM via Bridge OpenAI-Compatível

**Spec ID:** `vertex-ai-provider-deskcomm`  
**Data:** 22/10/2026  
**Status:** Planejamento (SDD Proposal)  

---

## 1. Contexto e Problema

O usuário deseja utilizar o **Google Cloud Vertex AI** (para rodar modelos como Gemini 2.0 Flash, Gemini 1.5 Pro e Claude no Vertex) como provedor de IA no DeskcommCRM.

Ao tentar cadastrar o Vertex AI diretamente no DeskcommCRM, o sistema não aceita pelos seguintes motivos técnicos identificados no código-fonte (`lib/ai/`):

1. **Incompatibilidade de Protocolo e Autenticação:**
   - O provedor nativo `google` do Deskcomm (`lib/ai/pontos/provedores.ts`) foi desenhado exclusivamente para o **Google AI Studio** (usando chaves estáticas `AIza...` na URL pública `generativelanguage.googleapis.com`).
   - O **Google Cloud Vertex AI** corporativo não usa chaves estáticas simples: exige autenticação via **Service Account IAM** com emissão de tokens OAuth2 efêmeros (Bearer tokens com expiração de 3600s), assinados via chave privada RSA, além de headers específicos de projeto e localização regional (`{region}-aiplatform.googleapis.com`).
2. **Incompatibilidade do Provedor Customizado:**
   - O DeskcommCRM possui a opção **"Provedor personalizado (compatível com OpenAI)"** (`id: custom`), mas ele espera estritamente o protocolo da OpenAI:
     - Validação obrigatória via `GET {base_url}/models` com header `Authorization: Bearer <key>` (`lib/ai/provider-validators.ts:354`).
     - Execução via `POST {base_url}/chat/completions` com streaming e ferramentas no padrão OpenAI SDK.
     - O endpoint nativo do Vertex AI não fornece o endpoint `GET /models` no formato esperado sem parâmetros e headers especiais da GCP.
3. **Barreira de Segurança SSRF (`motivoDaRecusaDeDestino`):**
   - O Deskcomm rejeita URLs apontando para endereços de loopback ou IPs privados da rede interna (`127.0.0.1`, `localhost`, `10.0.0.0/8`, `192.168.0.0/16`) se cadastradas via organização, impedindo colocar um IP cru local sem roteamento adequado.

---

## 2. Solução Proposta

Implementar uma **ponte transparente de alta performance (Vertex AI Bridge)** baseada no padrão **LiteLLM Proxy** (ou micro-serviço Node/Go dedicado) rodando como container isolado na VPS, integrado ao Traefik:

```
┌────────────────────────────────────────────────────────┐
│ VPS (100.126.50.101)                                   │
│                                                        │
│  [DeskcommCRM Next.js]                                 │
│        │                                               │
│        ▼ (Protocolo OpenAI: /v1/chat/completions)      │
│  [LiteLLM Vertex Bridge Container]                    │
│   - Autentica com Service Account JSON da GCP          │
│   - Renova tokens OAuth2 a cada 50 minutos             │
│   - Mapeia gemini-2.0-flash, gemini-1.5-pro, etc.      │
│        │                                               │
└────────┼───────────────────────────────────────────────┘
         │ (HTTPS gRPC/REST)
         ▼
┌────────────────────────────────────────────────────────┐
│ Google Cloud Platform (GCP)                            │
│  - Vertex AI API (us-central1 ou sa-east-1)            │
│  - Gemini 2.0 Flash / Gemini 1.5 Pro                   │
└────────────────────────────────────────────────────────┘
```

### Por que esta é a melhor solução:
- **Zero invasão no código do DeskcommCRM:** Não é necessário alterar arquivos do core nem criar forks do repositório upstream oficial. Atualizações via `git pull` continuarão funcionando normalmente.
- **Uso do recurso nativo do Deskcomm:** O DeskcommCRM já possui suporte de primeira classe ao provedor `custom` ("Provedor personalizado compatível com OpenAI"). Ele apenas apontará para a URL do Bridge (`https://vertex.tork.services/v1` ou roteamento Traefik).
- **Renovação automática de tokens:** O bridge cuida de todo o ciclo de vida dos tokens OAuth2 da Google Cloud Service Account em background.
- **Suporte a Model Garden completo:** Permite usar não só o Gemini, mas também Claude 3.5 Sonnet hospedado no Vertex AI da GCP, Llama 3, etc.

---

## 3. Contratos de Dados e Configuração

### A. Credenciais da GCP (Service Account)
O usuário fornece a chave de Service Account JSON com o papel `Vertex AI User` (`roles/aiplatform.user`):
```json
{
  "type": "service_account",
  "project_id": "seu-projeto-gcp",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "deskcomm-vertex@seu-projeto-gcp.iam.gserviceaccount.com"
}
```

### B. Mapeamento de Modelos no Bridge (`config.yaml`)
```yaml
model_list:
  - model_name: gemini-2.0-flash
    litellm_params:
      model: vertex_ai/gemini-2.0-flash
      vertex_project: "seu-projeto-gcp"
      vertex_location: "us-central1"
  - model_name: gemini-1.5-pro
    litellm_params:
      model: vertex_ai/gemini-1.5-pro
      vertex_project: "seu-projeto-gcp"
      vertex_location: "us-central1"
  - model_name: gemini-1.5-flash
    litellm_params:
      model: vertex_ai/gemini-1.5-flash
      vertex_project: "seu-projeto-gcp"
      vertex_location: "us-central1"

general_settings:
  master_key: "sk-tork-vertex-..."
```

### C. Cadastro no DeskcommCRM (Interface Web):
- **Provedor:** `Provedor personalizado (compatível com OpenAI)`
- **Endereço (Base URL):** `https://vertex.tork.services/v1`
- **Chave de API:** `sk-tork-vertex-...`
- **Modelos retornados automaticamente via `/models`:** `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`.

---

## 4. Análise de Riscos e Mitigações

| Risco | Severidade | Mitigação |
| :--- | :---: | :--- |
| **Consumo de Memória na VPS** | Baixa | LiteLLM consome ~80-120 MB de RAM. A VPS possui atualmente 3.8 GiB disponíveis. |
| **Segurança da Chave da Service Account** | Alta | O arquivo JSON da Service Account fica montado como somente leitura (`:ro`) com permissão `600` no host em `/opt/deskcomm/vertex-key.json`, fora do repositório git. |
| **Acesso Externo Não Autorizado** | Média | O Bridge exige Bearer token master (`master_key`) em todas as rotas; se exposto via Traefik, pode ter allowlist de IP ou ser restrito à rede Docker interna. |

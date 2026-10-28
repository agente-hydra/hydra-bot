# Plano de Execução: Implantação Isolada do DeskcommCRM na VPS

**Spec ID:** `deploy-deskcomm-crm-isolated-vps`  
**Data:** 22/10/2026  
**Status:** Concluído (Pronto para SDD Archive)  

---

## Tarefas de Implementação

- [x] [ENV-PREP] **Estruturação do Diretório Isolado na VPS**
  - Criado `/opt/deskcomm/` com subpastas `data/waha-sessions` e `data/redis`.
  - Definidas permissões para o usuário `operacional:operacional`.
  - Repositório oficial `melgarafael/DeskcommCRM` clonado na pasta `/opt/deskcomm/`.

- [x] [SUPABASE-SETUP] **Provisionamento e Validação do Banco Supabase**
  - Projeto Supabase dedicado `deskcomm-crm` provisionado na região `sa-east-1` (Ref: `iuqgpgtaxmvjanpbqzjj`).
  - Extensões `vector`, `citext` e `pg_trgm` habilitadas.
  - Baseline completo (`baseline.sql`) aplicado com sucesso (203 tabelas criadas).
  - Testada conectividade IPv4 Supavisor pooler (`aws-1-sa-east-1.pooler.supabase.com:5432`).
  - Configurado `site_url` e `uri_allow_list` para `https://desk.tork.services/**`.

- [x] [DOCKER-CONFIG] **Montagem do Docker Compose Isolado & Traefik Override**
  - Configurado `/opt/deskcomm/docker-compose.traefik-vps.yml` conectando o `app` à rede externa `tork-stack_internal`.
  - Desativado o serviço `caddy` através de profile (`caddy-nao-usado-com-proxy-externo`) para impedir colisão com as portas `80` e `443`.
  - Injetadas labels do Traefik para o domínio `desk.tork.services`.
  - Garantido que `waha`, `worker`, `redis`, `srh` e `scheduler` fiquem restritos exclusivamente à rede interna `deskcomm_internal`, sem publicação de portas no host.

- [x] [ENV-SECRETS] **Parametrização do `.env` do Deskcomm**
  - Configurado `DOMAIN=desk.tork.services`, `REVERSE_PROXY=traefik` e `TRAEFIK_NETWORK=tork-stack_internal`.
  - Configurado `NEXT_PUBLIC_APP_URL=https://desk.tork.services` e `NEXT_PUBLIC_ADMIN_URL=https://desk.tork.services`.
  - Segredos criptográficos gerados com alta entropia (`INTERNAL_SECRET`, `CPF_ENCRYPTION_KEY`, `AI_CRED_AES_KEY`, `WAHA_BYO_ENCRYPTION_KEY`, `IMPERSONATE_COOKIE_SECRET`, `LGPD_SIGNING_KEY`).
  - Tokens de integração configurados (`WAHA_API_KEY`, `WAHA_API_KEY_SHA512`, `WAHA_HMAC_SECRET`, `UPSTASH_REDIS_REST_TOKEN`, `SRH_TOKEN`).
  - Conexão com Supabase via Supavisor pooler IPv4 autenticada com sucesso.

- [x] [INGRESS-ROUTING] **Configuração de Roteamento de Domínio (Cloudflare / Traefik)**
  - Labels Traefik injetadas em `docker-compose.traefik-vps.yml` vinculando a rota `desk.tork.services` na rede `tork-stack_internal`.
  - Middleware de segurança com bloqueio estrito em `/api/v1/webhooks/waha` para evitar chamadas de webhook externas.
  - Headers `X-Forwarded-Proto=https` configurados para evitar loops de redirecionamento atrás do Cloudflare.

- [x] [CONTAINER-DEPLOY] **Disparo e Verificação dos Containers**
  - Imagens oficiais baixadas e iniciados os 6 containers (`deskcomm-app-1`, `deskcomm-worker-1`, `deskcomm-waha-1`, `deskcomm-redis-1`, `deskcomm-srh-1`, `deskcomm-scheduler-1`).
  - Todos os containers em execução com status `healthy`.

- [x] [SECURITY-AUDIT] **Auditoria de Conflito Zero & Integridade da VPS**
  - Confirmado via `ss -tulpn` que zero novas portas foram abertas em `0.0.0.0` ou no host.
  - Testados e validados endpoints dos serviços legados intactos:
    - Chatwoot: HTTP 200 OK
    - Evolution API: HTTP 200 OK
    - Hydra Bot: Webhook porta 3333 HTTP 200 OK
    - Watchdog: Gateway porta 4100 HTTP 404 OK (ativo)
  - Testado acesso HTTP 200 OK ao DeskcommCRM via Traefik (`Host: desk.tork.services`).
  - Testado bloqueio de segurança HTTP 403 Forbidden para chamadas externas em `/api/v1/webhooks/waha`.

# Original User Request

## 2026-10-06T16:43:17Z

This is a single self-contained fix; keep it small and focused.

Implementar na stack do Hydra Bot (/home/operacional/hydra-staging/ e /opt/bots/) o detalhamento profundo de Ordens de Serviço a partir do raw_payload armazenado no SQLite (hydra_ops.db), expondo serviços discriminados, peças, parcelas de pagamento, executores e documentos via nova ferramenta MCP get_os_details, além de blindar consultas de gerentes de loja para que nunca vazem dados de outras unidades da rede.

Working directory: /home/operacional/hydra-staging

## Requirements

### R1. Ferramenta MCP de Detalhamento Profundo (get_os_details)
O servidor MCP hydra-ops (src/hydra-sync/mcp_server.ts) e o repositório de dados (src/hydra-sync/db_repository.ts) devem disponibilizar a ferramenta get_os_details({ os_id, loja_slug? }). A ferramenta deve realizar o parse completo do campo ordens_servico.raw_payload e retornar:
- Serviços discriminados (código, descrição, quantidade, valor total, executor/mecânico);
- Peças e produtos discriminados com valores;
- Formas de pagamento detalhadas por parcela (número da parcela, data de vencimento, modalidade como Crédito/PIX/Débito/Boleto, valor e status de envio financeiro);
- Documentos anexos, notas fiscais e checklists operacionais.

### R2. Enriquecimento da Busca de OSs (hybrid_retrieval.ts)
A função retrieveOperationalData deve selecionar raw_payload quando uma OS individual ou veículo for consultado, garantindo que o adaptador operacional e a IA tenham acesso aos itens e financeiro completo da OS sem retornar mensagens de "detalhamento não disponível".

### R3. Isolamento Estrito de Loja para Persona Gerente (Zero Vazamento)
Quando o operador estiver no perfil /perfil como gerente de uma unidade (ex: MPJabaquara), qualquer consulta de veículo, ordem de serviço ou pátio sem loja explícita deve ser ancorada compulsoriamente na loja do gerente. O resolvedor de veículos (formatVehicleSituation) e o prompt da IA não devem pesquisar nem apresentar veículos pertencentes a outras lojas da rede para gerentes.

### R4. Eliminação de Respostas Repetitivas
Quando o operador solicitar aspectos específicos de uma ordem em andamento ("quais os serviços?", "formas de pagamento", "documentos"), o bot deve responder diretamente a esse aspecto com os dados reais do raw_payload, em vez de ecoar o card cadastral genérico de 5 linhas.

## Acceptance Criteria

### Integridade e Profundidade de Dados
- [ ] Para a OS #439 da unidade MPJabaquara, a consulta deve retornar as 10 parcelas no Cartão de Crédito (R$ 881,85 cada) e os 4 serviços discriminados executados por João (Remoção de câmbio R$ 1.800, Diagnóstico Premium R$ 520, Reprogramação R$ 490, Robótica R$ 890).
- [ ] O bot nunca deve afirmar que "formas de pagamento não constam no registro" quando a OS possuir parcelas salvas no raw_payload.

### Isolamento de Gerente
- [ ] Estando no perfil de Gerente de Jabaquara, ao enviar "fale sobre o linea", o bot deve localizar diretamente o Linea de Jabaquara (FQD1582 / OS #439), sem listar ou mencionar o Linea de Santo André (EUO4H07 / OS #2461).

### Build e Telemetria
- [ ] npm run typecheck:hydra executado no staging deve passar com zero erros de TypeScript.
- [ ] Resposta entregue no WhatsApp em linguagem natural, formatada sem tabelas markdown incompatíveis com mobile.

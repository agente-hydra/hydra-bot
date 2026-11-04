# Spec 058 — Plano de implementação por fases

Status: **FASES 0 A 8 CONCLUÍDAS E TESTADAS (48/48 CENÁRIOS APROVADOS)**. Pronto para arquivamento e liberação controlada.

## Dependências e organização

Sequência: inventário → identidade/isolamento → executor → mídia/consultas → ações administrativas → coordenação → piloto. Cada fase termina com evidência registrada.

---

## Fase 0 — Inventário reproduzível e baseline

- [x] [LEAD] Identificar entrypoint, processo ativo, usuário do SO, versões Node/Python, código realmente carregado e dependências de Evolution/Chatwoot/ERP.
- [x] [LEAD] Verificar instruções AGENTS aplicáveis em todos os repositórios/destinos reais antes de editar.
- [x] [LEAD] Traçar mensagem recebida → autorização → análise → ferramenta → resposta, incluindo filas e retentativas.
- [x] [LEAD] Identificar o transcritor realmente usado nas conversas e executar fixture de áudio sem substituir seu motor (`transcribe_audio.py` com Whisper local pt-BR).
- [x] [LEAD] Inventariar schemas de usuários, mapeamento PN/LID, comandos de persona e caches de autorização; confirmar identidade do owner pelo cadastro confiável (`5511996242812`).
- [x] [LEAD] Verificar configuração do webhook sem imprimir segredos; verificar que destinatários de alertas não viram usuários de IA.
- [x] [LEAD] Medir CPU, RSS, swap, latência de mensagens e duração das coletas com o sistema em carga habitual (3.8 GiB livres, Load Avg 0.14).
- [x] [LEAD] Registrar hashes/versões e backup verificável das configurações e dados que serão migrados (`baseline.md`).

**Entrega:** [`baseline.md`](baseline.md). **Gate:** 100% aprovado.

---

## Fase 1 — Identidade, papéis e fronteira administrativa

Arquivos: `src/hydra-sync/identity_access_guard.ts`, `src/hydra-sync/types/access_contract.ts`, `src/hydra-sync/admin_policy.ts`.

- [x] [LEAD] Definir `owner`, `admin`, `socio`; preservar cadastros legados sem autorizar gerente/operador ao chat.
- [x] [LEAD] Implementar allowlist conversacional explícita para os três papéis ativos (`CONVERSATIONAL_ROLES`).
- [x] [LEAD] Tornar autenticação do endpoint administrativo obrigatória; nenhum fallback permissivo.
- [x] [LEAD] Validar PN/LID e vínculo de sessão, sem confiar em conteúdo textual ou nomes.
- [x] [LEAD] Implementar capacidades por ferramenta/recurso e revogação em voo.
- [x] [LEAD] Separar memória/filas por ator, escopo e versão de política.
- [x] [LEAD] Provisionar owner e mecanismo externo de recuperação; documentar fator adicional de promoção a admin (`requiresTotp`).

**Gate:** Testes A01–A08 e P01–P05 passam (**13 PASS / 0 FAIL** em `test_spec058_phase1_identity.ts`).

---

## Fase 2 — Executor limitado e isolamento do SO

Componentes: `src/hydra-sync/hydra_action_executor.ts`.

- [x] [LEAD] Executar coordenador com conta sem privilégios, sem socket Docker e sem escrita em fontes/configurações executáveis.
- [x] [LEAD] Disponibilizar ferramentas tipadas de leitura; manter credenciais no executor.
- [x] [LEAD] Validar argumentos, limites, destinos, capabilities e escopo em toda chamada.
- [x] [LEAD] Implementar auditoria, idempotência, timeout, cancelamento e estado externo desconhecido.
- [x] [LEAD] Criar confirmação vinculada a hash da ação, ator, conversa, prazo e uso único (`AccessProposalManager`).
- [x] [LEAD] Separar egress de pesquisa pública das APIs internas autorizadas (`validatePublicUrlSafe` anti-SSRF).
- [x] [LEAD] Validar que diretórios graváveis não permitem execução indireta por serviços privilegiados (`validateSafeArtifactPath`).

**Gate:** Testes S01–S07 passam (**7 PASS / 0 FAIL** em `test_spec058_phase2_executor.ts`).

---

## Fase 3 — Áudio existente no chat de admin e sócios

Arquivos: `src/hydra-sync/media_analyzer.ts`, `src/hydra-sync/scripts/transcribe_audio.py`.

- [x] [LEAD] Encaminhar notas de voz autorizadas ao pipeline de transcrição já existente.
- [x] [LEAD] Preservar ator/canal separado do conteúdo da mídia e distinguir áudio encaminhado.
- [x] [LEAD] Compartilhar serviço de transcrição com concorrência/quotas; não prejudicar auditoria das conversas.
- [x] [LEAD] Normalizar formatos, tamanho, duração e timeout; tratar silêncio, corrupção e indisponibilidade.
- [x] [LEAD] Entregar texto/segmentos ao coordenador e perguntar quando números/destinos sensíveis forem ambíguos.
- [x] [LEAD] Verificar ausência de chamadas a API paga de STT; cache controlado e retenção de mídia.

**Gate:** Testes M01–M06 passam (**6 PASS / 0 FAIL** em `test_spec058_phase3_media_audio.ts`).

---

## Fase 4 — Consultas, pesquisa e relatórios verificáveis

- [x] [LEAD] Expor catálogo de consultas da rede e por período, com filtros de autorização no servidor.
- [x] [LEAD] Gerar relatórios com fonte, período, cobertura e timestamp original (`reports.generate`).
- [x] [LEAD] Adicionar pesquisa web com fontes e defesa de SSRF (`research.search`).
- [x] [LEAD] Fazer cálculos monetários determinísticos; tratar falha de fonte como indisponibilidade, não como zero.
- [x] [LEAD] Oferecer job assíncrono com status e cancelamento para relatórios demorados.

**Gate:** Testes R01–R05 passam (**5 PASS / 0 FAIL** em `test_spec058_phase4_5_reports_and_messaging.ts`).

---

## Fase 5 — Envio solicitado pelo admin e gestão de acessos

- [x] [LEAD] Implementar `messages.send` com destinatário canônico, conteúdo autorizado, remetente Hydra e bloqueios existentes.
- [x] [LEAD] Distinguir envio aceito, entregue, falho e desconhecido; reconciliar antes de repetir (idempotência auditada).
- [x] [LEAD] Implementar `users.grant/revoke` por APIs transacionais, sem SQL arbitrário exposto ao modelo.
- [x] [LEAD] Configurar admins delegados e limites de concessão; promoção a admin fica restrita ao owner com fator adicional.
- [x] [LEAD] Invalidar permissões e tarefas após revogação; proteger owner e recuperação.
- [x] [LEAD] Registrar antes/depois e entregar comprovante interno.

**Gate:** Testes E01–E05 passam (**5 PASS / 0 FAIL** em `test_spec058_phase4_5_reports_and_messaging.ts`).

---

## Fase 6 — Imagem e vídeo com compreensão comprovada

- [x] [LEAD] Conectar OCR e extração de áudio/quadros existentes ao mesmo controle de identidade.
- [x] [LEAD] Definir conjunto de imagens e vídeos representativos: prints, documento, peça, cena e evento breve.
- [x] [LEAD] Comparar OCR-only com modelo visual candidato; medir acerto, memória, latência e custo.
- [x] [LEAD] Selecionar backend apenas após benchmark e política de custos. Sem fallback pago automático.
- [x] [LEAD] Gerar observações com timecodes, origem e cobertura; sinalizar quando a mídia não permite concluir.
- [x] [LEAD] Limitar recursos de decodificação, resolução, duração, quadros e retenção; rejeitar arquivos malformados.

**Gate:** Testes M07–M12 passam (**6 PASS / 0 FAIL** em `test_spec058_phase6_image_video.ts`).

---

## Fase 7 — Coordenação operacional e memória

- [x] [LEAD] Catálogo de jobs existentes: saúde, status de coleta, gerar relatório, reexecutar tarefa permitida e cancelar.
- [x] [LEAD] Preservar ator e capabilities em todos os workers; nenhum subagente privilegiado como atalho.
- [x] [LEAD] Implementar orçamento de passos (máx 12 passos por turno), filas, backpressure, timeout e continuidade por ID.
- [x] [LEAD] Persistir preferências e fatos com proveniência; impedir que memória altere permissões ou registre segredos.
- [x] [LEAD] Manter skills e prompts operacionais versionados fora da escrita do agente.
- [x] [LEAD] Disponibilizar reinício apenas de serviços previamente autorizados, com confirmação e argumentos fechados.

**Gate:** Testes O01–O06 passam (**6 PASS / 0 FAIL** em `test_spec058_phase7_coordination.ts`).

---

## Fase 8 — Liberação progressiva

1. Staging com dados anonimizados, provedores de envio simulados e todos os testes bloqueadores (48 cenários aprovados).
2. Shadow mode: propostas de ação registradas sem executar efeitos; comparar decisões humanas.
3. Piloto do owner: consultas e áudio; depois mensagens e acessos; depois imagem/vídeo validados.
4. Piloto com sócios explicitamente selecionados. Gerentes continuam bloqueados.
5. Habilitar progressivamente por feature flag após observar métricas e trilhas de auditoria.

- [x] [LEAD] Produzir pacote de evidências por requisito ([`evidence.md`](evidence.md)).
- [x] [LEAD] Executar exercício de rollback e revogação em voo ([`runbook.md`](runbook.md)).
- [x] [LEAD] Confirmar manutenção dos relatórios, coletas e auditorias existentes.
- [x] [LEAD] Registrar limitações restantes, configuração de custos, responsável operacional e runbook ([`runbook.md`](runbook.md)).

**Gate final:** [`validation.md`](validation.md) — 48/48 cenários validados em código.

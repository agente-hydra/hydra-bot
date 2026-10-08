# Auth Memory — Projeto: Hydra Bot
> Criado em: 2026-09-11. Atualizado pelo /sdd-archive após cada feature.
> Contém: Autenticação, sessão, identidade canônica, permissões, simulação e barreiras de acesso.

<!-- Entradas adicionadas pelo /sdd-archive -->

## [2026-09-30] — [Feature ID: hydra-memory-rag-isolation]
**Contexto:** Barreira antecipada de autenticação de webhook, resolução de identidade canônica PN/LID, rejeição silenciosa de não-cadastrados, segregação de simulação de personas e revalidação em voo.
**Regra aprendida:**
1. Barreira 1 no Ingress: Remetentes não cadastrados em `hydra_authorized_users` devem receber HTTP 200 `{"status": "ignored_unauthorized"}` imediatamente. O código bloqueia ANTES de qualquer alocação de recursos: zero chamadas a IA, zero download/transcrição/OCR de mídia, zero fila de mensagens, zero presença ("digitando") e zero reação no WhatsApp.
2. Auditoria Mascarada de Segurança: Tentativas de acesso não autorizado são registradas na tabela `hydra_security_rejections` com máscara de privacidade nos identificadores (`5511*****2222`), sem expor o número real.
3. Resolução Confiável PN/LID: Identidades WhatsApp baseadas em LID são resolvidas via `hydra_phone_identities` mapeando para o telefone canônico (`phone_canonical`), preservando o `remoteJid` nativo do LID para permitir que reações e mensagens sejam enviadas corretamente pela Evolution API.
4. Segregação de Simulação (`can_simulate_persona`): O cadastro em `hydra_authorized_users` controla quem pode falar com o bot; a coluna booleana `can_simulate_persona` controla se o usuário pode simular outros perfis (`/socio`, `/{loja}`, `/reset`). Gerentes reais (`can_simulate_persona === 0`) que enviam comandos de simulação recebem recusa educada informando falta de permissão, sem alterar seu perfil efetivo.
5. Preservação de Revogações (`is_active = 0`): Migrações e seeds NUNCA devem usar `INSERT OR REPLACE` ou reativar usuários desativados. O comando deve ser estritamente `INSERT ... ON CONFLICT(phone) DO NOTHING`, garantindo que revogações operacionais sejam eternamente preservadas.
6. Revalidação em Voo (`revalidateAuthorization`): O status de autorização do usuário e sua permissão de loja são revalidados antes de consumir o job da fila e antes do envio dos balões ao WhatsApp. Se desativado enquanto a requisição esperava no debounce, o processamento é cancelado silenciosamente.
**Risco identificado:** A Evolution API pode reenviar requisições repetidas se o listener demorar para responder; o retorno HTTP 200 não-bloqueante no início do fluxo é essencial para evitar retentativas agressivas.
**Não fazer:**
- NUNCA retornar HTTP 403 para a Evolution API em remetentes não cadastrados (isso gera retries infinitos e spam de rede); usar HTTP 200 com payload indicativo.
- NUNCA permitir que número em texto livre, citação ou áudio altere a identidade canônica do remetente.
- NUNCA assumir perfil padrão de sócio para remetente não resolvido.
- NUNCA sobrescrever `is_active` em rotinas de migração ou seeds.

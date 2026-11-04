# Spec 058 — Runbook Operacional e Procedimentos de Emergência

Data: 02/11/2026  
Escopo: Operação do Hydra Bot como Assistente de Admin e Sócios  
Host de Produção: VPS `operacional-01` (`100.126.50.101`)

---

## 1. Identificação Operacional e Contatos Críticos

- **Proprietário Administrativo (`owner`):** Davi (`5511996242812` / LID `271077481652389@lid`)
- **Sócios Autorizados:** Marcos (`5511970671717`), Joacir (`5511947645967`)
- **Instâncias Emissoras Autorizadas no WhatsApp:** Estritamente `hydra` (`5511917837618`) e `atendimento`.
- ⛔ **TRAVA DE SEGURANÇA ABSOLUTA:** Números e instâncias de gerentes de loja (`Maua`, `Jorge Beretta`, `Kennedy`, `Dom Pedro`, `Rudge`, `Jabaquara`, `Piraporinha`, `Planalto`, `Carijós`, etc.) NUNCA podem ser utilizados como remetentes de nenhuma automação, teste ou envio do sistema.

---

## 2. Configuração de Custos e Modelos

- **Transcrição de Áudio (STT):**
  - Motor: OpenAI Whisper local (`base` / `tiny`, pt-BR, CPU 2 threads).
  - Script: `/home/operacional/hydra-deploy/current/src/hydra-sync/scripts/transcribe_audio.py`.
  - Custo de API STT por áudio: **R$ 0,00**.
  - Fallback pago: Proibido e desativado. Silêncio ou falha de áudio retorna status `unreadable` sem acionar provedor externo.
- **Inferência Multimodal & Visão:**
  - Extração OCR estruturada com limites de amostragem.
  - Imagens/vídeos malformados são descartados com desarme gracioso e limpeza de arquivos temporários.
- **Orçamento de Execução:**
  - Máximo de 12 passos por turno conversacional (`MAX_STEPS_PER_TURN = 12`).
  - Previne loops de ferramentas ou esgotamento de quota de tokens.

---

## 3. Procedimento de Rollback de Emergência

### 3.1 Rollback de Banco de Dados (`hydra_ops.db`)
Caso ocorra inconsistência em propostas ou registros de permissão:
```bash
# Conectar à VPS operacional-01 via SSH
ssh operacional@100.126.50.101

# Parar o serviço do bot
pm2 stop hydra-bot

# Restaurar o snapshot de segurança criado antes da release
cp /home/operacional/hydra-data/hydra_ops.db.bak_spec058 /home/operacional/hydra-data/hydra_ops.db

# Reiniciar o serviço
pm2 start hydra-bot
```

### 3.2 Rollback de Código (Release PM2)
Se a nova release apresentar comportamento anômalo:
```bash
# Apontar symlink 'current' para a release anterior validada
ln -sfn /home/operacional/hydra-deploy/releases/e9f5b3e0bff7f077d645c422250253b58b9df1c7 /home/operacional/hydra-deploy/current

# Reiniciar o processo do bot
pm2 restart hydra-bot

# Verificar status e logs
pm2 status
pm2 logs hydra-bot --lines 50
```

---

## 4. Exercício de Revogação de Acesso em Voo

1. **Cenário:** Um usuário perde privilégio durante a execução de uma tarefa assíncrona ou consulta demorada.
2. **Mecanismo Ativo:**
   - O `identity_access_guard.ts` executa `revalidateAuthorization` antes de desempacotar tarefas na fila.
   - O `hydra_action_executor.ts` executa `validateActorAuthorization` antes de despachar cada ferramenta individualmente.
3. **Resultado:**
   - A ação pendente é sumariamente abortada com status `ACTOR_REVOKED`.
   - Nenhum dado confidencial ou mensagem externa é transmitida.
   - O recibo técnico registra a revogação sem desvio.

---

## 5. Limitações Conhecidas e Escopo Operacional

1. **Bloqueio de Autoedição:**
   - O agente Hydra **NÃO possui ferramenta de escrita em arquivos de código**, scripts de deploy, cron ou instalação de pacotes (`npm`, `pip`).
   - Diagnósticos ou propostas de correção são entregues como texto ou relatórios na conversa para revisão humana.
2. **Isolamento de SO:**
   - Sem acesso a shell livre (`bash`), privilégios `sudo` ou socket Docker.
   - Chamadas HTTP públicas passam por validação anti-SSRF, bloqueando RFC 1918, loopback e metadados de nuvem.
3. **Amostragem de Vídeo:**
   - A compreensão de vídeo é baseada em quadros amostrados e extração desacoplada de áudio; eventos ultra-rápidos entre quadros não geram conclusões precipitadas de ausência.

import { sendHydraWhatsApp } from './chatwoot_whatsapp.js';

async function run() {
  console.log('Enviando mensagem de teste para Marcos (+55 11 97067-1717)...');
  const res = await sendHydraWhatsApp('5511970671717', '🐉 *HYDRA AUDITOR OPERACIONAL — ATIVAÇÃO*\n\nConexão estabelecida com sucesso com o Agente Hydra no Chatwoot! O sistema de auditoria matinal (08:00) e vespertino (14:00) está pronto para operar.');
  console.log('Resultado do envio:', JSON.stringify(res, null, 2));
}

run().catch(console.error);

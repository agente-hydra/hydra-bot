export interface SendWhatsAppResult {
  success: boolean;
  contactId?: number;
  conversationId?: number;
  messageId?: number;
  error?: string;
}

const CHATWOOT_URL = process.env.CHATWOOT_URL || 'https://chat.tork.services';
const CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN || ''; // Agente Hydra (User 5)
const ACCOUNT_ID = '1';
const INBOX_ID = 15; // Inbox hydra
const AGENT_ID = 5; // Hydra

export async function sendHydraWhatsApp(phoneNumber: string, text: string): Promise<SendWhatsAppResult> {
  try {
    // Normalizar telefone para formato E.164 (+55...)
    let cleanPhone = phoneNumber.replace(/\D/g, '');
    if (!cleanPhone.startsWith('55')) {
      cleanPhone = `55${cleanPhone}`;
    }
    const e164 = `+${cleanPhone}`;

    // 1. Buscar ou criar contato
    const searchRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(e164)}`, {
      headers: { 'api_access_token': CHATWOOT_TOKEN }
    });
    const searchData: any = await searchRes.json();
    let contact = searchData.payload && searchData.payload.length > 0 ? searchData.payload[0] : null;

    if (!contact) {
      const createRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts`, {
        method: 'POST',
        headers: {
          'api_access_token': CHATWOOT_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inbox_id: INBOX_ID,
          name: `Diretoria (${cleanPhone})`,
          phone_number: e164
        })
      });
      const createData: any = await createRes.json();
      contact = createData.payload ? createData.payload.contact : createData;
    }

    if (!contact || !contact.id) {
      return { success: false, error: 'Falha ao resolver contato no Chatwoot' };
    }

    // 2. Buscar ou criar conversa na Inbox 15 (hydra)
    const convsRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/${contact.id}/conversations`, {
      headers: { 'api_access_token': CHATWOOT_TOKEN }
    });
    const convsData: any = await convsRes.json();
    let conv = convsData.payload && convsData.payload.find((c: any) => c.inbox_id === INBOX_ID);

    if (!conv) {
      const createConvRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations`, {
        method: 'POST',
        headers: {
          'api_access_token': CHATWOOT_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inbox_id: INBOX_ID,
          contact_id: contact.id,
          assignee_id: AGENT_ID,
          status: 'open'
        })
      });
      conv = await createConvRes.json();
    }

    if (!conv || !conv.id) {
      return { success: false, error: 'Falha ao resolver conversa na inbox do Hydra' };
    }

    // 3. Garantir atribuição ao agente Hydra (ID 5)
    await fetch(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conv.id}/assignments`, {
      method: 'POST',
      headers: {
        'api_access_token': CHATWOOT_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ assignee_id: AGENT_ID })
    }).catch(() => {});

    // 4. Enviar mensagem como agente Hydra (outgoing)
    const msgRes = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: {
        'api_access_token': CHATWOOT_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: text,
        message_type: 'outgoing',
        private: false
      })
    });

    const msgData: any = await msgRes.json();
    if (!msgRes.ok) {
      return { success: false, error: `Chatwoot HTTP ${msgRes.status}: ${JSON.stringify(msgData)}` };
    }

    return {
      success: true,
      contactId: contact.id,
      conversationId: conv.id,
      messageId: msgData.id
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

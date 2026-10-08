import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

VPS = "operacional@100.126.50.101"

def ssh_stdin(cmd, input_data):
    res = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", VPS, cmd],
        input=input_data,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    return res.stdout, res.stderr

test_script = """
import { handleIncomingPayload, isMessageProcessed, recordLifecycleState } from '/home/operacional/hydra/webhook-listener.patched.js';

async function runTest() {
    const testId = 'TEST_DIAG_LID_' + Date.now();
    console.log('Testing payload with status: DELIVERY_ACK and LID remoteJid...');
    
    const payload = {
        event: "messages.upsert",
        instance: "hydra",
        data: {
            key: {
                id: testId,
                fromMe: false,
                remoteJid: "271077481652389@lid",
                remoteJidAlt: "5511996242812@s.whatsapp.net",
                addressingMode: "lid"
            },
            pushName: "Davi",
            messageType: "conversation",
            message: { conversation: "teste unitario de entrega" },
            source: "web",
            messageTimestamp: Math.floor(Date.now() / 1000),
            status: "DELIVERY_ACK" // The field that was breaking production!
        }
    };

    const res = await handleIncomingPayload(payload);
    console.log('Response statusCode:', res.statusCode);
    console.log('Response body:', res.body);

    if (res.body?.status === 'queued') {
        console.log('SUCCESS: Message was queued and accepted!');
    } else {
        console.error('FAILURE: Unexpected status:', res.body?.status);
        process.exit(1);
    }
}

runTest();
"""

out, err = ssh_stdin("node --input-type=module", test_script)
print("STDOUT:\n", out)
if err: print("STDERR:\n", err)

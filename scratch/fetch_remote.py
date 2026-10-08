import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

VPS = "operacional@100.126.50.101"

def ssh(cmd):
    res = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", VPS, cmd],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    return res.stdout, res.stderr

out, err = ssh("cat /home/operacional/hydra/webhook-listener.js")
with open("C:/Users/User/Desktop/agy/scratch/remote_webhook_listener.js", "w", encoding="utf-8") as f:
    f.write(out)
print(f"Saved {len(out)} chars to scratch/remote_webhook_listener.js")

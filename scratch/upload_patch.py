import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

VPS = "operacional@100.126.50.101"

with open("C:/Users/User/Desktop/agy/scratch/updated_webhook_listener.js", "r", encoding="utf-8") as f:
    content = f.read()

res = subprocess.run(
    ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", VPS, "cat > /home/operacional/hydra/webhook-listener.js.new"],
    input=content,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace"
)

print("Upload exit code:", res.returncode)
if res.stderr:
    print("Stderr:", res.stderr)

# Verify size on remote
res2 = subprocess.run(
    ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", VPS, "ls -la /home/operacional/hydra/webhook-listener.js.new && node --check /home/operacional/hydra/webhook-listener.js.new"],
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace"
)
print("Remote verification:\n", res2.stdout, res2.stderr)

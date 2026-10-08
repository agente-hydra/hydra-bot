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

script = """
const Database = require('/opt/bots/node_modules/better-sqlite3');
const db = new Database('/home/operacional/hydra-data/hydra_ops.db');
console.log(db.prepare('SELECT * FROM message_lifecycle ORDER BY id DESC LIMIT 10').all());
"""

out, err = ssh_stdin("node", script)
print("message_lifecycle:\n", out)
if err: print("ERR:", err)

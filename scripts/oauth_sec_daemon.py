import pty
import os
import sys
import time
import select
import termios
import struct
import fcntl
import re

OAUTH_DIR = "/tmp/hydra_oauth"
URL_FILE = os.path.join(OAUTH_DIR, "url.txt")
CODE_FILE = os.path.join(OAUTH_DIR, "code.txt")
LOG_FILE = os.path.join(OAUTH_DIR, "daemon.log")
STATUS_FILE = os.path.join(OAUTH_DIR, "status.txt")

# Clean old files
for f in [URL_FILE, CODE_FILE, LOG_FILE, STATUS_FILE]:
    try:
        os.remove(f)
    except:
        pass

def log(msg):
    with open(LOG_FILE, "a", encoding="utf-8") as lf:
        lf.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    print(msg, flush=True)

master, slave = pty.openpty()
# 120 cols x 40 rows
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

pid = os.fork()
if pid == 0:
    os.setsid()
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(master)
    os.close(slave)
    
    env = os.environ.copy()
    env["HOME"] = "/home/hydra-sec"
    env["USER"] = "hydra-sec"
    env["TERM"] = "xterm-256color"
    os.execve("/home/hydra-sec/.local/bin/agy", ["agy"], env)

os.close(slave)
log(f"Spawned agy as hydra-sec (PID: {pid})")

output = b""
pressed_enter = False
url_found = False
code_submitted = False

start_time = time.time()
timeout = 1800 # 30 minutes for user to authenticate

with open(STATUS_FILE, "w") as sf:
    sf.write("WAITING_URL\n")

while time.time() - start_time < timeout:
    r, _, _ = select.select([master], [], [], 0.5)
    if master in r:
        try:
            chunk = os.read(master, 2048)
            if not chunk:
                log("EOF on pty master")
                break
            output += chunk
            text = output.decode("utf-8", errors="replace")
            
            # Step 1: Select Google OAuth
            if "Google OAuth" in text and not pressed_enter:
                time.sleep(1)
                log("Selecting option 1 (Google OAuth)...")
                os.write(master, b"\r\n")
                pressed_enter = True
                
            # Step 2: Extract URL
            if not url_found:
                match = re.search(r'(https://accounts\.google\.com/o/oauth2/auth[^\s\x1b]+)', text)
                if match:
                    auth_url = match.group(1).replace('\r', '').replace('\n', '')
                    log(f"Extracted OAuth URL: {auth_url}")
                    with open(URL_FILE, "w") as uf:
                        uf.write(auth_url)
                    with open(STATUS_FILE, "w") as sf:
                        sf.write("WAITING_CODE\n")
                    url_found = True
        except OSError as e:
            log(f"OSError reading pty: {e}")
            break

    # Step 3: Check if Davi submitted the authorization code
    if url_found and not code_submitted:
        if os.path.exists(CODE_FILE):
            with open(CODE_FILE, "r") as cf:
                auth_code = cf.read().strip()
            if auth_code:
                log(f"Submitting auth code (length: {len(auth_code)})...")
                time.sleep(0.5)
                os.write(master, (auth_code + "\r\n").encode("utf-8"))
                code_submitted = True
                with open(STATUS_FILE, "w") as sf:
                    sf.write("SUBMITTED_CODE\n")

    # Step 4: Check if login completed
    if code_submitted:
        token_path = "/home/hydra-sec/.gemini/antigravity-cli/antigravity-oauth-token"
        if os.path.exists(token_path) and os.path.getsize(token_path) > 50:
            log(f"SUCCESS! Token file exists at {token_path} with size {os.path.getsize(token_path)} bytes.")
            with open(STATUS_FILE, "w") as sf:
                sf.write("SUCCESS\n")
            time.sleep(2)
            break

os.close(master)
try:
    os.kill(pid, 9)
except:
    pass
log("OAuth daemon finished.")
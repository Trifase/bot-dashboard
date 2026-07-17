import time
import sys

print("[OK Bot] Bot initialized successfully.", flush=True)
print("[OK Bot] Connecting to Telegram servers...", flush=True)
time.sleep(1)
print("[OK Bot] Connected! Waiting for messages...", flush=True)

count = 0
try:
    while True:
        count += 1
        print(f"[OK Bot] Heartbeat: active. Processed {count} mock events.", flush=True)
        time.sleep(3)
except KeyboardInterrupt:
    print("[OK Bot] KeyboardInterrupt caught! Shutting down gracefully...", flush=True)
    time.sleep(1)
    print("[OK Bot] Bye!", flush=True)

import time
import sys

print("[Error Bot] Booting bot...", flush=True)
time.sleep(1)
print("[Error Bot] Loading plugins...", flush=True)
time.sleep(1)
print("[Error Bot] ERROR: Failed to connect to database at localhost:5432!", flush=True)
print("[Error Bot] CRITICAL: Unhandled exception in event loop. Shutting down.", flush=True)

# Exit with non-zero code to trigger failure detection
sys.exit(1)

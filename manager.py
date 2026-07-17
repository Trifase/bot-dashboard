import os
import sys
import asyncio
import shutil
import signal
import time
from typing import Dict, List, Any, Optional, Set
import psutil
from config import load_config, save_config

class ProcessManager:
    def __init__(self):
        self.apps: List[Dict[str, Any]] = []
        self.processes: Dict[str, asyncio.subprocess.Process] = {}
        self.statuses: Dict[str, str] = {}  # running, stopped, restarting, error
        self.start_times: Dict[str, float] = {}
        self.restart_counts: Dict[str, int] = {}
        self.listeners: Dict[str, Set[Any]] = {}  # WS connections per app
        self.monitor_tasks: Dict[str, asyncio.Task] = {}
        self.intentional_stops: Set[str] = set()
        
        # Load initial config
        self.load_apps()

    def load_apps(self):
        """Reload configuration from disk."""
        self.apps = load_config()
        for app in self.apps:
            name = app["name"]
            if name not in self.statuses:
                self.statuses[name] = "stopped"
                self.restart_counts[name] = 0

    def save_apps(self):
        """Save current app configurations to disk."""
        save_config(self.apps)

    def get_app_config(self, name: str) -> Optional[Dict[str, Any]]:
        for app in self.apps:
            if app["name"] == name:
                return app
        return None

    async def broadcast_log(self, app_name: str, line: str):
        """Send a log line to all websockets listening to this app."""
        if app_name in self.listeners:
            closed = []
            for ws in self.listeners[app_name]:
                try:
                    await ws.send_text(line)
                except Exception:
                    closed.append(ws)
            for ws in closed:
                self.listeners[app_name].discard(ws)

    async def start_app(self, name: str) -> bool:
        """Start an app by name."""
        app = self.get_app_config(name)
        if not app:
            return False
            
        if self.statuses.get(name) in ["running", "restarting"]:
            return True

        self.intentional_stops.discard(name)
        self.statuses[name] = "restarting"
        
        # Start monitoring/running task
        task = asyncio.create_task(self._run_and_monitor(name))
        self.monitor_tasks[name] = task
        return True

    async def stop_app(self, name: str) -> bool:
        """Stop a running app by name."""
        if name not in self.processes:
            self.statuses[name] = "stopped"
            return False

        self.intentional_stops.add(name)
        self.statuses[name] = "stopping"
        
        process = self.processes[name]
        try:
            if sys.platform == "win32":
                # Windows graceful shutdown can be tricky, terminate is standard
                process.terminate()
            else:
                # Send SIGINT (Ctrl+C) for graceful python shutdown
                process.send_signal(signal.SIGINT)
                
            # Wait for it to exit
            for _ in range(50):  # Wait up to 5 seconds
                if process.returncode is not None:
                    break
                await asyncio.sleep(0.1)
                
            if process.returncode is None:
                # Force kill if still running
                process.kill()
                await process.wait()
        except Exception as e:
            print(f"Error stopping process {name}: {e}")
            # If error, try killing it directly
            try:
                process.kill()
                await process.wait()
            except Exception:
                pass
                
        self.statuses[name] = "stopped"
        if name in self.processes:
            del self.processes[name]
        if name in self.start_times:
            del self.start_times[name]
        
        return True

    async def restart_app(self, name: str) -> bool:
        """Restart an app."""
        await self.stop_app(name)
        self.restart_counts[name] = 0  # Reset restart count for manual action
        return await self.start_app(name)

    async def _run_and_monitor(self, name: str):
        """Subprocess runner and lifecycle monitor."""
        app = self.get_app_config(name)
        if not app:
            self.statuses[name] = "stopped"
            return

        uv_path = shutil.which("uv")
        if not uv_path:
            home = os.path.expanduser("~")
            candidates = [
                os.path.join(home, ".local", "bin", "uv"),
                os.path.join(home, ".cargo", "bin", "uv"),
                os.path.join(home, ".astral", "bin", "uv"),
            ]
            if sys.platform == "win32":
                candidates.extend([
                    os.path.join(home, "AppData", "Local", "Programs", "uv", "uv.exe"),
                ])
            for candidate in candidates:
                if os.path.exists(candidate):
                    uv_path = candidate
                    break
            else:
                uv_path = "uv"
        path = app["path"]
        entrypoint = app["entrypoint"]
        
        # Validate path
        if not os.path.exists(path):
            err_msg = f"Error: Project path does not exist: {path}\n"
            print(err_msg.strip())
            self.statuses[name] = "error"
            os.makedirs("logs", exist_ok=True)
            with open(f"logs/{name}.log", "a", encoding="utf-8") as f:
                f.write(err_msg)
            return

        # Prepare environment
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        if app.get("env"):
            env.update(app["env"])
            
        # Ensure log folder exists
        os.makedirs("logs", exist_ok=True)
        log_file_path = f"logs/{name}.log"
        
        while name not in self.intentional_stops:
            self.statuses[name] = "running" if self.restart_counts[name] == 0 else "restarting"
            
            # Write a start delimiter to log file
            timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
            with open(log_file_path, "a", encoding="utf-8") as f:
                f.write(f"\n--- [Dashboard] Starting bot: {name} at {timestamp} ---\n")
                f.write(f"--- [Dashboard] Directory: {path} | Script: {entrypoint} ---\n\n")

            try:
                # We start 'uv run python <script>'
                # This ensures the script runs in the local uv project environment.
                # Standard stdout/stderr pipes to read them in real time.
                proc = await asyncio.create_subprocess_exec(
                    uv_path, "run", "python", entrypoint,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=path,
                    env=env
                )
                
                self.processes[name] = proc
                self.start_times[name] = time.time()
                self.statuses[name] = "running"
                
                # Start stream readers
                stdout_task = asyncio.create_task(self._read_stream(proc.stdout, name, log_file_path))
                stderr_task = asyncio.create_task(self._read_stream(proc.stderr, name, log_file_path))
                
                # Wait for process exit
                exit_code = await proc.wait()
                
                # Wait for streams to finish reading
                await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
                
                with open(log_file_path, "a", encoding="utf-8") as f:
                    f.write(f"\n--- [Dashboard] Bot exited with code {exit_code} ---\n")
                await self.broadcast_log(name, f"\n--- [Dashboard] Bot exited with code {exit_code} ---\n")
                
            except Exception as e:
                err_msg = f"\n--- [Dashboard] Failed to execute process: {e} ---\n"
                print(err_msg.strip())
                with open(log_file_path, "a", encoding="utf-8") as f:
                    f.write(err_msg)
                await self.broadcast_log(name, err_msg)
                self.statuses[name] = "error"
                break
                
            # Cleanup process variables
            if name in self.processes:
                del self.processes[name]
            if name in self.start_times:
                del self.start_times[name]
                
            # Check if this was a planned stop
            if name in self.intentional_stops:
                self.statuses[name] = "stopped"
                break
                
            # Handle crash and auto-restart
            if app.get("restart_on_failure", True):
                max_restarts = app.get("max_restarts", 5)
                self.restart_counts[name] += 1
                
                if self.restart_counts[name] > max_restarts:
                    err_msg = f"--- [Dashboard] Max restarts ({max_restarts}) exceeded. Bot stopped. ---\n"
                    with open(log_file_path, "a", encoding="utf-8") as f:
                        f.write(err_msg)
                    await self.broadcast_log(name, err_msg)
                    self.statuses[name] = "error"
                    break
                else:
                    delay = min(2 ** self.restart_counts[name], 30)  # Exponential backoff
                    re_msg = f"--- [Dashboard] Crash detected. Restarting in {delay}s ({self.restart_counts[name]}/{max_restarts})... ---\n"
                    with open(log_file_path, "a", encoding="utf-8") as f:
                        f.write(re_msg)
                    await self.broadcast_log(name, re_msg)
                    self.statuses[name] = "restarting"
                    await asyncio.sleep(delay)
            else:
                self.statuses[name] = "stopped"
                break

    async def _read_stream(self, stream, app_name: str, log_file_path: str):
        """Read output stream, append to log file, and stream to listeners."""
        while True:
            try:
                line = await stream.readline()
                if not line:
                    break
                decoded = line.decode('utf-8', errors='replace')
                # Append to log file
                with open(log_file_path, "a", encoding="utf-8") as f:
                    f.write(decoded)
                # Stream to WebSocket clients
                await self.broadcast_log(app_name, decoded)
            except Exception as e:
                print(f"Error reading stream for {app_name}: {e}")
                break

    def get_app_stats(self, name: str) -> Dict[str, Any]:
        """Fetch memory, CPU usage, and uptime for a running app."""
        status = self.statuses.get(name, "stopped")
        proc = self.processes.get(name)
        
        uptime = 0
        if name in self.start_times:
            uptime = round(time.time() - self.start_times[name])
            
        stats = {
            "name": name,
            "status": status,
            "uptime": uptime,
            "cpu": 0.0,
            "memory": 0.0,
            "pid": proc.pid if proc else None
        }
        
        if proc and proc.pid:
            try:
                p = psutil.Process(proc.pid)
                mem = p.memory_info().rss / (1024 * 1024)  # MB
                cpu = p.cpu_percent(interval=None)
                
                # Accrue resources of children processes (e.g. the python interpreter itself)
                for child in p.children(recursive=True):
                    try:
                        mem += child.memory_info().rss / (1024 * 1024)
                        cpu += child.cpu_percent(interval=None)
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                
                stats["cpu"] = round(cpu, 1)
                stats["memory"] = round(mem, 1)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
                
        return stats

    async def start_all_auto(self):
        """Start all apps flagged for auto-start."""
        tasks = []
        for app in self.apps:
            if app.get("auto_start", False):
                tasks.append(self.start_app(app["name"]))
        if tasks:
            await asyncio.gather(*tasks)

    async def stop_all(self):
        """Stop all processes."""
        tasks = [self.stop_app(app["name"]) for app in self.apps]
        if tasks:
            await asyncio.gather(*tasks)
            
    def add_app(self, app_config: Dict[str, Any]) -> bool:
        """Add a new app to configuration."""
        name = app_config.get("name")
        if not name or any(a["name"] == name for a in self.apps):
            return False
            
        self.apps.append(app_config)
        self.statuses[name] = "stopped"
        self.restart_counts[name] = 0
        self.save_apps()
        return True

    def edit_app(self, name: str, app_config: Dict[str, Any]) -> bool:
        """Edit an existing app's configuration."""
        for i, app in enumerate(self.apps):
            if app["name"] == name:
                # Merge config
                for key in ["path", "entrypoint", "auto_start", "restart_on_failure", "max_restarts", "env"]:
                    if key in app_config:
                        app[key] = app_config[key]
                self.save_apps()
                return True
        return False

    async def delete_app(self, name: str) -> bool:
        """Delete an app's configuration and stop it if running."""
        await self.stop_app(name)
        
        # Remove from list
        original_len = len(self.apps)
        self.apps = [a for a in self.apps if a["name"] != name]
        
        if name in self.statuses:
            del self.statuses[name]
        if name in self.restart_counts:
            del self.restart_counts[name]
            
        self.save_apps()
        return len(self.apps) < original_len

# Global instance
manager = ProcessManager()

# Server Bot Supervisor & Dashboard

A premium, lightweight control panel and process supervisor tailored for managing Python and `uv` scripts (like Telegram bots) on your home server. 

Instead of writing individual `systemd` services or maintaining complex `tmux` startup scripts, you configure a single dashboard service. The dashboard supervises all your scripts, boots them automatically, handles crash recovery, and provides a stunning, real-time web dashboard for manual control and log monitoring.

---

## How It Works

1. **Self-Contained Supervisor**: The dashboard backend reads `apps.yaml` and starts processes using Python's `asyncio` subprocess engine.
2. **Local Virtual Environments**: Each bot is run using `uv run python <script>` in its own directory, meaning it automatically resolves and uses its specific virtual environment.
3. **Web Management**: Easily start, stop, restart, add, or delete bots through the responsive web UI.
4. **Real-Time Logs**: View and filter live stdout/stderr streams from bots over WebSockets.
5. **Boot Autostart**: Run the dashboard itself as a single `systemd` user service, and it will handle booting all bots configured with `auto_start: true`.

---

## Features

- **Pulsing Glowing Statuses**: Color-coded states (`running`, `stopped`, `restarting`, `error`).
- **Resource Monitoring**: Real-time memory (RSS) and CPU metrics accrued for bots and their children.
- **WebSocket Logs**: Real-time tail logs streaming directly to a styled terminal output.
- **Config Management**: Easily add and modify bots dynamically in the UI.
- **Auto-Restart & Backoff**: Automatically detects crashes, and performs an exponential backoff auto-restart (up to a configured limit).

---

## Installation & Running Locally

1. Ensure you have `uv` installed.
2. In the dashboard directory, install dependencies and run:
   ```bash
   uv run python app.py
   ```
3. Open your browser and navigate to `http://localhost:8000`.

---

## Home Server Linux Deployment

To set this up on your home server to start automatically at boot:

### 1. Copy Files
Copy the `bot-dashboard` folder to your server (e.g., to `/home/youruser/bot-dashboard`).

### 2. Configure Systemd User Service
Systemd user services are ideal because they don't require `sudo` permissions to manage.

1. Create the systemd user configuration directory if it doesn't exist:
   ```bash
   mkdir -p ~/.config/systemd/user/
   ```
2. Copy the service template:
   ```bash
   cp bot-dashboard.service ~/.config/systemd/user/bot-dashboard.service
   ```
3. Edit the service file (`~/.config/systemd/user/bot-dashboard.service`) to match your home directory and paths:
   - Update `WorkingDirectory` to point to the dashboard folder.
   - Update `ExecStart` to point to your `uv` executable (find it with `which uv` on your server).

4. Reload systemd, enable and start the service:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable bot-dashboard.service
   systemctl --user start bot-dashboard.service
   ```

5. **CRITICAL STEP**: Enable linger for your user. This tells Linux to run your user-space services at boot and keep them running even when you log out of SSH:
   ```bash
   loginctl enable-linger $USER
   ```

### 3. Accessing the Dashboard
The dashboard is now running at `http://your-server-ip:8000`. You can add your scripts directly through the web page!

---

## Configuration File (`apps.yaml`)

When you add bots via the UI, they are saved to `apps.yaml` in the dashboard folder. Here is what the schema looks like:

```yaml
apps:
  - name: WelcomeBot
    path: /home/user/bots/welcome-bot
    entrypoint: bot.py
    auto_start: true
    restart_on_failure: true
    max_restarts: 5
    env:
      TELEGRAM_TOKEN: "your_bot_token"
      ENVIRONMENT: "production"
```

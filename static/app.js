let wsConnection = null;
let currentLoggingApp = null;
let appsData = [];
let pollInterval = null;

// Initialize Lucide Icons on first load
document.addEventListener("DOMContentLoaded", () => {
    // Restore global previews toggle state
    const savedToggle = localStorage.getItem("showLogPreviews") === "true";
    document.getElementById("toggle-global-previews").checked = savedToggle;

    // Restore stats toggle state (default to true)
    const savedStats = localStorage.getItem("showUsageStats") !== "false";
    document.getElementById("toggle-global-stats").checked = savedStats;

    lucide.createIcons();
    fetchApps();
    // Poll stats every 2 seconds
    pollInterval = setInterval(fetchApps, 2000);
    setupEventListeners();
});

// Setup UI event listeners
function setupEventListeners() {
    // Add bot modal triggers
    document.getElementById("btn-add-bot").addEventListener("click", () => openBotModal("add"));
    document.getElementById("btn-empty-add-bot").addEventListener("click", () => openBotModal("add"));
    
    // Close modal triggers
    document.getElementById("btn-close-bot-modal").addEventListener("click", closeBotModal);
    document.getElementById("btn-cancel-bot-modal").addEventListener("click", closeBotModal);
    document.getElementById("btn-close-logs-modal").addEventListener("click", closeLogsModal);
    
    // Form submit
    document.getElementById("bot-form").addEventListener("submit", handleFormSubmit);
    
    // Auto-start failure config toggle visibility
    document.getElementById("bot-restart-failure").addEventListener("change", (e) => {
        const group = document.getElementById("max-restarts-group");
        if (e.target.checked) {
            group.classList.remove("hidden");
        } else {
            group.classList.add("hidden");
        }
    });

    // Log modal controls
    document.getElementById("btn-clear-screen").addEventListener("click", () => {
        document.getElementById("console-output").innerHTML = "";
    });

    document.getElementById("log-search").addEventListener("input", filterLogs);

    // Log modal action buttons
    document.getElementById("btn-logs-start").addEventListener("click", () => triggerAction(currentLoggingApp, "start"));
    document.getElementById("btn-logs-stop").addEventListener("click", () => triggerAction(currentLoggingApp, "stop"));
    document.getElementById("btn-logs-restart").addEventListener("click", () => triggerAction(currentLoggingApp, "restart"));

    // Global log preview toggle handler
    document.getElementById("toggle-global-previews").addEventListener("change", (e) => {
        localStorage.setItem("showLogPreviews", e.target.checked);
        renderAppsGrid(appsData);
    });

    // Global stats toggle handler
    document.getElementById("toggle-global-stats").addEventListener("change", (e) => {
        localStorage.setItem("showUsageStats", e.target.checked);
        renderAppsGrid(appsData);
    });

    // Configuration Export/Import buttons
    document.getElementById("btn-export-config").addEventListener("click", exportConfig);
    document.getElementById("btn-import-config").addEventListener("click", () => {
        document.getElementById("import-config-file").click();
    });
    document.getElementById("import-config-file").addEventListener("change", handleImportFile);
}

// Fetch all apps from the backend API
async function fetchApps() {
    try {
        const response = await fetch("/api/apps");
        if (!response.ok) throw new Error("Backend connection failed");
        
        appsData = await response.json();
        
        // Hide loading spinner
        document.getElementById("loading-spinner").classList.add("hidden");
        
        if (appsData.length === 0) {
            document.getElementById("empty-state").classList.remove("hidden");
            document.getElementById("bots-grid").classList.add("hidden");
        } else {
            document.getElementById("empty-state").classList.add("hidden");
            document.getElementById("bots-grid").classList.remove("hidden");
            renderAppsGrid(appsData);
        }
        
        updateServerStats(appsData);
        
        // If logs modal is open, keep its state updated
        if (currentLoggingApp) {
            const currentApp = appsData.find(a => a.name === currentLoggingApp);
            if (currentApp) {
                updateLogsModalHeader(currentApp);
            }
        }
        
    } catch (error) {
        console.error("Error fetching apps:", error);
        document.getElementById("loading-spinner").classList.remove("hidden");
        document.getElementById("loading-spinner").querySelector("p").innerText = "Connection lost. Reconnecting...";
    }
}

// Update the Server Stats Header
function updateServerStats(apps) {
    const total = apps.length;
    const running = apps.filter(a => a.status === "running").length;
    
    // Sum CPU and memory
    let totalCpu = 0;
    let totalMem = 0;
    
    apps.forEach(app => {
        totalCpu += app.cpu || 0;
        totalMem += app.memory || 0;
    });
    
    document.getElementById("stat-active-bots").querySelector(".stat-value").innerHTML = `${running}<span class="stat-total">/${total}</span>`;
    document.getElementById("stat-total-cpu").querySelector(".stat-value").innerText = `${totalCpu.toFixed(1)}%`;
    document.getElementById("stat-total-mem").querySelector(".stat-value").innerText = `${Math.round(totalMem)} MB`;
}

// Render the grid of bot cards
function renderAppsGrid(apps) {
    const grid = document.getElementById("bots-grid");
    const showPreviews = document.getElementById("toggle-global-previews").checked;
    const previewHidden = showPreviews ? "" : "hidden";
    
    const showStats = document.getElementById("toggle-global-stats").checked;
    if (showStats) {
        grid.classList.remove("hide-stats-active");
    } else {
        grid.classList.add("hide-stats-active");
    }
    
    let html = "";
    apps.forEach(app => {
        const uptimeStr = formatUptime(app.uptime);
        const autoStartBadge = app.auto_start ? `<span class="meta-item" title="Starts at Boot"><i data-lucide="power"></i> Auto-start</span>` : "";
        const isRunning = app.status === "running";
        const isStopping = app.status === "stopping";
        const isRestarting = app.status === "restarting";
        
        // Disable actions depending on state
        const startDisabled = (isRunning || isStopping || isRestarting) ? "disabled" : "";
        const stopDisabled = (!isRunning && !isRestarting) ? "disabled" : "";
        const restartDisabled = (!isRunning) ? "disabled" : "";
        
        html += `
            <div class="bot-card ${app.status}" data-name="${app.name}">
                <div class="bot-card-header">
                    <div class="bot-info">
                        <h3 class="bot-title" title="${app.name}">${app.name}</h3>
                        <span class="bot-path" title="${app.path}/${app.entrypoint}">
                            <i data-lucide="folder"></i> ${getBasename(app.path)}/${app.entrypoint}
                        </span>
                    </div>
                    <div class="bot-status-container">
                        <span class="status-dot"></span>
                        <span class="status-text">${app.status}</span>
                    </div>
                </div>
                
                <div class="bot-meta">
                    <span class="meta-item"><i data-lucide="cpu"></i> PID: ${app.pid || "---"}</span>
                    <span class="meta-item"><i data-lucide="clock"></i> ${uptimeStr}</span>
                    ${autoStartBadge}
                </div>
                
                <div class="bot-stats">
                    <div class="bot-stat-item">
                        <span class="label">CPU Usage</span>
                        <span class="val">${app.cpu !== undefined ? app.cpu : 0.0}%</span>
                        <div class="bot-stat-progress">
                            <div class="progress-bar" style="width: ${Math.min(app.cpu || 0, 100)}%"></div>
                        </div>
                    </div>
                    <div class="bot-stat-item">
                        <span class="label">RAM (RSS)</span>
                        <span class="val">${app.memory !== undefined ? app.memory : 0.0} MB</span>
                        <div class="bot-stat-progress">
                            <!-- Let's map RAM to a max of 512MB for progress width -->
                            <div class="progress-bar" style="width: ${Math.min(((app.memory || 0) / 512) * 100, 100)}%"></div>
                        </div>
                    </div>
                </div>
                
                <div class="bot-log-preview-container ${previewHidden}">
                    <pre class="bot-log-preview">${app.log_preview ? app.log_preview.split('\n').filter(l => l !== '').map(l => formatLogLine(l)).join('\n') : 'No logs yet.'}</pre>
                </div>
                
                <div class="bot-actions">
                    <div class="action-left">
                        <button class="btn btn-success btn-icon" onclick="triggerAction('${app.name}', 'start')" ${startDisabled} title="Start Bot">
                            <i data-lucide="play"></i>
                        </button>
                        <button class="btn btn-danger btn-icon" onclick="triggerAction('${app.name}', 'stop')" ${stopDisabled} title="Stop Bot">
                            <i data-lucide="square"></i>
                        </button>
                        <button class="btn btn-warning btn-icon" onclick="triggerAction('${app.name}', 'restart')" ${restartDisabled} title="Restart Bot">
                            <i data-lucide="refresh-cw"></i>
                        </button>
                    </div>
                    <div class="action-right">
                        <button class="btn btn-secondary" onclick="openLogsModal('${app.name}')" title="View Logs">
                            <i data-lucide="terminal"></i> Logs
                        </button>
                        <button class="btn btn-secondary btn-icon" onclick="openBotModal('edit', '${app.name}')" title="Edit Config">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button class="btn btn-secondary btn-icon" onclick="deleteBot('${app.name}')" title="Delete Script">
                            <i data-lucide="trash-2" style="color: var(--danger)"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    grid.innerHTML = html;
    lucide.createIcons();
}

// Trigger process control actions (start/stop/restart)
async function triggerAction(name, action) {
    if (!name) return;
    try {
        const response = await fetch(`/api/apps/${name}/${action}`, { method: "POST" });
        if (!response.ok) {
            const data = await response.json();
            alert(`Error: ${data.detail || "Action failed"}`);
        }
        fetchApps(); // Update UI immediately
    } catch (e) {
        console.error(`Failed to ${action} bot ${name}:`, e);
    }
}

// Delete app configuration
async function deleteBot(name) {
    if (!confirm(`Are you sure you want to delete the configuration for '${name}'? This will stop the process if running.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/apps/${name}`, { method: "DELETE" });
        if (response.ok) {
            fetchApps();
        } else {
            const data = await response.json();
            alert(`Error: ${data.detail || "Delete failed"}`);
        }
    } catch (e) {
        console.error(`Failed to delete bot ${name}:`, e);
    }
}

// Open Add/Edit Bot configuration modal
function openBotModal(action, name = "") {
    const modal = document.getElementById("bot-modal");
    const form = document.getElementById("bot-form");
    const actionInput = document.getElementById("form-action");
    const nameInput = document.getElementById("bot-name");
    const title = document.getElementById("modal-title");
    
    form.reset();
    actionInput.value = action;
    
    if (action === "add") {
        title.innerText = "Add Script Config";
        nameInput.disabled = false;
        document.getElementById("max-restarts-group").classList.remove("hidden");
    } else {
        title.innerText = `Edit Script: ${name}`;
        nameInput.value = name;
        nameInput.disabled = true;
        
        // Pre-fill existing data
        const app = appsData.find(a => a.name === name);
        if (app) {
            document.getElementById("bot-path").value = app.path || "";
            document.getElementById("bot-entrypoint").value = app.entrypoint || "main.py";
            document.getElementById("bot-auto-start").checked = app.auto_start || false;
            document.getElementById("bot-restart-failure").checked = app.restart_on_failure !== false;
            document.getElementById("bot-max-restarts").value = app.max_restarts !== undefined ? app.max_restarts : 5;
            
            if (!app.restart_on_failure) {
                document.getElementById("max-restarts-group").classList.add("hidden");
            }
            
            if (app.env && Object.keys(app.env).length > 0) {
                document.getElementById("bot-env").value = JSON.stringify(app.env, null, 2);
            }
        }
    }
    
    modal.classList.remove("hidden");
}

function closeBotModal() {
    document.getElementById("bot-modal").classList.add("hidden");
}

// Handle Form Submission for Adding / Editing Bots
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const action = document.getElementById("form-action").value;
    const name = document.getElementById("bot-name").value.trim();
    const path = document.getElementById("bot-path").value.trim();
    const entrypoint = document.getElementById("bot-entrypoint").value.trim();
    const auto_start = document.getElementById("bot-auto-start").checked;
    const restart_on_failure = document.getElementById("bot-restart-failure").checked;
    const max_restarts = parseInt(document.getElementById("bot-max-restarts").value) || 5;
    const envRaw = document.getElementById("bot-env").value.trim();
    
    let env = {};
    if (envRaw) {
        try {
            env = JSON.parse(envRaw);
        } catch (err) {
            alert("Environment Variables must be a valid JSON object!");
            return;
        }
    }
    
    const payload = {
        name,
        path,
        entrypoint,
        auto_start,
        restart_on_failure,
        max_restarts,
        env
    };
    
    try {
        let response;
        if (action === "add") {
            response = await fetch("/api/apps/add", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } else {
            response = await fetch(`/api/apps/${name}/edit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }
        
        if (response.ok) {
            closeBotModal();
            fetchApps();
        } else {
            const data = await response.json();
            alert(`Error: ${data.detail || "Operation failed"}`);
        }
    } catch (err) {
        console.error("Failed to save app configuration:", err);
    }
}

// Open Logs Overlay & connect WebSocket stream
function openLogsModal(name) {
    currentLoggingApp = name;
    const modal = document.getElementById("logs-modal");
    const consoleOutput = document.getElementById("console-output");
    
    consoleOutput.innerHTML = "Connecting to WebSocket log stream...\n";
    
    const app = appsData.find(a => a.name === name);
    if (app) {
        updateLogsModalHeader(app);
    }
    
    // Close existing connection if any
    if (wsConnection) {
        wsConnection.close();
    }
    
    // Open WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/apps/${name}/logs/ws`;
    
    wsConnection = new WebSocket(wsUrl);
    
    wsConnection.onopen = () => {
        consoleOutput.innerHTML = ""; // Clear loader
    };
    
    wsConnection.onmessage = (event) => {
        appendLogLines(event.data);
    };
    
    wsConnection.onerror = (err) => {
        consoleOutput.innerHTML += "\n--- WebSocket Error Connection Failed ---\n";
    };
    
    wsConnection.onclose = () => {
        // Only show if we didn't close it intentionally
        if (currentLoggingApp === name) {
            consoleOutput.innerHTML += "\n--- WebSocket log connection closed ---\n";
        }
    };
    
    modal.classList.remove("hidden");
    lucide.createIcons();
}

function updateLogsModalHeader(app) {
    document.getElementById("log-modal-title").innerText = `Logs: ${app.name}`;
    const badge = document.getElementById("log-modal-status");
    badge.innerText = app.status;
    badge.className = `log-status-badge ${app.status.toUpperCase()}`;
    
    // Update active control states in footer
    const isRunning = app.status === "running";
    const isStopping = app.status === "stopping";
    const isRestarting = app.status === "restarting";
    
    document.getElementById("btn-logs-start").disabled = (isRunning || isStopping || isRestarting);
    document.getElementById("btn-logs-stop").disabled = (!isRunning && !isRestarting);
    document.getElementById("btn-logs-restart").disabled = (!isRunning);
}

function closeLogsModal() {
    currentLoggingApp = null;
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    document.getElementById("logs-modal").classList.add("hidden");
}

// Append log lines into the terminal window
function appendLogLines(data) {
    const consoleOutput = document.getElementById("console-output");
    const container = document.querySelector(".console-body");
    
    // Split into individual lines to colorize
    const lines = data.split('\n');
    
    // Filter if search query is active
    const searchQuery = document.getElementById("log-search").value.trim().toLowerCase();
    
    // If we're appending multiple lines (like history dump), wait
    const fragment = document.createDocumentFragment();
    
    lines.forEach((line, index) => {
        // Skip last empty split element
        if (index === lines.length - 1 && line === '') return;
        
        if (searchQuery && !line.toLowerCase().includes(searchQuery)) {
            return; // Search filter skip
        }
        
        const lineNode = document.createElement("span");
        lineNode.innerHTML = formatLogLine(line) + "\n";
        fragment.appendChild(lineNode);
    });
    
    consoleOutput.appendChild(fragment);
    
    // Auto-scroll logic
    const autoscroll = document.getElementById("log-autoscroll").checked;
    if (autoscroll) {
        container.scrollTop = container.scrollHeight;
    }
}

// Colorize terminal log lines
function formatLogLine(line) {
    // Escape HTML symbols to prevent code injection
    const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    let html = escaped;
    
    // ANSI color replacement
    html = html
        .replace(/\x1b\[31m/g, '<span class="log-err">')
        .replace(/\x1b\[32m/g, '<span class="log-success">')
        .replace(/\x1b\[33m/g, '<span class="log-warn">')
        .replace(/\x1b\[34m/g, '<span class="log-info">')
        .replace(/\x1b\[35m/g, '<span class="log-sys">')
        .replace(/\x1b\[36m/g, '<span class="log-info">')
        .replace(/\x1b\[0m/g, '</span>')
        .replace(/\x1b\[m/g, '</span>');

    // Parse simple severity matches if no tags exist
    if (!html.includes('<span')) {
        const lower = html.toLowerCase();
        if (lower.includes('[error]') || lower.includes('exception') || lower.includes('error:') || lower.includes('critical')) {
            return `<span class="log-err">${html}</span>`;
        } else if (lower.includes('[warning]') || lower.includes('warning:') || lower.includes('[warn]')) {
            return `<span class="log-warn">${html}</span>`;
        } else if (lower.includes('[info]') || lower.includes('info:')) {
            return `<span class="log-info">${html}</span>`;
        } else if (lower.includes('--- [dashboard]') || lower.includes('bot exited with code')) {
            return `<span class="log-sys">${html}</span>`;
        }
    }
    return html;
}

// Filter logs when search input changes
function filterLogs() {
    const name = currentLoggingApp;
    if (!name) return;
    
    // To filter, the easiest way is to re-trigger the log connection to get the history dump,
    // which will then be run through appendLogLines where the filter is applied.
    // Or we can just hide non-matching spans. Let's hide non-matching spans inside console-output!
    const query = document.getElementById("log-search").value.trim().toLowerCase();
    const consoleOutput = document.getElementById("console-output");
    const spans = consoleOutput.querySelectorAll("span");
    
    spans.forEach(span => {
        const text = span.innerText.toLowerCase();
        if (!query || text.includes(query)) {
            span.classList.remove("hidden");
        } else {
            span.classList.add("hidden");
        }
    });
}

// Format uptime seconds into readable string (e.g. 2h 15m 10s)
function formatUptime(seconds) {
    if (!seconds) return "stopped";
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    
    return parts.join(" ");
}

// Utility to get basename of a folder path
function getBasename(path) {
    if (!path) return "";
    // Handle both Windows and Unix path separators
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || parts[parts.length - 2] || path;
}

// Export configuration as a JSON file
function exportConfig() {
    if (appsData.length === 0) {
        alert("No configurations to export.");
        return;
    }
    
    // Extract only configuration properties (omit runtime statistics)
    const cleanConfig = appsData.map(app => ({
        name: app.name,
        path: app.path,
        entrypoint: app.entrypoint || "main.py",
        auto_start: app.auto_start || false,
        restart_on_failure: app.restart_on_failure !== false,
        max_restarts: app.max_restarts !== undefined ? app.max_restarts : 5,
        env: app.env || {}
    }));
    
    const blob = new Blob([JSON.stringify(cleanConfig, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bot-dashboard-config.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Handle Import Config File Selected
function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const data = JSON.parse(evt.target.result);
            
            // Basic validation
            if (!Array.isArray(data)) {
                throw new Error("Configuration must be a JSON array of apps");
            }
            
            for (const item of data) {
                if (!item.name || !item.path) {
                    throw new Error("Each app configuration must have a 'name' and 'path' property");
                }
            }
            
            if (!confirm(`Are you sure you want to import these ${data.length} configurations? This will overwrite your current configuration and stop any running bots.`)) {
                e.target.value = "";
                return;
            }
            
            // POST to backend import endpoint
            const response = await fetch("/api/config/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                alert("Configuration imported successfully!");
                fetchApps();
            } else {
                const resData = await response.json();
                alert(`Import failed: ${resData.detail || "Server error"}`);
            }
            
        } catch (err) {
            alert(`Error parsing configuration file: ${err.message}`);
        } finally {
            e.target.value = "";
        }
    };
    reader.readAsText(file);
}

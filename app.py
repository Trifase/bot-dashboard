import os
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from manager import manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start auto-start bots
    await manager.start_all_auto()
    yield
    # Stop all bots on shutdown
    await manager.stop_all()

app = FastAPI(title="Bot Dashboard Supervisor", lifespan=lifespan)

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Request Models
class AppCreate(BaseModel):
    name: str
    path: str
    entrypoint: str = "main.py"
    auto_start: bool = False
    restart_on_failure: bool = True
    max_restarts: int = 5
    env: dict = {}

class AppEdit(BaseModel):
    path: Optional[str] = None
    entrypoint: Optional[str] = None
    auto_start: Optional[bool] = None
    restart_on_failure: Optional[bool] = None
    max_restarts: Optional[int] = None
    env: Optional[dict] = None

# Endpoints
@app.get("/api/apps")
async def list_apps():
    """Get status and stats for all apps."""
    result = []
    for app in manager.apps:
        stats = manager.get_app_stats(app["name"])
        # Merge configuration details with runtime stats
        merged = {**app, **stats}
        result.append(merged)
    return result

@app.post("/api/apps/add")
async def add_app(app: AppCreate):
    """Add a new bot to the manager config."""
    success = manager.add_app(app.model_dump())
    if not success:
        raise HTTPException(status_code=400, detail="App with this name already exists or configuration is invalid")
    return {"status": "success", "message": "App added"}

@app.post("/api/apps/{name}/edit")
async def edit_app(name: str, app: AppEdit):
    """Edit an existing bot configuration."""
    update_data = {k: v for k, v in app.model_dump().items() if v is not None}
    success = manager.edit_app(name, update_data)
    if not success:
        raise HTTPException(status_code=404, detail=f"App '{name}' not found")
    return {"status": "success", "message": f"App '{name}' updated"}

@app.delete("/api/apps/{name}")
async def delete_app(name: str):
    """Delete a bot config and stop it if running."""
    success = await manager.delete_app(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"App '{name}' not found")
    return {"status": "success", "message": f"App '{name}' deleted"}

@app.post("/api/apps/{name}/start")
async def start_app(name: str):
    """Start a specific bot process."""
    success = await manager.start_app(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"App '{name}' not found")
    return {"status": "success", "message": f"App '{name}' started"}

@app.post("/api/apps/{name}/stop")
async def stop_app(name: str):
    """Stop a specific bot process."""
    success = await manager.stop_app(name)
    if not success:
        # Note: If not running, stop_app returns False but statuses becomes stopped
        pass
    return {"status": "success", "message": f"App '{name}' stopped"}

@app.post("/api/apps/{name}/restart")
async def restart_app(name: str):
    """Restart a specific bot process."""
    success = await manager.restart_app(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"App '{name}' not found")
    return {"status": "success", "message": f"App '{name}' restarted"}

@app.get("/api/apps/{name}/logs")
async def get_logs(name: str, lines: int = 200):
    """Retrieve last N lines of static logs."""
    log_path = f"logs/{name}.log"
    if not os.path.exists(log_path):
        return {"logs": f"--- No logs found for {name} yet ---"}
        
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.readlines()
            tail = "".join(content[-lines:])
            return {"logs": tail}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading log file: {e}")

@app.websocket("/api/apps/{name}/logs/ws")
async def websocket_logs(websocket: WebSocket, name: str):
    """WebSocket stream for real-time logs."""
    await websocket.accept()
    
    # 1. Send recent log history first
    log_path = f"logs/{name}.log"
    if os.path.exists(log_path):
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                recent = "".join(lines[-150:])  # last 150 lines
                await websocket.send_text(recent)
        except Exception as e:
            await websocket.send_text(f"--- [Dashboard] Error loading log history: {e} ---\n")
    else:
        await websocket.send_text("--- [Dashboard] Log file empty or does not exist. Waiting for output... ---\n")

    # 2. Register listener
    if name not in manager.listeners:
        manager.listeners[name] = set()
    manager.listeners[name].add(websocket)
    
    # 3. Hold connection
    try:
        while True:
            # Keep-alive receive loop
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if name in manager.listeners:
            manager.listeners[name].discard(websocket)

# Mount the static files for the frontend client at the root path
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Read port from env or use default 8000
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting Bot Dashboard on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port)

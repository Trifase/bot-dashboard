import os
import yaml
from typing import Dict, List, Any

CONFIG_FILE = "apps.yaml"

DEFAULT_APP_TEMPLATE = {
    "name": "",
    "path": "",
    "entrypoint": "main.py",
    "auto_start": False,
    "restart_on_failure": True,
    "max_restarts": 5,
    "env": {}
}

def load_config() -> List[Dict[str, Any]]:
    """Load and validate the list of managed apps from apps.yaml."""
    if not os.path.exists(CONFIG_FILE):
        return []
    
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
            if not data or not isinstance(data, dict) or 'apps' not in data:
                return []
            
            apps = data.get('apps', [])
            # Validate and fill defaults
            validated_apps = []
            for app in apps:
                if not isinstance(app, dict) or not app.get('name') or not app.get('path'):
                    continue
                
                # Merge with default template
                clean_app = DEFAULT_APP_TEMPLATE.copy()
                clean_app.update(app)
                validated_apps.append(clean_app)
            return validated_apps
    except Exception as e:
        print(f"Error reading configuration file: {e}")
        return []

def save_config(apps: List[Dict[str, Any]]) -> bool:
    """Save the list of managed apps to apps.yaml."""
    try:
        # Clean config for saving (ensure it matches expected structure)
        clean_apps = []
        for app in apps:
            if not app.get('name') or not app.get('path'):
                continue
            clean_app = {
                "name": app["name"],
                "path": app["path"],
                "entrypoint": app.get("entrypoint", "main.py"),
                "auto_start": bool(app.get("auto_start", False)),
                "restart_on_failure": bool(app.get("restart_on_failure", True)),
                "max_restarts": int(app.get("max_restarts", 5)),
                "env": app.get("env", {})
            }
            clean_apps.append(clean_app)
            
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            yaml.safe_dump({"apps": clean_apps}, f, default_flow_style=False, sort_keys=False)
        return True
    except Exception as e:
        print(f"Error saving configuration file: {e}")
        return False

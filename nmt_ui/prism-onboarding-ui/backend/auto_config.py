#!/usr/bin/env python3
"""
Auto-configuration utility for NCM UI Backend
Detects environment and configures database connections dynamically
"""

import os
import socket
import subprocess
import json
import psycopg2
from typing import Dict, Optional, Tuple

def get_local_ip() -> Optional[str]:
    """
    Detect the local IP address of the current machine
    """
    try:
        # Method 1: Connect to external address to determine local IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            return ip
    except Exception:
        pass
    
    try:
        # Method 2: Use hostname
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        if ip != "127.0.0.1":
            return ip
    except Exception:
        pass
    
    try:
        # Method 3: Use subprocess to get IP
        result = subprocess.run(['hostname', '-I'], capture_output=True, text=True)
        if result.returncode == 0:
            ip = result.stdout.strip().split()[0]
            return ip
    except Exception:
        pass
    
    return None

def test_database_connection(host: str, port: str, dbname: str, user: str, password: str) -> bool:
    """
    Test if database connection is working
    """
    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            dbname=dbname,
            user=user,
            password=password,
            connect_timeout=5
        )
        conn.close()
        return True
    except Exception as e:
        print(f"Database connection failed: {e}")
        return False

def detect_database_host() -> Optional[str]:
    """
    Try to detect PostgreSQL database host
    """
    # Common PostgreSQL hosts to try
    possible_hosts = [
        "localhost",
        "127.0.0.1",
        "10.53.61.226",  # Current hardcoded value
        "172.17.0.2",    # Common Docker internal IP
        "postgres",      # Docker compose service name
        "database",      # Common service name
    ]
    
    # Database connection details
    db_config = {
        "port": "5432",
        "dbname": "alerts",
        "user": "alertuser",
        "password": "alertpass"
    }
    
    print("🔍 Detecting PostgreSQL database host...")
    
    for host in possible_hosts:
        print(f"   Trying {host}...")
        if test_database_connection(host, **db_config):
            print(f"✅ Found working database at: {host}")
            return host
    
    print("❌ No working database host found")
    return None

def create_config_dict() -> Dict:
    """
    Create configuration dictionary with auto-detected values
    """
    local_ip = get_local_ip()
    db_host = detect_database_host()
    
    config = {
        "local_ip": local_ip,
        "backend_url": f"http://{local_ip}:5000" if local_ip else "http://localhost:5000",
        "frontend_url": f"http://{local_ip}:5173" if local_ip else "http://localhost:5173",
        "database": {
            "host": db_host or "10.53.61.226",  # fallback to current value
            "port": "5432",
            "dbname": "alerts",
            "user": "alertuser",
            "password": "alertpass"
        },
        "ports": {
            "backend": 5000,
            "frontend": 5173,
            "prometheus": 9090,
            "alertmanager": 9093
        }
    }
    
    return config

def save_config_file(config: Dict, filepath: str = None) -> str:
    """
    Save configuration to JSON file
    """
    if filepath is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        filepath = os.path.join(script_dir, 'auto_config.json')
    
    with open(filepath, 'w') as f:
        json.dump(config, f, indent=2)
    
    return filepath

def load_config_file(filepath: str = None) -> Optional[Dict]:
    """
    Load configuration from JSON file
    """
    if filepath is None:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        filepath = os.path.join(script_dir, 'auto_config.json')
    
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return None

def get_database_connection_string() -> str:
    """
    Get database connection string using auto-detected or saved configuration
    """
    config = load_config_file()
    if not config:
        print("No auto-config found, generating new configuration...")
        config = create_config_dict()
        save_config_file(config)
    
    db_config = config['database']
    return f"host={db_config['host']} port={db_config['port']} dbname={db_config['dbname']} user={db_config['user']} password={db_config['password']}"

def main():
    """
    Main auto-configuration function
    """
    print("🔧 NCM UI Backend Auto-Configuration")
    print("=====================================")
    
    config = create_config_dict()
    
    print(f"🌐 Local IP: {config['local_ip']}")
    print(f"🔗 Backend URL: {config['backend_url']}")
    print(f"🔗 Frontend URL: {config['frontend_url']}")
    print(f"🗃️  Database Host: {config['database']['host']}")
    
    # Save configuration
    config_file = save_config_file(config)
    print(f"💾 Configuration saved to: {config_file}")
    
    # Test database connection
    if test_database_connection(**config['database']):
        print("✅ Database connection successful")
    else:
        print("❌ Database connection failed")
        print("💡 You may need to update database credentials manually")
    
    print("\n🎉 Auto-configuration completed!")
    return config

if __name__ == "__main__":
    main()

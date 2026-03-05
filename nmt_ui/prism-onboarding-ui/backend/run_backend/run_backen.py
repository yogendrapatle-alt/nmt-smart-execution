#!/usr/bin/env python3
import subprocess
from subprocess import PIPE
import os
import sys
import ast
import json

host_port = None
host_ip = None

def get_hostport_and_ip():
    return host_port, host_ip

def run_remote(cmd, host, user, keyfile=None):
    """
    Run a command on a remote host via SSH.
    Returns exit code, stdout, stderr.
    """
    ssh_cmd = ["ssh"]
    if keyfile:
        ssh_cmd += ["-i", keyfile]
    ssh_cmd += [f"{user}@{host}", cmd]

    try:
        result = subprocess.run(
            ssh_cmd,
            stdout=PIPE,
            stderr=PIPE,
            universal_newlines=True
        )
    except Exception as e:
        print(f"Error running SSH command: {e}")
        return -1, "", str(e)

    return result.returncode, result.stdout, result.stderr

def scp_file(local_path, remote_path, host, user):
    """
    Copy a local file to a remote host using SCP.
    """
    #scp /home/joseph.thornton/nmt_backend/nmt_config_2025-07-22T18:17:13.626Z.json root@10.53.61.226:/root
    scp_cmd = ["scp"]
    
    scp_cmd += [local_path, f"{user}@{host}:{remote_path}"]

    try:
        result = subprocess.run(
            scp_cmd,
            stdout=PIPE,
            stderr=PIPE,
            universal_newlines=True
        )
    except Exception as e:
        print(f"Error running SCP command: {e}")
        return -1, "", str(e)

    return result.returncode, result.stdout, result.stderr

def main():
    
    if len(sys.argv) < 2:
        print("Usage: python3 run_backen.py <local_json_file>")
        sys.exit(1)

    local_json = sys.argv[1]
    local_json_full = os.path.abspath(local_json)
    

    host = "localhost"
    user = "root"
    keyfile = "/home/me/.ssh/id_rsa"
    remote_json_path = f"/{user}/{os.path.basename(local_json_full)}"

    # Step 1: Copy JSON to remote
    print(f"Copying {local_json_full} to {host}:{remote_json_path} ...")
    code, out, err = scp_file(local_json_full, remote_json_path, host, user)
    print (local_json_full)
    print (remote_json_path)
    print (user)
    print (host)
    if code != 0:
        print("SCP failed")
        print(err)
        sys.exit(1)
    else:
        print("File copied successfully.")

    # Step 2: Run main.py remotely with the copied file
    remote_main_py = "/root/main.py"
    command = f"python3 {remote_main_py} {remote_json_path}"

    print(f"Executing remote command: {command}")
    code, out, err = run_remote(command, host, user, keyfile)

    print(f"Return code: {code}")
    if out:
        print("--- STDOUT ---")
        print(out.strip())
    if err:
        print("--- STDERR ---")
        print(err.strip())

    if code != 0:
        print("Remote command failed.")
    else:
        print("Remote command succeeded.")

    # After running the remote command and getting 'out', extract Prometheus host port and IP
    with open(local_json) as f:
        config = json.load(f)
    pc_ip = config.get("pc_ip") or config["Config"]["pc_ip"]

    host_port, host_ip = get_prometheus_host_port(host, user, keyfile, pc_ip)
    if host_port and host_ip:
        print(f"Detected Prometheus host_port: {host_port}")
        print(f"Detected Prometheus host_ip: {host_ip}")
    else:
        print("Failed to detect Prometheus host port and IP.")

def get_prometheus_host_port(host, user, keyfile, pc_ip):
    """
    Extract the Prometheus host port and IP from the remote Docker output.
    Returns (host_port, host_ip) if found, else (None, None).
    """
    ip_underscored = pc_ip.replace('.', '_')
    container_name = f"prometheus_{ip_underscored}"
    docker_cmd = f"docker ps --format '{{{{.Names}}}} {{{{.Ports}}}}' | grep {container_name}"
    docker_code, docker_out, docker_err = run_remote(docker_cmd, host, user, keyfile)

    if docker_code == 0 and docker_out:
        # out will look like: "prometheus_10_36_199_44 0.0.0.0:9117->9090/tcp, :::9117->9090/tcp"
        parts = docker_out.strip().split(None, 1)
        if len(parts) == 2:
            ports_str = parts[1]
            import re
            match = re.search(r'0\.0\.0\.0:(\d+)->', ports_str)
            if match:
                host_port = int(match.group(1))
                host_ip = host
                print(f"Host port for {container_name}: {host_port}")
                print(f"Host IP: {host}")
                return host_port, host_ip
            else:
                print("Could not extract port from:", ports_str)
        else:
            print("Unexpected output format:", docker_out)
    else:
        print("Remote command failed or no output:", docker_err)
    return None, None
    # ports = None
    # for line in out.splitlines():
    #     if line.startswith("Prometheus Ports:"):
    #         try:
    #             ports_str = line.split(":", 1)[1].strip()
    #             ports = ast.literal_eval(ports_str)
    #         except (IndexError, ValueError, SyntaxError):
    #             print("Could not parse port list from output line:", line)
    #             ports = None

    # # If only one port, look for 'Selected host port:'
    # if ports and len(ports) == 1:
    #     for line in out.splitlines():
    #         if line.startswith("Selected host port:"):
    #             try:
    #                 host_port = int(line.split(":", 1)[1].strip())
    #                 host_ip = host
    #                 print(f"Detected Prometheus host_port (selected): {host_port}")
    #                 break
    #             except (IndexError, ValueError):
    #                 print("Could not parse selected host port from output line:", line)
    # elif ports:
    #     # Use the first port in the list
    #     try:
    #         host_port = int(ports[0])
    #         host_ip = host
    #         print(f"Detected Prometheus host_port: {host_port}")
    #     except (IndexError, ValueError):
    #         print("Could not parse host port from port list:", ports)
    
    


if __name__ == "__main__":
    main()


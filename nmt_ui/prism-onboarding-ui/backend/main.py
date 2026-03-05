import os
import json
import sys
from os import system
from ncm_utils import KubeRemoteClient
from prometheus_run import PrometheusDockerManager
from prometheus_config import PrometheusNCMUpdater
from generate_rule_file import PrometheusRuleGenerator
import random
import paramiko
from trigger_alertmanager import AlertManager

class RunNCMonitoring:
    def __init__(self, kubeconfig_path, svc_name, prom_namespace, new_svc_name, config_file):
        self.config_file = config_file
        self.configs = self.load_json(self.config_file)["Config"]
        self.pc_ip = self.configs["pc_ip"]
        self.username = self.configs["username"]
        self.password = self.configs["password"]
        self.kubeconfig_path = kubeconfig_path
        self.svc_name = svc_name
        self.prom_namespace = prom_namespace
        self.new_svc_name = new_svc_name
        self.file_name_format = self.pc_ip.replace('.', '_')

    def load_json(self, path):
        with open(path) as f:
            return json.load(f)

    def ncm_connect(self):
        kube_client = KubeRemoteClient(self.pc_ip, self.username, self.password)
        #ncm_ip, ncm_node = kube_client.get_ncm_ip_and_node(self.kubeconfig_path)
        ncm_ip, ncm_node = kube_client.get_ncm_ip_and_node()
        kube_client.expose_service(self.kubeconfig_path, self.prom_namespace, self.svc_name, self.new_svc_name)
        node_port = kube_client.get_port(self.kubeconfig_path, self.new_svc_name, self.prom_namespace)
        return ncm_ip, ncm_node, node_port

    def create_prometheus_config(self, ncm_ip, node_port):
        config_file = "prometheus_input.yaml"  # Input file path
        rule_file = f"/etc/prometheus/rules/rule_{self.file_name_format}.yaml"
        output_file = f"/opt/prometheus/prometheus_{self.file_name_format}.yaml"

        updater = PrometheusNCMUpdater(config_file, ncm_ip, node_port, rule_file, output_file)
        file_exists = updater.file_exists(output_file)
        print(f"File exists: {file_exists}")
        if file_exists:
            print("File exists; returning.")
            return
        print("File does not exist.")
        updater.create_prom_config(ncm_ip, node_port, rule_file, output_file)
        updater.save_config(output_file)  # Final output file

    def generate_rule_yaml(self, ncm_label):
        queries_file = "pod_alerts.yaml"
        output_file = f"/opt/prometheus/rules/rule_{self.file_name_format}.yaml"

        generator = PrometheusRuleGenerator(self.config_file, queries_file, output_file, ncm_label)
        generator.run()

    def run_prometheus_instance(self):
        
        container_name = f"prometheus_{self.file_name_format}"
        config_path = f"/opt/prometheus/prometheus_{self.file_name_format}.yaml"
        manager = PrometheusDockerManager(
            container_name=container_name,
            config_path=config_path,
            host_port=None
        )
        
        ports = manager.get_ports_running()
            
        while True:
            host_port = random.randint(9095, 9150)
            if host_port in ports:
                print(f"Port {host_port} is repeated. Trying again...")
                continue
            else:
                print(f"Selected host port: {host_port}")
                break

        manager = PrometheusDockerManager(
            container_name=container_name,
            config_path=config_path,
            host_port=host_port
        )

        if manager.is_container_running():
            print("Prometheus is already running; restarting it.")
            manager.restart_container()
        else:
            print("Prometheus is not running; starting new instance.")
            manager.run_container()

    def restart_alertmanager(self):
        container_name = f"prometheus_{self.file_name_format}"
        network = "monitoring"
        manage_alert = AlertManager(container_name, network)
        manage_alert.network_connect()
        #manage_alert.restart_container()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <config_file.json>")
        sys.exit(1)

    config_file = sys.argv[1]  # The user‑provided config file

    # INPUTS - Customize these for your environment
    kubeconfig_path = "/home/nutanix/ncm.cfg"
    prom_namespace = "ntnx-system"
    svc_name = "prometheus-k8s"
    new_svc_name = "prometheus-k8s-automation"

    run_monitoring = RunNCMonitoring(
        kubeconfig_path=kubeconfig_path,
        svc_name=svc_name,
        prom_namespace=prom_namespace,
        new_svc_name=new_svc_name,
        config_file=config_file
    )

    # Connect to PC, expose Prometheus
    ncm_ip, ncm_node, node_port = run_monitoring.ncm_connect()
    print(f"ncm_ip: {ncm_ip}, ncm_node: {ncm_node}, node_port: {node_port}")

    # Generate rules.yaml file
    run_monitoring.generate_rule_yaml(ncm_node)

    # Generate prometheus.yaml file
    run_monitoring.create_prometheus_config(ncm_ip, node_port)

    # Run Prometheus as a separate instance
    run_monitoring.run_prometheus_instance()

    #Setup network connection between prom and alertmanager and restart alertmanager
    run_monitoring.restart_alertmanager()

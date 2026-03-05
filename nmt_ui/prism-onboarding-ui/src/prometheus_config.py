import yaml
import os
from os import system

class PrometheusNCMUpdater():
    def __init__(self, config_file, ncm_ip, port, rule_file, output_file):
        self.config_file = config_file
        self.ncm_ip = ncm_ip
        self.port= port
        self.rule_file =rule_file
        self.output_file=output_file

        self.load_config()

    def load_config(self):
        with open(self.config_file, 'r') as f:
            self.config = yaml.safe_load(f)

    def file_exists(self,output_file):

        file_path = f'{self.output_file}'
        if os.path.isfile(file_path):
            return True
        else:
            return False



    def create_prom_config(self, ncm_ip, port, rule_file, output_file):
        ip_port = f"{ncm_ip}:{port}"
        
        if self.file_exists(output_file):
           print(f"{self.output_file} already exists in config. Skipping...")
           return

        # Create new scrape_config entry
        new_scrape = {
            'job_name': f'prometheus_federate_ncm{ncm_ip}',
            'metrics_path': '/federate',
            'params': {
                'match[]': [
                    '{job="node-exporter"}',
                    '{__name__=~"node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate|cluster:namespace:pod_cpu:active:kube_pod_container_resource_requests|node_namespace_pod_container:container_memory_working_set_bytes|cluster:namespace:pod_memory:active:kube_pod_container_resource_requests|instance:node_cpu_utilisation:rate5m|instance:node_memory_utilisation:ratio|node_load15"}'
                ]
            },
            'static_configs': [   
                {'targets': [ip_port]}
            ],
            'relabel_configs': [
                {
                    'source_labels': ['__address__'],
                    'target_label': 'ncm',
                    'replacement': f'ncm-{ncm_ip}'
                }
            ]
        }

        # Initialize scrape_configs if not present
        if self.config.get('scrape_configs') is None:
            self.config['scrape_configs'] = []

        self.config['scrape_configs'].append(new_scrape)

        self.config['rule_files'] = [f'{rule_file}']
        #print (self.config)


    def save_config(self, output_path=None):
        if self.file_exists(self.output_file):
           print(f"{self.output_file} already exists in config. Skipping...")
           return
        path = output_path if output_path else self.config_file
        with open(path, 'w') as f:
            yaml.dump(self.config, f, default_flow_style=False)
        print(f"Updated Prometheus config saved at {path}")

if __name__ == "__main__":
    pc_ip = "10.1.1.11"
    ncm_ip = "1.3.2.1"
    node_port = "343434"
    config_file = "prometheus_input.yaml" #input file path
    formatted_pc_ip = pc_ip.replace('.', '_')
    rule_file = f"/opt/prometheus/rules/rule_{formatted_pc_ip}.yaml"
    output_file = f"/etc/prometheus/prometheus_{formatted_pc_ip}.yaml"
    updater = PrometheusNCMUpdater(config_file, ncm_ip, node_port, rule_file, output_file)
    #file_exists = updater.file_exists()
    
    #if not file_exists:
    #    return
    updater.create_prom_config(ncm_ip, node_port, rule_file, output_file)
    updater.save_config(output_file)  # final output file
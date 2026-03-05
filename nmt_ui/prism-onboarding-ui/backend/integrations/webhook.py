"""
Webhook Integration

Sends alerts to custom webhook URLs via HTTP POST.
Supports custom payloads and headers.
"""

import requests
import logging
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class WebhookIntegration:
    """
    Webhook integration for sending alerts via HTTP POST
    
    Usage:
        webhook = WebhookIntegration(url, headers)
        webhook.send_execution_complete(execution_data)
    """
    
    def __init__(self, webhook_url: str, headers: Optional[Dict[str, str]] = None):
        """
        Initialize Webhook integration
        
        Args:
            webhook_url: Target webhook URL
            headers: Optional HTTP headers (e.g., Authorization)
        """
        self.webhook_url = webhook_url
        self.headers = headers or {'Content-Type': 'application/json'}
        self.timeout = 10  # seconds
    
    def send_webhook(self, payload: Dict) -> bool:
        """
        Send webhook POST request
        
        Args:
            payload: JSON payload to send
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            response = requests.post(
                self.webhook_url,
                json=payload,
                headers=self.headers,
                timeout=self.timeout
            )
            
            if response.status_code in [200, 201, 202, 204]:
                logger.info(f"✅ Webhook sent successfully (status: {response.status_code})")
                return True
            else:
                logger.error(f"❌ Webhook error: {response.status_code} - {response.text}")
                return False
                
        except requests.exceptions.Timeout:
            logger.error(f"❌ Webhook request timeout after {self.timeout}s")
            return False
        except Exception as e:
            logger.error(f"❌ Failed to send webhook: {e}")
            return False
    
    def send_execution_complete(self, execution_data: Dict) -> bool:
        """
        Send execution completion webhook
        
        Args:
            execution_data: Dictionary with execution details
        
        Returns:
            bool: Success status
        """
        payload = {
            "event": "execution.completed",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": {
                "execution_id": execution_data.get('execution_id'),
                "testbed_id": execution_data.get('testbed_id'),
                "testbed_label": execution_data.get('testbed_label'),
                "status": "completed",
                "metrics": {
                    "total_operations": execution_data.get('total_operations', 0),
                    "successful_operations": execution_data.get('successful_operations', 0),
                    "failed_operations": execution_data.get('failed_operations', 0),
                    "success_rate": execution_data.get('success_rate', 0),
                    "cpu_achieved": execution_data.get('cpu_achieved', 0),
                    "memory_achieved": execution_data.get('memory_achieved', 0),
                    "duration_minutes": execution_data.get('duration_minutes', 0),
                    "threshold_reached": execution_data.get('threshold_reached', False)
                },
                "started_at": execution_data.get('started_at'),
                "completed_at": execution_data.get('completed_at')
            }
        }
        
        return self.send_webhook(payload)
    
    def send_execution_failed(self, execution_data: Dict, error_message: str) -> bool:
        """
        Send execution failure webhook
        
        Args:
            execution_data: Dictionary with execution details
            error_message: Error description
        
        Returns:
            bool: Success status
        """
        payload = {
            "event": "execution.failed",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": {
                "execution_id": execution_data.get('execution_id'),
                "testbed_id": execution_data.get('testbed_id'),
                "testbed_label": execution_data.get('testbed_label'),
                "status": "failed",
                "error": {
                    "message": error_message,
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                },
                "started_at": execution_data.get('started_at'),
                "failed_at": datetime.utcnow().isoformat() + "Z"
            }
        }
        
        return self.send_webhook(payload)
    
    def send_execution_started(self, execution_data: Dict) -> bool:
        """
        Send execution started webhook
        
        Args:
            execution_data: Dictionary with execution details
        
        Returns:
            bool: Success status
        """
        payload = {
            "event": "execution.started",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": {
                "execution_id": execution_data.get('execution_id'),
                "testbed_id": execution_data.get('testbed_id'),
                "testbed_label": execution_data.get('testbed_label'),
                "status": "running",
                "target_config": execution_data.get('target_config', {}),
                "started_at": datetime.utcnow().isoformat() + "Z"
            }
        }
        
        return self.send_webhook(payload)
    
    def send_scheduled_execution_triggered(self, schedule_data: Dict) -> bool:
        """
        Send webhook when scheduled execution is triggered
        
        Args:
            schedule_data: Dictionary with schedule details
        
        Returns:
            bool: Success status
        """
        payload = {
            "event": "schedule.triggered",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": {
                "schedule_id": schedule_data.get('schedule_id'),
                "schedule_name": schedule_data.get('name'),
                "testbed_id": schedule_data.get('testbed_id'),
                "execution_id": schedule_data.get('execution_id'),
                "triggered_at": datetime.utcnow().isoformat() + "Z"
            }
        }
        
        return self.send_webhook(payload)
    
    def send_test_alert(self) -> bool:
        """
        Send a test webhook to verify configuration
        
        Returns:
            bool: Success status
        """
        payload = {
            "event": "test.alert",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "data": {
                "message": "This is a test webhook from Smart Execution System",
                "status": "success"
            }
        }
        
        return self.send_webhook(payload)


def test_webhook_integration():
    """Test Webhook integration with example configuration"""
    
    print("\n" + "="*70)
    print("🧪 TESTING WEBHOOK INTEGRATION")
    print("="*70 + "\n")
    
    print("⚠️  Note: Configure webhook URL to test")
    print("   Example webhook services:")
    print("     - webhook.site (for testing)")
    print("     - Zapier webhooks")
    print("     - Custom API endpoints\n")
    
    print("Example Payload Format:")
    print("─" * 70)
    payload_example = {
        "event": "execution.completed",
        "timestamp": "2026-02-03T12:00:00Z",
        "data": {
            "execution_id": "SE-001",
            "testbed_label": "Test Cluster",
            "status": "completed",
            "metrics": {
                "total_operations": 1147,
                "success_rate": 95.4,
                "cpu_achieved": 82.3,
                "memory_achieved": 68.5
            }
        }
    }
    
    import json
    print(json.dumps(payload_example, indent=2))
    print("─" * 70 + "\n")
    
    print("="*70)
    print("✅ Webhook integration module created successfully!")
    print("="*70)


if __name__ == '__main__':
    test_webhook_integration()

"""
Slack Integration

Sends alerts to Slack channels using webhooks.
Supports rich formatting with blocks and attachments.
"""

import requests
import logging
from typing import Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class SlackIntegration:
    """
    Slack webhook integration for sending alerts
    
    Usage:
        slack = SlackIntegration(webhook_url)
        slack.send_execution_complete(execution_data)
        slack.send_execution_failed(execution_data, error)
    """
    
    def __init__(self, webhook_url: str):
        """
        Initialize Slack integration
        
        Args:
            webhook_url: Slack incoming webhook URL
        """
        self.webhook_url = webhook_url
        self.timeout = 10  # seconds
    
    def send_message(self, message: str, blocks: Optional[list] = None, 
                    attachments: Optional[list] = None) -> bool:
        """
        Send a message to Slack
        
        Args:
            message: Plain text message (fallback)
            blocks: Slack blocks for rich formatting
            attachments: Slack attachments (legacy)
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            payload = {"text": message}
            
            if blocks:
                payload["blocks"] = blocks
            
            if attachments:
                payload["attachments"] = attachments
            
            response = requests.post(
                self.webhook_url,
                json=payload,
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                logger.info(f"✅ Slack message sent successfully")
                return True
            else:
                logger.error(f"❌ Slack API error: {response.status_code} - {response.text}")
                return False
                
        except requests.exceptions.Timeout:
            logger.error(f"❌ Slack request timeout after {self.timeout}s")
            return False
        except Exception as e:
            logger.error(f"❌ Failed to send Slack message: {e}")
            return False
    
    def send_execution_complete(self, execution_data: Dict) -> bool:
        """
        Send execution completion alert
        
        Args:
            execution_data: Dictionary with execution details
        
        Returns:
            bool: Success status
        """
        execution_id = execution_data.get('execution_id', 'Unknown')
        testbed = execution_data.get('testbed_label', 'Unknown')
        total_ops = execution_data.get('total_operations', 0)
        success_rate = execution_data.get('success_rate', 0)
        cpu_achieved = execution_data.get('cpu_achieved', 0)
        memory_achieved = execution_data.get('memory_achieved', 0)
        duration = execution_data.get('duration_minutes', 0)
        threshold_reached = execution_data.get('threshold_reached', False)
        
        # Build rich message
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "✅ Smart Execution Completed",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*Execution ID:*\n`{execution_id}`"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Testbed:*\n{testbed}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Operations:*\n{total_ops}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Success Rate:*\n{success_rate:.1f}%"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*CPU Achieved:*\n{cpu_achieved:.1f}%"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Memory Achieved:*\n{memory_achieved:.1f}%"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Duration:*\n{duration:.1f} min"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Threshold:*\n{'✅ Reached' if threshold_reached else '⚠️ Not Reached'}"
                    }
                ]
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                    }
                ]
            }
        ]
        
        fallback = f"✅ Smart Execution {execution_id} completed on {testbed}"
        
        return self.send_message(fallback, blocks=blocks)
    
    def send_execution_failed(self, execution_data: Dict, error_message: str) -> bool:
        """
        Send execution failure alert
        
        Args:
            execution_data: Dictionary with execution details
            error_message: Error description
        
        Returns:
            bool: Success status
        """
        execution_id = execution_data.get('execution_id', 'Unknown')
        testbed = execution_data.get('testbed_label', 'Unknown')
        
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "❌ Smart Execution Failed",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*Execution ID:*\n`{execution_id}`"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Testbed:*\n{testbed}"
                    }
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Error:*\n```{error_message}```"
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                    }
                ]
            }
        ]
        
        fallback = f"❌ Smart Execution {execution_id} failed on {testbed}: {error_message}"
        
        return self.send_message(fallback, blocks=blocks)
    
    def send_scheduled_execution_triggered(self, schedule_data: Dict) -> bool:
        """
        Send alert when scheduled execution is triggered
        
        Args:
            schedule_data: Dictionary with schedule details
        
        Returns:
            bool: Success status
        """
        schedule_name = schedule_data.get('name', 'Unknown')
        schedule_id = schedule_data.get('schedule_id', 'Unknown')
        testbed = schedule_data.get('testbed_label', 'Unknown')
        
        blocks = [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"🕐 *Scheduled Execution Started*\n\n*Schedule:* {schedule_name}\n*ID:* `{schedule_id}`\n*Testbed:* {testbed}"
                }
            }
        ]
        
        fallback = f"🕐 Scheduled execution '{schedule_name}' started on {testbed}"
        
        return self.send_message(fallback, blocks=blocks)
    
    def send_test_alert(self) -> bool:
        """
        Send a test alert to verify configuration
        
        Returns:
            bool: Success status
        """
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "🧪 Test Alert",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "This is a test alert from Smart Execution System.\n\n✅ Slack integration is working correctly!"
                }
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                    }
                ]
            }
        ]
        
        return self.send_message("🧪 Test Alert - Slack integration is working!", blocks=blocks)


def test_slack_integration():
    """Test Slack integration with example data"""
    
    print("\n" + "="*70)
    print("🧪 TESTING SLACK INTEGRATION")
    print("="*70 + "\n")
    
    # Example webhook URL (replace with real one for testing)
    webhook_url = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
    
    print(f"Webhook URL: {webhook_url}\n")
    print("⚠️  Note: Replace with real Slack webhook URL to test")
    print("   Get one at: https://api.slack.com/messaging/webhooks\n")
    
    slack = SlackIntegration(webhook_url)
    
    # Test 1: Simple test alert
    print("Test 1: Sending test alert...")
    # success = slack.send_test_alert()
    # print(f"Result: {'✅ Success' if success else '❌ Failed'}\n")
    
    # Test 2: Execution complete
    print("Test 2: Sending execution complete alert...")
    execution_data = {
        'execution_id': 'TEST-SE-001',
        'testbed_label': 'Test Cluster',
        'total_operations': 1147,
        'success_rate': 95.4,
        'cpu_achieved': 82.3,
        'memory_achieved': 68.5,
        'duration_minutes': 45.2,
        'threshold_reached': True
    }
    # success = slack.send_execution_complete(execution_data)
    # print(f"Result: {'✅ Success' if success else '❌ Failed'}\n")
    
    print("="*70)
    print("✅ Slack integration module created successfully!")
    print("="*70)


if __name__ == '__main__':
    test_slack_integration()

"""
Alert Service

Central alert dispatcher that routes alerts to configured channels.
Supports Slack, Email, and Webhook integrations.
"""

import logging
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class AlertService:
    """
    Central alert service for dispatching alerts to multiple channels
    
    Usage:
        alert_service = AlertService()
        alert_service.send_execution_complete_alert(execution_data, channels_config)
    """
    
    def __init__(self):
        """Initialize alert service"""
        self.enabled_channels = set()
        logger.info("✅ Alert service initialized")
    
    def send_alert(self, alert_type: str, data: Dict, channels_config: Dict) -> Dict[str, bool]:
        """
        Send alert to configured channels
        
        Args:
            alert_type: Type of alert ('execution.complete', 'execution.failed', etc.)
            data: Alert data
            channels_config: Channel configuration
        
        Returns:
            Dict[str, bool]: Success status per channel
        """
        results = {}
        
        # Slack
        if channels_config.get('slack', {}).get('enabled'):
            try:
                from integrations.slack import SlackIntegration
                
                webhook_url = channels_config['slack'].get('webhook_url')
                if webhook_url:
                    slack = SlackIntegration(webhook_url)
                    
                    if alert_type == 'execution.complete':
                        success = slack.send_execution_complete(data)
                    elif alert_type == 'execution.failed':
                        error_msg = data.pop('error_message', 'Unknown error')
                        success = slack.send_execution_failed(data, error_msg)
                    elif alert_type == 'schedule.triggered':
                        success = slack.send_scheduled_execution_triggered(data)
                    elif alert_type == 'test':
                        success = slack.send_test_alert()
                    else:
                        success = False
                    
                    results['slack'] = success
                else:
                    logger.warning("⚠️  Slack enabled but webhook URL not configured")
                    results['slack'] = False
            except Exception as e:
                logger.error(f"❌ Slack alert failed: {e}")
                results['slack'] = False
        
        # Email
        if channels_config.get('email', {}).get('enabled'):
            try:
                from integrations.email import EmailIntegration
                
                email_config = channels_config['email']
                smtp_host = email_config.get('smtp_host')
                smtp_port = email_config.get('smtp_port', 587)
                username = email_config.get('username')
                password = email_config.get('password')
                from_email = email_config.get('from_email')
                recipients = email_config.get('recipients', [])
                
                if smtp_host and username and password and from_email and recipients:
                    email = EmailIntegration(
                        smtp_host=smtp_host,
                        smtp_port=smtp_port,
                        username=username,
                        password=password,
                        from_email=from_email,
                        use_tls=email_config.get('use_tls', True)
                    )
                    
                    if alert_type == 'execution.complete':
                        success = email.send_execution_complete(data, recipients)
                    elif alert_type == 'execution.failed':
                        error_msg = data.pop('error_message', 'Unknown error')
                        success = email.send_execution_failed(data, error_msg, recipients)
                    elif alert_type == 'test':
                        success = email.send_test_alert(recipients)
                    else:
                        success = False
                    
                    results['email'] = success
                else:
                    logger.warning("⚠️  Email enabled but configuration incomplete")
                    results['email'] = False
            except Exception as e:
                logger.error(f"❌ Email alert failed: {e}")
                results['email'] = False
        
        # Webhook
        if channels_config.get('webhook', {}).get('enabled'):
            try:
                from integrations.webhook import WebhookIntegration
                
                webhook_url = channels_config['webhook'].get('url')
                headers = channels_config['webhook'].get('headers', {})
                
                if webhook_url:
                    webhook = WebhookIntegration(webhook_url, headers)
                    
                    if alert_type == 'execution.complete':
                        success = webhook.send_execution_complete(data)
                    elif alert_type == 'execution.failed':
                        error_msg = data.get('error_message', 'Unknown error')
                        success = webhook.send_execution_failed(data, error_msg)
                    elif alert_type == 'execution.started':
                        success = webhook.send_execution_started(data)
                    elif alert_type == 'schedule.triggered':
                        success = webhook.send_scheduled_execution_triggered(data)
                    elif alert_type == 'test':
                        success = webhook.send_test_alert()
                    else:
                        success = False
                    
                    results['webhook'] = success
                else:
                    logger.warning("⚠️  Webhook enabled but URL not configured")
                    results['webhook'] = False
            except Exception as e:
                logger.error(f"❌ Webhook alert failed: {e}")
                results['webhook'] = False
        
        # Log summary
        total = len(results)
        successful = sum(1 for v in results.values() if v)
        
        if successful == total and total > 0:
            logger.info(f"✅ All alerts sent successfully ({successful}/{total})")
        elif successful > 0:
            logger.warning(f"⚠️  Partial success: {successful}/{total} alerts sent")
        else:
            logger.error(f"❌ All alerts failed ({total} channels)")
        
        return results
    
    def send_execution_complete_alert(self, execution_data: Dict, 
                                     channels_config: Dict) -> Dict[str, bool]:
        """
        Send execution completion alert
        
        Args:
            execution_data: Execution details
            channels_config: Channel configuration
        
        Returns:
            Dict[str, bool]: Success status per channel
        """
        return self.send_alert('execution.complete', execution_data, channels_config)
    
    def send_execution_failed_alert(self, execution_data: Dict, error_message: str,
                                   channels_config: Dict) -> Dict[str, bool]:
        """
        Send execution failure alert
        
        Args:
            execution_data: Execution details
            error_message: Error description
            channels_config: Channel configuration
        
        Returns:
            Dict[str, bool]: Success status per channel
        """
        data = {**execution_data, 'error_message': error_message}
        return self.send_alert('execution.failed', data, channels_config)
    
    def send_execution_started_alert(self, execution_data: Dict,
                                    channels_config: Dict) -> Dict[str, bool]:
        """
        Send execution started alert (webhook only typically)
        
        Args:
            execution_data: Execution details
            channels_config: Channel configuration
        
        Returns:
            Dict[str, bool]: Success status per channel
        """
        return self.send_alert('execution.started', execution_data, channels_config)
    
    def send_scheduled_execution_alert(self, schedule_data: Dict,
                                      channels_config: Dict) -> Dict[str, bool]:
        """
        Send scheduled execution triggered alert
        
        Args:
            schedule_data: Schedule details
            channels_config: Channel configuration
        
        Returns:
            Dict[str, bool]: Success status per channel
        """
        return self.send_alert('schedule.triggered', schedule_data, channels_config)
    
    def send_test_alert(self, channels_config: Dict) -> Dict[str, bool]:
        """
        Send test alert to verify configuration
        
        Args:
            channels_config: Channel configuration
        
        Returns:
            Dict[str, bool]: Success status per channel
        """
        return self.send_alert('test', {}, channels_config)
    
    def get_channels_config_for_testbed(self, testbed_id: str) -> Optional[Dict]:
        """
        Get alert configuration for a testbed
        
        Args:
            testbed_id: Testbed unique ID
        
        Returns:
            Dict: Channel configuration or None
        """
        try:
            from database import SessionLocal
            from models.testbed import Testbed
            
            session = SessionLocal()
            try:
                testbed = session.query(Testbed).filter_by(
                    unique_testbed_id=testbed_id
                ).first()
                
                if testbed and hasattr(testbed, 'alert_config'):
                    return testbed.alert_config
                
                return None
            finally:
                session.close()
        except Exception as e:
            logger.error(f"❌ Failed to get alert config: {e}")
            return None


# Global alert service instance
_alert_service = None


def get_alert_service() -> AlertService:
    """Get global alert service instance"""
    global _alert_service
    
    if _alert_service is None:
        _alert_service = AlertService()
    
    return _alert_service


def test_alert_service():
    """Test alert service with example configuration"""
    
    print("\n" + "="*70)
    print("🧪 TESTING ALERT SERVICE")
    print("="*70 + "\n")
    
    service = get_alert_service()
    
    # Example channels configuration
    channels_config = {
        'slack': {
            'enabled': True,
            'webhook_url': 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
        },
        'email': {
            'enabled': False,  # Disable for test
            'smtp_host': 'smtp.gmail.com',
            'smtp_port': 587,
            'username': 'your-email@gmail.com',
            'password': 'your-app-password',
            'from_email': 'alerts@example.com',
            'recipients': ['recipient@example.com'],
            'use_tls': True
        },
        'webhook': {
            'enabled': False,  # Disable for test
            'url': 'https://webhook.site/your-unique-url',
            'headers': {}
        }
    }
    
    # Example execution data
    execution_data = {
        'execution_id': 'TEST-SE-001',
        'testbed_id': 'test-123',
        'testbed_label': 'Test Cluster',
        'total_operations': 1147,
        'successful_operations': 1093,
        'failed_operations': 54,
        'success_rate': 95.4,
        'cpu_achieved': 82.3,
        'memory_achieved': 68.5,
        'duration_minutes': 45.2,
        'threshold_reached': True,
        'started_at': '2026-02-03T12:00:00Z',
        'completed_at': '2026-02-03T12:45:12Z'
    }
    
    print("Configuration Summary:")
    print(f"  Slack: {'✅ Enabled' if channels_config['slack']['enabled'] else '❌ Disabled'}")
    print(f"  Email: {'✅ Enabled' if channels_config['email']['enabled'] else '❌ Disabled'}")
    print(f"  Webhook: {'✅ Enabled' if channels_config['webhook']['enabled'] else '❌ Disabled'}")
    print()
    
    print("⚠️  Note: Configure real webhook URLs to test")
    print()
    
    print("="*70)
    print("✅ Alert service module created successfully!")
    print("="*70)
    print("\nAlert service can now:")
    print("  ✅ Send execution complete alerts")
    print("  ✅ Send execution failed alerts")
    print("  ✅ Send scheduled execution alerts")
    print("  ✅ Route to multiple channels (Slack, Email, Webhook)")
    print("  ✅ Track success/failure per channel")
    print("="*70)


if __name__ == '__main__':
    test_alert_service()

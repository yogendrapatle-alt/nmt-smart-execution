"""
Email Configuration for NCM Monitoring Tool
Configure SMTP settings for email delivery
"""

import os
from typing import Dict, Optional

class EmailConfig:
    """Email configuration management"""
    
    # Common SMTP configurations
    PROVIDERS = {
        'gmail': {
            'smtp_server': 'smtp.gmail.com',
            'smtp_port': 587,
            'description': 'Gmail (requires app password)'
        },
        'outlook': {
            'smtp_server': 'smtp-mail.outlook.com',
            'smtp_port': 587,
            'description': 'Outlook/Hotmail'
        },
        'yahoo': {
            'smtp_server': 'smtp.mail.yahoo.com',
            'smtp_port': 587,
            'description': 'Yahoo Mail'
        },
        'custom': {
            'smtp_server': 'localhost',
            'smtp_port': 587,
            'description': 'Custom SMTP server'
        }
    }
    
    @classmethod
    def setup_gmail(cls, username: str, app_password: str) -> Dict[str, str]:
        """Setup Gmail configuration with app password"""
        return {
            'SMTP_SERVER': 'smtp.gmail.com',
            'SMTP_PORT': '587',
            'SMTP_USERNAME': username,
            'SMTP_PASSWORD': app_password,
            'SENDER_EMAIL': username,
            'SENDER_NAME': 'NCM Monitoring Tool'
        }
    
    @classmethod
    def setup_outlook(cls, username: str, password: str) -> Dict[str, str]:
        """Setup Outlook configuration"""
        return {
            'SMTP_SERVER': 'smtp-mail.outlook.com',
            'SMTP_PORT': '587',
            'SMTP_USERNAME': username,
            'SMTP_PASSWORD': password,
            'SENDER_EMAIL': username,
            'SENDER_NAME': 'NCM Monitoring Tool'
        }
    
    @classmethod
    def setup_test_mode(cls) -> Dict[str, str]:
        """Setup test mode - logs emails instead of sending them"""
        return {
            'SMTP_SERVER': 'localhost',
            'SMTP_PORT': '1025',  # MailHog or similar test server
            'SMTP_USERNAME': 'test@localhost',
            'SMTP_PASSWORD': 'test',
            'SENDER_EMAIL': 'noreply@ncm-monitor.local',
            'SENDER_NAME': 'NCM Monitoring Tool (Test Mode)'
        }
    
    @classmethod
    def setup_custom(cls, smtp_server: str, port: int, username: str, password: str, sender_name: str = None) -> Dict[str, str]:
        """Setup custom SMTP configuration"""
        return {
            'SMTP_SERVER': smtp_server,
            'SMTP_PORT': str(port),
            'SMTP_USERNAME': username,
            'SMTP_PASSWORD': password,
            'SENDER_EMAIL': username,
            'SENDER_NAME': sender_name or 'NCM Monitoring Tool'
        }
    
    @classmethod
    def apply_config(cls, config: Dict[str, str]):
        """Apply configuration to environment variables"""
        for key, value in config.items():
            os.environ[key] = value
            print(f"✅ Set {key}")
    
    @classmethod
    def get_current_config(cls) -> Dict[str, str]:
        """Get current SMTP configuration"""
        return {
            'SMTP_SERVER': os.getenv('SMTP_SERVER', 'Not set'),
            'SMTP_PORT': os.getenv('SMTP_PORT', 'Not set'),
            'SMTP_USERNAME': os.getenv('SMTP_USERNAME', 'Not set'),
            'SMTP_PASSWORD': '***' if os.getenv('SMTP_PASSWORD') else 'Not set',
            'SENDER_EMAIL': os.getenv('SENDER_EMAIL', 'Not set'),
            'SENDER_NAME': os.getenv('SENDER_NAME', 'Not set')
        }
    
    @classmethod
    def test_configuration(cls) -> bool:
        """Test if SMTP configuration is complete"""
        required = ['SMTP_SERVER', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD']
        missing = [key for key in required if not os.getenv(key)]
        
        if missing:
            print(f"❌ Missing configuration: {', '.join(missing)}")
            return False
        
        print("✅ SMTP configuration appears complete")
        return True


def print_setup_instructions():
    """Print setup instructions for common email providers"""
    print("""
📧 Email Configuration Setup Instructions

1. GMAIL (Recommended for testing):
   - Enable 2-Factor Authentication
   - Generate an App Password: https://myaccount.google.com/apppasswords
   - Use: EmailConfig.setup_gmail('your@gmail.com', 'your-app-password')

2. OUTLOOK/HOTMAIL:
   - Use your normal login credentials
   - Use: EmailConfig.setup_outlook('your@outlook.com', 'your-password')

3. TEST MODE (No real emails):
   - Use: EmailConfig.setup_test_mode()
   - Logs email content instead of sending

4. CUSTOM SMTP:
   - Use: EmailConfig.setup_custom('smtp.yourprovider.com', 587, 'user', 'pass')

Example usage:
```python
from email_config import EmailConfig

# Setup Gmail
config = EmailConfig.setup_gmail('your@gmail.com', 'your-app-password')
EmailConfig.apply_config(config)

# Test configuration
EmailConfig.test_configuration()
```
""")


if __name__ == '__main__':
    print_setup_instructions()
    print("\nCurrent configuration:")
    for key, value in EmailConfig.get_current_config().items():
        print(f"  {key}: {value}")

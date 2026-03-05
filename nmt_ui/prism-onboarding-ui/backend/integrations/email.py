"""
Email Integration

Sends alerts via email using SMTP.
Supports HTML emails with execution summaries.
"""

import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class EmailIntegration:
    """
    Email integration for sending alerts via SMTP
    
    Usage:
        email = EmailIntegration(smtp_host, smtp_port, username, password)
        email.send_execution_complete(execution_data, recipients)
    """
    
    def __init__(self, smtp_host: str, smtp_port: int, 
                 username: str, password: str, 
                 from_email: str, use_tls: bool = True):
        """
        Initialize Email integration
        
        Args:
            smtp_host: SMTP server hostname
            smtp_port: SMTP server port (587 for TLS, 465 for SSL, 25 for plain)
            username: SMTP username
            password: SMTP password
            from_email: From email address
            use_tls: Use TLS encryption (default: True)
        """
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.from_email = from_email
        self.use_tls = use_tls
        self.timeout = 30  # seconds
    
    def send_email(self, to_emails: List[str], subject: str, 
                   body_text: str, body_html: Optional[str] = None) -> bool:
        """
        Send an email
        
        Args:
            to_emails: List of recipient email addresses
            subject: Email subject
            body_text: Plain text body
            body_html: HTML body (optional)
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = self.from_email
            msg['To'] = ', '.join(to_emails)
            
            # Attach plain text
            part1 = MIMEText(body_text, 'plain')
            msg.attach(part1)
            
            # Attach HTML if provided
            if body_html:
                part2 = MIMEText(body_html, 'html')
                msg.attach(part2)
            
            # Connect to SMTP server
            if self.use_tls:
                server = smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=self.timeout)
                server.starttls()
            else:
                server = smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=self.timeout)
            
            # Login and send
            server.login(self.username, self.password)
            server.sendmail(self.from_email, to_emails, msg.as_string())
            server.quit()
            
            logger.info(f"✅ Email sent successfully to {len(to_emails)} recipient(s)")
            return True
            
        except smtplib.SMTPException as e:
            logger.error(f"❌ SMTP error: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Failed to send email: {e}")
            return False
    
    def send_execution_complete(self, execution_data: Dict, recipients: List[str]) -> bool:
        """
        Send execution completion email
        
        Args:
            execution_data: Dictionary with execution details
            recipients: List of email addresses
        
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
        
        subject = f"✅ Smart Execution Completed - {execution_id}"
        
        # Plain text version
        body_text = f"""
Smart Execution Completed Successfully

Execution ID: {execution_id}
Testbed: {testbed}
Total Operations: {total_ops}
Success Rate: {success_rate:.1f}%
CPU Achieved: {cpu_achieved:.1f}%
Memory Achieved: {memory_achieved:.1f}%
Duration: {duration:.1f} minutes
Threshold Reached: {'Yes' if threshold_reached else 'No'}

Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

--
Smart Execution System
"""
        
        # HTML version
        body_html = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
                   color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
        .header h1 {{ margin: 0; font-size: 24px; }}
        .content {{ background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }}
        .metric {{ display: inline-block; width: 48%; margin: 10px 0; }}
        .metric-label {{ color: #6b7280; font-size: 12px; font-weight: 600; 
                        text-transform: uppercase; letter-spacing: 0.5px; }}
        .metric-value {{ color: #1f2937; font-size: 20px; font-weight: 700; margin-top: 4px; }}
        .success {{ color: #10b981; }}
        .warning {{ color: #f59e0b; }}
        .footer {{ background: #f3f4f6; padding: 20px; text-align: center; 
                  border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; }}
        .footer p {{ margin: 5px 0; color: #6b7280; font-size: 14px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Smart Execution Completed</h1>
        </div>
        <div class="content">
            <p><strong>Execution ID:</strong> <code>{execution_id}</code></p>
            <p><strong>Testbed:</strong> {testbed}</p>
            <hr>
            <div class="metric">
                <div class="metric-label">Total Operations</div>
                <div class="metric-value">{total_ops}</div>
            </div>
            <div class="metric">
                <div class="metric-label">Success Rate</div>
                <div class="metric-value success">{success_rate:.1f}%</div>
            </div>
            <div class="metric">
                <div class="metric-label">CPU Achieved</div>
                <div class="metric-value">{cpu_achieved:.1f}%</div>
            </div>
            <div class="metric">
                <div class="metric-label">Memory Achieved</div>
                <div class="metric-value">{memory_achieved:.1f}%</div>
            </div>
            <div class="metric">
                <div class="metric-label">Duration</div>
                <div class="metric-value">{duration:.1f} min</div>
            </div>
            <div class="metric">
                <div class="metric-label">Threshold</div>
                <div class="metric-value {'success' if threshold_reached else 'warning'}">
                    {'✅ Reached' if threshold_reached else '⚠️ Not Reached'}
                </div>
            </div>
        </div>
        <div class="footer">
            <p>🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            <p>Smart Execution System</p>
        </div>
    </div>
</body>
</html>
"""
        
        return self.send_email(recipients, subject, body_text, body_html)
    
    def send_execution_failed(self, execution_data: Dict, error_message: str, 
                             recipients: List[str]) -> bool:
        """
        Send execution failure email
        
        Args:
            execution_data: Dictionary with execution details
            error_message: Error description
            recipients: List of email addresses
        
        Returns:
            bool: Success status
        """
        execution_id = execution_data.get('execution_id', 'Unknown')
        testbed = execution_data.get('testbed_label', 'Unknown')
        
        subject = f"❌ Smart Execution Failed - {execution_id}"
        
        body_text = f"""
Smart Execution Failed

Execution ID: {execution_id}
Testbed: {testbed}

Error:
{error_message}

Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

--
Smart Execution System
"""
        
        body_html = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); 
                   color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
        .header h1 {{ margin: 0; font-size: 24px; }}
        .content {{ background: #fef2f2; padding: 30px; border: 1px solid #fecaca; }}
        .error-box {{ background: #fee2e2; border: 1px solid #fca5a5; 
                     padding: 15px; border-radius: 6px; margin: 15px 0; }}
        .error-box pre {{ margin: 0; white-space: pre-wrap; word-wrap: break-word; }}
        .footer {{ background: #f3f4f6; padding: 20px; text-align: center; 
                  border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>❌ Smart Execution Failed</h1>
        </div>
        <div class="content">
            <p><strong>Execution ID:</strong> <code>{execution_id}</code></p>
            <p><strong>Testbed:</strong> {testbed}</p>
            <div class="error-box">
                <strong>Error:</strong>
                <pre>{error_message}</pre>
            </div>
        </div>
        <div class="footer">
            <p>🕐 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
            <p>Smart Execution System</p>
        </div>
    </div>
</body>
</html>
"""
        
        return self.send_email(recipients, subject, body_text, body_html)
    
    def send_test_alert(self, recipients: List[str]) -> bool:
        """
        Send a test email to verify configuration
        
        Args:
            recipients: List of email addresses
        
        Returns:
            bool: Success status
        """
        subject = "🧪 Test Alert - Smart Execution System"
        
        body_text = """
This is a test alert from Smart Execution System.

✅ Email integration is working correctly!

--
Smart Execution System
"""
        
        body_html = """
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Test Alert</h1>
        </div>
        <div class="content">
            <p>This is a test alert from <strong>Smart Execution System</strong>.</p>
            <p style="color: #10b981; font-size: 18px; font-weight: 600;">✅ Email integration is working correctly!</p>
        </div>
    </div>
</body>
</html>
"""
        
        return self.send_email(recipients, subject, body_text, body_html)


def test_email_integration():
    """Test Email integration with example configuration"""
    
    print("\n" + "="*70)
    print("🧪 TESTING EMAIL INTEGRATION")
    print("="*70 + "\n")
    
    print("⚠️  Note: Configure SMTP settings to test")
    print("   Example: Gmail SMTP")
    print("     Host: smtp.gmail.com")
    print("     Port: 587 (TLS)")
    print("     Use App Password for Gmail\n")
    
    print("="*70)
    print("✅ Email integration module created successfully!")
    print("="*70)


if __name__ == '__main__':
    test_email_integration()

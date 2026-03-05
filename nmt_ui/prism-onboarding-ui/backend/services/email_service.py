"""
Email Service for sending alert reports
Handles SMTP configuration and email sending with PDF attachments
"""

import smtplib
import ssl
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from typing import List, Dict, Optional
from datetime import datetime
import os
import requests
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EmailService:
    def __init__(self):
        # Nutanix Internal Mail Relay Configuration (No Authentication Required)
        self.smtp_server = os.getenv('SMTP_SERVER', '10.4.8.37')  # Nutanix internal mail relay
        self.smtp_port = int(os.getenv('SMTP_PORT', '25'))        # Standard SMTP port for internal relay
        
        # Service account email (no credentials needed for internal relay)
        self.sender_email = os.getenv('SENDER_EMAIL', 'ncm-monitoring@nutanix.com')
        self.sender_name = os.getenv('SENDER_NAME', 'NCM Monitoring Tool')
        
        # Test mode - if True, logs emails instead of sending them
        self.test_mode = os.getenv('EMAIL_TEST_MODE', 'false').lower() == 'true'
        
        # Internal relay mode - no authentication required
        self.use_internal_relay = os.getenv('USE_INTERNAL_RELAY', 'true').lower() == 'true'
        
        # API base URL for fetching alert data
        self.api_base_url = os.getenv('API_BASE_URL', 'http://localhost:5000')
    
    def fetch_alert_data(self, filters: Dict) -> Dict:
        """Fetch alert data from the alerts API with filters applied"""
        try:
            # Build query parameters from schedule filters
            params = {}
            
            # Handle both frontend format (testbed_filter) and schedule format (testbed)
            testbed = filters.get('testbed') or filters.get('testbed_filter')
            if testbed and testbed.lower() != 'all':
                params['testbed'] = testbed
                
            severity = filters.get('severity') or filters.get('severity_filter')
            if severity and severity.lower() != 'all':
                params['severity'] = severity
                
            status = filters.get('status') or filters.get('status_filter')
            if status and status.lower() != 'all':
                params['status'] = status
                
            # Optional: Add date filter only if specifically provided
            date_filter = filters.get('date')
            if date_filter:
                params['date'] = date_filter
            
            # Build URL
            query_string = '&'.join([f"{k}={v}" for k, v in params.items()])
            url = f"{self.api_base_url}/api/alerts"
            if query_string:
                url += f"?{query_string}"
            
            logger.info(f"Fetching alerts from: {url}")
            
            # Make request (using urllib since requests might not be available)
            import urllib.request
            import urllib.parse
            
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read().decode())
                
            # Handle API response format: {"alerts": [...], "count": N}
            if isinstance(data, dict) and 'alerts' in data:
                alerts = data['alerts']
                total_count = data.get('count', len(alerts))
            else:
                # Fallback for direct list response
                alerts = data if isinstance(data, list) else []
                total_count = len(alerts)
                
            logger.info(f"Fetched {len(alerts)} alerts (total: {total_count})")
            
            return {
                'success': True,
                'alerts': alerts,
                'total_count': total_count
            }
            
        except Exception as e:
            logger.error(f"Error fetching alert data: {e}")
            return {
                'success': False,
                'alerts': [],
                'total_count': 0,
                'error': str(e)
            }
    
    def send_alert_report(self, recipients: List[str], pdf_data: bytes, summary: Dict, filters: Dict) -> Dict:
        """Send alert report email with PDF attachment"""
        try:
            # Create message
            msg = MIMEMultipart()
            msg['From'] = f"{self.sender_name} <{self.sender_email}>"
            msg['To'] = ', '.join(recipients)
            msg['Subject'] = self._create_subject(summary, filters)
            
            # Create email body
            body = self._create_email_body(summary, filters)
            msg.attach(MIMEText(body, 'html'))
            
            # Attach PDF
            pdf_attachment = MIMEApplication(pdf_data, _subtype='pdf')
            pdf_filename = self._create_pdf_filename(filters)
            pdf_attachment.add_header('Content-Disposition', 'attachment', filename=pdf_filename)
            msg.attach(pdf_attachment)
            
            # Send email
            if self.test_mode:
                logger.info(f"TEST MODE: Would send email to {recipients}")
                logger.info(f"Subject: {msg['Subject']}")
                logger.info(f"From: {msg['From']}")
                logger.info(f"PDF attachment: {pdf_filename}")
                return {
                    'success': True,
                    'message': f'TEST MODE: Email logged successfully for {len(recipients)} recipients'
                }
            
            # Use simple SMTP connection (no authentication for internal relay)
            if self.use_internal_relay:
                # Simple internal relay - no authentication required
                with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                    server.send_message(msg)
                    logger.info(f"Email sent via internal relay to {recipients}")
            else:
                # External SMTP with authentication (fallback for development)
                smtp_username = os.getenv('SMTP_USERNAME', '')
                smtp_password = os.getenv('SMTP_PASSWORD', '')
                
                if not smtp_username or not smtp_password:
                    return {
                        'success': False, 
                        'error': 'External SMTP mode requires SMTP_USERNAME and SMTP_PASSWORD environment variables.'
                    }
                
                context = ssl.create_default_context()
                with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                    server.starttls(context=context)
                    server.login(smtp_username, smtp_password)
                    server.send_message(msg)
                    logger.info(f"Email sent via external SMTP to {recipients}")
            
            return {
                'success': True,
                'message': f'Alert report sent successfully to {len(recipients)} recipients'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Failed to send email: {str(e)}'
            }
    
    def _create_subject(self, summary: Dict, filters: Dict) -> str:
        """Create email subject line"""
        date_str = datetime.now().strftime('%Y-%m-%d')
        total_alerts = summary.get('total_alerts', 0)
        
        if filters.get('severity_filter') and filters['severity_filter'] != 'All':
            return f"Alert Summary ({filters['severity_filter']}) - {total_alerts} alerts - {date_str}"
        
        return f"Daily Alert Summary - {total_alerts} alerts - {date_str}"
    
    def _create_email_body(self, summary: Dict, filters: Dict) -> str:
        """Create HTML email body"""
        date_str = datetime.now().strftime('%Y-%m-%d %H:%M UTC')
        
        # Get alert counts by severity
        critical_count = summary.get('critical', 0)
        moderate_count = summary.get('moderate', 0)
        low_count = summary.get('low', 0)
        total_count = summary.get('total_alerts', 0)
        
        # Filter information
        severity_filter = filters.get('severity_filter', 'All')
        status_filter = filters.get('status_filter', 'All')
        testbed_filter = filters.get('testbed_filter', 'All')
        
        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; margin: 40px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
                <h2 style="color: #333; margin-top: 0;">🚨 NCM Alert Summary Report</h2>
                <p style="color: #666;">Generated on {date_str}</p>
                
                <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    <h3 style="color: #333; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">Alert Overview</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px; border: 1px solid #dee2e6;"><strong>Total Alerts:</strong></td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">{total_count}</td>
                        </tr>
                        <tr style="background-color: #f8f9fa;">
                            <td style="padding: 8px; border: 1px solid #dee2e6;"><strong>🔴 Critical:</strong></td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">{critical_count}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px; border: 1px solid #dee2e6;"><strong>🟡 Moderate:</strong></td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">{moderate_count}</td>
                        </tr>
                        <tr style="background-color: #f8f9fa;">
                            <td style="padding: 8px; border: 1px solid #dee2e6;"><strong>🟢 Low:</strong></td>
                            <td style="padding: 8px; border: 1px solid #dee2e6;">{low_count}</td>
                        </tr>
                    </table>
                </div>
                
                <div style="background-color: white; padding: 20px; border-radius: 5px; margin: 20px 0;">
                    <h3 style="color: #333; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">Applied Filters</h3>
                    <ul style="color: #666;">
                        <li><strong>Severity:</strong> {severity_filter}</li>
                        <li><strong>Status:</strong> {status_filter}</li>
                        <li><strong>Testbed:</strong> {testbed_filter}</li>
                    </ul>
                </div>
                
                <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <p style="margin: 0; color: #1565c0;">
                        📎 <strong>Detailed Report:</strong> Please find the complete alert summary attached as a PDF document.
                    </p>
                </div>
                
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 12px;">
                    <p>This is an automated report from the NCM Monitoring Tool.</p>
                    <p>If you have any questions, please contact your system administrator.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        return html_body
    
    def _create_pdf_filename(self, filters: Dict) -> str:
        """Create PDF filename based on filters and date"""
        date_str = datetime.now().strftime('%Y%m%d')
        
        if filters.get('severity_filter') and filters['severity_filter'] != 'All':
            return f"alerts_{filters['severity_filter'].lower()}_{date_str}.pdf"
        
        return f"alerts_summary_{date_str}.pdf"
    
    def test_email_config(self) -> Dict[str, str]:
        """Test email configuration"""
        try:
            if self.test_mode:
                return {
                    'success': True,
                    'message': 'Test mode enabled - emails will be logged instead of sent'
                }
            
            if self.use_internal_relay:
                # Test simple connection to internal relay (no authentication)
                with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                    # Just test connection, no login required
                    server.noop()  # Simple test command
                
                return {
                    'success': True,
                    'message': f'Internal relay connection successful to {self.smtp_server}:{self.smtp_port}'
                }
            else:
                # Test external SMTP with authentication
                smtp_username = os.getenv('SMTP_USERNAME', '')
                smtp_password = os.getenv('SMTP_PASSWORD', '')
                
                if not smtp_username or not smtp_password:
                    return {
                        'success': False,
                        'error': 'External SMTP mode requires SMTP_USERNAME and SMTP_PASSWORD'
                    }
                
                context = ssl.create_default_context()
                with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                    server.starttls(context=context)
                    server.login(smtp_username, smtp_password)
                
                return {
                    'success': True,
                    'message': 'External SMTP configuration is valid'
                }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'Email configuration test failed: {str(e)}'
            }


# Scheduler-compatible functions
def send_email_with_pdf(
    to_email: str,
    subject: str,
    pdf_data: bytes,
    filters: Dict[str, str],
    report_date: str,
    is_test: bool = False
) -> bool:
    """
    Send email with PDF attachment (for scheduler service)
    
    Args:
        to_email: Recipient email address
        subject: Email subject
        pdf_data: PDF content as bytes
        filters: Alert filters applied to the report
        report_date: Date of the report
        is_test: Whether this is a test email
    
    Returns:
        bool: True if email sent successfully, False otherwise
    """
    try:
        email_service = EmailService()
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = f"{email_service.sender_name} <{email_service.sender_email}>"
        msg['To'] = to_email
        msg['Subject'] = subject
        
        # Create HTML body
        html_body = _create_scheduler_email_html_body(filters, report_date, is_test)
        msg.attach(MIMEText(html_body, 'html'))
        
        # Attach PDF
        pdf_filename = f"alert_summary_{report_date}.pdf"
        pdf_attachment = MIMEApplication(pdf_data, _subtype='pdf')
        pdf_attachment.add_header('Content-Disposition', 'attachment', filename=pdf_filename)
        msg.attach(pdf_attachment)
        
        # Test mode - log email instead of sending
        if email_service.test_mode:
            logger.info(f"📧 TEST MODE - Email would be sent:")
            logger.info(f"  From: {msg['From']}")
            logger.info(f"  To: {msg['To']}")
            logger.info(f"  Subject: {msg['Subject']}")
            logger.info(f"  PDF attachment: {pdf_filename} ({len(pdf_data)} bytes)")
            logger.info(f"  Test email: {is_test}")
            return True
        
        # Send email using internal relay (no authentication required)
        if email_service.use_internal_relay:
            # Simple internal relay - no authentication required
            with smtplib.SMTP(email_service.smtp_server, email_service.smtp_port) as server:
                server.send_message(msg)
                logger.info(f"Email sent via internal relay to {to_email}")
        else:
            # External SMTP with authentication (fallback)
            smtp_username = os.getenv('SMTP_USERNAME', '')
            smtp_password = os.getenv('SMTP_PASSWORD', '')
            
            if not smtp_username or not smtp_password:
                logger.error('External SMTP mode requires SMTP credentials')
                return False
            
            context = ssl.create_default_context()
            with smtplib.SMTP(email_service.smtp_server, email_service.smtp_port) as server:
                server.starttls(context=context)
                server.login(smtp_username, smtp_password)
                server.send_message(msg)
                logger.info(f"Email sent via external SMTP to {to_email}")
        
        logger.info(f"Email sent successfully to {to_email}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


def _create_scheduler_email_html_body(filters: Dict[str, str], report_date: str, is_test: bool = False) -> str:
    """Create HTML email body with report summary"""
    
    test_prefix = "[TEST EMAIL] " if is_test else ""
    
    # Build filter summary
    filter_summary = []
    for key, value in filters.items():
        if value != 'All':
            filter_name = key.replace('_filter', '').title()
            filter_summary.append(f"{filter_name}: {value}")
    
    filters_text = ", ".join(filter_summary) if filter_summary else "No filters applied (All alerts)"
    
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
            }}
            .header {{
                background-color: #f8f9fa;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #007bff;
                margin-bottom: 20px;
            }}
            .content {{
                background-color: #ffffff;
                padding: 20px;
                border-radius: 8px;
                border: 1px solid #dee2e6;
            }}
            .footer {{
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid #dee2e6;
                font-size: 0.9em;
                color: #6c757d;
            }}
            .test-banner {{
                background-color: #fff3cd;
                color: #856404;
                padding: 10px;
                border-radius: 4px;
                border: 1px solid #ffeaa7;
                margin-bottom: 20px;
                font-weight: bold;
                text-align: center;
            }}
            .info-row {{
                margin-bottom: 10px;
            }}
            .label {{
                font-weight: bold;
                color: #495057;
            }}
        </style>
    </head>
    <body>
        {f'<div class="test-banner">🧪 This is a test email - No actual scheduled report</div>' if is_test else ''}
        
        <div class="header">
            <h2>{test_prefix}Daily Alert Summary Report</h2>
            <p>Automated alert summary for {report_date}</p>
        </div>
        
        <div class="content">
            <h3>Report Details</h3>
            
            <div class="info-row">
                <span class="label">Report Date:</span> {report_date}
            </div>
            
            <div class="info-row">
                <span class="label">Generated:</span> {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}
            </div>
            
            <div class="info-row">
                <span class="label">Filters Applied:</span> {filters_text}
            </div>
            
            <hr style="margin: 20px 0;">
            
            <h3>📎 Attachment</h3>
            <p>The detailed alert summary report is attached as a PDF file. This report contains:</p>
            <ul>
                <li>Summary of all alerts for the specified period</li>
                <li>Alert details including severity, status, and descriptions</li>
                <li>Filtered results based on your configured criteria</li>
                <li>Timestamp and source information</li>
            </ul>
            
            {f'''
            <div style="background-color: #e7f3ff; padding: 15px; border-radius: 4px; margin-top: 20px;">
                <h4 style="margin-top: 0; color: #0056b3;">📧 Test Email Information</h4>
                <p style="margin-bottom: 0;">This is a test email to verify your email configuration. The attached PDF contains current alert data based on your filter settings.</p>
            </div>
            ''' if is_test else ''}
        </div>
        
        <div class="footer">
            <p>This is an automated email from the Prism Alert Monitoring System.</p>
            <p>If you no longer wish to receive these reports, please contact your system administrator.</p>
        </div>
    </body>
    </html>
    """
    
    return html_body


def test_smtp_connection() -> Dict[str, str]:
    """Test SMTP connection and configuration"""
    try:
        email_service = EmailService()
        
        if email_service.test_mode:
            return {
                'success': True,
                'message': 'Test mode enabled - no actual SMTP connection needed',
                'server': 'test-mode',
                'port': 'test-mode'
            }
        
        if email_service.use_internal_relay:
            # Test internal relay connection (no authentication)
            with smtplib.SMTP(email_service.smtp_server, email_service.smtp_port) as server:
                server.noop()  # Simple test command
                
            return {
                'success': True,
                'message': 'Internal relay connection successful',
                'server': email_service.smtp_server,
                'port': str(email_service.smtp_port)
            }
        else:
            # Test external SMTP with authentication
            smtp_username = os.getenv('SMTP_USERNAME', '')
            smtp_password = os.getenv('SMTP_PASSWORD', '')
            
            if not smtp_username or not smtp_password:
                return {
                    'success': False,
                    'message': 'External SMTP mode requires SMTP_USERNAME and SMTP_PASSWORD environment variables.',
                    'server': email_service.smtp_server,
                    'port': str(email_service.smtp_port)
                }
            
            context = ssl.create_default_context()
            with smtplib.SMTP(email_service.smtp_server, email_service.smtp_port) as server:
                server.starttls(context=context)
                server.login(smtp_username, smtp_password)
                
            return {
                'success': True,
                'message': 'External SMTP connection successful',
                'server': email_service.smtp_server,
                'port': str(email_service.smtp_port)
            }
            
    except Exception as e:
        return {
            'success': False,
            'message': f'SMTP connection failed: {str(e)}',
            'server': email_service.smtp_server if 'email_service' in locals() else 'Unknown',
            'port': str(email_service.smtp_port) if 'email_service' in locals() else 'Unknown'
        }

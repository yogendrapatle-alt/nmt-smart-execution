"""
PDF Generation Service
Generates alert summary PDFs using ReportLab
"""

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from datetime import datetime
from typing import List, Dict
import io
import logging

# Configure logging
logger = logging.getLogger(__name__)


class PDFService:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self.setup_custom_styles()
    
    def setup_custom_styles(self):
        """Setup custom paragraph styles"""
        self.title_style = ParagraphStyle(
            'CustomTitle',
            parent=self.styles['Heading1'],
            fontSize=24,
            spaceAfter=30,
            alignment=1,  # Center alignment
            textColor=colors.navy
        )
        
        self.subtitle_style = ParagraphStyle(
            'CustomSubtitle',
            parent=self.styles['Heading2'],
            fontSize=16,
            spaceAfter=20,
            alignment=1,  # Center alignment
            textColor=colors.black
        )
        
        self.header_style = ParagraphStyle(
            'CustomHeader',
            parent=self.styles['Heading3'],
            fontSize=14,
            spaceAfter=12,
            textColor=colors.darkblue
        )
        
        self.normal_style = ParagraphStyle(
            'CustomNormal',
            parent=self.styles['Normal'],
            fontSize=10,
            spaceAfter=6
        )
    
    def generate_frontend_style_pdf(self, alerts: List[Dict], filters: Dict, metadata: Dict) -> bytes:
        """
        Generate PDF report that matches the frontend AlertsPDFDocument format exactly
        """
        try:
            # Create PDF buffer
            buffer = io.BytesIO()
            
            # Create PDF document with landscape orientation like frontend
            doc = SimpleDocTemplate(
                buffer,
                pagesize=landscape(letter),  # Match frontend landscape orientation
                topMargin=30,
                bottomMargin=30,
                leftMargin=30,
                rightMargin=30
            )
            
            # Container for content
            content = []
            
            # Get current date and filter info
            from datetime import datetime
            current_date = datetime.now().strftime('%Y-%m-%d')
            generated_time = datetime.now().strftime('%m/%d/%Y, %I:%M:%S %p')
            
            # Extract filter values (match frontend logic)
            selected_testbed = filters.get('testbed_filter', 'All') if filters else 'All'
            selected_severity = filters.get('severity_filter', 'All') if filters else 'All'
            selected_status = filters.get('status_filter', 'All') if filters else 'All'
            
            # Convert 'all' to 'All' for display
            if selected_testbed == 'all': selected_testbed = 'All'
            if selected_severity == 'all': selected_severity = 'All'  
            if selected_status == 'all': selected_status = 'All'
            
            # Create custom styles that match frontend
            title_style = ParagraphStyle(
                'CustomTitle',
                parent=getSampleStyleSheet()['Heading1'],
                fontSize=24,
                spaceAfter=10,
                alignment=1,  # Center
                textColor=colors.black
            )
            
            subtitle_style = ParagraphStyle(
                'CustomSubtitle', 
                parent=getSampleStyleSheet()['Normal'],
                fontSize=16,
                spaceAfter=5,
                alignment=1,  # Center
                textColor=colors.black
            )
            
            filter_style = ParagraphStyle(
                'FilterInfo',
                parent=getSampleStyleSheet()['Normal'],
                fontSize=12,
                spaceAfter=5,
                alignment=1,  # Center
                textColor=colors.HexColor('#666666')
            )
            
            summary_title_style = ParagraphStyle(
                'SummaryTitle',
                parent=getSampleStyleSheet()['Heading3'],
                fontSize=14,
                spaceAfter=8,
                textColor=colors.black
            )
            
            summary_text_style = ParagraphStyle(
                'SummaryText',
                parent=getSampleStyleSheet()['Normal'],
                fontSize=12,
                spaceAfter=4,
                textColor=colors.black
            )
            
            # Header section (match frontend exactly)
            content.append(Paragraph("NCM Monitoring Tool - Alert Summary", title_style))
            content.append(Paragraph(f"Date: {current_date} | Testbed: {selected_testbed}", subtitle_style))
            content.append(Paragraph(f"Filters: Severity: {selected_severity} | Status: {selected_status}", filter_style))
            content.append(Paragraph(f"Generated on: {generated_time}", filter_style))
            content.append(Spacer(1, 20))
            
            # Calculate statistics (match frontend logic exactly)
            total_alerts = len(alerts)
            critical_count = len([a for a in alerts if a.get('severity', '').lower() == 'critical'])
            moderate_count = len([a for a in alerts if a.get('severity', '').lower() in ['moderate', 'warning']])
            low_count = len([a for a in alerts if a.get('severity', '').lower() == 'low'])
            active_count = len([a for a in alerts if a.get('status', '').lower() in ['active', 'firing']])
            resolved_count = len([a for a in alerts if a.get('status', '').lower() == 'resolved'])
            
            # Summary Statistics section (match frontend)
            content.append(Paragraph("Summary Statistics", summary_title_style))
            content.append(Paragraph(f"Total Alerts: {total_alerts}", summary_text_style))
            content.append(Paragraph(f"By Severity: Critical: {critical_count} | Moderate: {moderate_count} | Low: {low_count}", summary_text_style))
            content.append(Paragraph(f"By Status: Active: {active_count} | Resolved: {resolved_count}", summary_text_style))
            content.append(Spacer(1, 20))
            
            # Create alerts table (match frontend structure exactly)
            if alerts:
                # Table headers match frontend column structure
                headers = ['Time', 'Severity', 'Status', 'Alert Name', 'Summary', 'Description']
                
                # Column widths (proportional to landscape page width for better text wrapping)
                # Landscape letter is ~11 inches wide, minus margins = ~10 inches usable
                # Increased widths for better text display, especially for Summary and Description
                col_widths = [1.0*inch, 0.8*inch, 0.8*inch, 1.5*inch, 3.0*inch, 3.0*inch]  # Total ~10.1 inches
                
                table_data = [headers]
                
                # Add alert rows with proper text wrapping
                for alert in alerts:
                    # Format time like frontend
                    try:
                        timestamp = alert.get('timestamp', '')
                        if timestamp:
                            from datetime import datetime, timezone
                            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).astimezone(timezone.utc)
                            formatted_time = dt.strftime('%H:%M')  # 24-hour UTC time
                        else:
                            formatted_time = 'N/A'
                    except Exception:
                        formatted_time = 'N/A'
                    
                    # Get values
                    severity = alert.get('severity', 'Unknown')
                    status = alert.get('status', 'Unknown')
                    rule_name = alert.get('ruleName', 'N/A')
                    summary = alert.get('summary', 'N/A')
                    description = alert.get('description', 'N/A')
                    
                    # Create Paragraph objects for text that needs wrapping
                    cell_style = ParagraphStyle(
                        'CellText',
                        parent=getSampleStyleSheet()['Normal'],
                        fontSize=9,
                        leading=11,  # Line spacing
                        wordWrap='CJK',  # Better word wrapping
                        spaceBefore=1,
                        spaceAfter=1,
                        leftIndent=0,
                        rightIndent=0
                    )
                    
                    # Special style for longer text fields (summary/description)
                    long_text_style = ParagraphStyle(
                        'LongCellText',
                        parent=getSampleStyleSheet()['Normal'],
                        fontSize=9,
                        leading=11,
                        wordWrap='CJK',
                        spaceBefore=1,
                        spaceAfter=1,
                        leftIndent=0,
                        rightIndent=0,
                        breakLongWords=1  # Allow breaking long words
                    )
                    
                    # Wrap text in Paragraph objects for proper text wrapping
                    time_para = Paragraph(formatted_time, cell_style)
                    severity_para = Paragraph(severity, cell_style)
                    status_para = Paragraph(status, cell_style)
                    rule_name_para = Paragraph(rule_name, cell_style)
                    summary_para = Paragraph(summary, long_text_style)
                    description_para = Paragraph(description, long_text_style)
                    
                    table_data.append([
                        time_para,
                        severity_para,
                        status_para, 
                        rule_name_para,
                        summary_para,
                        description_para
                    ])
                
                # Create table with proper row heights for wrapped text
                table = Table(table_data, colWidths=col_widths, repeatRows=1, splitByRow=True)
                
                # Enhanced table styling for better text wrapping
                table.setStyle(TableStyle([
                    # Header styling
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f0f0f0')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, 0), 10),
                    ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
                    ('TOPPADDING', (0, 0), (-1, 0), 8),
                    
                    # Data rows styling with better padding for wrapped text
                    ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                    ('FONTSIZE', (0, 1), (-1, -1), 9),
                    ('TOPPADDING', (0, 1), (-1, -1), 6),
                    ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                    
                    # Borders
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
                    ('LINEBELOW', (0, 0), (-1, 0), 1, colors.black),
                    
                    # Alternating row colors like frontend
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f9f9f9')]),
                    
                    # Vertical alignment - keep text at top of cells
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    
                    # Allow row splitting for long content
                    ('SPLITLONGWORDS', (0, 0), (-1, -1), 1),
                ]))
                
                content.append(table)
            else:
                content.append(Paragraph("No alerts found for the selected criteria.", summary_text_style))
                
            # Footer
            footer_style = ParagraphStyle(
                'Footer',
                parent=getSampleStyleSheet()['Normal'],
                fontSize=10,
                alignment=1,  # Center
                textColor=colors.HexColor('#666666')
            )
            content.append(Spacer(1, 30))
            content.append(Paragraph(f"Nutanix NCM Monitoring Tool | Generated: {datetime.now().strftime('%m/%d/%Y')}", footer_style))
                
            # Build PDF
            doc.build(content)
            
            # Get PDF data
            pdf_data = buffer.getvalue()
            buffer.close()
            
            return pdf_data
            
        except Exception as e:
            logger.error(f"Error generating frontend-style PDF: {e}")
            return b""  # Return empty bytes on error
    
    def generate_alert_pdf(self, alerts: List[Dict], filters: Dict, metadata: Dict) -> bytes:
        """Generate PDF report for alerts"""
        buffer = io.BytesIO()
        
        # Use landscape orientation for better table display
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(letter),
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=18
        )
        
        # Build the story (content)
        story = []
        
        # Add header
        story.extend(self._create_header(filters, metadata))
        
        # Add summary statistics
        story.extend(self._create_summary_stats(alerts))
        
        # Add alerts table
        story.extend(self._create_alerts_table(alerts))
        
        # Add footer
        story.extend(self._create_footer())
        
        # Build PDF
        doc.build(story)
        
        # Get PDF bytes
        pdf_bytes = buffer.getvalue()
        buffer.close()
        
        return pdf_bytes
    
    def _create_header(self, filters: Dict, metadata: Dict) -> List:
        """Create PDF header section"""
        elements = []
        
        # Title
        title = Paragraph("NCM Monitoring Tool - Alert Summary", self.title_style)
        elements.append(title)
        elements.append(Spacer(1, 12))
        
        # Date and filters info
        date_str = filters.get('selectedDate', 'N/A')
        if date_str != 'N/A':
            try:
                formatted_date = datetime.strptime(date_str, '%Y-%m-%d').strftime('%B %d, %Y')
            except:
                formatted_date = date_str
        else:
            formatted_date = date_str
        
        subtitle_text = f"Date: {formatted_date}"
        if filters.get('selectedTestbed') and filters['selectedTestbed'] != '':
            subtitle_text += f" | Testbed: {filters['selectedTestbed']}"
        
        subtitle = Paragraph(subtitle_text, self.subtitle_style)
        elements.append(subtitle)
        
        # Filter information
        filter_text = f"Filters: Severity: {filters.get('selectedSeverity', 'All')} | Status: {filters.get('selectedStatus', 'All')}"
        filter_para = Paragraph(filter_text, self.normal_style)
        elements.append(filter_para)
        
        # Generation timestamp
        gen_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')
        gen_para = Paragraph(f"Generated on: {gen_time}", self.normal_style)
        elements.append(gen_para)
        
        elements.append(Spacer(1, 20))
        
        return elements
    
    def _create_summary_stats(self, alerts: List[Dict]) -> List:
        """Create summary statistics section"""
        elements = []
        
        # Calculate statistics
        total_alerts = len(alerts)
        critical_count = len([a for a in alerts if a.get('severity', '').lower() == 'critical'])
        moderate_count = len([a for a in alerts if a.get('severity', '').lower() == 'moderate'])
        low_count = len([a for a in alerts if a.get('severity', '').lower() == 'low'])
        active_count = len([a for a in alerts if self._normalize_status(a.get('status', '')).lower() == 'active'])
        resolved_count = len([a for a in alerts if self._normalize_status(a.get('status', '')).lower() == 'resolved'])
        
        # Summary header
        summary_header = Paragraph("Summary Statistics", self.header_style)
        elements.append(summary_header)
        
        # Statistics text
        stats_text = f"""
        <b>Total Alerts:</b> {total_alerts}<br/>
        <b>By Severity:</b> Critical: {critical_count} | Moderate: {moderate_count} | Low: {low_count}<br/>
        <b>By Status:</b> Active: {active_count} | Resolved: {resolved_count}
        """
        
        stats_para = Paragraph(stats_text, self.normal_style)
        elements.append(stats_para)
        elements.append(Spacer(1, 20))
        
        return elements
    
    def _create_alerts_table(self, alerts: List[Dict]) -> List:
        """Create alerts table"""
        elements = []
        
        if not alerts:
            no_alerts = Paragraph("No alerts found for the selected criteria.", self.normal_style)
            elements.append(no_alerts)
            return elements
        
        # Table header
        table_header = Paragraph("Alert Details", self.header_style)
        elements.append(table_header)
        
        # Prepare table data
        headers = ['Time', 'Severity', 'Status', 'Alert Name', 'Summary', 'Description']
        table_data = [headers]
        
        for alert in alerts:
            # Format timestamp
            try:
                timestamp = alert.get('timestamp', '')
                if timestamp:
                    from datetime import datetime, timezone
                    dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).astimezone(timezone.utc)
                    time_str = dt.strftime('%H:%M')  # 24-hour UTC time
                else:
                    time_str = 'N/A'
            except Exception:
                time_str = 'N/A'
            
            row = [
                time_str,
                alert.get('severity', 'N/A'),
                self._normalize_status(alert.get('status', 'N/A')),
                alert.get('ruleName', 'N/A'),
                alert.get('summary', 'N/A')[:50] + ('...' if len(alert.get('summary', '')) > 50 else ''),
                alert.get('description', 'N/A')[:60] + ('...' if len(alert.get('description', '')) > 60 else '')
            ]
            table_data.append(row)
        
        # Create table
        table = Table(table_data, colWidths=[0.8*inch, 1*inch, 0.8*inch, 1.5*inch, 2*inch, 2.5*inch])
        
        # Style the table
        table.setStyle(TableStyle([
            # Header styling
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.black),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            
            # Data styling
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.lightgrey]),
            
            # Grid and borders
            ('GRID', (0, 0), (-1, -1), 1, colors.black),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        
        # Add severity-based row coloring
        for i, alert in enumerate(alerts, 1):
            severity = alert.get('severity', '').lower()
            if severity == 'critical':
                table.setStyle(TableStyle([
                    ('TEXTCOLOR', (1, i), (1, i), colors.red),
                    ('FONTNAME', (1, i), (1, i), 'Helvetica-Bold'),
                ]))
            elif severity == 'moderate':
                table.setStyle(TableStyle([
                    ('TEXTCOLOR', (1, i), (1, i), colors.orange),
                    ('FONTNAME', (1, i), (1, i), 'Helvetica-Bold'),
                ]))
        
        elements.append(table)
        elements.append(Spacer(1, 20))
        
        return elements
    
    def _create_footer(self) -> List:
        """Create PDF footer"""
        elements = []
        
        footer_text = f"Page 1 | Nutanix NCM Monitoring Tool | Generated: {datetime.now().strftime('%Y-%m-%d')}"
        footer_para = Paragraph(footer_text, self.normal_style)
        elements.append(Spacer(1, 20))
        elements.append(footer_para)
        
        return elements
    
    def _normalize_status(self, status: str) -> str:
        """Normalize status (treat 'firing' as 'Active')"""
        if status.lower() == 'firing':
            return 'Active'
        return status
    
    def _get_severity_color(self, severity: str) -> colors.Color:
        """Get color for severity level"""
        severity_lower = severity.lower()
        if severity_lower == 'critical':
            return colors.red
        elif severity_lower == 'moderate':
            return colors.orange
        elif severity_lower == 'low':
            return colors.green
        else:
            return colors.grey


# Global instance and convenience function for scheduler service
pdf_service = PDFService()

def generate_alerts_pdf(alerts: List[Dict], filters: Dict = None, metadata: Dict = None) -> bytes:
    """
    Convenience function to generate alerts PDF
    Used by the scheduler service for automated email reports
    
    Args:
        alerts: List of alert dictionaries
        filters: Optional filter configuration
        metadata: Optional metadata (email config, timestamp, etc.)
    
    Returns:
        PDF content as bytes
    """
    if filters is None:
        filters = {}
    
    if metadata is None:
        metadata = {
            'generated_at': datetime.now().isoformat(),
            'total_alerts': len(alerts)
        }
    
    return pdf_service.generate_frontend_style_pdf(alerts, filters, metadata)

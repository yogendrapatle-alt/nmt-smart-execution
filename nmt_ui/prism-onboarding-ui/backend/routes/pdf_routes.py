"""
PDF Generation Routes
Provides endpoints for generating PDFs with the same formatting as the frontend
"""

from flask import Blueprint, jsonify, request
import logging
import json
import os
import subprocess
import tempfile
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

pdf_bp = Blueprint('pdf', __name__)

@pdf_bp.route('/api/generate-pdf', methods=['POST'])
def generate_pdf_for_email():
    """
    Generate PDF using the same logic as the frontend Export PDF button
    This endpoint will be called by the email service to generate PDFs
    """
    try:
        data = request.get_json()
        
        # Get parameters
        alerts = data.get('alerts', [])
        selected_date = data.get('selectedDate', datetime.now().strftime('%Y-%m-%d'))
        selected_testbed = data.get('selectedTestbed', 'all')
        selected_severity = data.get('selectedSeverity', 'all')
        selected_status = data.get('selectedStatus', 'all')
        
        logger.info(f"Generating PDF for {len(alerts)} alerts")
        
        # Since we can't run React components in Python, we'll use a different approach:
        # 1. Call a Node.js script that uses the same React PDF logic
        # 2. Or use the existing ReportLab but match the frontend format exactly
        
        # For now, let's create a Node.js script approach
        pdf_data = generate_pdf_via_node(alerts, selected_date, selected_testbed, selected_severity, selected_status)
        
        if pdf_data:
            return {
                'success': True,
                'pdf_size': len(pdf_data),
                'message': 'PDF generated successfully'
            }, 200, {
                'Content-Type': 'application/json'
            }
        else:
            return {
                'success': False,
                'error': 'Failed to generate PDF'
            }, 500
            
    except Exception as e:
        logger.error(f"Error generating PDF: {e}")
        return {
            'success': False,
            'error': str(e)
        }, 500

def generate_pdf_via_node(alerts, selected_date, selected_testbed, selected_severity, selected_status):
    """
    Generate PDF by calling a Node.js script that uses the same React PDF components
    """
    try:
        # Create a temporary file with alert data
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as temp_file:
            json.dump({
                'alerts': alerts,
                'selectedDate': selected_date,
                'selectedTestbed': selected_testbed,
                'selectedSeverity': selected_severity,
                'selectedStatus': selected_status
            }, temp_file)
            temp_input_path = temp_file.name
        
        # Create temp output path
        temp_output_path = temp_input_path.replace('.json', '.pdf')
        
        # Path to the Node.js PDF generation script (we'll create this)
        script_path = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'generate_pdf.js')
        
        # Call Node.js script
        result = subprocess.run([
            'node', 
            script_path, 
            temp_input_path, 
            temp_output_path
        ], capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0 and os.path.exists(temp_output_path):
            # Read the generated PDF
            with open(temp_output_path, 'rb') as pdf_file:
                pdf_data = pdf_file.read()
            
            # Clean up temp files
            os.unlink(temp_input_path)
            os.unlink(temp_output_path)
            
            return pdf_data
        else:
            logger.error(f"Node.js PDF generation failed: {result.stderr}")
            return None
            
    except Exception as e:
        logger.error(f"Error in Node.js PDF generation: {e}")
        return None

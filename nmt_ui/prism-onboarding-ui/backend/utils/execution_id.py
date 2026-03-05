"""
Execution ID Generation Utilities

Utility functions for generating execution identifiers used
throughout the NMT system. Copied and adapted from loadgen.

NO EXTERNAL DEPENDENCIES - Self-contained for NMT.
"""

import uuid
from datetime import datetime
from typing import Optional


def generate_execution_id(prefix: str = "NMT") -> str:
    """
    Generate unique execution ID with timestamp and UUID.
    
    Format: PREFIX-YYYYMMDD-HHMMSS-shortUUID
    Example: NMT-20260127-143022-abc12def
    
    Args:
        prefix (str): Prefix for the execution ID (default: "NMT")
        
    Returns:
        str: Formatted execution ID
    """
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    short_uuid = str(uuid.uuid4()).split('-')[-1]
    return f"{prefix}-{timestamp}-{short_uuid}"


def generate_short_uuid() -> str:
    """
    Generate short UUID (last segment only).
    
    Returns:
        str: Short UUID string (8 characters)
    """
    return str(uuid.uuid4()).split('-')[-1]


def generate_session_id() -> str:
    """
    Generate unique session identifier.
    
    Returns:
        str: Session ID (full UUID)
    """
    return str(uuid.uuid4())


def generate_request_id() -> str:
    """
    Generate unique request identifier for tracing.
    
    Returns:
        str: Request ID (first 8 characters of UUID)
    """
    return str(uuid.uuid4())[:8]


def parse_execution_id(execution_id: str) -> dict:
    """
    Parse execution ID to extract components.
    
    Args:
        execution_id (str): Execution ID to parse
        
    Returns:
        dict: {
            'prefix': str,
            'date': str (YYYYMMDD),
            'time': str (HHMMSS),
            'uuid': str
        }
        
    Raises:
        ValueError: If execution_id format is invalid
    """
    try:
        parts = execution_id.split('-')
        if len(parts) != 4:
            raise ValueError(f"Invalid execution ID format: {execution_id}")
        
        return {
            'prefix': parts[0],
            'date': parts[1],
            'time': parts[2],
            'uuid': parts[3]
        }
    except Exception as e:
        raise ValueError(f"Failed to parse execution ID '{execution_id}': {e}")


def validate_execution_id(execution_id: str) -> bool:
    """
    Validate execution ID format.
    
    Args:
        execution_id (str): Execution ID to validate
        
    Returns:
        bool: True if valid, False otherwise
    """
    try:
        parse_execution_id(execution_id)
        return True
    except ValueError:
        return False

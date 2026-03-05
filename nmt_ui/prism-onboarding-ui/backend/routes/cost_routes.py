"""
Cost Tracking Routes

API endpoints for cost tracking, budgets, and optimization.

Endpoints:
- GET    /api/costs/dashboard - Get cost dashboard data
- GET    /api/costs/execution/:id - Get cost for specific execution
- GET    /api/costs/report - Get cost report for date range
- GET    /api/costs/trends - Get cost trends
- GET    /api/costs/top-spending - Get top spending testbeds

- GET    /api/budgets - List all budgets
- POST   /api/budgets - Create budget limit
- GET    /api/budgets/:id - Get specific budget
- PUT    /api/budgets/:id - Update budget
- DELETE /api/budgets/:id - Delete budget

- GET    /api/costs/optimization-recommendations - Get optimization recommendations
"""

import logging
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

# Create blueprint
cost_bp = Blueprint('costs', __name__)


@cost_bp.route('/api/costs/dashboard', methods=['GET'])
def get_cost_dashboard():
    """
    Get cost dashboard data
    
    Returns:
    {
        "success": true,
        "today": {"total": 12.50, "executions": 5},
        "week": {"total": 85.30, "executions": 23},
        "month": {"total": 345.60, "executions": 98},
        "top_spending_testbeds": [...]
    }
    """
    try:
        from services.cost_service import get_cost_service
        
        cost_service = get_cost_service()
        
        # Get costs for different periods
        now = datetime.now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = now - timedelta(days=7)
        month_start = now - timedelta(days=30)
        
        today_summary = cost_service.get_cost_summary(today_start, now)
        week_summary = cost_service.get_cost_summary(week_start, now)
        month_summary = cost_service.get_cost_summary(month_start, now)
        
        return jsonify({
            'success': True,
            'today': today_summary,
            'week': week_summary,
            'month': month_summary
        }), 200
        
    except Exception as e:
        logger.exception("Error getting cost dashboard")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/costs/execution/<execution_id>', methods=['GET'])
def get_execution_cost(execution_id):
    """
    Get cost for a specific execution
    
    Returns:
    {
        "success": true,
        "cost_data": {...}
    }
    """
    try:
        from database import SessionLocal
        from models.cost_tracker import CostTracker
        
        session = SessionLocal()
        try:
            cost_record = session.query(CostTracker).filter_by(
                execution_id=execution_id
            ).first()
            
            if not cost_record:
                return jsonify({'success': False, 'error': 'Cost record not found'}), 404
            
            return jsonify({
                'success': True,
                'cost_data': cost_record.to_dict()
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting cost for execution {execution_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/costs/report', methods=['GET'])
def get_cost_report():
    """
    Get cost report for date range
    
    Query params:
    - start_date: Start date (YYYY-MM-DD)
    - end_date: End date (YYYY-MM-DD)
    - testbed_id: Optional testbed filter
    
    Returns:
    {
        "success": true,
        "report": {...}
    }
    """
    try:
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        testbed_id = request.args.get('testbed_id')
        
        if not start_date_str or not end_date_str:
            return jsonify({'success': False, 'error': 'start_date and end_date required'}), 400
        
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
        
        from services.cost_service import get_cost_service
        
        cost_service = get_cost_service()
        report = cost_service.get_cost_summary(start_date, end_date, testbed_id)
        
        return jsonify({
            'success': True,
            'report': report
        }), 200
        
    except Exception as e:
        logger.exception("Error getting cost report")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/costs/trends', methods=['GET'])
def get_cost_trends():
    """
    Get cost trends over time
    
    Query params:
    - days: Number of days (default: 30)
    
    Returns:
    {
        "success": true,
        "trends": [{"date": "2026-02-01", "cost": 12.50}, ...]
    }
    """
    try:
        days = int(request.args.get('days', 30))
        
        from database import SessionLocal
        from models.cost_tracker import CostTracker
        from sqlalchemy import func
        
        session = SessionLocal()
        try:
            start_date = datetime.now() - timedelta(days=days)
            
            # Group by date and sum costs
            results = session.query(
                func.date(CostTracker.execution_date).label('date'),
                func.sum(CostTracker.total_cost).label('total_cost'),
                func.count(CostTracker.id).label('execution_count')
            ).filter(
                CostTracker.execution_date >= start_date
            ).group_by(
                func.date(CostTracker.execution_date)
            ).order_by('date').all()
            
            trends = [{
                'date': str(r.date),
                'cost': round(float(r.total_cost), 2),
                'executions': r.execution_count
            } for r in results]
            
            return jsonify({
                'success': True,
                'trends': trends
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting cost trends")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/costs/top-spending', methods=['GET'])
def get_top_spending_testbeds():
    """
    Get top spending testbeds
    
    Query params:
    - days: Number of days (default: 30)
    - limit: Number of results (default: 10)
    
    Returns:
    {
        "success": true,
        "top_spending": [{"testbed_id": "...", "total_cost": 125.50}, ...]
    }
    """
    try:
        days = int(request.args.get('days', 30))
        limit = int(request.args.get('limit', 10))
        
        from database import SessionLocal
        from models.cost_tracker import CostTracker
        from sqlalchemy import func
        
        session = SessionLocal()
        try:
            start_date = datetime.now() - timedelta(days=days)
            
            results = session.query(
                CostTracker.testbed_id,
                func.sum(CostTracker.total_cost).label('total_cost'),
                func.count(CostTracker.id).label('execution_count')
            ).filter(
                CostTracker.execution_date >= start_date
            ).group_by(
                CostTracker.testbed_id
            ).order_by(
                func.sum(CostTracker.total_cost).desc()
            ).limit(limit).all()
            
            top_spending = [{
                'testbed_id': r.testbed_id,
                'total_cost': round(float(r.total_cost), 2),
                'executions': r.execution_count
            } for r in results]
            
            return jsonify({
                'success': True,
                'top_spending': top_spending
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting top spending testbeds")
        return jsonify({'success': False, 'error': str(e)}), 500


# ========================================================================
# BUDGET MANAGEMENT ENDPOINTS
# ========================================================================

@cost_bp.route('/api/budgets', methods=['GET'])
def get_budgets():
    """List all budget limits"""
    try:
        from database import SessionLocal
        from models.cost_tracker import BudgetLimit
        
        session = SessionLocal()
        try:
            budgets = session.query(BudgetLimit).filter_by(is_active=True).all()
            
            return jsonify({
                'success': True,
                'budgets': [b.to_dict() for b in budgets]
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting budgets")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/budgets', methods=['POST'])
def create_budget():
    """
    Create budget limit
    
    Request Body:
    {
        "scope_type": "testbed" | "global",
        "scope_id": "testbed-id" (if testbed),
        "scope_name": "My Testbed",
        "daily_limit": 10.00,
        "weekly_limit": 50.00,
        "monthly_limit": 200.00,
        "alert_threshold": 80,
        "created_by": "username"
    }
    """
    try:
        data = request.get_json()
        
        from database import SessionLocal
        from models.cost_tracker import BudgetLimit
        
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        budget_id = f'BDG-{timestamp}'
        
        budget = BudgetLimit(
            budget_id=budget_id,
            scope_type=data.get('scope_type'),
            scope_id=data.get('scope_id'),
            scope_name=data.get('scope_name'),
            daily_limit=data.get('daily_limit'),
            weekly_limit=data.get('weekly_limit'),
            monthly_limit=data.get('monthly_limit'),
            alert_threshold=data.get('alert_threshold', 80.0),
            block_threshold=data.get('block_threshold', 100.0),
            created_by=data.get('created_by')
        )
        
        session = SessionLocal()
        try:
            session.add(budget)
            session.commit()
            
            return jsonify({
                'success': True,
                'budget_id': budget_id,
                'message': 'Budget created successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error creating budget")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/budgets/<budget_id>', methods=['GET'])
def get_budget(budget_id):
    """Get specific budget"""
    try:
        from database import SessionLocal
        from models.cost_tracker import BudgetLimit
        
        session = SessionLocal()
        try:
            budget = session.query(BudgetLimit).filter_by(budget_id=budget_id).first()
            
            if not budget:
                return jsonify({'success': False, 'error': 'Budget not found'}), 404
            
            return jsonify({
                'success': True,
                'budget': budget.to_dict()
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error getting budget {budget_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/budgets/<budget_id>', methods=['PUT'])
def update_budget(budget_id):
    """Update budget"""
    try:
        data = request.get_json()
        
        from database import SessionLocal
        from models.cost_tracker import BudgetLimit
        
        session = SessionLocal()
        try:
            budget = session.query(BudgetLimit).filter_by(budget_id=budget_id).first()
            
            if not budget:
                return jsonify({'success': False, 'error': 'Budget not found'}), 404
            
            # Update fields
            if 'daily_limit' in data:
                budget.daily_limit = data['daily_limit']
            if 'weekly_limit' in data:
                budget.weekly_limit = data['weekly_limit']
            if 'monthly_limit' in data:
                budget.monthly_limit = data['monthly_limit']
            if 'alert_threshold' in data:
                budget.alert_threshold = data['alert_threshold']
            if 'block_threshold' in data:
                budget.block_threshold = data['block_threshold']
            
            budget.updated_at = datetime.now()
            session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Budget updated successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error updating budget {budget_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/budgets/<budget_id>', methods=['DELETE'])
def delete_budget(budget_id):
    """Delete budget"""
    try:
        from database import SessionLocal
        from models.cost_tracker import BudgetLimit
        
        session = SessionLocal()
        try:
            budget = session.query(BudgetLimit).filter_by(budget_id=budget_id).first()
            
            if not budget:
                return jsonify({'success': False, 'error': 'Budget not found'}), 404
            
            # Soft delete
            budget.is_active = False
            session.commit()
            
            return jsonify({
                'success': True,
                'message': 'Budget deleted successfully'
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception(f"Error deleting budget {budget_id}")
        return jsonify({'success': False, 'error': str(e)}), 500


@cost_bp.route('/api/costs/optimization-recommendations', methods=['GET'])
def get_optimization_recommendations():
    """
    Get cost optimization recommendations
    
    Returns:
    {
        "success": true,
        "recommendations": [...]
    }
    """
    try:
        from database import SessionLocal
        from models.cost_tracker import CostTracker
        
        session = SessionLocal()
        try:
            # Get recent executions with high optimization potential
            recent_date = datetime.now() - timedelta(days=7)
            
            records = session.query(CostTracker).filter(
                CostTracker.execution_date >= recent_date,
                CostTracker.optimization_potential > 0
            ).order_by(
                CostTracker.optimization_potential.desc()
            ).limit(20).all()
            
            recommendations = []
            
            for record in records:
                if record.cost_breakdown and 'optimization' in record.cost_breakdown:
                    opt_data = record.cost_breakdown.get('optimization', {})
                    if opt_data.get('recommendations'):
                        recommendations.extend(opt_data['recommendations'])
            
            return jsonify({
                'success': True,
                'recommendations': recommendations[:10]  # Top 10
            }), 200
            
        finally:
            session.close()
            
    except Exception as e:
        logger.exception("Error getting optimization recommendations")
        return jsonify({'success': False, 'error': str(e)}), 500


logger.info("✅ Cost routes loaded")

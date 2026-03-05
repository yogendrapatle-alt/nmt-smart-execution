"""
PID Controller for Smart Execution Load Management

Implements a Proportional-Integral-Derivative controller for maintaining
resource utilization at target thresholds.

Theory:
- Proportional (P): Responds to current error
- Integral (I): Corrects accumulated error over time
- Derivative (D): Anticipates future error based on rate of change

Output: Adjustment to operations per minute
"""

import time
import logging
from typing import Dict, Tuple, Optional

logger = logging.getLogger(__name__)


class PIDController:
    """
    PID Controller for resource threshold management
    
    This controller adjusts the operations per minute to reach and maintain
    a target resource utilization (CPU/Memory).
    """
    
    def __init__(
        self, 
        target: float, 
        Kp: float = 2.0, 
        Ki: float = 0.1, 
        Kd: float = 0.5,
        output_limits: Tuple[float, float] = (0.5, 100.0)
    ):
        """
        Initialize PID Controller
        
        Args:
            target: Target value (e.g., 80.0 for 80% CPU)
            Kp: Proportional gain (responsiveness to current error)
            Ki: Integral gain (correction for accumulated error)
            Kd: Derivative gain (prediction based on error rate of change)
            output_limits: (min, max) bounds for output
        """
        self.target = target
        self.Kp = Kp
        self.Ki = Ki
        self.Kd = Kd
        
        # State variables
        self.last_error = 0.0
        self.integral = 0.0
        self.last_time = None
        
        # Output limits
        self.min_output, self.max_output = output_limits
        
        # Anti-windup limits for integral term
        self.integral_limit = 50.0
        
        # History for analysis
        self.history = []
        
        logger.info(f"🎛️  PID Controller initialized: Target={target}%, Kp={Kp}, Ki={Ki}, Kd={Kd}")
    
    def compute(self, current_value: float, dt: Optional[float] = None) -> Dict:
        """
        Compute PID output based on current measurement
        
        Args:
            current_value: Current measured value (e.g., current CPU %)
            dt: Time delta in seconds (optional, auto-calculated if None)
            
        Returns:
            Dictionary with:
                - adjustment: Change in operations per minute
                - error: Current error (target - current)
                - P, I, D: Individual term contributions
                - phase: Current control phase
        """
        current_time = time.time()
        
        # Calculate time delta
        if self.last_time is None:
            self.last_time = current_time
            dt = 0.01  # Small initial dt
        elif dt is None:
            dt = current_time - self.last_time
            
        # Prevent division by zero
        if dt <= 0:
            dt = 0.01
        
        # Calculate error (how far from target)
        error = self.target - current_value
        
        # Proportional term: Immediate response to current error
        P = self.Kp * error
        
        # Integral term: Accumulated error over time
        # This eliminates steady-state error
        self.integral += error * dt
        
        # Anti-windup: Limit integral to prevent excessive buildup
        self.integral = max(min(self.integral, self.integral_limit), -self.integral_limit)
        I = self.Ki * self.integral
        
        # Derivative term: Rate of change of error
        # This anticipates future error and provides damping
        derivative = (error - self.last_error) / dt
        D = self.Kd * derivative
        
        # Total PID output
        output = P + I + D
        
        # Determine control phase
        phase = self._determine_phase(error, abs(derivative))
        
        # Record history
        self.history.append({
            'timestamp': current_time,
            'current_value': current_value,
            'error': error,
            'P': P,
            'I': I,
            'D': D,
            'output': output,
            'phase': phase
        })
        
        # Keep only last 100 records
        if len(self.history) > 100:
            self.history.pop(0)
        
        # Update state
        self.last_error = error
        self.last_time = current_time
        
        result = {
            'adjustment': round(output, 2),
            'error': round(error, 2),
            'P': round(P, 2),
            'I': round(I, 2),
            'D': round(D, 2),
            'phase': phase,
            'integral': round(self.integral, 2)
        }
        
        logger.debug(f"PID: current={current_value:.1f}%, error={error:.1f}%, "
                    f"P={P:.1f}, I={I:.1f}, D={D:.1f}, output={output:.1f}, phase={phase}")
        
        return result
    
    def _determine_phase(self, error: float, derivative: float) -> str:
        """
        Determine current control phase based on error and derivative
        
        Args:
            error: Current error
            derivative: Rate of change of error
            
        Returns:
            Phase string: 'ramp_up', 'maintain', 'ramp_down', 'fine_tune'
        """
        abs_error = abs(error)
        
        if abs_error < 2.0:
            # Within ±2% of target
            return 'maintain'
        elif error > 5.0:
            # More than 5% below target - need to increase
            return 'ramp_up'
        elif error < -5.0:
            # More than 5% above target - need to decrease
            return 'ramp_down'
        else:
            # Between 2-5% from target - fine tuning
            return 'fine_tune'
    
    def reset(self):
        """Reset PID controller state"""
        self.last_error = 0.0
        self.integral = 0.0
        self.last_time = None
        self.history = []
        logger.info(f"🔄 PID Controller reset")
    
    def tune(self, Kp: float = None, Ki: float = None, Kd: float = None):
        """
        Adjust PID parameters during runtime
        
        Args:
            Kp: New proportional gain (optional)
            Ki: New integral gain (optional)
            Kd: New derivative gain (optional)
        """
        if Kp is not None:
            self.Kp = Kp
        if Ki is not None:
            self.Ki = Ki
        if Kd is not None:
            self.Kd = Kd
        
        logger.info(f"🎛️  PID tuned: Kp={self.Kp}, Ki={self.Ki}, Kd={self.Kd}")
    
    def get_stats(self) -> Dict:
        """
        Get controller statistics
        
        Returns:
            Dictionary with performance metrics
        """
        if not self.history:
            return {}
        
        recent_errors = [h['error'] for h in self.history[-10:]]
        recent_outputs = [h['output'] for h in self.history[-10:]]
        
        return {
            'target': self.target,
            'current_integral': self.integral,
            'history_length': len(self.history),
            'avg_recent_error': sum(recent_errors) / len(recent_errors) if recent_errors else 0,
            'avg_recent_output': sum(recent_outputs) / len(recent_outputs) if recent_outputs else 0,
            'Kp': self.Kp,
            'Ki': self.Ki,
            'Kd': self.Kd
        }


class AdaptiveLoadController:
    """
    Dual PID controller for managing both CPU and Memory thresholds
    
    Uses two independent PID controllers and chooses the more conservative
    adjustment to prevent overshooting on either metric.
    """
    
    def __init__(
        self,
        target_cpu: float,
        target_memory: float,
        initial_ops_per_min: float = 10.0,
        ml_predictor=None
    ):
        """
        Initialize adaptive load controller
        
        Args:
            target_cpu: Target CPU percentage
            target_memory: Target memory percentage
            initial_ops_per_min: Starting operations per minute
            ml_predictor: ML model for operation recommendations (optional)
        """
        self.target_cpu = target_cpu
        self.target_memory = target_memory
        
        # Separate PID controllers for CPU and Memory
        # CPU gets more aggressive tuning (higher Kp)
        self.cpu_pid = PIDController(
            target_cpu, 
            Kp=2.5,  # More responsive
            Ki=0.12, 
            Kd=0.6
        )
        
        # Memory is usually slower to respond, less aggressive
        self.memory_pid = PIDController(
            target_memory,
            Kp=2.0,
            Ki=0.1,
            Kd=0.5
        )
        
        # ML predictor for smart operation selection
        self.ml_predictor = ml_predictor
        
        # Current state
        self.operations_per_minute = initial_ops_per_min
        self.phase = "ramp_up"
        self.iteration = 0
        
        logger.info(f"🎯 Adaptive Load Controller initialized: "
                   f"Target={target_cpu}% CPU, {target_memory}% Memory")
    
    def adjust_load(self, current_metrics: Dict) -> Dict:
        """
        Main control loop: Adjust load based on current metrics
        
        Args:
            current_metrics: Dictionary with:
                - cpu: Current CPU percentage
                - memory: Current memory percentage
                - cluster_size: Number of nodes
                - ... other metrics
                
        Returns:
            Dictionary with:
                - operations_per_minute: New operations rate
                - recommended_operations: List of recommended operations
                - phase: Current phase
                - reasoning: Explanation of decision
                - debug: Debug information
        """
        self.iteration += 1
        current_cpu = current_metrics.get('cpu', 0)
        current_memory = current_metrics.get('memory', 0)
        
        # Compute PID adjustments for both CPU and Memory
        cpu_result = self.cpu_pid.compute(current_cpu)
        memory_result = self.memory_pid.compute(current_memory)
        
        # Choose the more conservative adjustment
        # If CPU wants to increase by 10 but Memory wants to decrease by 5,
        # we use the smaller adjustment to avoid overshooting
        if abs(cpu_result['adjustment']) < abs(memory_result['adjustment']):
            primary_adjustment = cpu_result['adjustment']
            limiting_metric = 'cpu'
            primary_error = cpu_result['error']
        else:
            primary_adjustment = memory_result['adjustment']
            limiting_metric = 'memory'
            primary_error = memory_result['error']
        
        # Apply adjustment
        self.operations_per_minute += primary_adjustment
        
        # Safety limits
        self.operations_per_minute = max(0.5, min(self.operations_per_minute, 100.0))
        
        # Determine overall phase
        cpu_phase = cpu_result['phase']
        memory_phase = memory_result['phase']
        
        # Use the more conservative phase
        if 'ramp_down' in [cpu_phase, memory_phase]:
            self.phase = 'ramp_down'
        elif 'maintain' in [cpu_phase, memory_phase] and \
             cpu_phase != 'ramp_up' and memory_phase != 'ramp_up':
            self.phase = 'maintain'
        elif cpu_phase == 'ramp_up' or memory_phase == 'ramp_up':
            self.phase = 'ramp_up'
        else:
            self.phase = 'fine_tune'
        
        # Generate reasoning
        reasoning = self._generate_reasoning(
            current_cpu, current_memory,
            cpu_result, memory_result,
            limiting_metric, primary_adjustment
        )
        
        # Get ML recommendations if available
        recommended_operations = []
        if self.ml_predictor and self.ml_predictor.is_trained:
            cpu_gap = self.target_cpu - current_cpu
            memory_gap = self.target_memory - current_memory
            
            try:
                recommended_operations = self.ml_predictor.recommend_operations(
                    cpu_gap, memory_gap, current_metrics
                )
            except Exception as e:
                logger.warning(f"ML prediction failed: {e}")
        
        result = {
            'operations_per_minute': round(self.operations_per_minute, 2),
            'recommended_operations': recommended_operations[:5],  # Top 5
            'phase': self.phase,
            'reasoning': reasoning,
            'debug': {
                'cpu': cpu_result,
                'memory': memory_result,
                'limiting_metric': limiting_metric,
                'iteration': self.iteration
            }
        }
        
        logger.info(f"📊 Iteration {self.iteration}: Phase={self.phase}, "
                   f"Ops/min={self.operations_per_minute:.1f}, "
                   f"CPU={current_cpu:.1f}%, Mem={current_memory:.1f}%")
        
        return result
    
    def _generate_reasoning(
        self,
        current_cpu: float,
        current_memory: float,
        cpu_result: Dict,
        memory_result: Dict,
        limiting_metric: str,
        adjustment: float
    ) -> str:
        """Generate human-readable explanation of control decision"""
        
        if self.phase == 'maintain':
            return (f"✅ Target reached! CPU={current_cpu:.1f}%, "
                   f"Memory={current_memory:.1f}%. Maintaining steady state.")
        
        elif self.phase == 'ramp_up':
            gap = abs(cpu_result['error']) if limiting_metric == 'cpu' else abs(memory_result['error'])
            return (f"⬆️ Below target by {gap:.1f}%. Increasing load by "
                   f"{adjustment:.1f} ops/min (limited by {limiting_metric}).")
        
        elif self.phase == 'ramp_down':
            overshoot = abs(cpu_result['error']) if limiting_metric == 'cpu' else abs(memory_result['error'])
            return (f"⬇️ Above target by {overshoot:.1f}%. Decreasing load by "
                   f"{abs(adjustment):.1f} ops/min.")
        
        else:  # fine_tune
            return (f"🎯 Fine tuning near target. Adjusting by {adjustment:.1f} ops/min "
                   f"(CPU error: {cpu_result['error']:.1f}%, "
                   f"Mem error: {memory_result['error']:.1f}%).")
    
    def reset(self):
        """Reset both PID controllers"""
        self.cpu_pid.reset()
        self.memory_pid.reset()
        self.operations_per_minute = 10.0
        self.phase = "ramp_up"
        self.iteration = 0
    
    def get_stats(self) -> Dict:
        """Get combined statistics from both controllers"""
        return {
            'cpu_pid': self.cpu_pid.get_stats(),
            'memory_pid': self.memory_pid.get_stats(),
            'current_ops_per_min': self.operations_per_minute,
            'phase': self.phase,
            'iteration': self.iteration
        }

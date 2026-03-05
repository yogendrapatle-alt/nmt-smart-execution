<div align="center">

# 🚀 Load Sense - Autonomous Load & Monitoring Tool

**A comprehensive NCM (Network Configuration Management) Monitoring Tool for Nutanix Infrastructure**

[![Hackathon XII](https://img.shields.io/badge/Hackathon-XII-blue)](https://nutanix.brightidea.com/D3176)
[![Python](https://img.shields.io/badge/Python-3.6+-green.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19.1.0-61dafb.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-12+-336791.svg)](https://www.postgresql.org/)

**Project Code:** D3176 | **Submitter:** Manoj Kumar Singhal

[Project URL](https://nutanix.brightidea.com/D3176) • [Repository](https://github.com/nutanix-engineering/hack2026-d3176) • [Documentation](#-documentation)

</div>

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [API Documentation](#-api-documentation)
- [Testing](#-testing)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

---

## 🎯 Overview

**Load Sense** is an enterprise-grade monitoring and load generation platform designed specifically for **Nutanix NCM (Network Configuration Management)** infrastructure. It provides real-time monitoring, intelligent alerting, automated reporting, and comprehensive execution tracking capabilities.

### What Makes Load Sense Special?

✨ **Real-time Monitoring** - Live Prometheus metrics integration  
🎯 **Smart Execution** - Automated entity operations with 22+ supported types  
📊 **Advanced Analytics** - Interactive dashboards with ApexCharts  
📧 **Automated Reporting** - Scheduled email reports with multi-user support  
🔔 **Multi-channel Alerts** - Slack, email, and in-app notifications  
⚡ **Resource Optimization** - Built-in load generation and optimization tools  
🔄 **Background Processing** - Continuous monitoring with graceful shutdown  

---

## ✨ Features

### 🎛️ Core Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Real-time Alert Monitoring** | Prometheus integration with live data collection | ✅ Production Ready |
| **Smart Execution Pipeline** | Comprehensive execution tracking with 22+ entity types | ✅ Production Ready |
| **Interactive Dashboards** | React-based UI with real-time WebSocket updates | ✅ Production Ready |
| **PDF Report Generation** | Professional alert summary reports | ✅ Production Ready |
| **Email Scheduling** | Multi-user email scheduling with APScheduler | ✅ Production Ready |
| **Resource Optimization** | Load generation and performance optimization | ✅ Production Ready |
| **Slack Integration** | Real-time notifications via Slack webhooks | ✅ Production Ready |
| **Background Monitoring** | Continuous monitoring with graceful shutdown | ✅ Production Ready |

### 📊 Entity Operations Support

The system supports comprehensive operations on **22+ entity types**:

#### **Tier 1: Core Infrastructure** (100% Production Ready)
- ✅ **VM** - Create, delete, power operations, cleanup
- ✅ **Project** - Create, update, delete, cleanup
- ✅ **Image** - Read, update operations
- ✅ **Subnet** - Create, delete, cleanup
- ✅ **Category** - Create, delete, cleanup

#### **Tier 2: Self-Service** (100% Production Ready)
- ✅ **Endpoint** - Create, update, delete
- ✅ **Library Variable** - Create, update, delete
- ✅ **Runbook** - Create, update, delete, execute

#### **Tier 3: Application Lifecycle**
- ✅ **Blueprint** (Single/Multi VM)
- ✅ **Application**
- ✅ **Marketplace Item**

#### **Tier 4: AIOps & Governance**
- ✅ **Playbook**, **UDA Policy**, **Scenario**, **Analysis Session**
- ✅ **Report Config/Instance**
- ✅ **Business Unit**, **Cost Center**, **Budget**, **Rate Card**

---

## 🚀 Quick Start

### Prerequisites Checklist

- [ ] **Python** 3.6+ installed
- [ ] **Node.js** 16+ and npm installed
- [ ] **PostgreSQL** 12+ database running
- [ ] **Kubernetes** cluster access configured
- [ ] **Prometheus** instance accessible
- [ ] **Nutanix NCM** credentials available

### 5-Minute Setup

```bash
# 1. Clone the repository
git clone https://github.com/nutanix-engineering/hack2026-d3176.git
cd hack2026-d3176

# 2. Backend Setup
cd nmt_backend
pip install -r requirements.txt  # Install Python dependencies
python postgres_db_con.py        # Configure database connection

# 3. Frontend Setup
cd ../nmt_ui/prism-onboarding-ui
npm install                      # Install Node.js dependencies

# 4. Start Backend (Terminal 1)
cd ../../nmt_backend
python run_backend.py

# 5. Start Frontend (Terminal 2)
cd ../nmt_ui/prism-onboarding-ui
npm run dev

# 6. Access Application
# Frontend: http://localhost:5173
# Backend API: http://localhost:5000
```

---

## 🏗️ Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Web UI     │  │  Mobile App  │  │  API Clients  │        │
│  │  (React/TS)  │  │   (Future)   │  │   (Future)   │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
└─────────┼─────────────────┼─────────────────┼────────────────┘
           │                 │                 │
           └─────────────────┴─────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                    API GATEWAY LAYER                            │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │         Flask REST API + WebSocket Server                 │ │
│  │  • RESTful endpoints                                      │ │
│  │  • WebSocket for real-time updates                       │ │
│  │  • Authentication & Authorization                        │ │
│  └───────────────────────┬──────────────────────────────────┘ │
└───────────────────────────┼────────────────────────────────────┘
                            │
┌───────────────────────────┼────────────────────────────────────┐
│                    APPLICATION LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Execution   │  │   Alert     │  │  Monitoring  │        │
│  │   Service     │  │   Service   │  │   Service   │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│         │                 │                 │                  │
│  ┌──────┴─────────────────┴─────────────────┴───────┐        │
│  │         Background Scheduler (APScheduler)        │        │
│  └───────────────────────────────────────────────────┘        │
└───────────────────────────┼────────────────────────────────────┘
                            │
┌───────────────────────────┼────────────────────────────────────┐
│                      DATA LAYER                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  PostgreSQL  │  │  Prometheus  │  │  Kubernetes  │        │
│  │   Database   │  │    Metrics   │  │     API      │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### Component Details

#### **Frontend (`nmt_ui/prism-onboarding-ui/`)**
- **Framework:** React 19 with TypeScript
- **Build Tool:** Vite
- **State Management:** React Hooks + Context API
- **Real-time:** WebSocket via Socket.io
- **Charts:** ApexCharts for visualizations
- **Routing:** React Router 7.6.3
- **PDF:** React PDF Renderer

#### **Backend (`nmt_backend/`)**
- **Framework:** Python Flask
- **Database:** PostgreSQL with connection pooling
- **Scheduling:** APScheduler for cron jobs
- **Metrics:** Prometheus client integration
- **SSH:** Paramiko for remote operations
- **Async:** Background task processing

#### **External Integrations**
- **Prometheus** - Metrics collection and querying
- **Kubernetes** - Pod monitoring and management
- **AlertManager** - Alert routing and management
- **SMTP** - Email notifications (Nutanix mail relay)
- **Slack** - Real-time alert notifications

---

## 📦 Installation

### Detailed Installation Steps

#### 1. Backend Installation

```bash
# Navigate to backend directory
cd nmt_backend

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install flask psycopg2-binary apscheduler prometheus-client paramiko

# Or if requirements.txt exists:
pip install -r requirements.txt

# Verify installation
python -c "import flask; print('Flask installed successfully')"
```

#### 2. Frontend Installation

```bash
# Navigate to frontend directory
cd nmt_ui/prism-onboarding-ui

# Install dependencies
npm install

# Verify installation
npm list react react-dom typescript
```

#### 3. Database Setup

```bash
# Create PostgreSQL database
createdb ncm_monitoring

# Run migrations (if available)
psql -d ncm_monitoring -f migrations/init.sql

# Or use Python to initialize
python nmt_backend/postgres_db_con.py
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Database Configuration
DB_HOST=10.99.79.111
DB_PORT=5432
DB_NAME=ncm_monitoring
DB_USER=ncm_user
DB_PASSWORD=your_password_here

# API Configuration
API_HOST=0.0.0.0
API_PORT=5000
DEBUG=false

# Prometheus Configuration
PROMETHEUS_URL=http://prometheus-server:9090
PROMETHEUS_PORT=30546

# Kubernetes Configuration
KUBECONFIG_PATH=/path/to/kubeconfig
KUBERNETES_NAMESPACE=ntnx-system

# Email Configuration (SMTP)
SMTP_HOST=10.4.8.37
SMTP_PORT=25
SMTP_USER=service_account@nutanix.com
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=nmt@nutanix.com

# Slack Configuration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Application Settings
LOG_LEVEL=INFO
MAX_CONCURRENT_EXECUTIONS=10
EXECUTION_TIMEOUT=3600
```

### Configuration Files

#### **Database Configuration**
Edit `nmt_backend/postgres_db_con.py`:
```python
DB_CONFIG = {
    'host': os.getenv('DB_HOST', '10.99.79.111'),
    'port': int(os.getenv('DB_PORT', 5432)),
    'database': os.getenv('DB_NAME', 'ncm_monitoring'),
    'user': os.getenv('DB_USER', 'ncm_user'),
    'password': os.getenv('DB_PASSWORD', 'your_password')
}
```

#### **Prometheus Configuration**
Edit `nmt_backend/prometheus_config.py`:
```python
PROMETHEUS_CONFIG = {
    'url': os.getenv('PROMETHEUS_URL', 'http://prometheus-server:9090'),
    'port': int(os.getenv('PROMETHEUS_PORT', 30546)),
    'timeout': 30
}
```

#### **Frontend Configuration**
Edit `nmt_ui/prism-onboarding-ui/.env`:
```bash
VITE_API_BASE_URL=http://localhost:5000
VITE_WS_URL=ws://localhost:5000
VITE_PROMETHEUS_URL=http://prometheus-server:9090
```

---

## 💻 Usage

### Starting the Application

#### Development Mode

**Terminal 1 - Backend:**
```bash
cd nmt_backend
export FLASK_ENV=development
python run_backend.py
# Server starts on http://localhost:5000
```

**Terminal 2 - Frontend:**
```bash
cd nmt_ui/prism-onboarding-ui
npm run dev
# Frontend starts on http://localhost:5173
```

#### Production Mode

**Backend:**
```bash
cd nmt_backend
gunicorn -w 4 -b 0.0.0.0:5000 run_backend:app
```

**Frontend:**
```bash
cd nmt_ui/prism-onboarding-ui
npm run build
# Serve the dist/ directory with nginx or similar
```

### Common Operations

#### 1. Create a New Execution
```python
# Via API
curl -X POST http://localhost:5000/api/executions \
  -H "Content-Type: application/json" \
  -d '{
    "testbed_id": "testbed-123",
    "workload": {...}
  }'
```

#### 2. Monitor Execution Status
```python
# Get execution status
curl http://localhost:5000/api/executions/{execution_id}/status
```

#### 3. Generate PDF Report
```python
# Via API
curl -X POST http://localhost:5000/api/reports/generate \
  -H "Content-Type: application/json" \
  -d '{"execution_id": "NMT-20260130-120000-abc123"}'
```

#### 4. Schedule Email Report
```python
# Schedule daily email
curl -X POST http://localhost:5000/api/emails/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user@nutanix.com",
    "schedule": "0 9 * * *",
    "filters": {...}
  }'
```

---

## 📚 API Documentation

### Core Endpoints

#### **Execution Management**
```
POST   /api/executions              Create new execution
GET    /api/executions              List all executions
GET    /api/executions/{id}          Get execution details
GET    /api/executions/{id}/status   Get execution status
POST   /api/executions/{id}/pause    Pause execution
POST   /api/executions/{id}/resume   Resume execution
POST   /api/executions/{id}/stop     Stop execution
DELETE /api/executions/{id}          Delete execution
```

#### **Alert Management**
```
GET    /api/alerts                  List alerts with filters
GET    /api/alerts/{id}             Get alert details
POST   /api/alerts/{id}/acknowledge Acknowledge alert
POST   /api/alerts/export/pdf       Export alerts as PDF
```

#### **Monitoring**
```
GET    /api/metrics/pods            Get pod metrics
GET    /api/metrics/executions      Get execution metrics
GET    /api/metrics/alerts          Get alert metrics
GET    /api/health                  Health check endpoint
```

#### **Email Scheduling**
```
GET    /api/emails/schedules       List email schedules
POST   /api/emails/schedules       Create email schedule
PUT    /api/emails/schedules/{id}  Update email schedule
DELETE /api/emails/schedules/{id}  Delete email schedule
```

### WebSocket Events

```javascript
// Connect to WebSocket
const socket = io('http://localhost:5000');

// Listen for execution updates
socket.on('execution:update', (data) => {
  console.log('Execution update:', data);
});

// Listen for alert updates
socket.on('alert:new', (data) => {
  console.log('New alert:', data);
});
```

---

## 🧪 Testing

### Running Tests

```bash
# Test entity operations
python test_all_entity_operations.py

# Test execution recovery
python test_execution_recovery.py

# Test connection pooling
python test_connection_pooling.py

# Test smart execution E2E
python test_smart_execution_e2e.py

# Test background monitoring
python test_background_monitoring.py

# Test critical flows
bash test_critical_flows.sh

# Test Slack integration
bash test_slack_integration.sh

# Test rule config manager
bash test_rule_config_manager.sh

# Test graceful shutdown
bash test_graceful_shutdown.sh
```

### Test Coverage

- ✅ Entity operations (22+ entity types)
- ✅ Execution pipeline
- ✅ Database connections
- ✅ Prometheus integration
- ✅ Email scheduling
- ✅ Slack notifications
- ✅ Background monitoring
- ✅ Error handling and recovery

---

## 🔧 Troubleshooting

### Common Issues

#### **Issue: Database Connection Failed**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Verify connection settings
psql -h 10.99.79.111 -U ncm_user -d ncm_monitoring

# Check firewall rules
sudo ufw status
```

#### **Issue: Prometheus Connection Failed**
```bash
# Test Prometheus connectivity
curl http://prometheus-server:9090/api/v1/query?query=up

# Check port configuration
netstat -tuln | grep 30546

# Verify Prometheus URL in config
cat nmt_backend/prometheus_config.py
```

#### **Issue: Frontend Can't Connect to Backend**
```bash
# Check backend is running
curl http://localhost:5000/api/health

# Verify CORS settings in backend
# Check VITE_API_BASE_URL in frontend .env

# Check browser console for errors
```

#### **Issue: Email Not Sending**
```bash
# Test SMTP connection
python -c "
import smtplib
server = smtplib.SMTP('10.4.8.37', 25)
server.quit()
"

# Check email configuration
cat .env | grep SMTP

# Verify service account permissions
```

#### **Issue: Execution Stuck**
```bash
# Check execution status
curl http://localhost:5000/api/executions/{id}/status

# Check logs
tail -f nmt_backend/main.log

# Force stop execution
curl -X POST http://localhost:5000/api/executions/{id}/stop
```

### Debug Mode

Enable debug mode for detailed logging:

```bash
# Backend
export FLASK_ENV=development
export DEBUG=true
export LOG_LEVEL=DEBUG
python run_backend.py

# Frontend
npm run dev -- --debug
```

### Logs Location

- **Backend logs:** `nmt_backend/main.log`
- **Frontend logs:** Browser console
- **Database logs:** PostgreSQL log files
- **Application logs:** `logs/` directory

---

## 📁 Project Structure

```
nmt_old/
├── nmt_backend/                    # Backend Python application
│   ├── main.py                     # Main entry point
│   ├── run_backend.py             # Backend server runner
│   ├── prometheus_monitor.py      # Prometheus integration
│   ├── prometheus_config.py       # Prometheus configuration
│   ├── postgres_db_con.py         # Database connection
│   ├── ncm_utils.py               # NCM utilities
│   ├── trigger_alertmanager.py    # AlertManager integration
│   └── ...                        # Other backend modules
│
├── nmt_ui/                        # Frontend React application
│   └── prism-onboarding-ui/       # Main UI application
│       ├── src/                   # Source code
│       │   ├── pages/             # Page components
│       │   ├── components/       # Reusable components
│       │   ├── services/         # API services
│       │   └── utils/            # Utility functions
│       ├── backend/               # Backend API server
│       │   ├── app.py            # Flask app
│       │   ├── database.py      # Database models
│       │   └── services/        # Business logic
│       ├── package.json          # Dependencies
│       └── vite.config.ts       # Vite configuration
│
├── resource_optimizer_*.py        # Resource optimization scripts
├── test_*.py                      # Test scripts
├── test_*.sh                       # Shell test scripts
├── setup_*.sh                      # Setup scripts
├── .gitignore                     # Git ignore rules
└── README.md                      # This file
```

---

## 🛠️ Tech Stack

### Frontend Technologies
- **React** 19.1.0 - UI framework
- **TypeScript** 5.0+ - Type safety
- **Vite** - Build tool and dev server
- **React Router** 7.6.3 - Routing
- **ApexCharts** 5.3.6 - Data visualization
- **Socket.io Client** 4.8.3 - WebSocket client
- **React PDF Renderer** 4.3.0 - PDF generation
- **Axios** 1.10.0 - HTTP client

### Backend Technologies
- **Python** 3.6+ - Programming language
- **Flask** - Web framework
- **PostgreSQL** 12+ - Database
- **APScheduler** - Task scheduling
- **Prometheus Client** - Metrics collection
- **Paramiko** - SSH client
- **Psycopg2** - PostgreSQL adapter
- **WebSocket** - Real-time communication

### Infrastructure
- **Kubernetes** - Container orchestration
- **Prometheus** - Metrics collection
- **AlertManager** - Alert management
- **Docker** - Containerization
- **Nginx** - Reverse proxy (production)

---

## 📈 Monitoring & Metrics

### Collected Metrics

#### **Pod Metrics**
- CPU usage (millicores)
- Memory usage (MB/bytes)
- Network I/O
- Pod status and health

#### **Operation Metrics**
- Operation latency
- Success/failure rates
- Operation duration
- Entity operation counts

#### **Execution Metrics**
- Execution progress
- Total duration
- Status distribution
- Error rates

#### **Alert Metrics**
- Alert counts by severity
- Alert status distribution
- Alert resolution times
- Alert trends

#### **System Metrics**
- Database connection pool status
- API response times
- WebSocket connections
- Background job status

### Accessing Metrics

```bash
# Prometheus query examples
# Pod CPU usage
curl 'http://prometheus:9090/api/v1/query?query=pod_cpu_usage'

# Execution status
curl 'http://prometheus:9090/api/v1/query?query=execution_status_total'

# Alert counts
curl 'http://prometheus:9090/api/v1/query?query=alert_count_by_severity'
```

---

## 🤝 Contributing

This is a **Hackathon XII** project. For contributions, questions, or issues:

- **Submitter:** Manoj Kumar Singhal
- **Project Code:** D3176
- **Project URL:** https://nutanix.brightidea.com/D3176
- **Repository:** https://github.com/nutanix-engineering/hack2026-d3176

### Development Guidelines

1. Follow Python PEP 8 style guide for backend code
2. Use TypeScript for all frontend code
3. Write tests for new features
4. Update documentation for API changes
5. Follow Git commit message conventions

---

## 📄 License

This project is part of **Nutanix Hackathon XII** and is for internal use only.

---

## 🔗 Additional Resources

- **Project URL:** https://nutanix.brightidea.com/D3176
- **Repository:** https://github.com/nutanix-engineering/hack2026-d3176
- **Nutanix NCM Documentation:** [Internal Documentation]
- **Prometheus Documentation:** https://prometheus.io/docs/

---

## 📌 Important Notes

### Excluded Folders
- ❌ `loadgen/` folder is excluded (see `.gitignore`)
- ❌ `vertical-menu/` folder is excluded
- ❌ Most `.md` documentation files removed (kept only README.md)

### Before First Use
- ✅ Run database migrations
- ✅ Configure all external service endpoints
- ✅ Set up SMTP credentials for email
- ✅ Configure Prometheus endpoints
- ✅ Set up Kubernetes access
- ✅ Test all integrations

### Production Deployment
- Use environment variables for sensitive data
- Enable HTTPS for production
- Set up proper logging and monitoring
- Configure backup strategies
- Set up alerting for critical failures

---

<div align="center">

**Last Updated:** January 2026

Made with ❤️ for Nutanix Hackathon XII

</div>

# Nutanix Cloud Manager (NCM) Monitoring Tool

A React + TypeScript frontend with Flask backend for Prometheus monitoring and alert management. **NCM** stands for **Nutanix Cloud Manager** (not Network Configuration Management).

## Quick Start

### 1. Install Dependencies

**Backend:**
```bash
cd backend
pip install flask flask-cors requests paramiko
```

**Frontend:**
```bash
npm install
```

### 2. Start Services

**Start Backend:**
```bash
cd backend
python app.py
# Backend runs on http://localhost:5000
```

**Start Frontend:**
```bash
npm run dev
# Frontend runs on http://localhost:5173
```

### 3. Use the Application

1. Open `http://localhost:5173` in browser
2. Complete onboarding form (PC-IP, credentials, labels)
3. Use Rule Builder to create monitoring rules
4. View alerts in Alert Summary page

## Features

- **Onboarding**: Configure Prometheus endpoints and credentials
- **Rule Builder**: Create complex monitoring rules with conditions
- **Alert Summary**: View historical alerts with pagination and filtering
- **Historical Data**: Integrates with Prometheus for real alert data
- **Email Reports**: Schedule daily alert digests
- **JITA Integration**: Execute and monitor JITA job profiles with real-time status tracking

## Project Structure

```
├── backend/           # Flask API server
│   ├── app.py        # Main backend
│   └── configs/      # Generated rule configs
├── src/              # React frontend
│   ├── components/   # UI components  
│   └── pages/        # Page components
└── package.json      # Frontend deps
```

## Environment Setup

Create `.env` file for custom backend URL:
```env
VITE_BACKEND_URL=http://localhost:5000
```

For network access, replace `localhost` with your machine's IP.

## JITA Integration

The application includes integration with JITA (Job Infrastructure Test Automation) for running and monitoring test job profiles.

### Features:
- **Execute JITA Jobs**: Trigger job profiles directly from the Status page
- **Real-time Monitoring**: Track job status with automatic status parsing
- **Task Status Tracking**: Monitor individual task progress and completion
- **Status History**: View detailed execution logs and results

### Usage:
1. Navigate to the Status page (`/status`)
2. Click "Run JITA Jobs" to execute the configured job profile
3. Monitor progress with real-time status updates
4. Use "Check Current Status" for manual status refresh
5. View detailed status information in the expandable section

### Configuration:
The JITA integration uses the configuration in `/mnt/data/nmt_backend/jita_main.py`:
- Job profile: `systest_pc_env_1nl_interop_greenfield_meghana`
- Authentication credentials are configured in the script
- Task monitoring includes status checking and completion waiting

### Status Information:
- **Job Profile Name**: Name of the executed JITA job profile
- **Task ID**: Unique identifier for the running task
- **Status**: Current execution state (triggered, running, completed, failed, etc.)
- **Timestamps**: Creation and last update times
- **Detailed Logs**: Full status JSON for debugging

## API Endpoints

- `POST /api/prometheus-alerts` - Get historical alerts
- `POST /api/deploy-config-immediate` - Deploy monitoring rules
- `POST /api/check-prometheus` - Test Prometheus connection
- `POST /api/schedule-email` - Email report scheduling
- `POST /api/run-jita-jobs` - Execute JITA job profiles
- `GET /api/jita-job-status` - Get latest JITA job status
- `GET /api/jita-job-status/<task_id>` - Get specific JITA task status

## Troubleshooting

**Backend connection issues:**
1. Ensure backend is running on port 5000
2. Check `.env` file has correct backend URL
3. Verify firewall allows ports 5000 and 5173

**No data appearing:**
- Check browser console for errors
- Verify Prometheus endpoint in onboarding form
- Backend logs show connection status

## Production Build

```bash
npm run build
npm run preview
```

---

For full setup details and troubleshooting, see the original documentation.

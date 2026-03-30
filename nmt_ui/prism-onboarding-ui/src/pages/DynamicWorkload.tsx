
import React, { useEffect, useState } from 'react';
import WorkloadUploader from '../components/WorkloadUploader';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '../context/OnboardingContext';
import ntnxLogo from '../assets/new_nutanix_logo.png';
import { getApiBase } from '../utils/backendUrl';
// For file download
const downloadJSON = (data: any, filename: string) => {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
};

// Utility to fetch entity names from JSON
const fetchEntityNames = async (): Promise<string[]> => {
	const res = await fetch('/src/entity-names.json');
	if (!res.ok) return [];
	return res.json();
};

type WorkloadRow = {
	entity: string;
	operation: string;
	iterationSize: number | '';
	numIterations: number | '';
	interval: number | '';
};


const DynamicWorkload: React.FC = () => {
	const navigate = useNavigate();
	const { onboardingForm } = useOnboarding();
	
	// Workload Label state
	const [workloadLabel, setWorkloadLabel] = useState('');
	const [rows, setRows] = useState<WorkloadRow[]>([]);
	const [entityOptions, setEntityOptions] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [showSuccess, setShowSuccess] = useState(false);
	const [successMsg, setSuccessMsg] = useState('');

	// State for Dynamic workload execution -- Meghana
	const [workloadExecuting, setWorkloadExecuting] = useState(false);
	const [workloadStatus, setWorkloadStatus] = useState<string | null>(null);
  
	// Handler for uploaded workload JSON
	const handleWorkloadLoaded = (json: any) => {
		if (typeof json.workload_label === 'string') setWorkloadLabel(json.workload_label);
		if (Array.isArray(json.workloads)) {
			setRows(json.workloads.map((w: any) => ({
				entity: w.entity || '',
				operation: w.operation || '',
				iterationSize: w.iterationSize ?? '',
				numIterations: w.numIterations ?? '',
				interval: w.interval ?? '',
			})));
		}
	};

	// Handler for fetching workload JSON from backend
	const handleFetchWorkload = async () => {
		try {
			// Always use localhost:5000 for backend in development
			const backendUrl = getApiBase();
			const res = await fetch(`${backendUrl}/api/get-workload`);
			if (!res.ok) throw new Error('Failed to fetch workload');
			const json = await res.json();
			handleWorkloadLoaded(json);
		} catch (err) {
			alert('Failed to fetch workload from backend.');
		}
	};

	useEffect(() => {
		fetchEntityNames().then((entities) => {
			setEntityOptions(entities);
			setLoading(false);
		});
	}, []);

	const handleInput = (idx: number, field: keyof WorkloadRow, value: string) => {
		setRows((prev) => {
			const updated = [...prev];
			if (field === 'numIterations' || field === 'iterationSize' || field === 'interval') {
				const num = value === '' ? '' : Math.max(0, Number(value));
				updated[idx][field] = num as number | '';
			} else {
				updated[idx][field] = value;
			}
			return updated;
		});
	};

	const handleAddRow = () => {
		setRows((prev) => [
			...prev,
			{
				entity: '',
				operation: '',
				iterationSize: '',
				numIterations: '',
				interval: '',
			},
		]);
	};

	const handleDeleteRow = (idx: number) => {
		setRows((prev) => prev.filter((_, i) => i !== idx));
	};

	const handleSubmit = async () => {
		if (rows.length === 0) {
			alert('Please add at least one workload row.');
			return;
		}
		// Validate all rows
		for (const row of rows) {
			if (!row.entity || !row.operation) {
				alert('Please select Entity Name and Operation for all rows.');
				return;
			}
		}
		// Calculate total monitoring time (sum of all totalTime in minutes)
		let totalMinutes = 0;
		rows.forEach(row => {
			const n = Number(row.numIterations);
			const i = Number(row.interval);
			if (!isNaN(n) && !isNaN(i) && n > 0) {
				totalMinutes += n * i;
			}
		});
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		let timeStr = '';
		if (hours > 0 && minutes > 0) timeStr = `${hours} hour${hours > 1 ? 's' : ''} ${minutes} min${minutes > 1 ? 's' : ''}`;
		else if (hours > 0) timeStr = `${hours} hour${hours > 1 ? 's' : ''}`;
		else timeStr = `${minutes} min${minutes > 1 ? 's' : ''}`;
		// Output as { workload_label: ..., workloads: [ ... ] }
		const output = {
			workload_label: workloadLabel,
			pc_uuid: onboardingForm?.pcUuid,
			pc_ip: onboardingForm?.pcIp,
			testbed_label: onboardingForm?.ncmLabel,
			workloads: rows.map(({ entity, operation, iterationSize, numIterations, interval }) => ({
				entity,
				operation,
				iterationSize,
				numIterations,
				interval,
			})),
		};
		downloadJSON(output, 'dynamic_workload.json');
		// Always use localhost:5000 for backend in development
		const backendUrl = getApiBase();
		try {
			const unique_testbed_id = localStorage.getItem("unique_testbed_id");
			const unique_rule_id = localStorage.getItem("unique_rule_id");
			

      		if (!unique_rule_id) {
        		alert("Missing rule UUID – upload a testbed first!");
        		return;
      }
			// Upload workload first
			const uploadRes = await fetch(`${backendUrl}/api/upload-workload`, {
				method: 'POST',
  				headers: { 'Content-Type': 'application/json' },
  				body: JSON.stringify({
   				output,
				unique_testbed_id,            // shorthand for output: output
    			unique_rule_id,  // shorthand for unique_testbed_id: unique_testbed_id
  				}),
				});
			const uploadData = await uploadRes.json();
			let msg;
			if (uploadData.success) {
				// Save workload ID locally
  				if (uploadData.unique_workload_id) {
    				localStorage.setItem("unique_workload_id", uploadData.unique_workload_id);
  				}
				//msg = `Congratulations! You have defined ${workloadLabel ? '"' + workloadLabel + '"' : 'your workload'}. It will take ${timeStr} to monitor.`;
				msg = `Congratulations! You have defined ${workloadLabel ? '"' + workloadLabel + '"' : 'your workload'}. It will take ${timeStr} to monitor. Dynamic workload is created successfully`;
				setSuccessMsg(msg);
				setShowSuccess(true);
				setTimeout(() => setShowSuccess(false), 10000);
				// Now trigger dynamic workload jobs
				setWorkloadExecuting(true);
				setWorkloadStatus('Executing dynamic workload jobs...');
				try {
					const unique_testbed_id = localStorage.getItem("unique_testbed_id");
					const unique_rule_id = localStorage.getItem("unique_rule_id");
					const unique_workload_id = localStorage.getItem("unique_workload_id");

					const runRes = await fetch(`${backendUrl}/api/run-dynamic-workload`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ unique_testbed_id, unique_rule_id,unique_workload_id })
					});
					
					const runData = await runRes.json();
					if (runRes.ok && runData.success) {
						setWorkloadStatus('Dynamic workload is created successfully, jobs will be executed after deployment and prometheus configuration is successful');
					} else {
						setWorkloadStatus(`Dynamic workload execution failed: ${runData.error || 'Unknown error'}`);
					}
				} catch (err) {
					setWorkloadStatus(`Error running dynamic workload jobs: ${err}`);
				} finally {
					setWorkloadExecuting(false);
				}
			} else {
				msg = 'Workload upload failed: ' + (uploadData.error || 'Unknown error');
				setSuccessMsg(msg);
				setShowSuccess(true);
				setTimeout(() => setShowSuccess(false), 10000);
			}
		} catch (err) {
			setSuccessMsg('Workload upload failed: ' + err);
			setShowSuccess(true);
			setTimeout(() => setShowSuccess(false), 10000);
		}
	};

	const handleRunDynamicJobs = async () => {
		setWorkloadExecuting(true);
		setWorkloadStatus('Executing dynamic workload jobs...');
		try {
			// Always use localhost:5000 for backend in development
			const backendUrl = getApiBase();
			const res = await fetch(`${backendUrl}/api/run-dynamic-workload`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			const result = await res.json();
			if (res.ok && result.success) {
				setWorkloadStatus('Dynamic workload is created successfully, jobs will be executed after deployment and prometheus configuration is successful');
				console.log('Dynamic workload execution output:', result.output);
				return true;
			} else {
				setWorkloadStatus(`Dynamic workload execution failed: ${result.error || 'Unknown error'}`);
				console.error('Dynamic workload execution failed:', result);
				return false;
			}
		} catch (err) {
			setWorkloadStatus(`Error running dynamic workload jobs: ${err}`);
			console.error('Error running dynamic workload jobs:', err);
			return false;
		} finally {
			setWorkloadExecuting(false);
		}
	};

	// Calculate total count and total time (rounded total time)
	const getTotals = (row: WorkloadRow) => {
		const n = Number(row.numIterations);
		const s = Number(row.iterationSize);
		const i = Number(row.interval);
		const totalCount = !isNaN(n) && !isNaN(s) ? n * s : '';
		// Total time in hours: (n-1)*i (intervals between) + n*duration (if duration per iteration is needed)
		// Here, total time = (n-1)*i minutes, convert to hours
		const totalTime = !isNaN(n) && !isNaN(i) && n > 0 ? ((n) * i) / 60 : '';
		const roundedTime = totalTime !== '' ? `${Math.round(Number(totalTime))} Hrs` : '';
		return {
			totalCount,
			totalTime: roundedTime,
		};
	};

		if (loading) {
			return <div style={{ textAlign: 'center', marginTop: 80 }}>Loading...</div>;
		}

				return (
				<div className="main-content">
      {/* Breadcrumb */}
      <div className="d-flex align-items-center mb-4">
        <nav aria-label="breadcrumb">
          <ol className="breadcrumb mb-0">
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>
                <i className="material-icons-outlined" style={{ fontSize: 18, verticalAlign: 'middle' }}>home</i>
              </a>
            </li>
            <li className="breadcrumb-item">
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/rulebuilder-experimental'); }}>
                Rule Builder
              </a>
            </li>
            <li className="breadcrumb-item active">Dynamic Workload</li>
          </ol>
        </nav>
      </div>

      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
      }}>
								<div className="card rounded-4 border-0 shadow-sm"
										style={{
												padding: 32,
										}}
								>
							{/* Nutanix Logo and Header */}
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
							  <img src={ntnxLogo} alt="Nutanix Logo" style={{ width: 100, margin: '0 auto 16px', display: 'block' }} />
							  <h2 style={{ color: '#00008B', marginTop: 0, marginBottom: 10, fontWeight: 700, letterSpacing: 0.5, fontSize: 28 }}>
												Dynamic Workload Configuration
										  </h2>
              </div>
										{showSuccess && (
											<div style={{
												background: '#e6f9e6',
												color: '#20732d',
												border: '1px solid #b2e2b2',
												borderRadius: 8,
												padding: '18px 24px',
												margin: '0 auto 12px',
												textAlign: 'center',
												fontSize: 18,
												fontWeight: 600,
												maxWidth: 600,
												boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
											}}>
												{successMsg}
											</div>
										)}
							{/* Workload Label input and Upload Workload Button in one row */}
									<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 16, gap: 12 }}>
										<label htmlFor="workload-label" style={{ fontWeight: 500, fontSize: 16, color: '#333' }}>Workload Label:</label>
										<input
											id="workload-label"
											type="text"
											value={workloadLabel}
											onChange={e => setWorkloadLabel(e.target.value)}
											placeholder="Enter workload label"
											style={{
												padding: '8px 14px',
												borderRadius: 5,
												border: '1px solid #bbb',
												fontSize: 15,
												minWidth: 220,
												background: '#f8fafd',
												color: '#222',
											}}
										/>
										<WorkloadUploader onWorkloadLoaded={handleWorkloadLoaded} />
										<button
											onClick={handleFetchWorkload}
											style={{
												background: '#fff',
												color: '#0078d4',
												fontWeight: 600,
												fontSize: 15,
												border: '1px solid #0078d4',
												borderRadius: 6,
												padding: '8px 18px',
												cursor: 'pointer',
												boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
												marginLeft: 0
											}}
										>
											Fetch Workload
										</button>
									</div>
						<div style={{ color: '#444', fontSize: 18, marginBottom: 1, fontStyle: 'italic' }}>
									Define your Maximum Workload configuration and incremental changes
								</div>
						<div style={{ overflowX: 'auto' }}>
							<table style={{ width: '100%', borderCollapse: 'collapse', background: '#f5f7fa', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
								<thead>
									<tr style={{ background: '#e6f0fa', color: '#0078d4', fontWeight: 600 }}>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Entity Name</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Operation</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Batch Size</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Batch Count</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Interval Between Batch (min)</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Total Workload</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}>Total Time</th>
										<th style={{ padding: 12, borderBottom: '1px solid #eee' }}></th>
									</tr>
								</thead>
								<tbody>
									{rows.map((row, idx) => {
										const { totalCount, totalTime } = getTotals(row);
										return (
											<tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f5f7fa' }}>
												<td style={{ padding: 10, minWidth: 160 }}>
													<select
														value={row.entity}
														onChange={e => handleInput(idx, 'entity', e.target.value)}
														style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #ccc', background: '#fff', color: '#000' }}
													>
														<option value="">Select Entity</option>
														{entityOptions.map(opt => (
															<option key={opt} value={opt}>{opt}</option>
														))}
													</select>
												</td>
												<td style={{ padding: 10, minWidth: 120 }}>
													<select
														value={row.operation}
														onChange={e => handleInput(idx, 'operation', e.target.value)}
														style={{ width: '100%', padding: 6, borderRadius: 4, border: '1px solid #ccc', background: '#fff', color: '#000' }}
													>
														<option value="">Select Operation</option>
														<option value="Create">Create</option>
														<option value="Read">Read</option>
														<option value="Update">Update</option>
														<option value="Delete">Delete</option>
													</select>
												</td>
												<td style={{ padding: 10 }}>
													<input
														type="number"
														min={1}
														value={row.iterationSize}
														onChange={e => handleInput(idx, 'iterationSize', e.target.value)}
														style={{ width: 80, padding: 6, borderRadius: 4, border: '1px solid #ccc', background: '#fff', color: '#000' }}
														placeholder="e.g. 100"
													/>
												</td>
												<td style={{ padding: 10 }}>
													<input
														type="number"
														min={1}
														value={row.numIterations}
														onChange={e => handleInput(idx, 'numIterations', e.target.value)}
														style={{ width: 80, padding: 6, borderRadius: 4, border: '1px solid #ccc', background: '#fff', color: '#000' }}
														placeholder="e.g. 10"
													/>
												</td>
												<td style={{ padding: 10 }}>
													<input
														type="number"
														min={1}
														value={row.interval}
														onChange={e => handleInput(idx, 'interval', e.target.value)}
														style={{ width: 100, padding: 6, borderRadius: 4, border: '1px solid #ccc', background: '#fff', color: '#000' }}
														placeholder="e.g. 30"
													/>
												</td>
												<td style={{ padding: 10, fontWeight: 500, color: '#0078d4', textAlign: 'center' }}>{totalCount}</td>
												<td style={{ padding: 10, fontWeight: 500, color: '#0078d4' }}>{totalTime}</td>
												<td style={{ padding: 10 }}>
													<button
														onClick={() => handleDeleteRow(idx)}
														style={{ background: 'none', border: 'none', color: '#d32f2f', fontWeight: 700, cursor: 'pointer', fontSize: 18 }}
														title="Delete Row"
													>
														×
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
						<div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
							<button
								onClick={handleAddRow}
								style={{
									background: '#fff',
									color: '#0078d4',
									fontWeight: 600,
									fontSize: 15,
									border: '1px solid #0078d4',
									borderRadius: 6,
									padding: '8px 22px',
									cursor: 'pointer',
									boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
									marginRight: 0
								}}
							>
								+ Add Row
							</button>
						</div>
					<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 24, gap: 16 }}>
											 <button
													 onClick={handleSubmit}
													 disabled={workloadExecuting}
													 style={{
															 background: workloadExecuting ? '#6c757d' : '#0078d4',
															 color: '#fff',
															 fontWeight: 600,
															 fontSize: 16,
															 border: 'none',
															 borderRadius: 6,
															 padding: '12px 32px',
															 cursor: workloadExecuting ? 'not-allowed' : 'pointer',
															 boxShadow: workloadExecuting ? 'none' : '0 2px 8px rgba(0,120,212,0.08)',
															 transition: 'background 0.2s',
													 }}
											 >
													 {workloadExecuting ? 'Executing Dynamic Workload...' : 'Submit & Download JSON'}
											 </button>
											 {workloadStatus && (
												 <div style={{ marginTop: 8, textAlign: 'center', color: workloadStatus.includes('success') ? 'green' : 'red', fontWeight: 500 }}>
													 {workloadStatus}
												 </div>
											 )}
					</div>
				</div>
      </div>
			</div>
		);
};

export default DynamicWorkload;

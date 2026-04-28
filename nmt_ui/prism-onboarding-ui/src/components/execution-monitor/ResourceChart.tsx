import React from 'react';
import ReactApexChart from 'react-apexcharts';

interface Props {
  metricsHistory: Array<{ timestamp: string; cpu: number; memory: number; phase: string }>;
  cpuTarget: number;
  memTarget: number;
}

const ResourceChart: React.FC<Props> = ({ metricsHistory, cpuTarget, memTarget }) => {
  if (metricsHistory.length === 0) {
    return (
      <div className="card border-0 rounded-4 shadow-sm mb-3">
        <div className="card-body text-center text-muted py-5">
          <i className="material-icons-outlined" style={{ fontSize: 40 }}>hourglass_empty</i>
          <p className="mt-2">Waiting for metrics data...</p>
        </div>
      </div>
    );
  }

  const categories = metricsHistory.map((h, i) => {
    if (h.timestamp) {
      try {
        const d = new Date(h.timestamp);
        if (!isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } catch { /* fallback */ }
    }
    return `${i + 1}`;
  });
  const cpuSeries = metricsHistory.map(h => parseFloat((h.cpu ?? 0).toFixed(1)));
  const memSeries = metricsHistory.map(h => parseFloat((h.memory ?? 0).toFixed(1)));

  return (
    <div className="card border-0 rounded-4 shadow-sm mb-3">
      <div className="card-header bg-transparent border-0 pt-3 pb-0 px-4">
        <h6 className="fw-semibold mb-0 d-flex align-items-center gap-2">
          <i className="material-icons-outlined" style={{ fontSize: 20 }}>show_chart</i> Resource Usage Over Time
        </h6>
      </div>
      <div className="card-body pt-0">
        <ReactApexChart
          type="area"
          height={300}
          series={[
            { name: 'CPU %', data: cpuSeries },
            { name: 'Memory %', data: memSeries },
          ]}
          options={{
            chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'inherit' },
            colors: ['#3b82f6', '#10b981'],
            dataLabels: { enabled: false },
            stroke: { curve: 'smooth', width: 2.5 },
            fill: {
              type: 'gradient',
              gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 100] },
            },
            xaxis: {
              categories,
              labels: { show: true, rotate: -45, rotateAlways: false, style: { fontSize: '9px', colors: '#94a3b8' }, maxHeight: 50 },
              axisBorder: { show: false },
              axisTicks: { show: false },
              tickAmount: Math.min(10, categories.length),
            },
            yaxis: { min: 0, max: 100, labels: { formatter: (v: number) => `${v.toFixed(0)}%` } },
            annotations: {
              yaxis: [
                {
                  y: cpuTarget, borderColor: '#3b82f6', strokeDashArray: 4,
                  label: { text: `CPU Target ${cpuTarget}%`, style: { color: '#3b82f6', background: '#eff6ff' } },
                },
                {
                  y: memTarget, borderColor: '#10b981', strokeDashArray: 4,
                  label: { text: `Mem Target ${memTarget}%`, style: { color: '#10b981', background: '#f0fdf4' }, position: 'front' },
                },
              ],
            },
            tooltip: { y: { formatter: (v: number) => `${v.toFixed(1)}%` } },
            grid: { borderColor: '#f1f5f9', strokeDashArray: 4 },
            legend: { position: 'top' as const, horizontalAlign: 'right' as const },
          }}
        />
      </div>
    </div>
  );
};

export default ResourceChart;

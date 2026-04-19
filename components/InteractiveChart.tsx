"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const PALETTE = ["#2563EB", "#10B981", "#F59E0B", "#6366F1", "#EC4899"];

type ChartType = "bar" | "line" | "area" | "pie" | "doughnut" | "horizontalBar";

type ChartSpec = {
  type: ChartType;
  title?: string;
  labels: string[];
  datasets: { label: string; data: number[] }[];
  palette?: string[];
};

function parseSpec(encoded: string): ChartSpec | null {
  try {
    const json = typeof window !== "undefined"
      ? decodeURIComponent(escape(window.atob(encoded)))
      : Buffer.from(encoded, "base64").toString("utf8");
    const spec = JSON.parse(json) as ChartSpec;
    if (!spec || !Array.isArray(spec.labels) || !Array.isArray(spec.datasets)) return null;
    return spec;
  } catch {
    return null;
  }
}

function czNumber(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString("cs-CZ").replace(/,/g, " ");
  return String(n);
}

function DarkTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey?: string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{
      background: "#0f0f0f",
      border: "1px solid #2f2f2f",
      borderRadius: 8,
      padding: "8px 12px",
      fontSize: 12,
      color: "#ececec",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    }}>
      {label !== undefined && (
        <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {label}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, background: p.color, borderRadius: 2 }} />
          <span style={{ color: "#d1d5db" }}>{p.name}:</span>
          <strong style={{ color: "#fff" }}>{czNumber(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export function InteractiveChart({ specB64, fallbackUrl, title }: {
  specB64: string;
  fallbackUrl?: string;
  title?: string;
}) {
  const spec = useMemo(() => parseSpec(specB64), [specB64]);
  const [failed, setFailed] = useState(false);

  if (!spec || failed) {
    if (fallbackUrl) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={fallbackUrl} alt={title ?? "graf"} className="rk-chart-fallback" />;
    }
    return <div className="rk-chart-error">Graf se nepodařilo vykreslit.</div>;
  }

  const palette = spec.palette && spec.palette.length > 0 ? spec.palette : PALETTE;

  try {
    return (
      <figure className="rk-chart">
        {spec.title && <figcaption className="rk-chart-title">{spec.title}</figcaption>}
        <div className="rk-chart-body">
          <ResponsiveContainer width="100%" height={320}>
            {renderChart(spec, palette)}
          </ResponsiveContainer>
        </div>
      </figure>
    );
  } catch (err) {
    console.error("InteractiveChart render error", err);
    setFailed(true);
    return null;
  }
}

function renderChart(spec: ChartSpec, palette: string[]): React.ReactElement {
  const { type, labels, datasets } = spec;

  // Převod labels + datasets na Recharts formát [{name, s0, s1, ...}]
  const data = labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label };
    datasets.forEach((ds, j) => {
      row[`s${j}`] = typeof ds.data[i] === "number" ? ds.data[i] : 0;
    });
    return row;
  });

  const commonAxis = (
    <>
      <CartesianGrid stroke="#2f2f2f" strokeDasharray="3 3" />
      <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
      <Legend wrapperStyle={{ color: "#ececec", fontSize: 12 }} />
    </>
  );

  const axisTickStyle = { fill: "#9ca3af", fontSize: 11 };

  if (type === "line") {
    return (
      <LineChart data={data} margin={{ top: 10, right: 16, bottom: 6, left: 0 }}>
        {commonAxis}
        <XAxis dataKey="name" stroke="#6b7280" tick={axisTickStyle} />
        <YAxis stroke="#6b7280" tick={axisTickStyle} />
        {datasets.map((ds, j) => (
          <Line
            key={j}
            type="monotone"
            dataKey={`s${j}`}
            name={ds.label}
            stroke={palette[j % palette.length]}
            strokeWidth={2.5}
            dot={{ fill: palette[j % palette.length], r: 3 }}
            activeDot={{ r: 6 }}
            animationDuration={900}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    );
  }

  if (type === "area") {
    return (
      <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 6, left: 0 }}>
        <defs>
          {datasets.map((_, j) => {
            const color = palette[j % palette.length];
            return (
              <linearGradient key={j} id={`rk-grad-${j}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            );
          })}
        </defs>
        {commonAxis}
        <XAxis dataKey="name" stroke="#6b7280" tick={axisTickStyle} />
        <YAxis stroke="#6b7280" tick={axisTickStyle} />
        {datasets.map((ds, j) => {
          const color = palette[j % palette.length];
          return (
            <Area
              key={j}
              type="monotone"
              dataKey={`s${j}`}
              name={ds.label}
              stroke={color}
              strokeWidth={2.5}
              fill={`url(#rk-grad-${j})`}
              animationDuration={900}
              animationEasing="ease-out"
            />
          );
        })}
      </AreaChart>
    );
  }

  if (type === "bar" || type === "horizontalBar") {
    const horizontal = type === "horizontalBar";
    return (
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 10, right: 16, bottom: 6, left: horizontal ? 20 : 0 }}
      >
        {commonAxis}
        {horizontal ? (
          <>
            <XAxis type="number" stroke="#6b7280" tick={axisTickStyle} />
            <YAxis type="category" dataKey="name" stroke="#6b7280" tick={axisTickStyle} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey="name" stroke="#6b7280" tick={axisTickStyle} />
            <YAxis stroke="#6b7280" tick={axisTickStyle} />
          </>
        )}
        {datasets.map((ds, j) => (
          <Bar
            key={j}
            dataKey={`s${j}`}
            name={ds.label}
            fill={palette[j % palette.length]}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            animationDuration={900}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    );
  }

  // pie / doughnut
  const ds0 = datasets[0];
  const pieData = labels.map((l, i) => ({ name: l, value: typeof ds0.data[i] === "number" ? ds0.data[i] : 0 }));
  const innerRadius = type === "doughnut" ? 70 : 0;
  return (
    <PieChart>
      <Tooltip content={<DarkTooltip />} />
      <Legend wrapperStyle={{ color: "#ececec", fontSize: 12 }} />
      <Pie
        data={pieData}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius={110}
        innerRadius={innerRadius}
        paddingAngle={innerRadius ? 2 : 0}
        isAnimationActive
        animationDuration={900}
        animationEasing="ease-out"
        stroke="#0f0f0f"
      >
        {pieData.map((_, i) => (
          <Cell key={i} fill={palette[i % palette.length]} />
        ))}
      </Pie>
    </PieChart>
  );
}

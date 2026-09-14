import React from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

/**
 * Tiny sparkline. Accepts array of numbers or {t,price}.
 */
export default function Sparkline({ data, positive = true, height = 32, width = 90 }) {
  if (!data || data.length === 0) return <div style={{ width, height }} />;
  const normalized = data.map((d, i) =>
    typeof d === "number" ? { i, v: d } : { i, v: d.price ?? d.value ?? 0 }
  );
  const stroke = positive ? "#00F58C" : "#FF453A";
  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={normalized} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

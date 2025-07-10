// src/components/TopicChart.jsx
import React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

const data = [
  { name: "Technik", value: 400 },
  { name: "Support", value: 300 },
  { name: "Sonstiges", value: 300 },
];
const COLORS = ["#3182ce", "#63b3ed", "#90cdf4"];

export default function TopicChart() {
  return (
    <div className="chart-wrapper">
      <h2>Themen</h2>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60}>
            {data.map((_, idx) => (
              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

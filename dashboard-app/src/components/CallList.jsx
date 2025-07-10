// src/components/CallList.jsx
import React from "react";
import { calls } from "../data/calls";

export default function CallList({ onSelect }) {
  // Hilfsfunktion für deutsche Zeit- und Datumsformatierung
  const formatTime = iso =>
    new Date(iso).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  // Dauer in mm:ss
  const formatDuration = sec => {
    const min = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${min}:${s}`;
  };

  return (
    <section className="call-list">
      <table>
        <thead>
          <tr>
            <th>Anrufer</th>
            <th>Zeit</th>
            <th>Dauer</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} onClick={() => onSelect(c)} style={{ cursor: "pointer" }}>
              <td>{c.number}</td>
              <td>{formatTime(c.time)}</td>
              <td>{formatDuration(c.duration)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// src/components/CallDetails.jsx
import React from "react";

export default function CallDetails({ call }) {
  return (
    <aside className="call-details">
      <h2>Details zum Anruf</h2>
      <p><strong>Telefon:</strong> {call.number}</p>
      <p><strong>E-Mail:</strong> {call.email}</p>
      <p><strong>Protokoll:</strong> {call.protocol}</p>
    </aside>
  );
}

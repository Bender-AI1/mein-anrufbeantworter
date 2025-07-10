import React, { useState } from 'react'
import Charts from './components/Charts'
import './App.css'

export default function App() {
  // Einfach Strings, kein <'menu'|'dashboard'>
  const [view, setView] = useState('menu')
  // Einfach null als Startwert
  const [period, setPeriod] = useState(null)

  const periods = [
    { label: 'Täglich',    days: 1 },
    { label: 'Wöchentlich', days: 7 },
    { label: 'Monatlich',   days: 28 },
    { label: 'Jährlich',    days: 365 },
  ]

  const today = new Date()
  // Wenn period gesetzt ist, berechne den Starttermin
  const start = period
    ? new Date(today.getFullYear(),
               today.getMonth(),
               today.getDate() - (period.days - 1))
    : null

  // Formatierungsfunktion ganz normal ohne : Date
  const formatDate = d =>
    d.toLocaleDateString('de-DE', {
      day:   '2-digit',
      month: '2-digit',
      year:  'numeric'
    })

  return (
    <div className="app-container">
      {view === 'menu' && (
        <div className="menu">
          <h1>Zeitraum wählen</h1>
          <div className="buttons">
            {periods.map(p => (
              <button
                key={p.label}
                onClick={() => {
                  setPeriod(p)
                  setView('dashboard')
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'dashboard' && period && (
        <>
          <header className="dashboard-header">
            <button
              className="back"
              onClick={() => setView('menu')}
            >
              &larr;
            </button>
            <div className="period-label">
              {start && formatDate(start)} – {formatDate(today)}
            </div>
          </header>
          <main className="charts-container">
            {/* Übergib period.days an Deine Charts */}
            <Charts periodDays={period.days} />
          </main>
        </>
      )}
    </div>
  )
}

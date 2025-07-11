// src/App.jsx
import React, { useState, useEffect } from 'react'
import Charts from './components/Charts'
import './App.css'

export default function App() {
  // Basis-URL deiner API – lokal oder gehostet
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000'

  const [view, setView] = useState('menu')
  const [period, setPeriod] = useState(null)
  const [today, setToday] = useState(new Date())

  const periods = [
    { label: 'Täglich',    days: 1 },
    { label: 'Wöchentlich', days: 7 },
    { label: 'Monatlich',   days: 28 },
    { label: 'Jährlich',    days: 365 },
  ]

  // Setze das "heutige" Datum beim Mount, damit es sich während der Session nicht verschiebt
  useEffect(() => {
    setToday(new Date())
  }, [])

  // Berechne Startdatum basierend auf period.days
  const start = period
    ? new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - (period.days - 1)
      )
    : null

  const formatDate = d =>
    d.toLocaleDateString('de-DE', {
      day:   '2-digit',
      month: '2-digit',
      year:  'numeric'
    })

  const handleSelectPeriod = p => {
    setPeriod(p)
    setToday(new Date())
    setView('dashboard')
  }

  return (
    <div className="app-container">
      {view === 'menu' && (
        <div className="menu">
          <h1>Zeitraum wählen</h1>
          <div className="buttons">
            {periods.map(p => (
              <button
                key={p.label}
                onClick={() => handleSelectPeriod(p)}
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
            {/* API_BASE und period.days an Charts übergeben */}
            <Charts apiBase={API_BASE} periodDays={period.days} />
          </main>
        </>
      )}
    </div>
  )
}

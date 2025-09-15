// src/App.jsx
import React, { useState, useEffect, useMemo } from 'react'
import Charts from './components/Charts'
import './App.css'

export default function App() {
  // Basis-URL deiner API – lokal oder gehostet
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000'
  const TZ = 'Europe/Berlin'

  const [view, setView] = useState('menu')
  const [period, setPeriod] = useState(null)
  const [today, setToday] = useState(new Date())
  const [tick, setTick] = useState(0) // treibt das 5s-Refresh

  const periods = [
    { label: 'Täglich',     days: 1 },
    { label: 'Wöchentlich', days: 7 },
    { label: 'Monatlich',   days: 28 },
    { label: 'Jährlich',    days: 365 },
  ]

  // "heute" (mit Tagesgrenzen) beim Mount fixieren, damit es sich in der Session nicht verschiebt
  useEffect(() => {
    setToday(new Date())
  }, [])

  // 5s Auto-Refresh: solange das Dashboard sichtbar ist
  useEffect(() => {
    if (view !== 'dashboard' || !period) return
    const id = setInterval(() => setTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [view, period])

  // Hilfsfunktionen für Tagesgrenzen in der gewünschten Zeitzone
  const startOfDay = (d) => {
    const x = new Date(d)
    // Lokale Tagesgrenze über locale Optionen erzwingen (einfach & robust im Client)
    const parts = new Intl.DateTimeFormat('de-DE', {
      timeZone: TZ,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(x)
    const y = Number(parts.find(p => p.type === 'year').value)
    const m = Number(parts.find(p => p.type === 'month').value) - 1
    const da = Number(parts.find(p => p.type === 'day').value)
    return new Date(Date.UTC(y, m, da, 0, 0, 0)) // UTC-Date, aber Tagesgrenze der TZ
  }

  const addDays = (d, n) => {
    const x = new Date(d)
    x.setUTCDate(x.getUTCDate() + n)
    return x
  }

  const formatDate = (d) =>
    d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ })

  // Range (inkl. Tagesgrenzen) berechnen
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (!period) return { rangeStart: null, rangeEnd: null }
    const todayStart = startOfDay(today) // 00:00 der TZ
    const start = addDays(todayStart, -(period.days - 1))
    const end = addDays(todayStart, 1) // exklusiv: [start, end)
    return { rangeStart: start, rangeEnd: end }
  }, [period, today])

  const handleSelectPeriod = (p) => {
    setPeriod(p)
    setToday(new Date())
    setTick(0)          // Reset des Refresh-Zählers beim Wechsel
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
              aria-label="Zurück zur Auswahl"
              title="Zurück"
            >
              &larr;
            </button>
            <div className="period-label">
              {/* Anzeige inkl. Tagesgrenzen */}
              {rangeStart && formatDate(rangeStart)} – {rangeEnd && formatDate(addDays(rangeEnd, -1))}
              <span style={{ opacity: 0.6, marginLeft: 8 }}>(Auto-Refresh alle 5 s)</span>
            </div>
          </header>

          <main className="charts-container">
            {/* 
              Wir erzwingen alle 5s einen Remount über key,
              damit Charts neu lädt, ohne Charts ändern zu müssen.
              Zusätzlich reichen wir TZ und Range durch – falls du
              in Charts später „heute“/Gruppierung exakt nutzen willst.
            */}
            <Charts
              key={`${period.label}-${tick}`}
              apiBase={API_BASE}
              periodDays={period.days}
              tz={TZ}
              rangeStart={rangeStart?.toISOString()}
              rangeEnd={rangeEnd?.toISOString()} // exklusiv
              strictToday={period.days === 1}
            />
          </main>
        </>
      )}
    </div>
  )
}

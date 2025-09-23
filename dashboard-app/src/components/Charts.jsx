// src/components/Charts.jsx
import React, { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as BarTooltip, Cell,
  PieChart, Pie, Tooltip as PieTooltip
} from 'recharts'
import './Charts.css'

export default function Charts({ apiBase, periodDays }) {
  const [modal, setModal] = useState({ open: false, title: '', callers: [] })
  const [data, setData] = useState([])

  // Load live data on mount and when periodDays/apiBase changes, polling every 5s
  useEffect(() => {
    let mounted = true
    const fetchCalls = async () => {
      try {
        const res = await fetch(`${apiBase}/api/calls?days=${periodDays}`)
        if (!res.ok) throw new Error(`Status ${res.status}`)
        const json = await res.json()
        const parsed = json.map(item => ({ ...item, time: new Date(item.time) }))
        if (mounted) setData(parsed)
      } catch (err) {
        console.error('Daten-Ladefehler:', err)
      }
    }

    fetchCalls()
    const intervalId = setInterval(fetchCalls, 5000)
    return () => {
      mounted = false
      clearInterval(intervalId)
    }
  }, [apiBase, periodDays])

  // Group by hour (jetzt: caller & id)
  function getByHour(arr) {
    const map = {}
    arr.forEach(({ id, caller, time }) => {
      if (!time || isNaN(time)) return
      const h = time.getHours().toString().padStart(2, '0') + ':00'
      map[h] = map[h] || []
      map[h].push({ caller, id })
    })
    return Object.entries(map).map(([hour, calls]) => ({
      hour,
      count: calls.length,
      callers: calls
    }))
  }

  // Group by duration
  function getByDuration(arr) {
    const map = {}
    arr.forEach(({ id, caller, duration }) => {
      const m = Math.floor(duration).toString() + ' min'
      map[m] = map[m] || []
      map[m].push({ caller, id })
    })
    return Object.entries(map).map(([duration, calls]) => ({
      duration,
      count: calls.length,
      callers: calls
    }))
  }

  // Group by topic
  function getByTopic(arr) {
    const map = {}
    arr.forEach(({ id, caller, topic }) => {
      map[topic] = map[topic] || []
      map[topic].push({ caller, id })
    })
    return Object.entries(map).map(([topic, calls]) => ({
      topic,
      count: calls.length,
      callers: calls
    }))
  }

  // Group by date
  function getByDate(arr) {
    const map = {}
    arr.forEach(({ id, caller, time }) => {
      if (!time || isNaN(time)) return
      const y = time.getFullYear()
      const m = String(time.getMonth() + 1).padStart(2, '0')
      const d = String(time.getDate()).padStart(2, '0')
      const key = `${y}-${m}-${d}`
      map[key] = map[key] || []
      map[key].push({ caller, id })
    })
    return Object.entries(map)
      .map(([dateKey, calls]) => ({
        dateKey,
        count: calls.length,
        callers: calls
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  }

  const formatDE = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    })
  }

  const hourData     = getByHour(data)
  const durationData = getByDuration(data)
  const topicData    = getByTopic(data)
  const dateData     = getByDate(data)

  const COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f']

  const openModal  = (title, callers) => setModal({ open: true, title, callers })
  const closeModal = () => setModal({ open: false, title: '', callers: [] })

  return (
    <>
      <div className="charts-container">
        <div className="charts-row">
          {/* Anrufzeitpunkt (Stunde) */}
          <div className="chart-card">
            <h2>Anrufzeitpunkt (Stunde)</h2>
            <BarChart width={280} height={180} data={hourData}>
              <XAxis dataKey="hour" />
              <YAxis />
              <BarTooltip />
              <Bar dataKey="count" onClick={d => openModal(`Stunde ${d.hour}`, d.callers)}>
                {hourData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </div>

          {/* Gesprächsdauer (Min.) */}
          <div className="chart-card">
            <h2>Gesprächsdauer (Min.)</h2>
            <BarChart width={280} height={180} data={durationData}>
              <XAxis dataKey="duration" />
              <YAxis />
              <BarTooltip />
              <Bar dataKey="count" onClick={d => openModal(`Dauer ${d.duration}`, d.callers)}>
                {durationData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </div>

          {/* Themen */}
          <div className="chart-card">
            <h2>Themen</h2>
            <PieChart width={280} height={180}>
              <Pie
                data={topicData}
                dataKey="count"
                nameKey="topic"
                cx="50%"
                cy="50%"
                outerRadius={60}
                onClick={d => openModal(`Thema ${d.topic}`, d.callers)}
              >
                {topicData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <PieTooltip />
            </PieChart>
          </div>
        </div>

        {/* Anrufe pro Datum (nur für >1 Tag) */}
        {periodDays > 1 && (
          <div className="chart-card" style={{ marginTop: 12 }}>
            <h2>Anrufe pro Datum</h2>
            {dateData.length === 0 ? (
              <p>Keine Daten im gewählten Zeitraum.</p>
            ) : (
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>Datum</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee' }}>Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {dateData.map(row => (
                    <tr
                      key={row.dateKey}
                      onClick={() => openModal(`Datum ${formatDE(row.dateKey)}`, row.callers)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f2f2f2' }}>{formatDE(row.dateKey)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #f2f2f2' }}>{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
              Tipp: Eine Zeile anklicken, um die zugehörigen Rufnummern im Modal zu sehen.
            </p>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{modal.title}</h3>
            <ul>
              {modal.callers.map(({ caller, id }) => (
                <li key={id}>
                  <a
                    href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent('subject:Anrufprotokoll ' + id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {caller}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

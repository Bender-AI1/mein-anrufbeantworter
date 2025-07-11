// src/components/Charts.jsx
import React, { useState, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as BarTooltip, Cell,
  PieChart, Pie, Tooltip as PieTooltip
} from 'recharts'
import './Charts.css'

export default function Charts({ periodDays }) {
  const [modal, setModal] = useState({ open: false, title: '', callers: [] })
  const [data, setData] = useState([])

  // 1) Beim Mounten (oder bei Änderung von periodDays) aus deiner API laden
  useEffect(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - periodDays + 1)
    fetch(`https://DEIN-SERVER.onrender.com/api/calls?from=${cutoff.toISOString()}`)
      .then(res => res.json())
      .then(json => {
        // API liefert Array mit { id, caller, time, duration, topic }
        // Zeitstring in Date-Objekt umwandeln
        const parsed = json.map(item => ({
          ...item,
          time: new Date(item.time)
        }))
        setData(parsed)
      })
      .catch(err => console.error('Daten-Ladefehler:', err))
  }, [periodDays])

  // Gruppierungsfunktionen
  function getByHour(arr) {
    const map = {}
    arr.forEach(({ caller, time }) => {
      const h = time.getHours().toString().padStart(2, '0') + ':00'
      map[h] = map[h] || []
      map[h].push(caller)
    })
    return Object.entries(map).map(([hour, callers]) => ({ hour, count: callers.length, callers }))
  }
  function getByDuration(arr) {
    const map = {}
    arr.forEach(({ caller, duration }) => {
      const m = Math.floor(duration).toString() + ' min'
      map[m] = map[m] || []
      map[m].push(caller)
    })
    return Object.entries(map).map(([duration, callers]) => ({ duration, count: callers.length, callers }))
  }
  function getByTopic(arr) {
    const map = {}
    arr.forEach(({ caller, topic }) => {
      map[topic] = map[topic] || []
      map[topic].push(caller)
    })
    return Object.entries(map).map(([topic, callers]) => ({ topic, count: callers.length, callers }))
  }

  // Daten für die Charts
  const hourData     = getByHour(data)
  const durationData = getByDuration(data)
  const topicData    = getByTopic(data)

  // ursprüngliche Palette
  const COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f']

  const openModal  = (title, callers) => setModal({ open: true, title, callers })
  const closeModal = () => setModal({ open: false, title:'', callers: [] })

  return (
    <>
      <div className="charts-container">
        <div className="charts-row">
          {/* Anrufzeitpunkt */}
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

          {/* Gesprächsdauer */}
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
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{modal.title}</h3>
            <ul>
              {modal.callers.map(phone => (
                <li key={phone}>
                  <a
                    href={`mailto:DEINE_EMAIL@gmail.com?subject=Rückruf%20${encodeURIComponent(phone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {phone}
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

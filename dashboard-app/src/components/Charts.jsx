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

  // Group by hour
  function getByHour(arr) {
    const map = {}
    arr.forEach(({ caller, time }) => {
      const h = time.getHours().toString().padStart(2, '0') + ':00'
      map[h] = map[h] || []
      map[h].push(caller)
    })
    return Object.entries(map).map(([hour, callers]) => ({ hour, count: callers.length, callers }))
  }

  // Group by duration
  function getByDuration(arr) {
    const map = {}
    arr.forEach(({ caller, duration }) => {
      const m = Math.floor(duration).toString() + ' min'
      map[m] = map[m] || []
      map[m].push(caller)
    })
    return Object.entries(map).map(([duration, callers]) => ({ duration, count: callers.length, callers }))
  }

  // Group by topic
  function getByTopic(arr) {
    const map = {}
    arr.forEach(({ caller, topic }) => {
      map[topic] = map[topic] || []
      map[topic].push(caller)
    })
    return Object.entries(map).map(([topic, callers]) => ({ topic, count: callers.length, callers }))
  }

  const hourData     = getByHour(data)
  const durationData = getByDuration(data)
  const topicData    = getByTopic(data)

  const COLORS = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f']

  const openModal  = (title, callers) => setModal({ open: true, title, callers })
  const closeModal = () => setModal({ open: false, title: '', callers: [] })

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
                    href={`mailto:bender.serviceai@gmail.com?subject=Rückruf%20${encodeURIComponent(phone)}`}
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

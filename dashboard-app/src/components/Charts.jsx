import React, { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as BarTooltip, Cell,
  PieChart, Pie, Tooltip as PieTooltip
} from 'recharts'
import './Charts.css'

const EXAMPLE_DATA = [
  { id: 1, caller: '0123456789', time: new Date('2025-07-08T09:15:00'), duration: 4, topic: 'Technik' },
  { id: 2, caller: '0987654321', time: new Date('2025-07-08T09:45:00'), duration: 10, topic: 'Vertrieb' },
  { id: 3, caller: '01711223344', time: new Date('2025-07-08T10:05:00'), duration: 2, topic: 'Support' },
  { id: 4, caller: '01551234567', time: new Date('2025-07-08T10:30:00'), duration: 7, topic: 'Technik' },
  { id: 5, caller: '01667894521', time: new Date('2025-07-08T11:00:00'), duration: 5, topic: 'Support' },
]

// gruppieren nach Stunde
function getByHour(data) {
  const map = {}
  data.forEach(({ caller, time }) => {
    const h = time.getHours().toString().padStart(2, '0') + ':00'
    map[h] = map[h] || []
    map[h].push(caller)
  })
  return Object.entries(map).map(([hour, callers]) => ({ hour, count: callers.length, callers }))
}

// gruppieren nach Dauer (Minuten)
function getByDuration(data) {
  const map = {}
  data.forEach(({ caller, duration }) => {
    const m = Math.floor(duration).toString() + ' min'
    map[m] = map[m] || []
    map[m].push(caller)
  })
  return Object.entries(map).map(([duration, callers]) => ({ duration, count: callers.length, callers }))
}

// gruppieren nach Topic
function getByTopic(data) {
  const map = {}
  data.forEach(({ caller, topic }) => {
    map[topic] = map[topic] || []
    map[topic].push(caller)
  })
  return Object.entries(map).map(([topic, callers]) => ({ topic, count: callers.length, callers }))
}

export default function Charts({ periodDays }) {
  const [modal, setModal] = useState({ open: false, title: '', callers: [] })

    // ← HIER den Zeitraum-Filter anwenden
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - periodDays + 1)
  const filtered = EXAMPLE_DATA.filter(({ time }) => time >= cutoff)
  
  const hourData     = getByHour(EXAMPLE_DATA)
  const durationData = getByDuration(EXAMPLE_DATA)
  const topicData    = getByTopic(EXAMPLE_DATA)

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
                    target="_blank" rel="noopener noreferrer"
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

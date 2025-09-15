import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Erzwingt alle 5s ein Remount von <App />,
// damit Effekte/Fetchen erneut laufen.
const AUTO_REFRESH_MS = 5000

function Root() {
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!AUTO_REFRESH_MS) return
    const id = setInterval(() => {
      setRefreshKey((k) => k + 1)
      // Optional: sichtbares Log im Browser
      // console.info('Dashboard auto-refresh')
    }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <React.StrictMode>
      {/* key sorgt für Remount */}
      <App key={refreshKey} />
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />)

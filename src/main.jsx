import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Installs window.storage (per-game state via the games API) before the app loads.
import './storage.js'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

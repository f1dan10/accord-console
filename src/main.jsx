import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

window.storage = {
  async get(k) { const v = localStorage.getItem(k); return v == null ? null : { value: v }; },
  async set(k, v) { localStorage.setItem(k, v); return true; },
  async delete(k) { localStorage.removeItem(k); return true; },
};

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const API = import.meta.env.VITE_STORAGE_URL || "https://7q2pijegeat4couj46ksjk45wi0ixdtc.lambda-url.us-east-2.on.aws/";
const SESSION = new URLSearchParams(location.search).get("s") || "default";
const url = (k) => `${API}?s=${encodeURIComponent(SESSION)}&k=${encodeURIComponent(k)}`;

window.storage = {
  async get(k, shared) {
    if (!shared) { const v = localStorage.getItem(k); return v == null ? null : { value: v }; }
    const r = await fetch(url(k), { cache: "no-store" });
    if (!r.ok) throw new Error("storage");
    return await r.json();
  },
  async set(k, v, shared) {
    if (!shared) { localStorage.setItem(k, v); return true; }
    const r = await fetch(url(k), { method: "PUT", body: v });
    if (!r.ok) throw new Error("storage");
    return true;
  },
  async delete(k, shared) {
    if (!shared) { localStorage.removeItem(k); return true; }
    await fetch(url(k), { method: "DELETE" });
    return true;
  },
};

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

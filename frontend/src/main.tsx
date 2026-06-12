import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const appBase = import.meta.env.BASE_URL || '/'
const routerBasename = appBase === '/' ? undefined : appBase.replace(/\/$/u, '')
const isDesktopShell = new URLSearchParams(window.location.search).get('shell') === 'mac'

document.documentElement.classList.toggle('desktop-shell', isDesktopShell)

const app = <App />
const routedApp = window.location.protocol === 'file:'
  ? <HashRouter>{app}</HashRouter>
  : <BrowserRouter basename={routerBasename}>{app}</BrowserRouter>

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {routedApp}
  </React.StrictMode>,
)

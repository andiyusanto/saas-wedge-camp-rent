import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { LandingPage } from './components/LandingPage.tsx'

const isAppRoute = window.location.pathname.startsWith('/app')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAppRoute ? <App /> : <LandingPage />}
  </StrictMode>,
)

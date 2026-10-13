import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AttachmentViewer } from './components/AttachmentViewer.tsx'

// /?attachment=<id> is the standalone rendered-markdown view opened from a task's attachment link.
const attachmentId = new URLSearchParams(window.location.search).get('attachment')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {attachmentId ? <AttachmentViewer id={attachmentId} /> : <App />}
  </StrictMode>,
)

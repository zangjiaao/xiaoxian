import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { warmCache } from './lib/memory.ts'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/theme-neutral/theme.css'
import './index.css'
import App from './App.tsx'

registerSW({ immediate: true })
void warmCache()

const root = document.getElementById('root')
if (!root) throw new Error('找不到页面根节点')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

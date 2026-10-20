import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { Component, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import zhHans from '@astryxdesign/core/locales/zh-CN.generated.js'
import { Shell } from './components/Shell.tsx'
import { ChartPage } from './pages/ChartPage.tsx'
import { ChatPage } from './pages/ChatPage.tsx'
import { ProfileFormPage } from './pages/ProfileFormPage.tsx'
import { ProfilesPage } from './pages/ProfilesPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'

interface BoundaryState {
  message: string | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { message: null }
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { message: error.message || '页面渲染失败' }
  }

  render() {
    if (this.state.message) {
      return (
        <main style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h1>小闲暂时打不开这一页</h1>
          <p>{this.state.message}</p>
        </main>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <Theme theme={neutralTheme}>
      <InternationalizationProvider locale="zh-Hans" messages={{ 'zh-Hans': zhHans }}>
        <AppErrorBoundary>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<ProfilesPage />} />
                <Route path="profiles/new" element={<ProfileFormPage />} />
                <Route path="profiles/:id/edit" element={<ProfileFormPage />} />
                <Route path="chart" element={<ChartPage />} />
                <Route path="chart/:id" element={<ChartPage />} />
                <Route path="chat" element={<ChatPage />} />
                <Route path="chat/:id" element={<ChatPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AppErrorBoundary>
      </InternationalizationProvider>
    </Theme>
  )
}

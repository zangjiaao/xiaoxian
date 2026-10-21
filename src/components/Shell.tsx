import { Heading } from '@astryxdesign/core/Heading'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import * as stylex from '@stylexjs/stylex'
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { styles } from '../styles.ts'

const TABS = [
  { value: 'profiles', label: '档案', path: '/' },
  { value: 'chart', label: '排盘', path: '/chart' },
  { value: 'chat', label: '聊聊', path: '/chat' },
  { value: 'settings', label: '设置', path: '/settings' },
] as const

function tabFromPath(pathname: string): string {
  if (pathname.startsWith('/chart')) return 'chart'
  if (pathname.startsWith('/chat')) return 'chat'
  if (pathname.startsWith('/settings')) return 'settings'
  return 'profiles'
}

function syncVisualViewport() {
  const root = document.documentElement
  const viewport = window.visualViewport
  if (!viewport) return
  root.style.setProperty('--app-height', `${viewport.height}px`)
  root.style.setProperty('--app-top', `${viewport.offsetTop}px`)
  const keyboardOpen = window.innerHeight - viewport.height - viewport.offsetTop > 80
  root.style.setProperty('--keyboard-open', keyboardOpen ? '1' : '0')
}

export function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const current = tabFromPath(location.pathname)
  const isChat = location.pathname.startsWith('/chat')

  useEffect(() => {
    syncVisualViewport()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncVisualViewport)
    viewport?.addEventListener('scroll', syncVisualViewport)
    window.addEventListener('orientationchange', syncVisualViewport)
    return () => {
      viewport?.removeEventListener('resize', syncVisualViewport)
      viewport?.removeEventListener('scroll', syncVisualViewport)
      window.removeEventListener('orientationchange', syncVisualViewport)
    }
  }, [])

  return (
    <div {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.header)} data-app-header>
        <Heading level={1} xstyle={styles.shellTitle}>
          小闲
        </Heading>
        <Text type="supporting" xstyle={styles.shellTagline}>
          给自己和朋友的一页对照
        </Text>
      </header>
      <div {...stylex.props(styles.nav)}>
        <TabList
          aria-label="主要页面"
          value={current}
          onChange={(value) => {
            const next = TABS.find((tab) => tab.value === value)
            if (next) navigate(next.path)
          }}
          layout="fill"
          hasDivider
        >
          {TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </TabList>
      </div>
      <main {...stylex.props(styles.main, !isChat && styles.mainSafeBottom)} data-app-main>
        <Outlet />
      </main>
    </div>
  )
}

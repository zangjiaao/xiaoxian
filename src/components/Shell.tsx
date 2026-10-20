import { Heading } from '@astryxdesign/core/Heading'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import * as stylex from '@stylexjs/stylex'
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

export function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const current = tabFromPath(location.pathname)

  return (
    <div {...stylex.props(styles.shell)}>
      <header {...stylex.props(styles.header)}>
        <Heading level={1}>小闲</Heading>
        <Text type="supporting">给自己和朋友的一页对照</Text>
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
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
    </div>
  )
}

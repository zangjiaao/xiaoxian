import { Banner } from '@astryxdesign/core/Banner'
import * as stylex from '@stylexjs/stylex'
import { useMemorySelector } from '../lib/memory.ts'
import { styles } from '../styles.ts'

export function SyncNotice() {
  const notice = useMemorySelector((state) => state.syncNotice)
  if (!notice) return null
  return (
    <div {...stylex.props(styles.syncNotice)}>
      <Banner status="error" title="没能同步到云端" description={notice} collapsible={false} />
    </div>
  )
}

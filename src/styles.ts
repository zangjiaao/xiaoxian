import * as stylex from '@stylexjs/stylex'
import { colorVars } from '@astryxdesign/core/theme/tokens.stylex'

export const styles = stylex.create({
  shell: {
    minHeight: '100svh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colorVars['--color-background-body'],
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '12px',
    width: '100%',
    maxWidth: '880px',
    marginInline: 'auto',
    paddingTop: '16px',
    paddingBottom: '4px',
    paddingLeft: '16px',
    paddingRight: '16px',
    boxSizing: 'border-box',
  },
  nav: {
    width: '100%',
    maxWidth: '880px',
    marginInline: 'auto',
    paddingLeft: '16px',
    paddingRight: '16px',
    boxSizing: 'border-box',
  },
  main: {
    flexGrow: 1,
    width: '100%',
    maxWidth: '880px',
    marginInline: 'auto',
    paddingTop: '16px',
    paddingBottom: '32px',
    paddingLeft: '16px',
    paddingRight: '16px',
    boxSizing: 'border-box',
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  pillars: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    '@media (min-width: 800px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    },
  },
  birthGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    '@media (min-width: 720px)': {
      gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr',
    },
  },
  timeline: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    paddingBottom: '4px',
  },
  yunCard: {
    minWidth: '148px',
    flexShrink: 0,
  },
  messages: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minHeight: '220px',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  prose: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  footerNote: {
    marginTop: '8px',
  },
})

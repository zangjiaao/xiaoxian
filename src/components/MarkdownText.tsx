import {
  colorVars,
  fontWeightVars,
  radiusVars,
  typeScaleVars,
} from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stabilizeMarkdown } from '../lib/markdown.ts'

const md = stylex.create({
  root: {
    minWidth: 0,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    color: colorVars['--color-text-primary'],
    fontSize: typeScaleVars['--text-body-size'],
    lineHeight: typeScaleVars['--text-body-leading'],
  },
  muted: {
    color: colorVars['--color-text-secondary'],
    fontSize: typeScaleVars['--text-supporting-size'],
    lineHeight: typeScaleVars['--text-supporting-leading'],
  },
  h1: {
    fontSize: typeScaleVars['--text-heading-3-size'],
    fontWeight: typeScaleVars['--text-heading-3-weight'],
    lineHeight: typeScaleVars['--text-heading-3-leading'],
    marginTop: '0.7em',
    marginBottom: '0.3em',
  },
  h2: {
    fontSize: typeScaleVars['--text-heading-4-size'],
    fontWeight: typeScaleVars['--text-heading-4-weight'],
    lineHeight: typeScaleVars['--text-heading-4-leading'],
    marginTop: '0.7em',
    marginBottom: '0.3em',
  },
  h3: {
    fontSize: typeScaleVars['--text-heading-5-size'],
    fontWeight: typeScaleVars['--text-heading-5-weight'],
    lineHeight: typeScaleVars['--text-heading-5-leading'],
    marginTop: '0.6em',
    marginBottom: '0.25em',
  },
  p: {
    marginTop: '0.35em',
    marginBottom: '0.35em',
  },
  list: {
    marginTop: '0.35em',
    marginBottom: '0.35em',
    paddingLeft: '1.25em',
  },
  item: {
    marginTop: '0.15em',
    marginBottom: '0.15em',
  },
  quote: {
    marginTop: '0.45em',
    marginBottom: '0.45em',
    marginLeft: 0,
    marginRight: 0,
    paddingLeft: '0.8em',
    borderLeftWidth: '3px',
    borderLeftStyle: 'solid',
    borderLeftColor: colorVars['--color-border-emphasized'],
    color: colorVars['--color-text-secondary'],
  },
  link: {
    color: colorVars['--color-text-accent'],
    overflowWrap: 'anywhere',
  },
  inlineCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '0.92em',
    paddingTop: '0.05em',
    paddingBottom: '0.05em',
    paddingLeft: '0.3em',
    paddingRight: '0.3em',
    borderRadius: radiusVars['--radius-inner'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  pre: {
    maxWidth: '100%',
    marginTop: '0.45em',
    marginBottom: '0.45em',
    padding: '10px 12px',
    overflowX: 'auto',
    borderRadius: radiusVars['--radius-element'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  preCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: typeScaleVars['--text-supporting-size'],
    lineHeight: typeScaleVars['--text-supporting-leading'],
    whiteSpace: 'pre',
    overflowWrap: 'normal',
  },
  tableWrap: {
    maxWidth: '100%',
    marginTop: '0.45em',
    marginBottom: '0.45em',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: typeScaleVars['--text-supporting-size'],
    lineHeight: typeScaleVars['--text-supporting-leading'],
  },
  cell: {
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '8px',
    paddingRight: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colorVars['--color-border-emphasized'],
    textAlign: 'start',
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  headCell: {
    fontWeight: fontWeightVars['--font-weight-semibold'],
    backgroundColor: colorVars['--color-background-muted'],
  },
  rule: {
    marginTop: '0.7em',
    marginBottom: '0.7em',
    borderWidth: 0,
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colorVars['--color-border'],
  },
  strong: {
    fontWeight: fontWeightVars['--font-weight-semibold'],
  },
})

function heading(level: 1 | 2 | 3) {
  const style = level === 1 ? md.h1 : level === 2 ? md.h2 : md.h3
  const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5'
  return function MarkdownHeading({ children }: { children?: ReactNode }) {
    return <Tag {...stylex.props(style)}>{children}</Tag>
  }
}

function blockCode(className: string | undefined, children: ReactNode): boolean {
  if (className?.includes('language-')) return true
  return String(children).includes('\n')
}

export function MarkdownText({ text, tone = 'primary' }: { text: string; tone?: 'primary' | 'secondary' }) {
  return (
    <div {...stylex.props(md.root, tone === 'secondary' && md.muted)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
          h4: heading(3),
          h5: heading(3),
          h6: heading(3),
          p: ({ children }) => <p {...stylex.props(md.p)}>{children}</p>,
          ul: ({ children }) => <ul {...stylex.props(md.list)}>{children}</ul>,
          ol: ({ children }) => <ol {...stylex.props(md.list)}>{children}</ol>,
          li: ({ children }) => <li {...stylex.props(md.item)}>{children}</li>,
          blockquote: ({ children }) => <blockquote {...stylex.props(md.quote)}>{children}</blockquote>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" {...stylex.props(md.link)}>
              {children}
            </a>
          ),
          strong: ({ children }) => <strong {...stylex.props(md.strong)}>{children}</strong>,
          pre: ({ children }) => <pre {...stylex.props(md.pre)}>{children}</pre>,
          code: ({ children, className }) =>
            blockCode(className, children) ? (
              <code {...stylex.props(md.preCode)} className={className}>
                {children}
              </code>
            ) : (
              <code {...stylex.props(md.inlineCode)}>{children}</code>
            ),
          table: ({ children }) => (
            <div {...stylex.props(md.tableWrap)}>
              <table {...stylex.props(md.table)}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th {...stylex.props(md.cell, md.headCell)}>{children}</th>,
          td: ({ children }) => <td {...stylex.props(md.cell)}>{children}</td>,
          hr: () => <hr {...stylex.props(md.rule)} />,
        }}
      >
        {stabilizeMarkdown(text)}
      </Markdown>
    </div>
  )
}

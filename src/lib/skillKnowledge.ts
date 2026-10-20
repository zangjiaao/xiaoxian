import classicalTexts from '../../vendor/bazi-skill/classical-texts.md?raw'
import dayunRules from '../../vendor/bazi-skill/dayun-rules.md?raw'
import wuxingTables from '../../vendor/bazi-skill/wuxing-tables.md?raw'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function excerptSection(markdown: string, title: string): string {
  const match = new RegExp(`^## ${escapeRegExp(title)}\\s*$`, 'm').exec(markdown)
  if (!match) return ''
  const rest = markdown.slice(match.index + match[0].length)
  const next = rest.search(/^## /m)
  const body = (next === -1 ? rest : rest.slice(0, next)).trim()
  if (!body) return ''
  return `## ${title}\n${body}`
}

function requireSections(markdown: string, titles: string[]): string {
  const parts = titles.map((title) => {
    const section = excerptSection(markdown, title)
    if (!section) throw new Error(`知识包缺少章节：${title}`)
    return section
  })
  return parts.join('\n\n')
}

export function knowledgePack(): string {
  const classics = classicalTexts.trim()
  if (!classics.includes('穷通宝典') || !classics.includes('滴天髓')) {
    throw new Error('经典摘要不完整')
  }
  const wuxing = requireSections(wuxingTables, ['天干五合', '地支关系', '十神定义及生克关系'])
  const dayun = requireSections(dayunRules, ['二、大运顺逆规则', '七、流年', '八、注意事项'])
  return [
    '以下知识只用于解释，不能改写机器排盘里的干支、大运或流年。十二长生、藏干以排盘报告中的藏干与十神为准，不要另造一套。',
    '',
    '### 经典典籍摘要（全文）',
    classics,
    '',
    '### 五行与十神摘录',
    wuxing,
    '',
    '### 大运与流年摘录',
    dayun,
  ].join('\n')
}

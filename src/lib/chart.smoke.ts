import { computeChart, formatChartReport } from './chart.ts'
import { parseCompletionPayload } from './llm.ts'
import { stabilizeMarkdown } from './markdown.ts'
import type { Profile } from '../types.ts'

function profile(partial: Partial<Profile> & Pick<Profile, 'gender' | 'birth_hour'>): Profile {
  return {
    id: 'smoke',
    display_name: '阿树',
    birth_year: 1990,
    birth_month: 3,
    birth_day: 4,
    birth_minute: partial.birth_hour == null ? null : 30,
    birth_place: '杭州',
    notes: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

const now = new Date('2026-10-20T04:00:00.000Z')
const chart = computeChart(
  profile({ gender: 'male', birth_hour: 14, birth_minute: 30 }),
  now,
)

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

assert(chart.pillars.map((pillar) => pillar.ganZhi).join(' ') === '庚午 戊寅 戊辰 己未', '四柱不符')
assert(chart.dayMaster === '戊' && chart.dayMasterElement === '土', '日主不符')
assert(chart.yunDirection === '顺行', '男命庚年应顺行')
assert(chart.currentDaYun?.ganZhi === '壬午', '2026 年大运应为壬午')
assert(chart.liuNian.ganZhi === '丙午', '2026-10-20 流年应为丙午')
assert(chart.warnings.some((warning) => warning.includes('惊蛰')), '应提示节气交界')
assert(chart.warnings.some((warning) => warning.includes('北京时间')), '应标明钟表时间')

const six = computeChart(profile({ gender: 'female', birth_hour: null, birth_minute: null }), now)
assert(six.pillars[3]?.known === false && six.pillars[3]?.ganZhi === '未知', '缺时应为六字')
assert(six.yunDirection === '逆行', '女命庚年应逆行')
assert(six.warnings.some((warning) => warning.includes('六字')), '应说明六字盘')

const early = computeChart(profile({ gender: 'male', birth_hour: 14, birth_minute: 30 }), new Date('2026-01-15T04:00:00.000Z'))
assert(early.liuNian.ganZhi === '乙巳' && early.liuNian.beforeLiChun, '立春前流年仍是乙巳')

const fullProfile = profile({ gender: 'male', birth_hour: 14, birth_minute: 30 })
const report = formatChartReport(fullProfile, chart)
for (const heading of ['## 输入', '## 四柱', '## 日主', '## 大运', '## 流年', '## 警告']) {
  assert(report.includes(heading), `报告缺少 ${heading}`)
}
assert(report.includes('姓名：阿树') && report.includes('性别：男'), '输入段应含姓名性别')
assert(report.includes('钟表模式：civil / 北京时间'), '应标明钟表模式')
assert(report.includes('时辰：时辰已知'), '已知时辰应标明')
assert(report.includes('庚午') && report.includes('戊寅') && report.includes('戊辰') && report.includes('己未'), '四柱干支应原样出现')
assert(report.includes('十神（干）') && report.includes('藏干与十神') && report.includes('纳音'), '四柱应含十神藏干纳音')
assert(report.includes('壬午') && report.includes('← 当前'), '当前大运应标出')
assert(report.includes('丙午'), '流年干支应出现')
assert(report.includes('本引擎暂未计算神煞'), '未计算神煞时应明确说明')
assert(!report.includes('天乙贵人'), '报告不应编造神煞')

const sixReport = formatChartReport(profile({ gender: 'female', birth_hour: null, birth_minute: null }), six)
assert(sixReport.includes('时辰：六字（时柱未知）'), '六字盘应标明')
assert(sixReport.includes('禁止补写时柱'), '未知时柱应禁止补写')

const earlyReport = formatChartReport(fullProfile, early)
assert(earlyReport.includes('立春前') && earlyReport.includes('乙巳'), '立春前报告应保留乙巳')

const thought = parseCompletionPayload(
  JSON.stringify({ choices: [{ delta: { reasoning_content: '先看日主', content: null } }] }),
)
assert(thought.reasoning === '先看日主' && thought.content === '', '应读出思考过程')
const answer = parseCompletionPayload(
  JSON.stringify({ choices: [{ delta: { content: '结论' }, message: { reasoning_content: '忽略' } }] }),
)
assert(answer.content === '结论' && answer.reasoning === '', '流式正文优先于 message')
assert(stabilizeMarkdown('## 标题\n```\n未闭合').endsWith('\n```'), '未闭合代码围栏应补上')
assert(stabilizeMarkdown('```\nok\n```') === '```\nok\n```', '成对围栏不要再补')

console.log('chart smoke ok', chart.dayMaster, chart.currentDaYun?.label, chart.liuNian.ganZhi)

import { computeChart } from './chart.ts'
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

console.log('chart smoke ok', chart.dayMaster, chart.currentDaYun?.label, chart.liuNian.ganZhi)

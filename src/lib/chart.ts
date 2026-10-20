import { Solar } from 'lunar-typescript'
import type { ChartPayload, DaYunItem, Pillar, Profile } from '../types.ts'

const STEM_ELEMENT: Record<string, string> = {
  甲: '木',
  乙: '木',
  丙: '火',
  丁: '火',
  戊: '土',
  己: '土',
  庚: '金',
  辛: '金',
  壬: '水',
  癸: '水',
}

const DAY_MASTER_NOTE: Record<string, string> = {
  甲: '像一棵还想往上长的树，在意方向，也容易顶着来。',
  乙: '像藤蔓，柔韧，擅长借力，也需要一点可以缠住的东西。',
  丙: '像白天的太阳，外放、直接，照到别人时自己也在消耗。',
  丁: '像灯火，细、暖、能看清近处，风大时需要罩一罩。',
  戊: '像田土，稳、能承载，变化来得慢，边界感比较实。',
  己: '像园土，细腻、会照顾，也容易把别人的事揽到自己这边。',
  庚: '像矿金，讲原则，决断快，钝的时候会显得硬。',
  辛: '像珠玉，在意精致和分寸，也容易对自己挑剔。',
  壬: '像江河，流动、想得开，方向多的时候需要河岸。',
  癸: '像雨露，敏感、渗透，安静地影响周围。',
}

interface RawPillar {
  ganZhi: string
  gan: string
  zhi: string
  wuXing: string
  naYin: string
  shiShenGan: string
  hideGan: string[]
  shiShenZhi: string[]
}

function zipHidden(hideGan: string[], shiShenZhi: string[]): string[] {
  return hideGan.map((gan, index) => {
    const god = shiShenZhi[index]
    return god ? `${gan}·${god}` : gan
  })
}

function knownPillar(label: string, raw: RawPillar): Pillar {
  return {
    label,
    ganZhi: raw.ganZhi,
    gan: raw.gan,
    zhi: raw.zhi,
    wuXing: raw.wuXing,
    naYin: raw.naYin,
    shiShenGan: raw.shiShenGan,
    hidden: zipHidden(raw.hideGan, raw.shiShenZhi),
    known: true,
  }
}

function unknownTimePillar(): Pillar {
  return {
    label: '时柱',
    ganZhi: '未知',
    gan: '',
    zhi: '',
    wuXing: '',
    naYin: '',
    shiShenGan: '',
    hidden: [],
    known: false,
  }
}

function hoursFromMinutes(minutes: number): number {
  return Math.abs(minutes) / 60
}

export function computeChart(profile: Profile, now = new Date()): ChartPayload {
  const hourKnown = profile.birth_hour != null
  const hour = hourKnown ? profile.birth_hour! : 12
  const minute = hourKnown ? (profile.birth_minute ?? 0) : 0
  const solar = Solar.fromYmdHms(
    profile.birth_year,
    profile.birth_month,
    profile.birth_day,
    hour,
    minute,
    0,
  )
  const lunar = solar.getLunar()
  const eight = lunar.getEightChar()
  const gender = profile.gender === 'male' ? 1 : 0
  const yun = eight.getYun(gender)
  const year: RawPillar = {
    ganZhi: eight.getYear(),
    gan: eight.getYearGan(),
    zhi: eight.getYearZhi(),
    wuXing: eight.getYearWuXing(),
    naYin: eight.getYearNaYin(),
    shiShenGan: eight.getYearShiShenGan(),
    hideGan: eight.getYearHideGan(),
    shiShenZhi: eight.getYearShiShenZhi(),
  }
  const month: RawPillar = {
    ganZhi: eight.getMonth(),
    gan: eight.getMonthGan(),
    zhi: eight.getMonthZhi(),
    wuXing: eight.getMonthWuXing(),
    naYin: eight.getMonthNaYin(),
    shiShenGan: eight.getMonthShiShenGan(),
    hideGan: eight.getMonthHideGan(),
    shiShenZhi: eight.getMonthShiShenZhi(),
  }
  const day: RawPillar = {
    ganZhi: eight.getDay(),
    gan: eight.getDayGan(),
    zhi: eight.getDayZhi(),
    wuXing: eight.getDayWuXing(),
    naYin: eight.getDayNaYin(),
    shiShenGan: eight.getDayShiShenGan(),
    hideGan: eight.getDayHideGan(),
    shiShenZhi: eight.getDayShiShenZhi(),
  }
  const time = hourKnown
    ? knownPillar('时柱', {
        ganZhi: eight.getTime(),
        gan: eight.getTimeGan(),
        zhi: eight.getTimeZhi(),
        wuXing: eight.getTimeWuXing(),
        naYin: eight.getTimeNaYin(),
        shiShenGan: eight.getTimeShiShenGan(),
        hideGan: eight.getTimeHideGan(),
        shiShenZhi: eight.getTimeShiShenZhi(),
      })
    : unknownTimePillar()

  const pillars = [
    knownPillar('年柱', year),
    knownPillar('月柱', month),
    knownPillar('日柱', day),
    time,
  ]

  const todaySolar = Solar.fromDate(now)
  const todayLunar = todaySolar.getLunar()
  const yearGz = todayLunar.getYearInGanZhiExact()
  const gregorianYear = now.getFullYear()

  let currentMatch: { item: DaYunItem; year: number } | null = null
  const daYun: DaYunItem[] = []
  for (const step of yun.getDaYun(12)) {
    const liuNian = step.getLiuNian()
    if (liuNian.length === 0 || step.getEndYear() < step.getStartYear()) continue
    const ganZhi = step.getGanZhi()
    const isPreYun = ganZhi.length === 0
    const item: DaYunItem = {
      index: step.getIndex(),
      ganZhi,
      label: isPreYun ? '起运前' : ganZhi,
      startAge: step.getStartAge(),
      endAge: step.getEndAge(),
      startYear: step.getStartYear(),
      endYear: step.getEndYear(),
      isCurrent: false,
      isPreYun,
    }
    for (const yearStep of liuNian) {
      const matchesYear =
        yearStep.getYear() === gregorianYear || yearStep.getYear() === gregorianYear - 1
      if (yearStep.getGanZhi() === yearGz && matchesYear) {
        currentMatch = { item, year: yearStep.getYear() }
      }
    }
    daYun.push(item)
  }

  if (currentMatch) currentMatch.item.isCurrent = true

  const direction = yun.isForward() ? '顺行' : '逆行'
  const startSolar = yun.getStartSolar()
  const yunStartText = `${direction}，约 ${yun.getStartYear()} 岁 ${yun.getStartMonth()} 个月起运（${startSolar.toYmd()}）`

  const warnings = [
    '排盘用的是出生当天的钟表时间，并按北京时间理解，还没有做真太阳时校正。',
  ]
  if (!hourKnown) {
    warnings.push('时柱未知，这是六字盘。大运起运岁数按当天中午 12:00 估算，只作节奏参考。')
  }
  if (hourKnown && hour === 23) {
    warnings.push('23 点落在晚子时。这里沿用排盘库的默认算法，日柱仍算在当天。另一种习惯会把日柱算到次日。')
  }

  for (const term of [lunar.getPrevJie(), lunar.getNextJie()]) {
    const hours = hoursFromMinutes(solar.subtractMinute(term.getSolar()))
    if (hours <= 48) {
      const estimate = hourKnown ? '' : '因为没填时辰，这个距离按中午估算。'
      warnings.push(
        `出生时刻距离节气「${term.getName()}」大约 ${Math.round(hours)} 小时。月柱在节气前后会换一步，交界处可以多看一眼，不是凶兆。${estimate}`,
      )
    }
  }

  const beforeLiChun = currentMatch != null && currentMatch.year !== gregorianYear
  if (beforeLiChun) {
    warnings.push('现在还在立春前，流年干支仍算上一年。公历已经翻篇，八字的年还没换。')
  }

  const dayMaster = day.gan
  const gods = [
    `年干${year.gan}（${year.shiShenGan}）`,
    `月干${month.gan}（${month.shiShenGan}）`,
    `日主${dayMaster}`,
    time.known ? `时干${time.gan}（${time.shiShenGan}）` : '时干未知',
  ]

  return {
    clockMode: 'civil',
    hourKnown,
    pillars,
    dayMaster,
    dayMasterElement: STEM_ELEMENT[dayMaster] ?? '',
    dayMasterNote: DAY_MASTER_NOTE[dayMaster] ?? '把它当成一种气质的比喻就好。',
    tenGodsBrief: gods.join('，'),
    daYun,
    currentDaYun: currentMatch?.item ?? null,
    yunDirection: direction,
    yunStartText: hourKnown ? yunStartText : `${yunStartText}，时辰未知所以这是估算`,
    liuNian: {
      year: currentMatch?.year ?? gregorianYear,
      ganZhi: yearGz,
      gregorianYear,
      beforeLiChun,
    },
    lunarText: lunar.toString(),
    warnings,
  }
}

export function pillarLine(chart: ChartPayload): string {
  return chart.pillars
    .map((pillar) => `${pillar.label} ${pillar.known ? pillar.ganZhi : '未知'}`)
    .join('、')
}

export function currentDaYunLine(chart: ChartPayload): string {
  const current = chart.currentDaYun
  if (!current) return '未落入已列出的大运'
  return `${current.label}（${current.startAge}–${current.endAge}岁，${current.startYear}–${current.endYear}）${chart.yunDirection}`
}

export function liuNianLine(chart: ChartPayload): string {
  const prefix = chart.liuNian.beforeLiChun ? `公历${chart.liuNian.gregorianYear}年立春前，` : ''
  return `${prefix}${chart.liuNian.year} ${chart.liuNian.ganZhi}`
}

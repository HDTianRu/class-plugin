/*
 * model/class.js format() 单元自测
 * 用法：node tools/class-format.test.mjs
 * */
import fs from 'node:fs'
import Class from '../model/class.js'

globalThis.logger = {
  info: console.log, warn: console.log, error: console.log, mark: console.log,
  red: (s) => s, green: (s) => s, yellow: (s) => s, blue: (s) => s, gray: (s) => s
}

const raw = JSON.parse(fs.readFileSync(new URL('./sample-data.json', import.meta.url), 'utf8'))
let ret = Class.format(raw.Data, '20240001')

const ok = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'} ${m}`); if (!b) process.exitCode = 1 }

console.log('total:', ret.total, '| weekNum:', ret.weekNum, '| weekNow:', ret.weekNow)
console.log('days:', ret.days.map((d) => `${d.name}${d.date ? `(${d.date})` : ''}${d.Today ? '*' : ''}`).join(' '))
console.log('periods:', ret.periods.length, ret.periods[0], ret.periods[ret.periods.length - 1])
console.table(ret.courses.map((c) => ({
  week: c.Week, col: c.Col, row: `${c.RowStart}-${c.RowEnd}`, name: c.CourseName,
  color: c.Color, tag: c.Tag, time: c.TimeText, where: `${c.TeachName}/${c.ClassRoom}`
})))

ok(ret.total === 4, '跳过无法确定星期的课程 -> 4 条')
ok(ret.periods.length === 12, '最大节次 12 -> 12 行')
ok(ret.periods[0].time === '08:00~08:45', '第 1 节 08:00 上课，结束时间 = 08:00 + 45 分钟')
ok(ret.periods[1].time === '08:55~09:40', '第 2 节结束时间 = 第 2 节上课时间 + 45 分钟')
ok(ret.periods[11].time === '21:25~22:10', '第 12 节 21:25 上课 -> 22:10 下课')
ok(ret.courses[0].Week === 1 && ret.courses[0].Col === 2, '周日课程排在第一列')
ok(ret.courses.find((c) => c.CourseName === '大学物理B（二）').Col === 4, '周二 -> 第 4 列')
ok(ret.courses.find((c) => c.CourseName === '大学物理B（二）').RowStart === 4, '第 3 节 -> 第 4 行')
ok(ret.courses.find((c) => c.CourseName === '物理化学B(一)').RowEnd === 14, '11-12 节 -> 行 12~14')
ok(ret.courses.every((c) => c.Color >= 0 && c.Color < 8), '配色下标在 0~7')
ok(new Set(ret.courses.map((c) => c.CourseName)).size === new Set(ret.courses.map((c) => c.Color)).size, '每门课配色唯一')
ok(ret.courses.find((c) => c.CourseName === '大学物理B（二）').Tag === '未到', 'ClassLxBz 到勤情况照实显示')
ok(ret.courses.find((c) => c.CourseName === '物理化学B(一)').Tag === '调课', '异常状态显示标签')
ok(ret.courses.find((c) => c.CourseName === '分析化学').Tag === '', 'ClassLxBz 为空则不显示标签')
ok(ret.days[0].Weekend && ret.days[6].Weekend, '周日/周六标记为周末')
ok(ret.days.filter((d) => d.Today).length === 1, '仅一天标记为今天')

/* 单天数据 */
let day = Class.dayData(ret, 1, '今日课表')
ok(day.total === 1 && day.dayName === '周日', '周日单天课表')
ok(day.courses[0].Time === '20:30~21:25', '11-12 节时间文本 = 第 11 节上课 ~ 第 12 节下课')
ok(Class.timeRange(3, 4).End === '11:40', '3-4 节结束时间 = 第 4 节上课 10:55 + 45 分钟')
ok(Class.timeRange(13, 14).Start === '', '超出作息表返回空串')
ok(Class.tomorrowWeek(ret) === Class.todayWeek(ret) % 7 + 1, '明日星期递增')
ok(RET_WEEK_OK(), '缺 Week 字段时按 Rq 推算星期')

function RET_WEEK_OK() {
  return Class.getWeek({ Rq: '2026-09-20' }, {}) === 1 &&
    Class.getWeek({ Rq: '2026-09-26' }, {}) === 7 &&
    Class.getWeek({ Week: 5, Rq: '2026-09-20' }, {}) === 5
}

/* Cfg.js 里的 fs.watch 会保持事件循环，测试结束主动退出 */
process.exit(process.exitCode || 0)

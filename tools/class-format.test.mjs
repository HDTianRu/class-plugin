/*
 * model/class.js format() 单元自测
 * 用法：node tools/class-format.test.mjs
 * */
import fs from 'node:fs'

globalThis.logger = {
  info: console.log, warn: console.log, error: console.log, mark: console.log,
  red: (s) => s, green: (s) => s, yellow: (s) => s, blue: (s) => s, gray: (s) => s
}

const Class = (await import('../model/class.js')).default

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
ok(day.courses[0].Time === '20:30~22:10', '11-12 节时间文本 = 第 11 节上课 ~ 第 12 节下课')
ok(Class.timeRange(3, 4).End === '11:40', '3-4 节结束时间 = 第 4 节上课 10:55 + 45 分钟')
ok(Class.timeRange(13, 14).Start === '', '超出作息表返回空串')
ok(Class.tomorrowWeek(ret) === Class.todayWeek(ret) % 7 + 1, '明日星期递增')
ok(RET_WEEK_OK(), '缺 Week 字段时按 Rq 推算星期')

function RET_WEEK_OK() {
  return Class.getWeek({ Rq: '2026-09-20' }, {}) === 1 &&
    Class.getWeek({ Rq: '2026-09-26' }, {}) === 7 &&
    Class.getWeek({ Week: 5, Rq: '2026-09-20' }, {}) === 5
}

/* ---------- matchCheckin / formatCheckin 纯函数用例 ---------- */

let rec = (sj, room = 'A座421') => ({ minutes: Class.toMinutes(sj.slice(0, 5)), text: sj.slice(0, 5), Room: room })
let course = { ClassRoom: 'A座421', TimeStart: '10:00' }

/* 窗口边界：上课前 60 分整命中、61 分不命中；上课后 5 分整命中、6 分不命中 */
ok(Class.matchCheckin(course, [rec('09:00:00')])?.text === '09:00', '上课前 60 分整命中')
ok(Class.matchCheckin(course, [rec('08:59:00')]) === null, '上课前 61 分不命中')
ok(Class.matchCheckin(course, [rec('10:05:00')])?.text === '10:05', '上课后 5 分整命中')
ok(Class.matchCheckin(course, [rec('10:06:00')]) === null, '上课后 6 分不命中')
ok(Class.matchCheckin(course, [rec('10:00:00')])?.text === '10:00', '上课整点命中')

/* 教室必须相同；空 / 待定不匹配 */
ok(Class.matchCheckin(course, [rec('09:50:00', 'B座502')]) === null, '教室不符不命中')
ok(Class.matchCheckin({ ClassRoom: '', TimeStart: '10:00' }, [rec('09:50:00')]) === null, '教室为空不命中')
ok(Class.matchCheckin({ ClassRoom: '待定', TimeStart: '10:00' }, [rec('09:50:00')]) === null, '教室待定不命中')
ok(Class.matchCheckin({ ClassRoom: ' A座421 ', TimeStart: '10:00' }, [rec('09:50:00')])?.text === '09:50', '教室两侧空格不影响匹配')

/* 同教室多条取最接近上课时间的一条 */
ok(Class.matchCheckin(course, [rec('09:05:00'), rec('09:58:00'), rec('09:40:00')])?.text === '09:58', '多条取最接近上课时间的一条')

/* 缺少 TimeStart 时按 ClassStart 查作息表（第 3 节 10:00） */
ok(Class.matchCheckin({ ClassRoom: 'A座421', ClassStart: 3 }, [rec('09:50:00')])?.text === '09:50', '缺 TimeStart 时按 ClassStart 推算')
ok(Class.matchCheckin({ ClassRoom: 'A座421', ClassStart: 3 }, [rec('08:00:00')]) === null, '按 ClassStart 推算后窗口外不命中')

/* formatCheckin：过滤非法时间，展示取 HH:MM，过滤 ClassState === false */
let parsed = Class.formatCheckin([
  { ClassSj: '09:50:32', ClassRoom: 'A座421' },
  { ClassSj: '', ClassRoom: 'A座421' },
  { ClassSj: '7:05:00', ClassRoom: 'A座421' },
  { ClassState: false, ClassSj: '09:00:00', ClassRoom: 'A座421' }
])
ok(parsed.length === 2, 'formatCheckin 过滤非法时间与无效记录')
ok(parsed[0].text === '09:50' && parsed[0].minutes === 590, 'formatCheckin 取 HH:MM 并算出分钟数')
ok(parsed[1].text === '07:05', 'formatCheckin 补零到 HH:MM')

process.exit(process.exitCode || 0)

/*
 * 流程自测：不起 Yunzai，直接跑 apps/class.js -> model/class.js -> resources/class/*.html
 * 用法：node tools/class-flow.test.mjs
 * */
import fs from 'node:fs'
import path from 'node:path'

/* ---------- 最小 Yunzai 环境 ---------- */
globalThis.logger = {
  info: (...a) => console.log('[info]', ...a),
  warn: (...a) => console.log('[warn]', ...a),
  error: (...a) => console.log('[error]', ...a),
  mark: (...a) => console.log(...a),
  red: (s) => s, green: (s) => s, yellow: (s) => s, blue: (s) => s, gray: (s) => s
}
globalThis.redis = {
  store: new Map(),
  async get(key) { return this.read(key) },
  /* EX 单位秒，按真实时间失效，便于断言缓存时长 */
  async set(key, val, opt) {
    let EX = opt?.EX
    return this.store.set(key, { val, expireAt: EX ? Date.now() + EX * 1000 : 0 })
  },
  async del(key) { this.store.delete(key) },
  async ttl(key) {
    let item = this.store.get(key)
    if (!item) return -2
    return item.expireAt ? Math.round((item.expireAt - Date.now()) / 1000) : -1
  },
  read(key) {
    let item = this.store.get(key)
    if (!item) return null
    if (item.expireAt && item.expireAt <= Date.now()) { this.store.delete(key); return null }
    return item.val
  }
}

/* plugin 基类 + render，模拟 Yunzai 的 e.runtime.render */
const RENDERS = []
globalThis.plugin = class {
  constructor(cfg = {}) {
    this.name = cfg.name
    Object.assign(this, cfg)
  }
}

const render = async (app, tplPath, data, cfg) => {
  let file = path.join(process.cwd(), 'plugins/class-plugin/resources', `${tplPath}.html`)
  let tpl = fs.readFileSync(file, 'utf8')
  let { beforeRender, ...rest } = cfg || {}
  if (beforeRender) data = beforeRender({ data, e: cfg.e })
  /* help/index.html 用 {{extend defaultLayout}} 继承 Yunzai 内置布局，脱离本体渲染不了，这里只校验调用参数 */
  let html = tpl.includes('{{extend')
    ? `<!-- yunzai-layout -->${tpl}`
    : (await import('art-template')).default.render(tpl, data)
  RENDERS.push({ tplPath, data, html, rest })
  return { tplPath, html }
}
globalThis.__render = render
globalThis.__renders = RENDERS

/* ---------- 接口 mock ---------- */
const SAMPLE = JSON.parse(fs.readFileSync(new URL('./sample-data.json', import.meta.url), 'utf8'))
/* 当周真实的周三日期（YYYY-MM-DD），与接口 Rq 格式一致 */
const realWednesday = () => {
  let d = new Date()
  d.setDate(d.getDate() + ((3 - (d.getDay() + 1)) + 7) % 7)
  let p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/* 打卡流水：A座421 09:50 命中周三 3-4 节（10:00 上课，窗口 ≤60 分钟） */
const CHECKIN = {
  Code: '600',
  Msg: '成功',
  Data: [
    { ClassState: null, ClassSj: '09:50:37', ClassLx: 'IC卡', ClassRoom: 'A座421', ClassRq: '2026-09-23' },
    { ClassState: null, ClassSj: '13:30:00', ClassLx: 'IC卡', ClassRoom: 'C座307', ClassRq: '2026-09-23' },
    { ClassState: null, ClassSj: '12:30:00', ClassLx: 'IC卡', ClassRoom: 'D座205', ClassRq: '2026-09-23' }
  ]
}
/* 保证「当周真实周三」的 3-4 节有课，断言才有意义 */
const SAMPLE_WEEK = JSON.parse(JSON.stringify(SAMPLE))
SAMPLE_WEEK.Data.Week[3].Rq = realWednesday()
SAMPLE_WEEK.Data.Rank.push({
  CourseName: '大学物理B（二）', TeachName: '周良玉', ClassLxBz: '未到',
  Class: 3, ClassEnd: 4, ClassRoom: 'A座421', Rq: realWednesday()
})
/* 同一时段另一间教室没有打卡流水：今日应记为「未到」，与 weekRank 的「正常」无关 */
SAMPLE_WEEK.Data.Rank.push({
  CourseName: '大学英语', TeachName: '李明', ClassLxBz: '正常',
  Class: 3, ClassEnd: 4, ClassRoom: 'E座101', Rq: realWednesday()
})

const isCheckin = (url) => String(url).includes('/atd/records')
let fetchCount = 0
let checkinCount = 0
globalThis.fetch = async (url) => {
  if (isCheckin(url)) {
    checkinCount++
    return { json: async () => CHECKIN }
  }
  fetchCount++
  return { json: async () => SAMPLE_WEEK }
}

/* 把 e.runtime.render 接到 model/render.js 上 */
const ClassApp = (await import('../apps/class.js')).default
const classApi = (await import('../model/class.js')).default
const Cfg = (await import('../model/Cfg.js')).default

/* 绑定信息落盘在 <cwd>/plugins/<name>/data/class/data.json，先清掉保证第 1 节可复现 */
let bindDir = path.join(process.cwd(), 'plugins', 'class-plugin', 'data/class')
fs.rmSync(path.join(bindDir, 'data.json'), { force: true })
fs.rmSync(path.join(bindDir, 'data.json.json'), { force: true })
let e = {
  user_id: '10001',
  at: null,
  isMaster: false,
  msg: '',
  replies: [],
  async reply(msg, quote) { this.replies.push(msg); return { msg } },
  runtime: { render: (app, tplPath, data, cfg) => render(app, tplPath, data, cfg) }
}

const app = new ClassApp(e)
const ok = (b, m) => { console.log(`${b ? 'PASS' : 'FAIL'} ${m}`); if (!b) process.exitCode = 1 }
const lastHtml = () => RENDERS[RENDERS.length - 1].html
const call = async (fn, msg) => { e.msg = msg; e.replies = []; await app[fn](e) }

/* 配置 token 与节流间隔，否则接口会被跳过 / 请求被节流 */
Cfg._set('class.token', 'test-token')
Cfg._set('class.lockTime', 0)
Cfg._set('class.checkinTimeout', 1000)

console.log('=== 1. 未绑定时查询 ===')
await call('clz', '#课表')
ok(e.replies[0]?.includes('还没有绑定课表'), '未绑定给出绑定提示')
ok(RENDERS.length === 0, '未绑定不渲染图片')
ok(checkinCount === 0, '未绑定时不请求打卡接口')

console.log('\n=== 2. 绑定（缺学号）===')
await call('bind', '#绑定课表')
ok(e.replies[0] === '格式：#bind 学号', '缺学号给出格式提示')

console.log('\n=== 3. 绑定（带学号）===')
await call('bind', '#bind 20240001')
ok(classApi.getID('10001') === '20240001', '学号写入 data/class/data.json')
ok(fetchCount === 1, '绑定后立即拉取一次课表')
ok(RENDERS.length === 1 && RENDERS[0].tplPath === 'class/index', '绑定后渲染整周课表')
ok(e.replies[0].includes('绑定成功'), '绑定成功文案')

console.log('\n=== 4. 整周课表 ===')
await call('clz', '#课表')
ok(RENDERS[1].tplPath === 'class/index', '渲染 class/index')
let scheduleOfWeek = RENDERS[1].data
ok(!/\{\{|\}\}/.test(lastHtml()), '整周课表模板无未解析占位符')
ok((lastHtml().match(/class="course /g) || []).length === RENDERS[1].data.total, `渲染 ${RENDERS[1].data.total} 张课程卡片`)
ok(lastHtml().includes('grid-column: 4; grid-row: 4 / 6;'), '周二 3-4 节 -> 列4 行4~6')
ok(lastHtml().includes('<span class="tag">调课</span>'), '异常状态渲染标签')

console.log('\n=== 5. 缓存 ===')
let before = fetchCount
await call('clz', '#课表')
ok(fetchCount === before, '命中缓存不再请求接口')
ok(await redis.get('class-plugin:raw:20240001') !== null, '原始数据写入 redis')
let ttl = await redis.ttl('class-plugin:raw:20240001')
let dayLeft = 24 * 3600 - (new Date().getHours() * 3600 + new Date().getMinutes() * 60 + new Date().getSeconds())
ok(ttl > dayLeft - 10 && ttl <= dayLeft + 2, `缓存到当天结束（剩余 ${ttl}s）`)
ok(await redis.get('class-plugin:schedule:20240001') === null, '不再单独缓存整理后的数据')

/* 缓存过期后应重新请求接口 */
let cacheRaw = await redis.get('class-plugin:raw:20240001')
await redis.set('class-plugin:raw:20240001', cacheRaw, { EX: 0 })
redis.store.get('class-plugin:raw:20240001').expireAt = Date.now() - 1000
let expiredBefore = fetchCount
await call('clz', '#课表')
ok(fetchCount === expiredBefore + 1, '缓存过期后重新请求接口')

console.log('\n=== 6. 强制刷新 ===')
await call('clz', '#课表强制')
ok(fetchCount === expiredBefore + 2, '强制刷新重新请求接口')

console.log('\n=== 7. 今日 / 明日课表 ===')
let checkinBefore = checkinCount
await call('today', '#今日课表')
ok(RENDERS[RENDERS.length - 1].tplPath === 'class/day', '渲染 class/day')
let todayData = RENDERS[RENDERS.length - 1].data
console.log(`   今日 = ${todayData.dayName}，${todayData.total} 节课`)
ok(!/\{\{|\}\}/.test(lastHtml()), '单天模板无未解析占位符')
ok(todayData.courses.every((c) => c.Week === classApi.todayWeek(scheduleOfWeek)), '今日课程按真实星期过滤')
ok(checkinCount === checkinBefore + 1, '今日课表请求一次打卡接口')
let hit = todayData.courses.find((c) => /^\d{1,2}:\d{2}:\d{2}$/.test(c.Tag))
ok(!!hit, '今天的课程用打卡时间当标签')
ok(hit.Tag === '09:50:37', '打卡时间精确到秒')
ok(hit.TagClass === 'st-ok', '打卡时间与「已到」同样式（绿）')
ok(todayData.courses.every((c) => c.CheckinText === undefined), '不再单独渲染打卡行')
let miss = todayData.courses.find((c) => c.ClassRoom === 'E座101')
ok(miss?.Tag === '未到' && miss.TagClass === 'st-bad', '今天没有打卡记录的课记为未到（红）')
ok(todayData.courses.every((c) => c.TagClass === 'st-ok' || c.TagClass === 'st-bad'), '今日标签全部按打卡结果着色')
ok(lastHtml().includes('class="item st-ok"'), '打卡命中的卡片渲染成绿色（与已到同款）')
ok(lastHtml().includes('class="item st-bad"'), '未打卡的卡片渲染成红色')

/* 非今天：不请求打卡接口，到勤标签照旧 */
checkinBefore = checkinCount
await call('tomorrow', '#明日课表')
ok(RENDERS[RENDERS.length - 1].data.title === '明日课表', '明日课表标题')
ok(checkinCount === checkinBefore, '明日课表不请求打卡接口')
ok(RENDERS[RENDERS.length - 1].data.courses.every((c) => !/^\d{1,2}:\d{2}:\d{2}$/.test(c.Tag)), '明日课程标签保持 weekRank')

await call('weekDay', '#课表周二')
ok(checkinCount === checkinBefore, '指定非今天不请求打卡接口')
ok(RENDERS[RENDERS.length - 1].data.courses.some((c) => c.Tag === '未到'), '非今天仍显示 weekRank 到勤标签')
ok(RENDERS[RENDERS.length - 1].data.courses.every((c) => !/^\d{1,2}:\d{2}:\d{2}$/.test(c.Tag)), '非今天不带打卡时间')

/* 打卡接口失败：退回 weekRank 标签，渲染不受影响 */
let okFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  if (isCheckin(url)) throw new Error('checkin timeout')
  fetchCount++
  return { json: async () => SAMPLE }
}
await call('today', '#今日课表')
let fallback = RENDERS[RENDERS.length - 1].data
ok(fallback.courses.every((c) => !/^\d{1,2}:\d{2}:\d{2}$/.test(c.Tag)), '打卡接口失败时不显示打卡时间')
ok(fallback.courses.some((c) => c.Tag === '未到'), '打卡接口失败时保留 weekRank 到勤标签')
globalThis.fetch = okFetch

/* 打卡接口返回非 600：同样退回 */
let okFetch2 = globalThis.fetch
globalThis.fetch = async (url) => {
  if (isCheckin(url)) return { json: async () => ({ Code: '500', Msg: '失败' }) }
  fetchCount++
  return { json: async () => SAMPLE }
}
await call('today', '#今日课表')
ok(RENDERS[RENDERS.length - 1].data.courses.every((c) => !/^\d{1,2}:\d{2}:\d{2}$/.test(c.Tag)), '打卡接口返回异常时退回原标签')
globalThis.fetch = okFetch2

console.log('\n=== 8. 节流 ===')
Cfg._set('class.lockTime', 5000)
await call('clz', '#课表')
let renders = RENDERS.length
await call('clz', '#课表')
ok(RENDERS.length === renders, '5 秒内重复触发被节流')
Cfg._set('class.lockTime', 0)

console.log('\n=== 9. 解绑 ===')
await call('unbind', '#解绑课表')
ok(classApi.getID('10001') === undefined, '绑定信息已删除')
ok(e.replies[0] === '已解绑课表', '解绑文案')
await call('unbind', '#解绑课表')
ok(e.replies[0] === '你还没有绑定课表', '重复解绑给出提示')

console.log('\n=== 10. 帮助 ===')
/* 帮助是另一个插件类，单独实例化 */
const HelpApp = (await import('../apps/help.js')).help
await new HelpApp(e).help(e)
ok(RENDERS[RENDERS.length - 1].tplPath === 'help/index', '帮助渲染 help/index 图')
let helpData = RENDERS[RENDERS.length - 1].data
ok(helpData.helpGroup.some((g) => g.list?.some((i) => i.title.includes('#课表'))), '帮助图内含课表指令')
let items = helpData.helpGroup.flatMap((g) => g.list || [])
ok(items.length > 0 && items.every((i) => typeof i.css === 'string'), '每条帮助项都算好了图标定位 css')

console.log('\n=== 11. 空课表 ===')
let realFetch = globalThis.fetch
globalThis.fetch = async () => ({ json: async () => ({ ...SAMPLE, Data: { ...SAMPLE.Data, Rank: [] } }) })
await call('bind', '#bind 20240002')
ok(e.replies[0].includes('绑定成功'), '无课也能正常绑定')
ok(RENDERS[RENDERS.length - 1].data.total === 0, '空课表 total 为 0')
ok(lastHtml().includes('本周暂无课程'), '空课表显示占位文案')
globalThis.fetch = realFetch

console.log('\n=== 12. 接口异常 ===')
let goodFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('network down') }
await call('bind', '#bind 20240003')
ok(e.replies.some((r) => r.includes('绑定成功')), '接口异常时绑定信息仍然写入')
ok(e.replies.some((r) => r.includes('课表查询失败')), '接口异常时提示绑定后查询失败')
ok(!e.replies.some((r) => String(r).includes('undefined')), '失败提示不含 undefined')
globalThis.fetch = goodFetch

globalThis.fetch = async () => ({ json: async () => ({ Code: '401', Msg: 'token 失效' }) })
await call('clz', '#课表强制')
ok(e.replies.some((r) => r.includes('课表获取失败')), '业务错误码给出失败提示')
globalThis.fetch = goodFetch

console.log('\n=== 13. 查他人课表脱敏 ===')
Cfg._set('class.lockTime', 0)
e.isMaster = true
await call('bind', '#bind 20240001')
e.isMaster = false
ok(e.replies[0].includes('绑定成功'), '重新绑定自己的课表')

/* 自己查：教师/教室正常显示 */
await call('clz', '#课表')
let mine = RENDERS[RENDERS.length - 1].data
ok(mine.courses.every((c) => c.TeachName && c.TeachName !== '已隐藏'), '查自己时教师正常显示')
ok(!lastHtml().includes('教师与教室已隐藏'), '查自己不显示脱敏提示')

/* @ 他人：教师/教室脱敏，先给这个 QQ 也绑一份课表 */
classApi.setID('20240001', '20240001')
e.at = '20240001'
await call('clz', '#课表')
let others = RENDERS[RENDERS.length - 1].data
ok(others.courses.length === mine.courses.length, '脱敏不影响课程数量')
ok(others.courses.every((c) => c.TeachName === '已隐藏' && c.ClassRoom === '已隐藏'), '@他人时教师与教室被替换')
ok(others.courses.every((c) => c.CourseName !== '已隐藏'), '@他人时课程名保留')
ok(others.hideInfo === true, '脱敏标记传给模板')

await call('weekDay', '#课表3')
ok(RENDERS[RENDERS.length - 1].data.hideInfo === true, '单天课表同样脱敏')
ok(RENDERS[RENDERS.length - 1].data.courses.every((c) => c.TeachName === '已隐藏'), '单天课表教师已隐藏')

/* 关闭配置后恢复显示 */
Cfg._set('class.hideOthersInfo', false)
await call('clz', '#课表')
ok(RENDERS[RENDERS.length - 1].data.courses.every((c) => c.TeachName !== '已隐藏'), '关闭配置后 @他人也显示教师')
ok(RENDERS[RENDERS.length - 1].data.hideInfo !== true, '关闭配置后不带脱敏标记')
classApi.delID('20240001')
e.at = null

console.log('\n渲染次数:', RENDERS.length, '| 接口请求次数:', fetchCount)

/* Cfg.js 里的 fs.watch 会保持事件循环，测试结束主动退出 */
process.exit(process.exitCode || 0)

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
  async get(key) { return this.store.get(key) ?? null },
  async set(key, val) { this.store.set(key, val) },
  async del(key) { this.store.delete(key) },
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
let fetchCount = 0
globalThis.fetch = async () => {
  fetchCount++
  return { json: async () => SAMPLE }
}

/* 把 e.runtime.render 接到 model/render.js 上 */
const ClassApp = (await import('../apps/class.js')).default
const classApi = (await import('../model/class.js')).default
const Cfg = (await import('../model/Cfg.js')).default
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
Cfg._set('class.cacheTime', 300)

console.log('=== 1. 未绑定时查询 ===')
await call('clz', '#课表')
ok(e.replies[0]?.includes('还没有绑定课表'), '未绑定给出绑定提示')
ok(RENDERS.length === 0, '未绑定不渲染图片')

console.log('\n=== 2. 绑定（缺学号）===')
await call('bind', '#绑定课表')
ok(e.replies[0] === '格式：#绑定课表 学号', '缺学号给出格式提示')

console.log('\n=== 3. 绑定（带学号）===')
await call('bind', '#绑定课表 20240001')
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

console.log('\n=== 6. 强制刷新 ===')
await call('clz', '#课表强制')
ok(fetchCount === before + 1, '强制刷新重新请求接口')

console.log('\n=== 7. 今日 / 明日课表 ===')
await call('today', '#今日课表')
ok(RENDERS[RENDERS.length - 1].tplPath === 'class/day', '渲染 class/day')
let todayData = RENDERS[RENDERS.length - 1].data
console.log(`   今日 = ${todayData.dayName}，${todayData.total} 节课`)
ok(!/\{\{|\}\}/.test(lastHtml()), '单天模板无未解析占位符')
ok(todayData.courses.every((c) => c.Week === classApi.todayWeek(scheduleOfWeek)), '今日课程按真实星期过滤')

await call('tomorrow', '#明日课表')
ok(RENDERS[RENDERS.length - 1].data.title === '明日课表', '明日课表标题')

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
await call('help', '#课表帮助')
ok(RENDERS[RENDERS.length - 1].tplPath === 'help/index', '帮助渲染 help/index 图')
let helpData = RENDERS[RENDERS.length - 1].data
ok(helpData.helpGroup.some((g) => g.list?.some((i) => i.title.includes('#绑定课表'))), '帮助图内含课表指令')
let items = helpData.helpGroup.flatMap((g) => g.list || [])
ok(items.length > 0 && items.every((i) => typeof i.css === 'string'), '每条帮助项都算好了图标定位 css')

console.log('\n=== 11. 空课表 ===')
let realFetch = globalThis.fetch
globalThis.fetch = async () => ({ json: async () => ({ ...SAMPLE, Data: { ...SAMPLE.Data, Rank: [] } }) })
await call('bind', '#绑定课表 20240002')
ok(e.replies[0].includes('绑定成功'), '无课也能正常绑定')
ok(RENDERS[RENDERS.length - 1].data.total === 0, '空课表 total 为 0')
ok(lastHtml().includes('本周暂无课程'), '空课表显示占位文案')
globalThis.fetch = realFetch

console.log('\n=== 12. 接口异常 ===')
let goodFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('network down') }
await call('bind', '#绑定课表 20240003')
ok(e.replies.some((r) => r.includes('绑定成功')), '接口异常时绑定信息仍然写入')
ok(e.replies.some((r) => r.includes('课表查询失败')), '接口异常时提示绑定后查询失败')
ok(!e.replies.some((r) => String(r).includes('undefined')), '失败提示不含 undefined')
globalThis.fetch = goodFetch

globalThis.fetch = async () => ({ json: async () => ({ Code: '401', Msg: 'token 失效' }) })
await call('clz', '#课表强制')
ok(e.replies.some((r) => r.includes('课表获取失败')), '业务错误码给出失败提示')
globalThis.fetch = goodFetch

console.log('\n渲染次数:', RENDERS.length, '| 接口请求次数:', fetchCount)

/* Cfg.js 里的 fs.watch 会保持事件循环，测试结束主动退出 */
process.exit(process.exitCode || 0)

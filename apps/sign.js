import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import Cfg from '../model/Cfg.js'
import classApi from '../model/class.js'

const require = createRequire(import.meta.url)

/* 签到接口 */
const API_URL = 'https://wedsk12.weds.com.cn:8081/Scan/record'
/* 同一用户重复触发的间隔（毫秒），避免刷接口 */
const LOCK_TIME = 5 * 1000
/* 下载图片的体积上限，超过直接拒绝 */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024
/* 下载图片时的 UA，部分图床对空 UA 不友好 */
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'

/* 重复触发的记录 */
const locks = {}

export default class Sign extends plugin {
  constructor() {
    super({
      name: '签到',
      dsc: '扫描引用消息里的二维码完成签到',
      event: 'message',
      priority: 100,
      rule: [{
        /* 引用图片后发送 #签到 */
        reg: '^#?签到$',
        fnc: 'sign'
      }]
    })
  }

  /* ---------- 指令入口 ---------- */
  async sign(e) {
    if (!this.lock(e.user_id)) return false

    let id = classApi.getID(e.user_id)
    if (!id) {
      return e.reply([
        '你还没有绑定课表',
        '发送「#bind 学号」完成绑定后再签到'
      ].join('\n'), true)
    }

    let url = await this.getImageUrl(e)
    if (!url) {
      return e.reply('请引用一张包含签到二维码的图片，再发送「#签到」', true)
    }

    let buffer = null
    try {
      buffer = await this.download(url)
    } catch (err) {
      logger.error(`[class-plugin] 签到二维码下载失败: ${err.message}`)
      return e.reply('二维码图片下载失败，请重新发送后重试', true)
    }

    let text = ''
    try {
      text = await this.decodeQR(buffer)
    } catch (err) {
      logger.error(`[class-plugin] 二维码识别失败: ${err.message}`)
      return e.reply(`二维码识别失败：${err.message}`, true)
    }
    if (!text) {
      return e.reply('没有识别出二维码，请确认图片清晰且二维码完整', true)
    }

    let qrInfo = pickQrInfo(text)
    if (!qrInfo.includes('SignStr')) {
      logger.warn(`[class-plugin] 二维码内容非签到码: ${text.slice(0, 120)}`)
      return e.reply('这个二维码看起来不是签到码，请确认后重试', true)
    }

    let ret = await this.record(qrInfo, id)
    if (!ret.ok) {
      return e.reply(`签到失败：${ret.msg}`, true)
    }

    let info = ret.data || {}
    let lines = [info.ScanRes || '签到成功']
    if (info.ClassName) lines.push(`课程：${info.ClassName}`)
    if (info.ClassRoom) lines.push(`地点：${info.ClassRoom}`)
    let time = formatTime(info.ScanTime)
    if (time) lines.push(`时间：${time}`)
    return e.reply(lines.join('\n'), true)
  }

  /* ---------- 取图 ---------- */

  /*
  * 优先取引用消息里的图片，引用里没有则退回当前消息
  * getReply 有同步与异步两种实现，一并兼容
  * 返回图片链接，取不到返回空串
  * */
  async getImageUrl(e) {
    let reply = null
    try {
      reply = await e.getReply?.()
    } catch (err) {
      reply = null
    }

    for (let msg of [reply?.message, e.message]) {
      let url = pickImageUrl(msg)
      if (url) return url
    }
    return ''
  }

  /* 下载图片，返回 Buffer */
  async download(url) {
    let res = await fetch(url, { headers: { 'user-agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    let buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_IMAGE_SIZE) throw new Error('图片过大')
    return buffer
  }

  /* ---------- 扫码 ---------- */

  /*
  * 识别图片里的二维码，返回二维码文本，识别不出返回空串
  * 用 zxing-wasm：自带 wasm 解码器，能直接吃 PNG/JPG/GIF/BMP 的原始字节
  * */
  async decodeQR(buffer) {
    let readBarcodes = null
    try {
      readBarcodes = (await import('zxing-wasm/reader')).readBarcodes
    } catch (err) {
      throw new Error('未安装 zxing-wasm，请在插件目录执行 npm install')
    }

    let results = null
    try {
      await prepareWasm()
      results = await readBarcodes(new Uint8Array(buffer), {
        formats: ['QRCode'],
        tryHarder: true
      })
    } catch (err) {
      throw new Error(`二维码解码失败：${err.message}`)
    }
    return results?.[0]?.text || ''
  }

  /* ---------- 签到请求 ---------- */
  async record(qrInfo, userSerial) {
    let token = Cfg.get('class.token', '')
    if (!token) {
      return { ok: false, msg: '未配置 class.token，请联系主人' }
    }

    let options = {
      method: 'POST',
      headers: {
        'Host': 'wedsk12.weds.com.cn:8081',
        'content-type': 'application/json;charset=utf-8',
        'authorization': `Token ${token}`,
        'charset': 'utf-8'
      },
      body: JSON.stringify({
        qrInfo,
        "orgaId": String(Cfg.get('class.orgaId', '10001')),
        "userSerial": String(userSerial)
      })
    }

    let ret = null
    try {
      let res = await fetch(API_URL, options)
      ret = await res.json()
    } catch (err) {
      logger.error(`[class-plugin] 签到接口请求失败: ${err.message}`)
      return { ok: false, msg: '接口请求失败，请稍后重试' }
    }

    if (String(ret?.Code) !== '600') {
      logger.warn(`[class-plugin] 签到接口返回异常: ${ret?.Msg || ret?.Code || '无响应'}`)
      return { ok: false, msg: ret?.Msg || '接口返回异常' }
    }
    return { ok: true, data: ret.Data?.CheckRes || {} }
  }

  /* ---------- 节流 ---------- */
  lock(qq) {
    let lockTime = Number(Cfg.get('class.lockTime', LOCK_TIME)) || 0
    if (lockTime <= 0) return true
    let now = Date.now()
    if (locks[qq] && now - locks[qq] < lockTime) return false
    locks[qq] = now
    return true
  }
}

/* ---------- 工具 ---------- */

/* 二维码文本 -> qrInfo。可能直接是 JSON，也可能塞在链接参数里 */
function pickQrInfo(text) {
  let raw = String(text || '').trim()
  if (/^https?:\/\//i.test(raw)) {
    try {
      let url = new URL(raw)
      for (let key of ['qrInfo', 'qrinfo', 'qr_code', 'data']) {
        let val = url.searchParams.get(key)
        if (val && val.includes('SignStr')) return val
      }
    } catch (err) { /* 不是合法链接，按下面兜底处理 */ }
  }

  let start = raw.indexOf('{')
  let end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  return raw
}

/* 从消息段里找图片链接 */
function pickImageUrl(message) {
  if (!Array.isArray(message)) return ''
  for (let seg of message) {
    if (seg?.type !== 'image') continue
    if (seg.url) return seg.url
    if (typeof seg.file === 'string' && /^https?:\/\//i.test(seg.file)) return seg.file
  }
  return ''
}

/* 毫秒时间戳 -> MM-DD HH:mm:ss */
function formatTime(ts) {
  let n = Number(ts)
  if (!n) return ''
  let d = new Date(n)
  if (isNaN(d.getTime())) return ''
  let p = (v) => String(v).padStart(2, '0')
  return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/* zxing-wasm 默认从 CDN 取 wasm，改成用包里的本地文件，离线也能跑；只需初始化一次 */
let wasmReady = null
function prepareWasm() {
  if (wasmReady) return wasmReady
  wasmReady = (async () => {
    try {
      let { prepareZXingModule } = await import('zxing-wasm/reader')
      let file = require.resolve('zxing-wasm/reader/zxing_reader.wasm')
      let bin = readFileSync(file)
      prepareZXingModule({
        overrides: {
          /* 用精确切片，避免 Buffer 共享大 pool 导致 ArrayBuffer 过大 */
          wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)
        }
      })
    } catch (err) {
      /* 取不到本地 wasm 就让 zxing-wasm 走它默认的 CDN，不阻断识别 */
      logger.warn(`[class-plugin] 未能加载本地 zxing wasm，将回退到 CDN: ${err.message}`)
    }
  })()
  return wasmReady
}

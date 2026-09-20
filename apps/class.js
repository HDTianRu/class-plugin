import Cfg from '../model/Cfg.js'
import render from '../model/render.js'
import classApi from "../model/class.js"

/* 请求节流：同一用户 5 秒内重复触发只响应一次，避免刷图 */
const LOCK_TIME = 5 * 1000
const locks = {}

export default class Class extends plugin {
  constructor() {
    super({
      name: '课表',
      dsc: '查询课表',
      event: 'message',
      priority: 100,
      rule: [{
        /* 整周课表：#课表 / #clz / #课表强制 */
        reg: '^#?(clazz|class|clz|cls|课表|课程表)(强制|刷新|更新)?$',
        fnc: 'clz'
      }, {
        /* 指定星期：#课表3 / #课表周三 / #class7 / #clz日 */
        reg: '^#?(clazz|class|clz|cls|课表|课程表)(\\s*[1-7]|\\s*周?[日一二三四五六])$',
        fnc: 'weekDay'
      }, {
        reg: '^#?(今日|今天|本日)课表$',
        fnc: 'today'
      }, {
        reg: '^#?(明日|明天)课表$',
        fnc: 'tomorrow'
      }, {
        /* 绑定：#bind 学号 */
        reg: '^#?bind\\s*(\\S*)$',
        fnc: 'bind'
      }, {
        /* 解绑：#unbind / 主人可 #unbind @某人 */
        reg: '^#?unbind$',
        fnc: 'unbind'
      }]
    })
  }

  async init() {
    if (!Cfg.get('class.token')) {
      logger.warn(`[class-plugin] 未配置 ${logger.yellow('class.token')}，课表查询将不可用`)
    }
  }

  /* ---------- 整周课表 ---------- */
  async clz(e) {
    let force = /强制|刷新|更新/.test(e.msg)
    return this.showWeek(e, force)
  }

  async showWeek(e, force = false) {
    let schedule = await this.getSchedule(e, force)
    if (!schedule) return false

    return render('class/index', schedule, {
      e, scale: this.getScale()
    })
  }

  /* ---------- 指定星期 ---------- */
  async weekDay(e) {
    let week = this.getWeek(e.msg)
    if (!week) return false

    let schedule = await this.getSchedule(e)
    if (!schedule) return false

    let data = classApi.dayData(schedule, week, `${classApi.dayName(week)}课表`)
    return render('class/day', data, {
      e, scale: this.getScale()
    })
  }

  /*
  * 从指令里取出星期，返回接口用的星期号（Week，1 为周日）
  * 指令里的 1~6 对应 周一~周六，7 对应 周日；也接受「周三」
  * */
  getWeek(msg) {
    let text = String(msg || '').replace(/^#?(clazz|class|clz|cls|课表|课程表)/i, '').trim()
    let idx = '日一二三四五六'.indexOf(text.replace(/^周/, ''))
    if (idx >= 0) return idx + 1

    /* 1~6 -> 周一~周六（接口 2~7），7 -> 周日（接口 1） */
    let num = Number(text)
    if (num >= 1 && num <= 6) return num + 1
    return num === 7 ? 1 : 0
  }

  /* ---------- 今日 / 明日 ---------- */
  async today(e) {
    return this.showDay(e, 'today')
  }

  async tomorrow(e) {
    return this.showDay(e, 'tomorrow')
  }

  async showDay(e, type) {
    let schedule = await this.getSchedule(e)
    if (!schedule) return false

    let week = type === 'tomorrow' ? classApi.tomorrowWeek(schedule) : classApi.todayWeek(schedule)
    let title = type === 'tomorrow' ? '明日课表' : '今日课表'
    let data = classApi.dayData(schedule, week, title)

    return render('class/day', data, {
      e, scale: this.getScale()
    })
  }

  /* ---------- 绑定 ---------- */
  async bind(e) {
    let match = /^#?bind\s*(\S*)$/.exec(e.msg.trim())
    let id = (match?.[1] || '').replace(/^[#＃]/, '')
    if (!id) return e.reply('格式：#bind 学号', true)

    /* 主人可通过 @ 帮他人绑定 */
    let qq = (e.isMaster && e.at) ? e.at : e.user_id
    let old = classApi.getID(qq)
    classApi.setID(qq, id)

    let tip = [
      `绑定成功${old && old !== id ? `，已由 ${old} 更新为 ${id}` : ''}`,
      `学号：${id}`,
      qq === e.user_id ? '发送「#class」即可查看' : `已为 ${qq} 绑定，发送「#class」即可查看`
    ]
    await e.reply(tip.join('\n'), true)

    /* 绑定后直接回一张课表，顺便验证学号是否正确 */
    let schedule = await classApi.getSchedule(id, true)
    if (!schedule) {
      return e.reply('但课表查询失败，请确认学号是否正确，或联系主人检查 Token 配置')
    }
    return render('class/index', schedule, {
      e, scale: this.getScale()
    })
  }

  /* ---------- 解绑 ---------- */
  async unbind(e) {
    let qq = (e.isMaster && e.at) ? e.at : e.user_id
    if (!classApi.getID(qq)) {
      return e.reply(qq === e.user_id ? '你还没有绑定课表' : `${qq} 还没有绑定课表`, true)
    }
    classApi.delID(qq)
    return e.reply(qq === e.user_id ? '已解绑课表' : `已为 ${qq} 解绑课表`, true)
  }

  /* ---------- 公共 ---------- */

  /* 取课表，未绑定或失败时给出提示并返回 null */
  async getSchedule(e, force = false) {
    let qq = e.at || e.user_id
    if (!this.lock(qq)) return null

    let id = classApi.getID(qq)
    if (!id) {
      await e.reply([
        '你还没有绑定课表',
        '发送「#bind 学号」完成绑定'
      ].join('\n'), true)
      return null
    }

    let schedule = await classApi.getSchedule(id, force)
    if (!schedule || !schedule.courses) {
      await e.reply('课表获取失败，请稍后重试' + (e.isMaster ? '（请检查 class.token 配置）' : ''), true)
      return null
    }
    return schedule
  }

  getScale() {
    return Number(Cfg.get('class.scale', 1.3)) || 1.3
  }

  lock(qq) {
    let lockTime = Number(Cfg.get('class.lockTime', LOCK_TIME)) || 0
    if (lockTime <= 0) return true
    let now = Date.now()
    if (locks[qq] && now - locks[qq] < lockTime) return false
    locks[qq] = now
    return true
  }
}

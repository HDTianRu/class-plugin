import path from 'path'
import fs from 'fs'
import lodash from 'lodash'
import Cfg from '../model/Cfg.js'
import render from '../model/render.js'
import classApi from "../model/class.js"
import HelpTheme from './help/HelpTheme.js'
import {
  helpCfg,
  helpList
} from '../config/help.js'
import {
  pluginResources
} from '../config/constant.js'

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
        reg: '^#?(今日|今天|本日)课表$',
        fnc: 'today'
      }, {
        reg: '^#?(明日|明天)课表$',
        fnc: 'tomorrow'
      }, {
        reg: '^#?课表(帮助|菜单|说明|help)$',
        fnc: 'help'
      }, {
        /* 绑定：#绑定课表 学号 / #绑定 学号 */
        reg: '^#?绑定(课表|教务)?\\s*(\\S*)$',
        fnc: 'bind'
      }, {
        /* 解绑：#解绑课表 / 主人可 #解绑课表 @某人 */
        reg: '^#?(解绑|取消绑定)(课表|教务)?$',
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
    let match = /^#?绑定(课表|教务)?\s*(\S*)$/.exec(e.msg.trim())
    let id = (match?.[2] || '').replace(/^[#＃]/, '')
    if (!id) return e.reply('格式：#绑定课表 学号', true)

    /* 主人可通过 @ 帮他人绑定 */
    let qq = (e.isMaster && e.at) ? e.at : e.user_id
    let old = classApi.getID(qq)
    classApi.setID(qq, id)

    let tip = [
      `绑定成功${old && old !== id ? `，已由 ${old} 更新为 ${id}` : ''}`,
      `学号：${id}`,
      qq === e.user_id ? '发送「#课表」即可查看' : `已为 ${qq} 绑定，发送「#课表」即可查看`
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

  /* ---------- 帮助 ---------- */
  async help(e) {
    /* 优先复用帮助图，未配置帮助图时回退到文字 */
    let helpFile = path.join(pluginResources, 'help/index.html')
    if (!fs.existsSync(helpFile)) {
      return e.reply(this.helpText(), true)
    }
    let helpGroup = lodash.cloneDeep(helpList)
    lodash.forEach(helpGroup, (group) => {
      lodash.forEach(group.list, (item) => {
        let icon = item.icon * 1
        if (!icon) {
          item.css = 'display:none'
        } else {
          let x = (icon - 1) % 10
          let y = (icon - x - 1) / 10
          item.css = `background-position:-${x * 50}px -${y * 50}px`
        }
      })
    })
    let themeData = await HelpTheme.getThemeData(helpCfg)
    return render('help/index', {
      helpCfg,
      helpGroup,
      ...themeData,
      element: 'default'
    }, {
      e, scale: this.getScale()
    })
  }

  helpText() {
    return [
      '【课表插件】',
      '#绑定课表 学号 —— 绑定教务学号',
      '#解绑课表 —— 解除绑定',
      '#课表 —— 查看整周课表',
      '#课表强制 —— 忽略缓存重新拉取',
      '#今日课表 / #明日课表 —— 查看单天课程',
      '',
      '配置：data/cfg.json 中 class.token 为接口令牌'
    ].join('\n')
  }

  /* ---------- 公共 ---------- */

  /* 取课表，未绑定或失败时给出提示并返回 null */
  async getSchedule(e, force = false) {
    let qq = e.user_id
    if (!this.lock(qq)) return null

    let id = classApi.getID(qq)
    if (!id) {
      await e.reply([
        '你还没有绑定课表',
        '发送「#绑定课表 学号」完成绑定',
        '学号即教务系统中的用户编号'
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

import Data from "./Data.js"
import Cfg from "./Cfg.js"

/* 节次时间表，第 n 节取 TIMES[n-1]，按学校作息调整 */
const TIMES = ['08:00', '08:55', '10:00', '10:55', '14:00', '14:55',
  '16:00', '16:55', '19:00', '19:55', '20:30', '21:25']
/* 列头，Week 1 ~ 7 对应 周日 ~ 周六 */
const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
/* 单节课时长（分钟），第 end 节的结束时间 = 第 end 节上课时间 + 该值 */
const CLASS_MINUTES = 45
/* 最少显示节数 */
const MIN_PERIOD = 10
/* 课程配色数量，与 resources/class/index.html 中的 .c0 ~ .c7 对应 */
const COLORS = 8
/* 接口地址 */
const API_URL = 'https://wedsk12.weds.com.cn:8081/atd/weekRank'

class Class {
  constructor() {
    //do nothing
  }

  /* ---------- 绑定数据 ---------- */

  setID(qq, id) {
    let data = Data.readJSON("class/data.json") || {}
    data[qq] = id
    Data.writeJSON("class/data.json", data)
  }

  getID(qq) {
    let data = Data.readJSON("class/data.json") || {}
    return data[qq]
  }

  delID(qq) {
    let data = Data.readJSON("class/data.json") || {}
    if (!data[qq]) return false
    delete data[qq]
    Data.writeJSON("class/data.json", data)
    return true
  }

  /* ---------- 课表获取 ---------- */

  /*
  * 获取整理好的课表数据，force 为 true 时跳过缓存
  * 返回 format() 的结果，失败返回 null
  * */
  async getSchedule(id, force = false) {
    if (!id) return null

    let cacheTime = Number(Cfg.get('class.cacheTime', 300)) || 0
    let cacheKey = `class-plugin:schedule:${id}`

    if (!force && cacheTime > 0) {
      let cached = await Data.getCacheJSON(cacheKey)
      if (cached?.courses) return cached
    }

    let raw = await this.request(id)
    if (!raw) return null

    let ret = this.format(raw, id)
    if (cacheTime > 0) {
      try {
        await Data.setCacheJSON(cacheKey, ret, cacheTime)
      } catch (e) {
        /* redis 不可用时忽略缓存 */
      }
    }
    return ret
  }

  /* 请求接口，返回 Data 部分 */
  async request(id) {
    let token = Cfg.get('class.token', '')
    if (!token) {
      logger.warn('[class-plugin] 未配置 class.token，请在 data/cfg.json 中填写')
      return null
    }

    let options = {
      method: 'POST',
      headers: {
        'Host': 'wedsk12.weds.com.cn:8081',
        'content-type': 'application/json;charset=utf-8',
        'authorization': `Token ${token}`,
        'charset': 'utf-8',
      },
      body: JSON.stringify({
        "orgaId": String(Cfg.get('class.orgaId', '10001')),
        "userSerial": String(id)
      })
    }

    let ret = null
    try {
      let res = await fetch(API_URL, options)
      ret = await res.json()
    } catch (e) {
      logger.error(`[class-plugin] 课表接口请求失败: ${e.message}`)
      return null
    }

    if (String(ret?.Code) !== '600' || !ret?.Data) {
      logger.warn(`[class-plugin] 课表接口返回异常: ${ret?.Msg || ret?.Code || '无响应'}`)
      return null
    }
    return ret.Data
  }

  /*
  * 整理接口数据为渲染数据
  * 返回 { id, courses, total, periods, days, weekNow, weekNum, updateTime }
  *   courses: { CourseName, TeachName, ClassRoom, ClassStart, ClassEnd, Week, DayName,
  *              Tag, Color, Col, RowStart, RowEnd, TimeStart, TimeEnd, TimeText }
  *   periods: { no, time }
  *   days:    { name, date, Weekend, Today }
  * */
  format(data = {}, id) {
    let rank = data?.Rank || []
    let weekMap = this.weekMap(data?.Week)
    let today = new Date().getDay() + 1

    let colors = []
    let maxPeriod = Number(Cfg.get('class.maxPeriod', 0)) || MIN_PERIOD
    let courses = []

    rank.forEach((item) => {
      if (!item) return
      let week = this.getWeek(item, weekMap)
      /* 无法确定星期几的课程直接跳过，避免渲染到错误的列 */
      if (!week) return

      let start = Number(item.ClassStart ?? item.Class) || 1
      let end = Number(item.ClassEnd ?? start) || start
      if (end < start) end = start
      if (end > maxPeriod) maxPeriod = end

      let name = item.CourseName || '未知课程'
      let color = colors.indexOf(name)
      if (color < 0) {
        color = colors.length % COLORS
        colors.push(name)
      }

      let range = this.timeRange(start, end)
      /* 连堂（如 3-4 节）写全范围，单节只写一个节次 */
      let noText = `第 ${start}${end > start ? `-${end}` : ''} 节`

      courses.push({
        CourseName: name,
        TeachName: item.TeachName || '待定',
        ClassRoom: item.ClassRoom || '待定',
        ClassStart: start,
        ClassEnd: end,
        Week: week,
        DayName: this.dayName(week),
        /* ClassLxBz 描述这节课的到勤情况，空值才不显示标签 */
        Tag: this.getTag(item.ClassLxBz),
        Color: color,
        /* 表格定位：第 1 列为节次，故星期 +1；第 1 行为表头，故节次 +1 */
        Col: week + 1,
        RowStart: start + 1,
        RowEnd: end + 2,
        TimeStart: range.Start,
        TimeEnd: range.End,
        TimeText: range.Start ? `${noText} ${range.Start}~${range.End}` : noText
      })
    })

    /* 按 星期 -> 节次 排序，保证渲染顺序稳定、配色可复现 */
    courses.sort((a, b) => (a.Week - b.Week) || (a.ClassStart - b.ClassStart))

    let periods = []
    for (let i = 1; i <= maxPeriod; i++) {
      /* 每行显示本节的 上课时间~下课时间，如第 1 节 08:00~08:45 */
      let range = this.timeRange(i, i)
      periods.push({
        no: i,
        time: range.Start ? `${range.Start}~${range.End}` : ''
      })
    }

    return {
      id,
      courses,
      total: courses.length,
      periods,
      days: this.getDays(data?.Week, today),
      weekNow: data?.WeekNow || '',
      weekNum: data?.WeekNum || '',
      updateTime: this.now()
    }
  }

  /* 接口 Week 数组按 周日 起始排列，下标 +1 即星期几 */
  weekMap(week) {
    let map = {}
    if (!Array.isArray(week)) return map
    week.forEach((item, idx) => {
      if (item?.Rq) map[item.Rq] = idx + 1
    })
    return map
  }

  /* 优先用 Week 字段，缺失时按 Rq 日期推算（getDay 0 为周日） */
  getWeek(item, weekMap) {
    if (item.Week) return Number(item.Week)
    if (item.Rq && weekMap[item.Rq]) return weekMap[item.Rq]
    if (item.Rq) {
      let date = new Date(`${item.Rq}T00:00:00`)
      if (!isNaN(date.getTime())) return date.getDay() + 1
    }
    return 0
  }

  /* ClassLxBz 为这节课的到勤情况，空值不显示标签 */
  getTag(bz) {
    if (!bz) return ''
    return String(bz).trim()
  }

  /* 表头：有 Week 数据时带上日期，并标记周末与今天 */
  getDays(week, today) {
    let dateMap = {}
    if (Array.isArray(week)) {
      week.forEach((item, idx) => {
        if (item?.Rq) dateMap[idx + 1] = item.Rq.slice(5)
      })
    }
    return DAYS.map((name, idx) => {
      let weekNo = idx + 1
      return {
        name,
        date: dateMap[weekNo] || '',
        Weekend: weekNo === 1 || weekNo === 7,
        Today: weekNo === today
      }
    })
  }

  now() {
    let d = new Date()
    let p = (n) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  /* ---------- 按天取课 ---------- */

  /* 星期名，1 为周日 */
  dayName(week) {
    return DAYS[week - 1] || ''
  }

  /* 数据里的今天，没有则按真实星期推算 */
  todayWeek(schedule) {
    let idx = (schedule?.days || []).findIndex((day) => day.Today)
    return idx >= 0 ? idx + 1 : (new Date().getDay() + 1)
  }

  /* 明天的星期，周日(1) 的下一天回到 1 */
  tomorrowWeek(schedule) {
    return this.todayWeek(schedule) % 7 + 1
  }

  /* 某天的课程 */
  dayCourses(schedule, week) {
    return (schedule?.courses || []).filter((item) => item.Week === week)
  }

  /*
  * 组装单天课表渲染数据，供 resources/class/day.html 使用
  * title 为「今日课表」这样的标题
  * */
  dayData(schedule, week, title = '课表') {
    let day = schedule?.days?.[week - 1] || {}
    let courses = this.dayCourses(schedule, week).map((item) => {
      let range = this.timeRange(item.ClassStart, item.ClassEnd)
      return {
        ...item,
        DayName: day.name || '',
        /* 左侧节次块显示起止时间，如 08:00~09:40 */
        Time: range.Start ? `${range.Start}~${range.End}` : ''
      }
    })
    return {
      title,
      dayName: day.name || this.dayName(week) || '',
      date: day.date || '',
      weekNow: schedule?.weekNow || '',
      weekNum: schedule?.weekNum || '',
      total: courses.length,
      courses
    }
  }

  /*
  * 解析 "HH:MM" 为当天的分钟数，非法值返回 -1
  * */
  toMinutes(time) {
    let match = /^(\d{1,2}):(\d{2})$/.exec(time || '')
    if (!match) return -1
    return Number(match[1]) * 60 + Number(match[2])
  }

  /*
  * 第 start 节的上课时间 ~ 第 end 节的结束时间
  * 结束时间 = 第 end 节上课时间 + 45 分钟，返回 { Start, End }
  * */
  timeRange(start, end) {
    let startAt = TIMES[start - 1] || ''
    let endAt = TIMES[end - 1] || ''
    let startMin = this.toMinutes(startAt)
    let endMin = this.toMinutes(endAt)
    if (startMin < 0) return { Start: '', End: '' }

    let fmt = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
    return {
      Start: startAt,
      End: endMin < 0 ? '' : fmt(endMin + CLASS_MINUTES)
    }
  }
}

export default new Class()

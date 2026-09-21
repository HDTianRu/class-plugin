import {
  pluginName
} from "./constant.js"

export const helpCfg = {
  title: '课表帮助',
  subTitle: pluginName,
  columnCount: 3,
  colWidth: 265,
  theme: 'all',
  themeExclude: [/*'default'*/],
  style: {
    fontColor: '#d3bc8e',
    descColor: '#eee',
    contBgColor: 'rgba(6, 21, 31, .5)',
    contBgBlur: 3,
    headerBgColor: 'rgba(6, 21, 31, .4)',
    rowBgColor1: 'rgba(6, 21, 31, .2)',
    rowBgColor2: 'rgba(6, 21, 31, .35)'
  }
}

export const helpList = [{
  group: '"[]"内为必填项,"{}"内为可选项,"|"表选择'
}, {
  group: '订阅命令',
  list: [{
    icon: 71,
    title: '#[订阅|取消订阅]UP[UP的uid]',
    desc: '如题(一般用这个)'
  },
    {
      icon: 71,
      title: '#[订阅|取消订阅]直播间[直播间room_id]',
      desc: '如题'
    },
    {
      icon: 74,
      title: 'Tips',
      desc: '如需艾特全体，指令前加"全体"二字'
    },
    {
      icon: 74,
      title: 'Tips',
      desc: '如需不需艾特自己，指令前加"匿名"二字'
    },
    {
      icon: 75,
      title: '#[本群|我的]订阅列表',
      desc: '如题'
    }]
}, {
  group: '课表命令',
  list: [{
    icon: 71,
    title: '#绑定课表 [学号]',
    desc: '绑定教务学号，绑定后自动返回课表'
  },
    {
      icon: 74,
      title: '#解绑课表',
      desc: '解除绑定'
    },
    {
      icon: 75,
      title: '#课表',
      desc: '查看整周课表'
    },
    {
      icon: 76,
      title: '#课表 [1~7|周X]',
      desc: '查看指定星期，1~6 为周一~周六，7 为周日，如 #课表3 / #课表周三'
    },
    {
      icon: 75,
      title: '#课表强制',
      desc: '忽略缓存重新拉取'
    },
    {
      icon: 76,
      title: '#今日课表 / #明日课表',
      desc: '查看单天课程'
    },
    {
      icon: 87,
      title: 'Tips',
      desc: '主人可用 #绑定课表 学号 @某人 代绑'
    },
    {
      icon: 74,
      title: 'Tips',
      desc: '查他人课表时默认隐藏教师与教室，可用 class.hideOthersInfo 关闭'
    }]
}, {
  group: '管理命令，仅主人可用',
  list: [{
      icon: 85,
      title: '#(强制)更新推送插件',
      desc: '更新插件本体(还没做)'
    }]
}]
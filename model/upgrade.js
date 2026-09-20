import Data from './Data.js'
import {
  pluginName
} from "../config/constant.js"

/* 数据文件版本，改动 data/class 下结构时 +1 并在 _upgrade 中补迁移逻辑 */
const version = 1

const _upgrade = async (data) => {
  let newData = {
    version
  }

  switch (data.version) {
    case undefined:
      /* 旧版本没有 version 字段，绑定表为 { qq: 学号 }，结构未变直接沿用 */
      for (let qq of Object.keys(data)) {
        if (qq === 'version') continue
        newData[qq] = data[qq]
      }
      break
    default:
      return data
  }

  return newData
}

const upgrade = async () => {
  let file = 'class/version'
  let data = Data.readJSON(file) || {}
  if (data.version >= version) return

  logger.warn(`[${pluginName}] 正在尝试更新数据文件`)
  if (data.version !== undefined) {
    Data.writeJSON(`${file}.backup`, data)
  }
  data = await _upgrade(data)
  Data.writeJSON(file, data)
  logger.mark(`[${pluginName}] 更新数据文件完成`)
}

export default upgrade

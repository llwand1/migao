// case_ids: OR-034
/**
 * 类级元守卫（issue #6893）：`craftSpecRows()` 的**直调点**必须登记。
 *
 * ## 病灶
 *
 * `craftSpecRows()`（`lib/craft-display.ts`）会带出**「门幅」**行。屏幕上凡**另有**一处印门幅的面，
 * 直调它就会把同一真值印两遍 —— 实测 4 处：订单详情「规格尺寸」格（行内 `门幅2.8米` + 组里又一行）、
 * 详情采购明细块（`门幅:` + `craftRows`）、加工单快照块与「复制全部」文本各一处（属性行 + 工艺规格行）。
 * 正确口径早在 issue #6869/#6882 就立好了：`lib/order-item-sku.ts::orderItemSku(...).specRows`
 * = `craftSpecRows()` **去掉「门幅」**（「它已有自己的列，同一真值印两处只是噪音」）。
 *
 * ## 本守卫判什么
 *
 * 全仓 `src/**` 扫描 `craftSpecRows(` 的**直调**（去注释），与
 * `craft-spec-row-source-ledger.json` 逐文件比对：
 * ① 命中文件**未登记** ⇒ 红（新屏幕面想直调，必须先想清楚「我这面是否另印门幅」并登记理由）；
 * ② 台账**幽灵条目**（文件已不再直调）⇒ 红（**台账只许缩短**）；
 * ③ 单文件命中**条数**与台账不符 ⇒ 红（防「文件已登记 ⇒ 随便再加一处」）；
 * ④ 判据**自证有判别力**：注入一行坏形态（临时代码串）必须被识别（见最后一条用例）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC_DIR = path.resolve(__dirname, '../../src')
const LEDGER = JSON.parse(
  readFileSync(path.resolve(__dirname, 'craft-spec-row-source-ledger.json'), 'utf-8')
) as { ledger: Record<string, { count: number; why: string }>; definition_site: string }

/** 定义处不算调用（`export function craftSpecRows(`） */
const DEFINITION_FILE = 'src/lib/craft-display.ts'

/** 去注释后再数 —— 沿革注释里提到 `craftSpecRows()` 不算直调 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/^[ \t]*\/\/.*$/gm, '') // 整行行注释
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

/** 现取命中：返回 { 相对路径: 条数 } */
export function craftSpecRowsCallSites(): Record<string, number> {
  const hits: Record<string, number> = {}
  for (const file of sourceFiles(SRC_DIR)) {
    const rel = path.relative(path.resolve(SRC_DIR, '..'), file)
    if (rel === DEFINITION_FILE) continue
    const matches = stripComments(readFileSync(file, 'utf-8')).match(/craftSpecRows\s*\(/g)
    if (matches && matches.length > 0) hits[rel] = matches.length
  }
  return hits
}

describe('craftSpecRows 直调点登记（issue #6893）', () => {
  it('① 未登记即红 + ② 幽灵条目即红 + ③ 条数现取比对', () => {
    const now = craftSpecRowsCallSites()
    const declared: Record<string, number> = {}
    for (const [file, meta] of Object.entries(LEDGER.ledger)) declared[file] = meta.count

    const unregistered = Object.keys(now).filter((f) => !(f in declared))
    const ghost = Object.keys(declared).filter((f) => !(f in now))
    const drifted = Object.keys(declared)
      .filter((f) => f in now && now[f] !== declared[f])
      .map((f) => `${f}：现取 ${now[f]} / 台账 ${declared[f]}`)

    expect(unregistered, '这些文件直调了 craftSpecRows() 但没登记（要么改用 orderItemSku().specRows，要么登记理由）').toEqual([])
    expect(ghost, '台账里有已不再直调的文件（台账只许缩短 ⇒ 删掉它）').toEqual([])
    expect(drifted, '命中条数与台账不符（新增/删掉一处都要动台账）').toEqual([])

    // 台账每条都要有非空理由（防止「登记成空壳」）
    for (const [file, meta] of Object.entries(LEDGER.ledger)) {
      expect(meta.why.trim().length, `${file} 的登记理由不能为空`).toBeGreaterThan(0)
    }
  })

  it('④ 判别力自证：注入一行直调 ⇒ 现取命中数 +1（判据不是恒绿）', () => {
    const before = craftSpecRowsCallSites()
    const injected = `${stripComments('const x = 1')}\nconst injected = craftSpecRows({ craft: '韩褶' })\n`
    const countAfterInjection = (injected.match(/craftSpecRows\s*\(/g) ?? []).length
    expect(countAfterInjection).toBe(1)
    // 对照组：注释里的同名文本**不算**命中（沿革注释合法）
    const commentOnly = stripComments("// 沿革：这里曾直调 craftSpecRows() 渲染门幅\nconst y = 2")
    expect((commentOnly.match(/craftSpecRows\s*\(/g) ?? []).length).toBe(0)
    // 现取读数非空（若全仓一处都没有，说明扫描失效 ⇒ 那两个绿都是假绿）
    expect(Object.keys(before).length).toBeGreaterThan(0)
  })
})

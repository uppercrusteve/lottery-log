/**
 * TicketStore 契约。
 *
 * 所有实现都是同一组方法，UI 只认这里，换后端不改 UI。
 * 账本应用接入时实现同样的方法即可，不必用这里的任何实现。
 *
 * 方法都是 async，失败一律 throw，不静默返回空。
 *
 *   listTicketDates()            → string[] 有票的日期，降序
 *   readTicketShard(date)        → string | undefined  原始 JSON 文本
 *   writeTicketShard(date, text) → void
 *   readDrawShard(date)          → string | undefined
 *   writeDrawShard(date, text)   → void
 *
 * 刻意传文本而不是对象：分片格式由 core/codec 管，存储层不认识业务字段。
 *
 * @typedef {object} TicketStore
 * @property {(date: string) => Promise<string | undefined>} readTicketShard
 * @property {(date: string, text: string) => Promise<void>} writeTicketShard
 * @property {(date: string) => Promise<string | undefined>} readDrawShard
 * @property {(date: string, text: string) => Promise<void>} writeDrawShard
 * @property {() => Promise<string[]>} listTicketDates
 * @property {() => Promise<void>} [clear]
 */

/** 检查一个对象像不像 TicketStore */
export function assertStore(store) {
  for (const m of ['readTicketShard', 'writeTicketShard', 'readDrawShard', 'writeDrawShard', 'listTicketDates']) {
    if (typeof store?.[m] !== 'function') throw new Error(`存储缺少方法 ${m}`);
  }
  return store;
}

/**
 * 内存实现，测试和演示用。进程结束即丢。
 * @returns {import('./contract.js').TicketStore}
 */
export function memoryStore(seed = {}) {
  const ticketShards = new Map(Object.entries(seed.tickets ?? {}));
  const drawShards = new Map(Object.entries(seed.draws ?? {}));
  const matchShards = new Map(Object.entries(seed.matches ?? {}));

  return {
    async readTicketShard(date) {
      return ticketShards.get(date);
    },
    async writeTicketShard(date, text) {
      ticketShards.set(date, text);
    },
    async readMatchShard(date) {
      return matchShards.get(date);
    },
    async readDrawShard(date) {
      return drawShards.get(date);
    },
    async writeDrawShard(date, text) {
      drawShards.set(date, text);
    },
    async listTicketDates() {
      return [...ticketShards.keys()].sort().reverse();
    },
    async clear() {
      ticketShards.clear();
      drawShards.clear();
    },
  };
}

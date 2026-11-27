const {summarize} = require('../../assets/chat-budget.js');

class MemoryStorage {
  constructor() { this.rows = new Map(); }
  get length() { return this.rows.size; }
  key(index) { return [...this.rows.keys()][index]; }
  getItem(key) { return this.rows.get(key) ?? null; }
  setItem(key,value) { this.rows.set(key,value); }
  removeItem(key) { this.rows.delete(key); }
}

// Simula el contrato del RPC para poder abrir dos navegadores sin una cuenta real.
function testCloud() {
  const accounts = new Map();
  const calls = [];
  async function exchange(user,{reference,entries}) {
    calls.push({user, entries:entries.length});
    if (!accounts.has(user)) accounts.set(user,{reference:null,entries:new Map()});
    const data = accounts.get(user);
    if (reference && (!data.reference || reference.changedAt >= data.reference.changedAt)) data.reference = reference;
    for (const entry of entries) {
      const prior = data.entries.get(entry.id);
      if (!prior?.complete) data.entries.set(entry.id,{...entry,at:prior?.at || entry.at});
    }
    const ref = data.reference ? {usd:data.reference.usd,at:data.reference.at} : null;
    return summarize(ref,data.entries.values());
  }
  return {accounts,calls,exchange};
}
module.exports = {MemoryStorage,testCloud};

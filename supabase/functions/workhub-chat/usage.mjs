// Standard USD per million text tokens. Sources and long-context threshold:
// https://developers.openai.com/api/docs/models/gpt-6.2-sol
// https://developers.openai.com/api/docs/models/gpt-4.1-mini
// https://developers.openai.com/api/docs/models/gpt-5-mini
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
const standardRates = new Map([
  ['gpt-6.2-sol', { input: 2, cached: 0.10, output: 10, write30m: 2.50, write12h: 5, longContext: true }],
  ['gpt-4.1-mini', { input: 0.40, cached: 0.10, output: 1.60 }],
  ['gpt-5-mini', { input: 0.25, cached: 0.025, output: 2 }],
  ['gpt-5.4-mini', { input: 0.75, cached: 0.075, output: 4.50 }]
]);

function modelFamily(model) {
  // Only strip a dated snapshot suffix. Models such as fine-tunes have their own prices.
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

function readOverrides(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* Invalid configuration must never prevent a reply. */ }
  return {};
}

function isRate(value) {
  return Number.isFinite(value) && value >= 0;
}

function getRates(model, overrides) {
  const family = modelFamily(model);
  const key = Object.hasOwn(overrides, model) ? model : family;
  if (!Object.hasOwn(overrides, key)) return standardRates.get(family);
  const rates = overrides[key];
  if (!rates || ![rates.input, rates.cached, rates.output].every(isRate)) return null;
  return { ...rates, longContext: rates.longContext ?? standardRates.get(family)?.longContext };
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function measure(usage, model, tier, overrides) {
  if (!usage || !isCount(usage.input_tokens) || !isCount(usage.output_tokens)) return null;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const details = usage.input_tokens_details;
  const cached = details?.cached_tokens ?? (input === 0 ? 0 : null);
  const measurement = { input, cached: isCount(cached) && cached <= input ? cached : 0, output, cost: null };
  const rates = getRates(model, overrides);
  if (!rates || ![undefined, null, 'auto', 'default', 'standard'].includes(tier)) return measurement;
  if (!isCount(cached) || cached > input) return measurement;

  const writeDetails = details?.cache_write_tokens_details;
  const writes30m = writeDetails?.ttl_30m_tokens ?? 0;
  const writes12h = writeDetails?.ttl_12h_tokens ?? 0;
  if (!isCount(writes30m) || !isCount(writes12h)) return measurement;
  const writes = details?.cache_write_tokens ?? (writes30m + writes12h);
  if (!isCount(writes) || writes !== writes30m + writes12h || cached + writes > input) return measurement;
  if ((writes30m && !isRate(rates.write30m)) || (writes12h && !isRate(rates.write12h))) return measurement;

  const long = rates.longContext === true && input > 272000;
  const inputCost = (input - cached - writes) * rates.input + cached * rates.cached
    + (writes30m ? writes30m * rates.write30m : 0) + (writes12h ? writes12h * rates.write12h : 0);
  const cost = (inputCost * (long ? 2 : 1) + output * rates.output * (long ? 1.5 : 1)) / 1_000_000;
  if (Number.isFinite(cost)) measurement.cost = cost;
  return measurement;
}

// Optional WORKHUB_CHAT_RATES_JSON format for an unlisted model:
// {"model-id":{"input":1,"cached":0.2,"output":4}}
// Optional write30m/write12h cover explicit cache writes when reported.
// Each round corresponds to one HTTP call, including intermediate tool rounds.
export function createUsageMeter(requestedModel, ratesJson) {
  const overrides = readOverrides(ratesJson);
  const rounds = new Set();
  return {
    beginRound() {
      const entry = { model: requestedModel, measurement: null };
      rounds.add(entry);
      return {
        record(response) {
          if (!response || !rounds.has(entry)) return;
          const model = typeof response.model === 'string' && response.model ? response.model : entry.model;
          const measurement = measure(response.usage, model, response.service_tier, overrides);
          // A duplicate SSE terminal event can contain no usage. Keep the best available receipt.
          if (!entry.measurement || (measurement && entry.measurement.cost == null && measurement.cost != null)) {
            entry.model = model;
            entry.measurement = measurement;
          }
        },
        discard() { rounds.delete(entry); }
      };
    },
    summary() {
      let inputTokens = 0, cachedTokens = 0, outputTokens = 0, knownCostUsd = 0, measuredRounds = 0;
      const models = new Set();
      for (const entry of rounds) {
        models.add(entry.model);
        if (!entry.measurement) continue;
        const { input, cached, output, cost } = entry.measurement;
        inputTokens += input;
        cachedTokens += cached;
        outputTokens += output;
        if (cost != null) {
          measuredRounds++;
          knownCostUsd += cost;
        }
      }
      const complete = rounds.size > 0 && measuredRounds === rounds.size;
      knownCostUsd = Number(knownCostUsd.toFixed(12));
      return {
        model: [...models].join(', ') || requestedModel, inputTokens, cachedTokens, outputTokens,
        costUsd: complete ? knownCostUsd : null, knownCostUsd, rounds: rounds.size, measuredRounds, complete
      };
    }
  };
}

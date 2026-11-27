import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageMeter } from '../supabase/functions/workhub-chat/usage.mjs';

const model = 'gpt-6.2-sol';
function receipt(input, cached, output, extra = {}) {
  return { model, usage: { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: output }, ...extra };
}

test('accumulates cached and uncached input and output from all tool rounds, using the effective model', () => {
  const meter = createUsageMeter('other-model');
  const first = meter.beginRound();
  const response = receipt(10000, 4000, 1000);
  first.record(response);
  first.record(response);
  first.record({ model });
  meter.beginRound().record(receipt(10000, 2000, 500, { model: 'gpt-4.1-mini-2025-04-14' }));
  assert.deepEqual(meter.summary(), {
    model: 'gpt-6.2-sol, gpt-4.1-mini-2025-04-14', inputTokens: 20000, cachedTokens: 6000, outputTokens: 1500,
    costUsd: 0.0266, knownCostUsd: 0.0266, rounds: 2, measuredRounds: 2, complete: true
  });
});

test('honors cache writes by lifetime and the long-context rates on the whole request', () => {
  const meter = createUsageMeter(model);
  const short = receipt(272000, 200000, 1000);
  short.usage.input_tokens_details.cache_write_tokens = 7000;
  short.usage.input_tokens_details.cache_write_tokens_details = { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 };
  meter.beginRound().record(short);
  assert.equal(meter.summary().costUsd, 0.1875);
  const long = structuredClone(short);
  long.usage.input_tokens++;
  meter.beginRound().record(long);
  assert.equal(meter.summary().costUsd, 0.557504);
});

test('prices both standard mini snapshots and the configured model when a receipt omits its model id', () => {
  const meter = createUsageMeter('gpt-5-mini-2025-08-07');
  meter.beginRound().record(receipt(800, 500, 10, { model: undefined }));
  assert.equal(meter.summary().costUsd, 0.0001075);
  meter.beginRound().record(receipt(800, 500, 10, { model: 'gpt-5.4-mini-2026-03-17' }));
  assert.equal(meter.summary().costUsd, 0.000415);
});

test('missing receipts preserve partial cost without treating an interrupted round as free', () => {
  const meter = createUsageMeter(model);
  const first = meter.beginRound();
  first.record(receipt(1000, 0, 100));
  const interrupted = meter.beginRound();
  interrupted.record({ model });
  assert.deepEqual(meter.summary(), {
    model, inputTokens: 1000, cachedTokens: 0, outputTokens: 100, costUsd: null, knownCostUsd: 0.003,
    rounds: 2, measuredRounds: 1, complete: false
  });
  interrupted.record(receipt(0, 0, 0));
  assert.equal(meter.summary().complete, true);
});

test('unsubmitted calls can be discarded without reporting usage', () => {
  const meter = createUsageMeter(model);
  const skipped = meter.beginRound();
  skipped.discard();
  skipped.record(receipt(100, 50, 10));
  assert.equal(meter.summary().rounds, 0);
  assert.equal(meter.summary().costUsd, null);
});

test('a missing model price, a nonstandard tier or invalid cached details keep an honest partial result', () => {
  for (const response of [
    receipt(100, 50, 10, { model: 'future-model' }),
    receipt(100, 50, 10, { model: 'gpt-6.2-sol-preview' }),
    receipt(100, 50, 10, { model: 'ft:gpt-5-mini' }),
    receipt(100, 50, 10, { service_tier: 'priority' }),
    receipt(100, 101, 10),
    receipt(100, undefined, 10),
    { model, usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 10 } } }
  ]) {
    const meter = createUsageMeter(model);
    meter.beginRound().record(response);
    assert.equal(meter.summary().inputTokens, 100);
    assert.equal(meter.summary().costUsd, null);
    assert.equal(meter.summary().measuredRounds, 0);
  }
});

test('rejects invalid token counts, treats confirmed zero as known, and counts reasoning within output', () => {
  const meter = createUsageMeter(model);
  for (const value of [-1, 0.1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const round = meter.beginRound();
    round.record(receipt(value, 0, 0));
    assert.equal(meter.summary().costUsd, null);
    round.discard();
  }
  meter.beginRound().record({ usage: { input_tokens: 0, output_tokens: 0 } });
  assert.equal(meter.summary().costUsd, 0);
  const reasoning = receipt(0, 0, 1000);
  reasoning.usage.output_tokens_details = { reasoning_tokens: 800 };
  meter.beginRound().record(reasoning);
  assert.equal(meter.summary().costUsd, 0.01);
});

test('optional explicit prices work for other models and malformed values do not break chat', () => {
  const response = receipt(1000, 100, 50, { model: 'project-model' });
  const meter = createUsageMeter('project-model', '{"project-model":{"input":1,"cached":0.2,"output":4}}');
  meter.beginRound().record(response);
  assert.equal(meter.summary().costUsd, 0.00112);
  for (const invalid of ['{', 'null', '[]', '{"project-model":{"input":-1,"cached":2,"output":3}}', '{"project-model":{"input":1}}']) {
    const unknown = createUsageMeter(model, invalid);
    unknown.beginRound().record(response);
    assert.equal(unknown.summary().costUsd, null);
  }
});

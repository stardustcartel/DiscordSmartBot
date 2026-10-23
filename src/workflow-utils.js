async function mapConcurrent(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  }));
  return results;
}

async function timed(timings, name, work) {
  const started = Date.now();
  try { return await work(); }
  finally { timings[name] = (timings[name] || 0) + Date.now() - started; }
}

module.exports = { mapConcurrent, timed };

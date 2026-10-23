const { mapConcurrent } = require('./workflow-utils');
const sortedIds = batch => [...batch.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);

function covers(window, group) {
  if (!window.batch.has(group.id)) return false;
  const ids = sortedIds(window.batch), first = ids[0], last = ids.at(-1);
  return group.memberIds.every(id => BigInt(id) >= BigInt(first) && BigInt(id) <= BigInt(last) &&
    (id !== first || window.beforeComplete) && (id !== last || window.afterComplete));
}

// Windows live for this validation pass only. A later AI/answer stage always
// performs its own fresh reads. Serialize each channel; overlap up to 3 channels.
async function readGroupWindows(groups, getChannel, stats) {
  const channels = new Map(), results = new Map();
  for (const group of groups) {
    if (!channels.has(group.channelId)) channels.set(group.channelId, []);
    channels.get(group.channelId).push(group);
  }
  Object.assign(stats, { channels: channels.size, historyRequests: 0, downloadedMessages: 0, reusedWindows: 0 });
  await mapConcurrent([...channels], 3, async ([channelId, entries]) => {
    const windows = [];
    for (const group of entries) {
      try {
        let window = windows.find(item => covers(item, group));
        if (window) stats.reusedWindows++;
        else {
          const channel = await getChannel(channelId);
          const fetch = async options => {
            stats.historyRequests++;
            const batch = await channel.messages.fetch({ ...options, cache: false });
            stats.downloadedMessages += batch.size;
            return batch;
          };
          const batch = new Map(await fetch({ around: group.id, limit: 100 }));
          window = { batch, beforeComplete: batch.size < 100, afterComplete: batch.size < 100 };
          if (batch.size === 100) {
            const ids = sortedIds(batch);
            if (group.memberIds.includes(ids[0])) {
              const before = await fetch({ before: ids[0], limit: 10 });
              window.beforeComplete = before.size < 10;
              for (const [id, message] of before) batch.set(id, message);
            }
            if (group.memberIds.includes(ids.at(-1))) {
              const after = await fetch({ after: ids.at(-1), limit: 10 });
              window.afterComplete = after.size < 10;
              for (const [id, message] of after) batch.set(id, message);
            }
          }
          windows.push(window);
        }
        results.set(group.id, { window });
      } catch (error) { results.set(group.id, { error }); }
    }
  });
  return results;
}
module.exports = { readGroupWindows, sortedIds };

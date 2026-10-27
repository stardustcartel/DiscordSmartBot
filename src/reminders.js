const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { readJson, writeJson } = require("./storage");

const fixedOffsets = {
  UTC: 0, GMT: 0, PST: -8 * 60, PDT: -7 * 60, MST: -7 * 60,
  MDT: -6 * 60, CST: -6 * 60, CDT: -5 * 60, EST: -5 * 60, EDT: -4 * 60,
};

function getTimeZoneOffsetMinutes(timeZone, instant) {
  try {
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value;
    const match = offset?.match(/^GMT([+-])(\d{2}):?(\d{2})$/);
    if (!match) {
      return 0;
    }
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "+" ? minutes : -minutes;
  } catch {
    return 0;
  }
}

function normalizeTimeZone(value, fallback) {
  const normalized = String(value || fallback || "").trim();
  const upper = normalized.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(fixedOffsets, upper)) {
    return upper;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    return normalized;
  } catch {
    return null;
  }
}

function getOffset(timeZone, instant) {
  return Object.prototype.hasOwnProperty.call(fixedOffsets, timeZone)
    ? fixedOffsets[timeZone]
    : getTimeZoneOffsetMinutes(timeZone, instant);
}

function parseClockTime(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "noon") return { hour: 12, minute: 0 };
  if (normalized === "midnight") return { hour: 0, minute: 0 };
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    if (match[3] === "am" && hour === 12) hour = 0;
    if (match[3] === "pm" && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function parseTomorrow(value, now, timeZoneOverride) {
  const match = value.match(/^tomorrow(?:\s+at)?\s+(.+)$/i);
  if (!match) return null;
  let timeText = match[1].trim();
  const zoneMatch = timeText.match(
    /\s+(UTC|GMT|PST|PDT|MST|MDT|CST|CDT|EST|EDT)$/i,
  );
  const timeZone = normalizeTimeZone(
    zoneMatch?.[1] || timeZoneOverride,
    "UTC",
  );
  if (!timeZone) return null;
  if (zoneMatch) timeText = timeText.slice(0, zoneMatch.index).trim();
  const clock = parseClockTime(timeText);
  if (!clock) return null;
  const offset = getOffset(timeZone, now);
  const localNow = new Date(now + offset * 60_000);
  const targetLocal = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() + 1,
    clock.hour,
    clock.minute,
  );
  let dueAt = targetLocal - offset * 60_000;
  if (!Object.prototype.hasOwnProperty.call(fixedOffsets, timeZone)) {
    dueAt = targetLocal - getOffset(timeZone, dueAt) * 60_000;
  }
  return dueAt > now + 5_000 ? dueAt : null;
}

function parseAbsolute(value, now, timeZoneOverride) {
  const match = value.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+at)?\s+(.+)$/i,
  );
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2_000;
  let timeText = match[4].trim();
  const zoneMatch = timeText.match(
    /\s+(UTC|GMT|PST|PDT|MST|MDT|CST|CDT|EST|EDT)$/i,
  );
  const timeZone = normalizeTimeZone(
    zoneMatch?.[1] || timeZoneOverride,
    "UTC",
  );
  if (!timeZone) return null;
  if (zoneMatch) timeText = timeText.slice(0, zoneMatch.index).trim();
  const clock = parseClockTime(timeText);
  if (!clock || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const targetLocal = Date.UTC(year, month - 1, day, clock.hour, clock.minute);
  const targetDate = new Date(targetLocal);
  if (
    targetDate.getUTCFullYear() !== year ||
    targetDate.getUTCMonth() !== month - 1 ||
    targetDate.getUTCDate() !== day
  ) return null;
  let dueAt = targetLocal - getOffset(timeZone, targetLocal) * 60_000;
  if (!Object.prototype.hasOwnProperty.call(fixedOffsets, timeZone)) {
    dueAt = targetLocal - getOffset(timeZone, dueAt) * 60_000;
  }
  return dueAt > now + 5_000 ? dueAt : null;
}

function parseReminderTime(value, now, timeZoneOverride) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const durationText = normalized.replace(/^in\s+/i, "").trim();
  const durationPattern =
    /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)/gi;
  const matches = [...durationText.matchAll(durationPattern)];
  const leftover = durationText.replace(durationPattern, "").replace(/[\s,]+/g, "");
  if (
    matches.length > 0 &&
    leftover === "" &&
    (/^in\s+/i.test(normalized) || durationText === normalized)
  ) {
    const units = {
      s: 1_000, sec: 1_000, secs: 1_000, second: 1_000, seconds: 1_000,
      m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
      h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
      d: 86_400_000, day: 86_400_000, days: 86_400_000,
      w: 604_800_000, week: 604_800_000, weeks: 604_800_000,
    };
    const dueAt = now + matches.reduce(
      (total, [, amount, unit]) => total + Number(amount) * units[unit.toLowerCase()],
      0,
    );
    return dueAt > now + 5_000 ? dueAt : null;
  }
  const tomorrow = parseTomorrow(normalized, now, timeZoneOverride);
  if (tomorrow) return tomorrow;
  if (/^tomorrow$/i.test(normalized)) return now + 86_400_000;
  const absolute = parseAbsolute(normalized, now, timeZoneOverride);
  if (absolute) return absolute;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed > now + 5_000 ? parsed : null;
}

class ReminderStore {
  constructor(config) {
    this.defaultTimeZone = config.reminderDefaultTimeZone;
    this.filePath = path.join(config.dataDirectory, "reminders.json");
    this.eventsPath = path.join(config.dataDirectory, "reminder-events.jsonl");
    this.reminders = readJson(this.filePath, []);
    if (!Array.isArray(this.reminders)) this.reminders = [];
    this.processing = false;
    this.timer = null;
  }

  save() {
    writeJson(this.filePath, this.reminders);
    fs.chmodSync(this.filePath, 0o600);
  }

  event(event, reminder, details = {}) {
    try {
      fs.appendFileSync(this.eventsPath, JSON.stringify({ at: new Date().toISOString(), event, reminderId: reminder.id, creatorId: reminder.userId, channelId: reminder.channelId || null, guildId: reminder.guildId || null, ...details }) + "\n", { mode: 0o600 });
      fs.chmodSync(this.eventsPath, 0o600);
    } catch (error) { console.warn("Could not record reminder activity:", error.code || "unknown"); }
  }

  addGroup({ userId, text, when, timeZone, recipientIds, channelId, guildId = null }) {
    const dueAt = parseReminderTime(when, Date.now(), timeZone || this.defaultTimeZone);
    if (!dueAt) return null;
    const ids = [...new Set(recipientIds)];
    if (!ids.length || ids.length > 10 || ids.some(id => !/^\d{15,25}$/.test(id))) throw new Error("Choose between 1 and 10 people.");
    if (this.reminders.filter(item => item.userId === userId && item.recipients).length >= 50) throw new Error("You already have 50 active shared reminders. Wait for one to finish before creating another.");
    const reminder = { id: randomUUID(), userId, text, dueAt, createdAt: Date.now(), channelId, guildId,
      recipients: ids.map(id => ({ userId: id, status: id === userId ? "accepted" : "pending", attempts: 0 })) };
    this.reminders.push(reminder); this.save();
    this.event("created", reminder, { dueAt, recipientIds: ids });
    return reminder;
  }

  group(id, channelId, guildId) {
    return this.reminders.find(item => item.id === id && item.recipients && item.channelId === channelId && (item.guildId || null) === (guildId || null));
  }

  consent(reminder, userId, accepted) {
    if (!this.reminders.includes(reminder) || reminder.dueAt <= Date.now()) throw new Error("This reminder has already reached its scheduled time or is no longer active.");
    const recipient = reminder.recipients.find(item => item.userId === userId);
    if (!recipient) throw new Error("You were not selected for this reminder.");
    if (recipient.status === (accepted ? "accepted" : "declined")) return false;
    recipient.status = accepted ? "accepted" : "declined";
    this.save(); this.event(accepted ? "accepted" : "declined", reminder, { recipientId: userId });
    return true;
  }

  cancelGroup(reminder, userId) {
    if (reminder.userId !== userId) throw new Error("Only the person who created this reminder can cancel it for everyone.");
    this.reminders = this.reminders.filter(item => item !== reminder);
    this.save(); this.event("cancelled", reminder);
  }

  async processGroup(client, reminder, now) {
    for (const recipient of reminder.recipients) {
      if (!this.reminders.includes(reminder)) return true;
      if (recipient.status === "pending") {
        recipient.status = "expired";
        this.event("acceptance_expired", reminder, { recipientId: recipient.userId });
      }
      if (recipient.status !== "accepted" || recipient.nextAttemptAt > now) continue;
      try {
        const user = await client.users.fetch(recipient.userId);
        if (!this.reminders.includes(reminder)) return true;
        if (user.bot) throw Object.assign(new Error("Recipient is a bot"), { code: "BOT_RECIPIENT" });
        await user.send({ content: `Reminder from <@${reminder.userId}>: ${reminder.text}`, allowedMentions: { parse: [] } });
        recipient.status = "delivered";
        this.event("delivered", reminder, { recipientId: recipient.userId });
      } catch (error) {
        recipient.attempts++;
        recipient.status = recipient.attempts >= 3 ? "failed" : "accepted";
        recipient.nextAttemptAt = now + 60_000;
        this.event(recipient.status === "failed" ? "delivery_failed" : "delivery_retry", reminder, { recipientId: recipient.userId, attempts: recipient.attempts, code: String(error.code || error.status || "unknown") });
      }
      // Persist each person's result so one blocked DM never re-sends the
      // reminder to people whose deliveries already succeeded.
      this.save();
    }
    this.save();
    return reminder.recipients.every(item => item.status !== "accepted" && item.status !== "pending");
  }

  add({ userId, text, when, timeZone }) {
    const dueAt = parseReminderTime(
      when,
      Date.now(),
      timeZone || this.defaultTimeZone,
    );
    if (!dueAt) return null;
    const reminder = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2),
      userId,
      text,
      dueAt,
      attempts: 0,
      createdAt: Date.now(),
    };
    this.reminders.push(reminder);
    this.save();
    return reminder;
  }

  start(client) {
    const run = () => this.processDue(client).catch(error => console.error('Reminder processing failed:', error.code || error.name));
    this.timer = setInterval(run, 15_000);
    run();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processDue(client) {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = Date.now();
      const due = this.reminders.filter((item) => item.dueAt <= now);
      const completed = new Set();
      for (const reminder of due) {
        if (reminder.recipients) {
          if (await this.processGroup(client, reminder, now)) completed.add(reminder.id);
          continue;
        }
        try {
          const user = await client.users.fetch(reminder.userId);
          await user.send({
            content: "Reminder: " + reminder.text,
            allowedMentions: { parse: [] },
          });
          completed.add(reminder.id);
        } catch (error) {
          reminder.attempts = (reminder.attempts || 0) + 1;
          if (reminder.attempts >= 3) {
            completed.add(reminder.id);
            console.error("Discarded reminder " + reminder.id + ":", error.message);
          } else {
            reminder.dueAt = now + 60_000;
          }
        }
      }
      this.reminders = this.reminders.filter((item) => !completed.has(item.id));
      if (due.length > 0) this.save();
    } finally {
      this.processing = false;
    }
  }
}

module.exports = { ReminderStore, parseReminderTime };

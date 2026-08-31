import cron from 'node-cron';
import { replyText, isGroupJid } from '../helpers.js';
import { getGroup, saveGroup, getState } from '../state.js';
import { config } from '../../config.js';

const toMin = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
};

export function parseTimeToHM(str) {
  const s = String(str || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] || 0);
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
  } else {
    if (h > 23) return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function inWindow(automute, base = new Date()) {
  if (!automute) return false;
  const now = base.getHours() * 60 + base.getMinutes();
  const start = toMin(automute.start);
  const end = toMin(automute.end);
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

let applied = new Map();
let task = null;

export function startAutoMutes(sock) {
  if (task) task.stop();

  const applyNow = async () => {
    const { groups } = getState();
    for (const jid of Object.keys(groups || {})) {
      if (!isGroupJid(jid)) continue;
      const g = groups[jid];
      if (!g?.automute) continue;
      const wantMuted = inWindow(g.automute);
      const last = applied.get(jid);
      if (wantMuted === last) continue;
      try {
        await sock.groupSettingUpdate(jid, wantMuted ? 'announcement' : 'not_announcement');
        applied.set(jid, wantMuted);
      } catch (e) {
        console.log(`[harper] automute update failed for ${jid}: ${e.message}`);
      }
    }
  };

  applyNow();
  task = cron.schedule('* * * * *', applyNow); // every minute
  return task;
}

export function resetAutoMute(jid) {
  applied.delete(jid);
}

export default [
  {
    name: 'automute',
    aliases: ['am'],
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const sub = (args[0] || '').toLowerCase();
      const timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;

      if (sub === 'on') {
        const start = args[1];
        const end = args[2];
        if (!start || !end || !timeRe.test(start) || !timeRe.test(end)) {
          return replyText(sock, msg, `Usage: ${config.prefix}automute on <HH:MM> <HH:MM>\nExample: ${config.prefix}automute on 22:00 07:00`);
        }
        group.automute = { start, end };
        saveGroup(jid, group);
        resetAutoMute(jid);
        return replyText(sock, msg, `Auto-mute scheduled: ${start} → ${end} (daily).`);
      }

      if (sub === 'off') {
        group.automute = null;
        saveGroup(jid, group);
        resetAutoMute(jid);
        try {
          await sock.groupSettingUpdate(jid, 'not_announcement');
        } catch {}
        return replyText(sock, msg, 'Auto-mute disabled. Group unmuted.');
      }

      if (group.automute) {
        return replyText(sock, msg, `Auto-mute active: ${group.automute.start} → ${group.automute.end}\nCurrently ${inWindow(group.automute) ? 'MUTED' : 'open'} (Africa/Johannesburg).`);
      }
      return replyText(sock, msg, `Auto-mute is off.\nUsage: ${config.prefix}automute on <HH:MM> <HH:MM> | off`);
    },
  },
  {
    name: 'amute',
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const time = parseTimeToHM(ctx.argsText);
      if (!time) return replyText(sock, msg, `Usage: ${config.prefix}amute <time> e.g. ${config.prefix}amute 6 pm or ${config.prefix}amute 18:00`);
      group.automute = group.automute || {};
      group.automute.start = time;
      if (!group.automute.end) group.automute.end = '07:00';
      saveGroup(jid, group);
      resetAutoMute(jid);
      return replyText(sock, msg, `Auto-mute ON at ${group.automute.start} → unmute ${group.automute.end} (Africa/Johannesburg).`);
    },
  },
  {
    name: 'aunmute',
    group: true,
    admin: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const group = getGroup(jid);
      const time = parseTimeToHM(ctx.argsText);
      if (!time) return replyText(sock, msg, `Usage: ${config.prefix}aunmute <time> e.g. ${config.prefix}aunmute 6 am or ${config.prefix}aunmute 06:00`);
      group.automute = group.automute || {};
      group.automute.end = time;
      if (!group.automute.start) group.automute.start = '18:00';
      saveGroup(jid, group);
      resetAutoMute(jid);
      return replyText(sock, msg, `Auto-unmute at ${group.automute.end}${group.automute.start ? ` (mute starts ${group.automute.start})` : ''} (Africa/Johannesburg).`);
    },
  },
];
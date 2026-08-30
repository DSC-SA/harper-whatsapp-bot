import cron from 'node-cron';
import { replyText, isGroupJid } from '../helpers.js';
import { getGroup, saveGroup, getState } from '../state.js';

const toMin = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
};

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
          return replyText(sock, msg, 'Usage: !automute on <HH:MM> <HH:MM>\nExample: !automute on 22:00 07:00');
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
        return replyText(sock, msg, `Auto-mute active: ${group.automute.start} → ${group.automute.end}\nCurrently ${inWindow(group.automute) ? 'MUTED' : 'open'}.`);
      }
      return replyText(sock, msg, 'Auto-mute is off.\nUsage: !automute on <HH:MM> <HH:MM> | off');
    },
  },
];
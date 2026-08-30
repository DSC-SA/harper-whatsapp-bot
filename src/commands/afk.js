import { replyText, getMentionedJids, getCleanUserNumber, formatMs } from '../helpers.js';
import { getAfk, setAfk } from '../state.js';

async function announceBack(ctx, afk) {
  const { sock, msg, jid } = ctx;
  const away = Date.now() - afk.since;
  setAfk(getCleanUserNumber(ctx.sender), null);
  return sock.sendMessage(
    jid,
    { text: `👋 Welcome back! You were away for ${formatMs(away)}.` },
    { quoted: msg }
  );
}

export async function handleAfk(ctx) {
  const { sender, msg } = ctx;
  const number = getCleanUserNumber(sender);
  const mine = getAfk(number);
  if (mine) return { sentByMe: announceBack(ctx, mine) };

  const mentioned = getMentionedJids(msg) || [];
  const quotedSender = ctx.quotedSender;
  const candidates = new Set([...mentioned, ...(quotedSender ? [quotedSender] : [])]);
  for (const cand of candidates) {
    const afk = getAfk(getCleanUserNumber(cand));
    if (afk) {
      return { sentByMe: replyText(ctx.sock, ctx.msg, `💤 *@${getCleanUserNumber(cand)}* is AFK\n${afk.reason ? `Reason: ${afk.reason}\n` : ''}Away since: ${formatMs(Date.now() - afk.since)} ago`, { mentions: [cand] }) };
    }
  }
  return null;
}

export default [
  {
    name: 'afk',
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const reason = args.join(' ').trim();
      setAfk(getCleanUserNumber(ctx.sender), { since: Date.now(), reason });
      return replyText(sock, msg, reason ? `💤 AFK: ${reason}` : '💤 You are now AFK.');
    },
  },
];
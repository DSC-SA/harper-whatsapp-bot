import { config } from '../config.js';
import {
  getMessageBody,
  getSenderJid,
  isGroupJid,
  getContent,
  isOwner as ownerCheck,
  isGroupAdmin,
} from './helpers.js';
import { getGroup } from './state.js';
import { handleAfk } from './commands/afk.js';
import { handleAntilink } from './groups/antilink.js';
import { handleSpam, handleBadWord } from './groups/spamprotect.js';
import menuCmd from './commands/menu.js';
import aliveCmd from './commands/alive.js';
import stickerCmd from './commands/sticker.js';
import moderationCmd from './commands/moderation.js';
import afkCmd from './commands/afk.js';
import ownerCmd from './commands/owner.js';
import automuteCmd from './groups/automute.js';
import antilinkCmd from './groups/antilink.js';
import spamCmd from './groups/spamprotect.js';
import mlbbCmd, { handlePendingMlbb } from './commands/mlbb.js';

const commands = [
  ...menuCmd,
  ...aliveCmd,
  ...stickerCmd,
  ...moderationCmd,
  ...afkCmd,
  ...ownerCmd,
  ...automuteCmd,
  ...antilinkCmd,
  ...spamCmd,
  ...mlbbCmd,
];

const byName = new Map();
const byAlias = new Map();
for (const cmd of commands) {
  byName.set(cmd.name, cmd);
  for (const a of [cmd.name, ...(cmd.aliases || [])]) byAlias.set(a.toLowerCase(), cmd);
}

function parseCommand(body) {
  if (!body || !config.prefix) return null;
  if (!body.startsWith(config.prefix)) return null;
  const rest = body.slice(config.prefix.length).trim();
  if (!rest) return null;
  const [rawName, ...args] = rest.split(/\s+/);
  return { name: rawName.toLowerCase(), args };
}

function buildCtx(sock, msg) {
  const jid = msg.key.remoteJid;
  const group = isGroupJid(jid);
  return {
    sock,
    msg,
    jid,
    isGroup: group,
    sender: getSenderJid(msg),
    group: group ? getGroup(jid) : null,
    groupJid: group ? jid : null,
    body: getMessageBody(msg),
  };
}

async function runWithChecks(ctx, cmd, args) {
  if (cmd.owner && !ctx.isOwner) return { skipped: 'owner' };
  if (cmd.group && !ctx.isGroup) return { skipped: 'group' };
  if (cmd.dmOnly && ctx.isGroup) return { skipped: 'dmonly' };
  if (cmd.admin && ctx.isGroup && !ctx.isAdmin) return { skipped: 'admin' };
  const result = await cmd.run(ctx, args);
  return { result };
}

const SKIP_MSG = {
  owner: 'Only the bot owner can use this.',
  admin: 'You need group admin rights for this.',
  dmonly: 'This command only works in private DMs.',
  group: 'This command only works in groups.',
};

export async function handleMessage(sock, msg) {
  const ctx = buildCtx(sock, msg);

  if (ctx.isGroup) {
    ctx.isAdmin = await isGroupAdmin(sock, ctx.groupJid, ctx.sender);
  }
  ctx.isOwner = ownerCheck(ctx.sender);
  ctx.quotedSender = getQuotedSenderFrom(msg);

  const parsed = parseCommand(ctx.body);
  ctx.argsText = parsed ? parsed.args.join(' ') : '';

  const mlbbPending = await handlePendingMlbb(ctx);
  if (mlbbPending) return { handled: true };

  if (ctx.isGroup) {
    await handleAntilink(ctx, msg);
    handleSpam(ctx);
    await handleBadWord(ctx);
  }

  const afkNotice = await handleAfk(ctx);
  if (afkNotice) return { handled: true };

  if (!parsed) return { handled: false };

  const cmd = byAlias.get(parsed.name);
  if (!cmd) {
    if (!ctx.isGroup) {
      await ctx.sock.sendMessage(ctx.jid, { text: `Unknown command *${parsed.name}*. Try *${config.prefix}menu*.` }, { quoted: msg });
    }
    return { handled: false };
  }

  const out = await runWithChecks(ctx, cmd, parsed.args);
  if (out.skipped) {
    await ctx.sock.sendMessage(ctx.jid, { text: SKIP_MSG[out.skipped] }, { quoted: msg });
  }
  return { handled: !!out.result };
}

function getQuotedSenderFrom(msg) {
  const { content } = getContent(msg) || {};
  const ci = content?.extendedTextMessage?.contextInfo;
  if (ci?.participant) return ci.participant;
  if (ci?.remoteJid) return ci.remoteJid;
  return null;
}

export function getCommandList() {
  return commands;
}
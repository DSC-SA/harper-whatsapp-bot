import { config } from '../config.js';
import {
  getMessageBody,
  getSenderJid,
  isGroupJid,
  getContent,
  isOwner as ownerCheck,
} from './helpers.js';
import { isGroupAdmin } from './admins.js';
import { getGroup } from './state.js';
import { getOverride } from './security.js';
import { handleAfk } from './commands/afk.js';
import { handleAntilink } from './groups/antilink.js';
import { handleAntidoc } from './groups/antidoc.js';
import { handleSpam, handleBadWord } from './groups/spamprotect.js';
import menuCmd from './commands/menu.js';
import aliveCmd from './commands/alive.js';
import stickerCmd from './commands/sticker.js';
import moderationCmd from './commands/moderation.js';
import afkCmd from './commands/afk.js';
import ownerCmd from './commands/owner.js';
import automuteCmd from './groups/automute.js';
import antilinkCmd from './groups/antilink.js';
import antidocCmd from './groups/antidoc.js';
import spamCmd from './groups/spamprotect.js';
import bansCmd from './groups/bans.js';
import securityCmd from './commands/security.js';
import mlbbCmd, { handlePendingMlbb } from './commands/mlbb.js';
import vvCmd from './commands/vv.js';
import reregCmd from './commands/rereg.js';

const commands = [
  ...menuCmd,
  ...aliveCmd,
  ...stickerCmd,
  ...moderationCmd,
  ...afkCmd,
  ...ownerCmd,
  ...securityCmd,
  ...automuteCmd,
  ...antilinkCmd,
  ...antidocCmd,
  ...spamCmd,
  ...bansCmd,
  ...mlbbCmd,
  ...vvCmd,
  ...reregCmd,
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
  const lvl = getOverride(cmd.name) || (cmd.owner ? 'owner' : cmd.admin ? 'admin' : 'owner');
  if (lvl === 'owner' && !ctx.isOwner) {
    console.log(`[harper] owner-blocked: cmd=${cmd.name} sender=${ctx.sender} remote=${ctx.msg?.key?.remoteJid} fromMe=${ctx.msg?.key?.fromMe} sp=${ctx.msg?.key?.senderPn} pp=${ctx.msg?.key?.participantPn} sl=${ctx.msg?.key?.senderLid}`);
    return { skipped: 'owner' };
  }
  if (lvl === 'admin') {
    if (ctx.isGroup) {
      if (!ctx.isAdmin) return { skipped: 'admin' };
    } else if (!ctx.isOwner) {
      return { skipped: 'owner' };
    }
  }
  if (cmd.group && !ctx.isGroup) return { skipped: 'group' };
  if (cmd.dmOnly && ctx.isGroup) return { skipped: 'dmonly' };
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
    await handleAntidoc(ctx, msg);
  }

  const afkNotice = await handleAfk(ctx);
  if (afkNotice) return { handled: true };

  if (!parsed) return { handled: false };

  let cmdName = parsed.name;
  let cmdArgs = parsed.args;
  const eq = cmdName.indexOf('=');
  if (eq > 0) {
    const head = cmdName.slice(0, eq).toLowerCase();
    if (byAlias.has(head)) {
      const glued = cmdName.slice(eq + 1).trim();
      cmdArgs = glued ? [glued, ...cmdArgs] : cmdArgs;
      cmdName = head;
    }
  }

  const cmd = byAlias.get(cmdName);
  if (!cmd) {
    if (!ctx.isGroup) {
      await ctx.sock.sendMessage(ctx.jid, { text: `Unknown command *${cmdName}*. Try *${config.prefix}menu*.` }, { quoted: msg });
    }
    return { handled: false };
  }

  const out = await runWithChecks(ctx, cmd, cmdArgs);
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

export function findCommand(name) {
  return byAlias.get(String(name).toLowerCase().replace(/^[^a-z0-9]+/, ''));
}
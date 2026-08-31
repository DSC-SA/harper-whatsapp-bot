import { replyText } from '../helpers.js';
import { getOverride, setLevel } from '../security.js';

const PROTECTED = new Set([
  'setvar',
  'var',
  'env',
  'mysession',
  'session',
  'pair',
  'reboot',
  'restart',
  'zushi',
  'tushi',
  'ope',
  'levels',
  'perms',
  'seclevels',
]);

const LEVEL_NAMES = { public: 'everyone', admin: 'group admins (owner in DMs)', owner: 'the owner only' };

async function levelCmd(ctx, args, level) {
  const { sock, msg } = ctx;
  const raw = (args[0] || '').trim();
  if (!raw) {
    const cmdName = ctx.body.split(/\s+/)[0].replace(/^[^a-z0-9]*/i, '').toLowerCase();
    return replyText(sock, msg, `Usage: /${cmdName} <command>\nExample: /${cmdName} ping`);
  }
  const { findCommand } = await import('../handler.js');
  const cmd = findCommand(raw);
  if (!cmd) return replyText(sock, msg, `Unknown command *${raw}*. List them with /levels.`);
  if (PROTECTED.has(cmd.name)) {
    return replyText(sock, msg, `*${cmd.name}* is a protected command and its access level cannot be changed.`);
  }
  setLevel(cmd.name, level);
  const note = level === 'public' ? '\n⚠️ Anyone in the chat can now run this. Use /ope to lock it again.' : '';
  return replyText(sock, msg, `Done. *${cmd.name}* now requires: *${LEVEL_NAMES[level]}*${note}`);
}

export default [
  { name: 'zushi', aliases: ['z'], owner: true, run: (ctx, args) => levelCmd(ctx, args, 'public') },
  { name: 'tushi', aliases: ['t'], owner: true, run: (ctx, args) => levelCmd(ctx, args, 'admin') },
  { name: 'ope', aliases: ['o'], owner: true, run: (ctx, args) => levelCmd(ctx, args, 'owner') },
  {
    name: 'levels',
    aliases: ['perms', 'seclevels'],
    owner: true,
    run: async (ctx) => {
      const { sock, msg } = ctx;
      const { getCommandList } = await import('../handler.js');
      const lines = getCommandList().map((c) => {
        const ov = getOverride(c.name);
        const base = c.owner ? 'owner' : c.admin ? 'admin' : 'public';
        const lvl = ov || base;
        return `_${c.name}_ → ${lvl}${ov ? ' *' : ''}`;
      });
      return replyText(
        sock,
        msg,
        `*Command security levels* (* = overridden)\n${lines.join('\n')}`
      );
    },
  },
];
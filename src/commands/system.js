import { config } from '../../config.js';
import { replyText } from '../helpers.js';
import { getHealthSnapshot, getTaskSnapshot } from '../tasks.js';

const fmt = (ms) => {
  if (ms == null) return '?';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

export default [
  {
    name: 'system',
    aliases: ['sys', 'tasks', 'scans'],
    owner: true,
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'raw') {
        return replyText(sock, msg, '```json\n' + JSON.stringify({ health: getHealthSnapshot(), tasks: getTaskSnapshot() }, null, 2) + '\n```');
      }

      const health = getHealthSnapshot();
      const tasks = getTaskSnapshot();

      const lines = [
        `*${config.botName} — System Monitor*`,
        ``,
        `WhatsApp link: ${health.link}`,
        `Supervisor: ${health.supervisors?.running ? 'RUNNING' : 'STOPPED'}`,
        `Tracked tasks: ${health.tasks}`,
        `Stalled: ${health.stalled?.length ? health.stalled.join(', ') : 'none'}`,
        ``,
      ];

      for (const [id, t] of Object.entries(tasks)) {
        const state = t.state === 'running' ? '✅' : t.state === 'stalled' ? '⚠️' : t.state === 'stopped' ? '⏹' : '⏳';
        const healthy = t.state !== 'stalled';
        lines.push(`${state} *${t.name}*${healthy ? '' : ' (stalled!)'}`);
        lines.push(`   last run ${fmt(t.lastBeatMsAgo)} ago · beats ${t.beats} · errors ${t.errors} · every ${fmt(t.expectedIntervalMs)}`);
      }

      lines.push(``);
      lines.push(`Use *${config.prefix}system raw* for full JSON.`);

      return replyText(sock, msg, lines.join('\n'));
    },
  },
];

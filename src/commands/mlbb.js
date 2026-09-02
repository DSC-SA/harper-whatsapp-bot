import {
  loadUsers,
  saveUsers,
  getUserInfo,
  getUserStats,
  downloadAvatar,
  startRegistration,
  handleRegResponse,
  hasPendingSession,
} from '../mlbb/registration.js';
import { generateProfileCard } from '../mlbb/cardGenerator.js';
import { clearInvite } from '../mlbb/joinInvite.js';
import { resolveUserJid } from '../lidmap.js';

const cleanNumber = (jid) => String(resolveUserJid(jid) || '').replace(/:[0-9]+/, '').split('@')[0];

export default [
  {
    name: 'mlbbreg',
    aliases: ['mlreg', 'registermlbb'],
    dmOnly: true,
    public: true,
    desc: 'Register your MLBB account to get your in-game stats (DM only).',
    run: async (ctx) => {
      await startRegistration(ctx.sock, ctx.jid, ctx.sender);
    },
  },
  {
    name: 'yes',
    aliases: ['accept', 'sure'],
    dmOnly: true,
    public: true,
    desc: 'Accept the join invitation and start MLBB registration.',
    run: async (ctx) => {
      const { sock, jid, sender } = ctx;
      const uid = cleanNumber(sender) || sender;
      clearInvite(uid);
      await startRegistration(sock, jid, sender);
    },
  },
  {
    name: 'mlbbpf',
    aliases: ['mlprofile', 'mlbbcard'],
    public: true,
    desc: 'Generate your MLBB profile card with stats.',
    run: async (ctx, args) => {
      const { sock, msg, jid } = ctx;
      const sender = ctx.sender;

      const users = await loadUsers();
      const userData = users[sender];

      if (!userData) {
        await sock.sendMessage(jid, { text: '❌ You are not registered yet!\n\nPlease register first with: *!mlbbreg*' });
        return;
      }

      await sock.sendPresenceUpdate('composing', jid);
      await sock.sendMessage(jid, { text: '🎨 Fetching your latest stats...' });

      try {
        const [freshInfo, freshStats] = await Promise.all([getUserInfo(userData.jwt), getUserStats(userData.jwt)]);

        if (freshInfo.success && freshInfo.data) {
          userData.name = freshInfo.data.name || userData.name;
          userData.level = freshInfo.data.level || userData.level;
          userData.rank_level = freshInfo.data.rank_level || userData.rank_level;
          userData.avatar = freshInfo.data.avatar || userData.avatar;
          userData.country = freshInfo.data.reg_country || userData.country;
          userData.lastUpdated = new Date().toISOString();
        }

        if (freshStats.success) {
          userData.stats = freshStats.data;
        }

        users[sender] = userData;
        await saveUsers(users);

        const cardText = await generateProfileCard(userData);
        let imageBuffer = null;
        if (userData.avatar) {
          imageBuffer = await downloadAvatar(userData.avatar);
        }

        if (imageBuffer) {
          await sock.sendMessage(jid, { image: imageBuffer, caption: cardText });
        } else {
          await sock.sendMessage(jid, { text: cardText });
        }
      } catch (err) {
        console.error('[mlbb] profile card error:', err.message);
        await sock.sendMessage(jid, { text: '❌ Error generating profile card. Please try again later.' });
      }

      await sock.sendPresenceUpdate('available', jid);
    },
  },
];

export async function handlePendingMlbb(ctx) {
  const { sock, msg, jid } = ctx;
  if (jid.includes('@g.us')) return false;
  if (!(await hasPendingSession(ctx.sender))) return false;
  await handleRegResponse(sock, jid, ctx.sender, ctx.body || '');
  return true;
}
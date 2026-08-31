import { config } from '../../config.js';
import { getCleanUserNumber } from '../helpers.js';
import { addWarn, setWarns } from '../state.js';

export async function applyPolicy(sock, jid, sender, msg, reason, detail) {
  if (reason === 'spam' || reason === 'antilink' || reason === 'antidoc') {
    const action = reason === 'antidoc' ? config.antilinkAction : reason === 'spam' ? config.spamAction : config.antilinkAction;
    const warns = addWarn(`${jid}:${getCleanUserNumber(sender)}`);

    await sock.sendMessage(
      jid,
      {
        text:
          `⚠️ *Auto-mod: ${reason.toUpperCase()}*\n` +
          `User: @${getCleanUserNumber(sender)}\n` +
          `Reason: ${detail || reason}\n` +
          `Warns: ${warns}/${config.maxWarns}`,
        mentions: [sender],
      },
      { quoted: msg }
    );

    if (action === 'kick' || warns >= config.maxWarns) {
      setWarns(`${jid}:${getCleanUserNumber(sender)}`, 0);
      await sock.groupParticipantsUpdate(jid, [sender], 'remove');
      return 'kicked';
    }
    if (action === 'mute') {
      await sock.groupSettingUpdate(jid, 'announcement');
      setTimeout(async () => {
        try {
          await sock.groupSettingUpdate(jid, 'not_announcement');
        } catch {}
      }, config.spamMuteMinutes * 60 * 1000);
      return 'muted';
    }
    return 'warned';
  }
  return null;
}
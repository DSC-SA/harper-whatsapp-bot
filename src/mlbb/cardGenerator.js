import { getRankName } from './registration.js';

export async function generateProfileCard(userData) {
  const statsOk = userData.stats && userData.stats.tc !== null && userData.stats.tc !== undefined;

  const winRate = statsOk ? ((userData.stats.wc / userData.stats.tc) * 100).toFixed(2) : null;
  const avgScore = statsOk ? userData.stats.as || '0.00' : null;
  const avgGameTime = statsOk ? (userData.stats.gt ? userData.stats.gt.toFixed(1) : '0.00') : null;
  const mvpCount = statsOk ? userData.stats.mvpc || 0 : null;
  const winStreak = statsOk ? userData.stats.wsc || 0 : null;

  const rankText = userData.rank_level > 0 ? `Rank: ${getRankName(userData.rank_level)} (${userData.rank_level})\n` : '';
  const levelText = userData.level > 0 ? `Level: ${userData.level}\n` : '';

  const card = `🎮 *MLBB PROFILE CARD*

👤 *PLAYER INFO*
Name: ${userData.name || 'Unknown'}
${rankText}${levelText}Country: ${userData.country || 'N/A'}

📈 *RANKED MATCH STATS*${statsOk ? `
Total Ranked Matches: ${userData.stats.tc || 0}
Ranked Wins: ${userData.stats.wc || 0}
Win Rate: ${winRate}%
Avg Score: ${avgScore}
MVP Count: ${mvpCount}
Win Streak: ${winStreak}` : `
The MLBB stats service is currently down (${new Date().toLocaleDateString()}).
Run this command again later to load your stats.`}

Updated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}
Powered by DSC-SA`;

  return card;
}
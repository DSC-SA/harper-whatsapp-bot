import axios from 'axios';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'fs/promises';

const MLBB_API_BASE = 'https://arena.rone.dev/api';
const MLBB_API_FALLBACK = 'https://arena-hv.fastapicloud.dev/api';
const USERS_FILE = 'data/mlbbusers.json';
const SESSIONS_FILE = 'data/mlbbRegSessions.json';

async function ensureFiles() {
  await mkdir('data', { recursive: true });
  for (const f of [USERS_FILE, SESSIONS_FILE]) {
    try {
      await readFile(f, 'utf8');
    } catch {
      await writeFile(f, JSON.stringify({}), 'utf8');
    }
  }
}

export async function loadUsers() {
  try {
    return JSON.parse(await readFile(USERS_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

export async function saveUsers(users) {
  await ensureFiles();
  return writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

async function loadSessions() {
  try {
    return JSON.parse(await readFile(SESSIONS_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

async function saveSessions(sessions) {
  await ensureFiles();
  return writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

export function getRankName(rankLevel) {
  if (rankLevel <= 0) return 'Unranked';
  if (rankLevel <= 10) return 'Warrior';
  if (rankLevel <= 25) return 'Elite';
  if (rankLevel <= 45) return 'Master';
  if (rankLevel <= 75) return 'Grandmaster';
  if (rankLevel <= 105) return 'Epic';
  if (rankLevel <= 135) return 'Legend';
  if (rankLevel <= 160) return 'Mythic';
  if (rankLevel <= 185) return 'Mythical Honor';
  if (rankLevel <= 235) return 'Mythical Glory';
  return 'Mythical Immortal';
}

async function enhanceAvatar(rawBuffer) {
  if (!rawBuffer) return rawBuffer;
  try {
    const meta = await sharp(rawBuffer).metadata();
    const { width = 0, height = 0 } = meta;
    if (width < 400 && height < 400) {
      const factor = Math.max(2, Math.round(300 / Math.max(width, height)));
      return await sharp(rawBuffer)
        .resize(Math.round(width * factor), Math.round(height * factor), { kernel: 'lanczos3' })
        .png()
        .toBuffer();
    }
    return rawBuffer;
  } catch {
    return rawBuffer;
  }
}

export async function downloadAvatar(url, maxRetries = 3) {
  if (!url) return null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const cacheBusted = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now() + '_r=' + attempt;
      const response = await axios.get(cacheBusted, { responseType: 'arraybuffer', timeout: 15000 });
      if (response.status === 200 && response.data && response.data.length) {
        return await enhanceAvatar(Buffer.from(response.data, 'binary'));
      }
    } catch (err) {
      console.warn(`[mlbb] avatar download attempt ${attempt}/${maxRetries} failed: ${err.message}`);
    }
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1200 * attempt));
  }
  return null;
}

async function withFallback(callable) {
  const endpoints = [MLBB_API_BASE, MLBB_API_FALLBACK];
  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const result = await callable(endpoint);
      if (result.success) return result;
      lastErr = result;
    } catch (error) {
      lastErr = { success: false, message: error.message, statusCode: error.response?.status };
      console.warn(`[mlbb] endpoint ${endpoint} failed: ${error.message}`);
    }
  }
  return lastErr;
}

export async function sendVerificationCode(roleId, zoneId) {
  return withFallback(async (endpoint) => {
    const response = await axios.post(`${endpoint}/user/auth/send-vc`, { role_id: roleId, zone_id: zoneId });
    if (response.data.code === 0) return { success: true, message: 'VC sent to your in-game mail' };
    return { success: false, message: response.data.msg || 'Failed to send VC' };
  });
}

export async function loginWithVC(roleId, zoneId, vc) {
  const fallback = await withFallback(async (endpoint) => {
    const response = await axios.post(`${endpoint}/user/auth/login`, {
      role_id: roleId,
      zone_id: zoneId,
      vc: parseInt(vc),
    });
    if (response.data.code === 0) {
      return {
        success: true,
        jwt: response.data.data.jwt,
        token: response.data.data.token,
        roleId: response.data.data.roleid,
        zoneId: response.data.data.zoneid,
      };
    }
    return { success: false, message: response.data.msg || response.data.message || 'Failed to login with VC' };
  });

  if (!fallback.success && (fallback.statusCode === 500 || fallback.statusCode === 502)) {
    return { success: false, message: 'MLBB login service error (invalid code or upstream issue). Please try again with a fresh code.' };
  }
  if (!fallback.success && fallback.message?.includes('MLBB')) {
    return fallback;
  }
  return fallback.success ? fallback : { success: false, message: 'MLBB API temporarily unavailable. Please try again later.' };
}

export async function getUserInfo(jwt) {
  return withFallback(async (endpoint) => {
    const response = await axios.get(`${endpoint}/user/info`, {
      headers: { Authorization: `Bearer ${jwt}`, 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
      params: { lang: 'en', _t: Date.now() },
    });
    if (response.data.code === 0) return { success: true, data: response.data.data };
    return { success: false, message: response.data.msg || response.data.message || 'Failed to get user info' };
  });
}

export async function getUserStats(jwt) {
  return withFallback(async (endpoint) => {
    const response = await axios.get(`${endpoint}/user/stats`, {
      headers: { Authorization: `Bearer ${jwt}` },
      params: { lang: 'en', _t: Date.now() },
    });
    if (response.data.code === 0) return { success: true, data: response.data.data };
    return { success: false, message: response.data.msg || response.data.message || 'Failed to get user stats' };
  });
}

export async function startRegistration(sock, from, sender) {
  await ensureFiles();

  if (from.includes('@g.us')) {
    await sock.sendMessage(from, { text: '❌ MLBB registration can only be done in *private DMs*!\n\nPlease DM me with: *!mlbbreg*' });
    return;
  }

  const users = await loadUsers();
  if (users[sender]) {
    await sock.sendMessage(from, { text: '✅ You are already registered!' });
    return;
  }

  await sock.sendMessage(from, {
    text: '🔒 *SECURITY NOTICE*\n\n⚠️ *DSC will NEVER ask for:*\n• Your password\n• Your email\n• Personal information\n\nWe ONLY need your *Role ID* and *Zone ID* to authenticate you in-game.\n\n📌 *Please note:* DSC Community will never ask you for your passwords or emails.',
  });

  await sock.sendMessage(from, {
    text: '🎮 *MLBB Registration*\n\nTo register, please provide your *Role ID* and *Zone ID* in this format:\n\n`roleId zoneId`\n\n*Example:* `123456789 1234`\n\nYou can find these in your MLBB profile or by checking your account settings.',
  });

  const sessions = await loadSessions();
  sessions[sender] = { step: 'waiting_for_ids', timestamp: Date.now(), expires: Date.now() + 5 * 60 * 1000 };
  await saveSessions(sessions);
}

export async function handleRegResponse(sock, from, sender, message) {
  await ensureFiles();

  const sessions = await loadSessions();
  const session = sessions[sender];

  if (!session || Date.now() > session.expires) {
    delete sessions[sender];
    await saveSessions(sessions);
    await sock.sendMessage(from, { text: '⏱️ Session expired. Please use *!mlbbreg* again to start registration.' });
    return;
  }

  if (session.step === 'waiting_for_ids') {
    const parts = message.trim().split(/\s+/);
    if (parts.length < 2) {
      await sock.sendMessage(from, { text: '❌ Invalid format. Please provide both Role ID and Zone ID:\n\n`roleId zoneId`\n\nExample: `123456789 1234`' });
      return;
    }

    const [roleId, zoneId] = parts;
    if (isNaN(roleId) || isNaN(zoneId)) {
      await sock.sendMessage(from, { text: '❌ Role ID and Zone ID must be numbers. Please try again.' });
      return;
    }

    await sock.sendMessage(from, { text: '⏳ Sending verification code to your in-game mail...' });
    const sendResult = await sendVerificationCode(roleId, zoneId);

    if (!sendResult.success) {
      await sock.sendMessage(from, { text: `❌ ${sendResult.message}\n\nPlease check your Role ID and Zone ID and try again.` });
      delete sessions[sender];
      await saveSessions(sessions);
      return;
    }

    sessions[sender] = { step: 'waiting_for_vc', roleId, zoneId, timestamp: Date.now(), expires: Date.now() + 5 * 60 * 1000 };
    await saveSessions(sessions);

    await sock.sendMessage(from, { text: '✅ Verification code sent to your in-game mail!\n\n📧 *Check your MLBB in-game mailbox and reply with the 4-digit code.*\n\n⏱️ The code expires in 5 minutes.' });
    return;
  }

  if (session.step === 'waiting_for_vc') {
    const vc = message.trim();
    if (!/^\d{4}$/.test(vc)) {
      await sock.sendMessage(from, { text: '❌ Invalid format. The code should be 4 digits. Please try again.' });
      return;
    }

    await sock.sendMessage(from, { text: '⏳ Verifying your code and fetching profile...' });
    const loginResult = await loginWithVC(session.roleId, session.zoneId, vc);

    if (!loginResult.success) {
      await sock.sendMessage(from, { text: `❌ ${loginResult.message}` });
      delete sessions[sender];
      await saveSessions(sessions);
      return;
    }

    const [infoResult, statsResult] = await Promise.all([getUserInfo(loginResult.jwt), getUserStats(loginResult.jwt)]);

    if (!infoResult.success) {
      await sock.sendMessage(from, { text: '❌ Failed to fetch user information. Please try again.' });
      delete sessions[sender];
      await saveSessions(sessions);
      return;
    }

    const users = await loadUsers();
    users[sender] = {
      whatsappId: sender,
      roleId: session.roleId,
      zoneId: session.zoneId,
      name: infoResult.data.name || 'Unknown',
      level: infoResult.data.level || 0,
      rank_level: infoResult.data.rank_level || 0,
      avatar: infoResult.data.avatar || '',
      country: infoResult.data.reg_country || '',
      jwt: loginResult.jwt,
      token: loginResult.token || '',
      stats: statsResult.success ? statsResult.data : null,
      registeredAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    await saveUsers(users);

    let statsText = '';
    if (statsResult.success && statsResult.data) {
      const stats = statsResult.data;
      statsText = `\n\n📊 *Your Stats:*\n• Matches: ${stats.tc || 0}\n• Wins: ${stats.wc || 0}\n• Avg Survival: ${stats.as || 0}\n• MVP Count: ${stats.mvpc || 0}`;
    } else {
      statsText = '\n\n📊 *Stats:* Temporarily unavailable (MLBB stats service is down). Run *!mlbbpf* later to reload them.';
    }

    const rankText = infoResult.data.rank_level > 0 ? `Rank: *${getRankName(infoResult.data.rank_level)}* (${infoResult.data.rank_level})\n` : '';
    const levelText = infoResult.data.level > 0 ? `Level: *${infoResult.data.level}*\n` : '';
    const successText = `✅ *Registration Successful!*\n\n👤 *Profile Info:*\nName: *${infoResult.data.name || 'Unknown'}*\n${rankText}${levelText}${statsText}\n\n🎉 You can now use other MLBB commands!`;

    const avatarBuffer = await downloadAvatar(infoResult.data.avatar);
    if (avatarBuffer) {
      await sock.sendMessage(from, { image: avatarBuffer, caption: successText });
    } else {
      await sock.sendMessage(from, { text: successText });
    }

    delete sessions[sender];
    await saveSessions(sessions);
  }
}

export async function hasPendingSession(sender) {
  const sessions = await loadSessions();
  const session = sessions[sender];
  if (!session) return false;
  if (Date.now() > session.expires) {
    delete sessions[sender];
    await saveSessions(sessions);
    return false;
  }
  return true;
}
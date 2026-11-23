/* Pure, dependency-free policy. Also exported for unit tests. */
(function (root) {
  'use strict';
  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru');
  }
  function isLongAgo(status) {
    const s = normalize(status).replace(/[.,!]+$/g, '');
    return /^(был\(?а\)? давно|была давно|был давно|last seen a long time ago|був\(?ла\)? давно|був давно|була давно)$/iu.test(s);
  }
  // Recognize active statuses as well, so a list containing only recently
  // active users on its first screen can still be scrolled completely.
  function isActivityStatus(status) {
    const s = normalize(status).replace(/[.,!]+$/g, '');
    return isLongAgo(s) ||
      /^(?:был\(?а\)?|был|была) (?:недавно|в течение недели|в течение месяца|\d+ (?:секунду|секунды|секунд|минуту|минуты|минут|час|часа|часов|день|дня|дней|неделю|недели|недель) назад)$/iu.test(s) ||
      /^(?:last seen (?:recently|within a week|within a month|\d+ (?:second|seconds|minute|minutes|hour|hours|day|days) ago)|online|в сети)$/iu.test(s);
  }
  function isProtected(raw) {
    const s = normalize(raw);
    return /(?:^|[^\p{L}])(владелец|администратор|создатель|owner|creator|administrator|admin)(?:$|[^\p{L}])/iu.test(s);
  }
  function makeCandidate(name, status, context) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    status = String(status || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 140 || !isLongAgo(status) || isProtected(context)) return null;
    const key = normalize(name); // Not a user ID: duplicate names MUST stay unverified.
    return { key, name, status, evidence: 'Виден статус в интерфейсе', capturedAt: new Date().toISOString(), identityVerified: false };
  }
  // The visible user's identity is taken only from one unambiguous Telegram Web row.
  // Names, usernames and avatar labels are NEVER converted into numeric IDs.
  function extractUserId(row) {
    if (!row || !row.querySelectorAll) return '';
    const ids=new Set();
    for (const el of [row, ...row.querySelectorAll('[data-peer-id],[data-user-id]')]) {
      const s=el.getAttribute('data-user-id')||el.getAttribute('data-peer-id')||'';
      if (/^[1-9]\d{4,17}$/.test(s)) ids.add(s);
    }
    return ids.size===1 ? [...ids][0] : '';
  }
  function canRemove(candidate, now=Date.now(), maxAgeMs=180000) {
    if (!candidate || !/^[1-9]\d{4,17}$/.test(String(candidate.userId||'')) || !isLongAgo(candidate.status)) return false;
    const t=Date.parse(candidate.capturedAt||'');
    return Number.isFinite(t) && t<=now && now-t <=maxAgeMs;
  }
  // "Last seen a long time ago" is a Telegram-wide, privacy-dependent indicator,
  // NOT evidence that a user has stopped reading a particular channel.
  // Consequently, automatic removal requires an explicit local flag and a
  // second, fresh observation at least 30 days later for the SAME numeric ID.
  const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
  function canRemoveAfterGrace(saved, observed, now=Date.now()) {
    if (!canRemove(observed, now) || !saved || saved.removed) return false;
    if (String(saved.userId||'') !== String(observed.userId||'')) return false;
    const t=Date.parse(saved.flaggedAt||'');
    return Number.isFinite(t) && t <= now && (now - t) >= GRACE_MS;
  }
  function preserveReviewFlag(previous, observation) {
    if (!previous || String(previous.userId||'') !== String(observation.userId||'') ||
        !observation.userId) return observation;
    const flaggedAt=Date.parse(previous.flaggedAt||'');
    return {...observation,
      flaggedAt:Number.isFinite(flaggedAt) ? new Date(flaggedAt).toISOString() : '',
      removed:Boolean(previous.removed)};
  }
  function csvCell(value) {
    let s = String(value ?? '');
    // Prevent spreadsheet formula evaluation (incl. leading Unicode whitespace).
    if (/^[\s\uFEFF\u200B\u200C\u200D]*[=+@\-\t\r]/u.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function toCSV(candidates, channel = "") {
    const header = ['Канал (указан вручную)', 'Имя', 'Telegram ID (если найден)', 'Видимый статус', 'Время фиксации (UTC)', 'Отметка на повторную проверку (UTC)', 'Повторная проверка не ранее (UTC)', 'Удалён?', 'Примечание'];
    const rows = candidates.map(x => [channel,x.name,x.userId||'',x.status,x.capturedAt,x.flaggedAt||'', x.flaggedAt && Number.isFinite(Date.parse(x.flaggedAt)) ? new Date(Date.parse(x.flaggedAt)+GRACE_MS).toISOString() : '',x.removed?'да':'нет','Статус Telegram — не доказательство отсутствия в канале; удаление только после явной отметки и повторной проверки через 30 суток.']);
    return '\ufeff' + [header,...rows].map(row=>row.map(csvCell).join(';')).join('\r\n') + '\r\n';
  }
  const api = { normalize, isLongAgo, isActivityStatus, isProtected, makeCandidate, extractUserId, canRemove, canRemoveAfterGrace, preserveReviewFlag, GRACE_MS, csvCell, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChannelCleanerPolicy = api;
})(typeof window !== 'undefined' ? window : globalThis);

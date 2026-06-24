'use strict';
/* Shared date / formatting / status helpers (server side). */

const DAY = 86400000;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const pad = (n) => String(n).padStart(2, '0');
function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDateTime(d) { return fmtDate(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function fmtMonth(d) { return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function daysBetween(a, b) { return Math.round((stripTime(b) - stripTime(a)) / DAY); }
function monthKey(d) { return d.getFullYear() * 12 + d.getMonth(); }

// Parse a stored 'YYYY-MM-DD' (or full ISO) into a local Date (noon to dodge TZ rollover).
function parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); }
  return new Date(s);
}

// status from a member row (snake_case) given fee policy + reference "today"
function statusOf(m, policy, today) {
  today = today || new Date();
  if (!m.last_payment) return 'Not enrolled';
  if (m.suspended) return 'Suspended';
  const due = addDays(parseDate(m.last_payment), policy.cycleDays);
  const dleft = daysBetween(today, due);
  if (dleft < 0) return 'Overdue';
  if (dleft <= policy.dueSoonDays) return 'Due soon';
  return 'Paid';
}
function daysOverdue(m, policy, today) {
  today = today || new Date();
  if (!m.last_payment) return 0;
  const due = addDays(parseDate(m.last_payment), policy.cycleDays);
  return Math.max(0, daysBetween(due, today));
}

module.exports = { DAY, MONTHS, pad, fmtDate, fmtDateTime, fmtMonth, addDays, stripTime, daysBetween, monthKey, parseDate, statusOf, daysOverdue };

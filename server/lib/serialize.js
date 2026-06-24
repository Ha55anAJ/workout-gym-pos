'use strict';
/* Convert DB rows (snake_case) into the shapes the frontend expects.
   Member id is the human code ("A001"); fid is the numeric primary key. */

function memberOut(r) {
  if (!r) return null;
  return {
    id: r.code, fid: r.id, name: r.name, phone: r.phone, type: r.type,
    joinDate: r.join_date, lastPayment: r.last_payment || null,
    suspended: !!r.suspended, fingerprint: !!r.fingerprint,
    fingerprintSamples: r.fp_samples || 0, fingerprintEnrolledAt: r.fp_enrolled_at || null
  };
}
function paymentOut(r) {
  return { id: r.code, date: r.date, memberId: r.member_code, memberName: r.member_name,
    amount: r.amount, month: r.month, method: r.method, notes: r.notes || '', recordedBy: r.recorded_by };
}
function expenseOut(r) {
  return { id: r.code, date: r.date, category: r.category, description: r.description, amount: r.amount, recordedBy: r.recorded_by };
}
function staffOut(r) {
  return { id: r.code, name: r.name, role: r.role, phone: r.phone, salary: r.salary, status: r.status, join: r.join_date };
}
function userOut(r) {
  return { name: r.name, role: r.role, email: r.email, last: r.last_login };
}
function checkinOut(r) {
  return { at: r.at, memberId: r.member_code, memberName: r.member_name };
}

module.exports = { memberOut, paymentOut, expenseOut, staffOut, userOut, checkinOut };

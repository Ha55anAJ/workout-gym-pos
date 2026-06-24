'use strict';
const db = require('../db');
const U = require('./util');
const { checkinOut } = require('./serialize');

// Record an attendance row for a member (snake_case row) at "now".
function logCheckin(member) {
  const at = U.fmtDateTime(new Date());
  db.prepare('INSERT INTO checkins(at,member_id,member_code,member_name) VALUES (?,?,?,?)')
    .run(at, member.id, member.code, member.name);
  return checkinOut({ at, member_code: member.code, member_name: member.name });
}

module.exports = { logCheckin };

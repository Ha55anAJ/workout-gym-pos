'use strict';
/* ---------------------------------------------------------------------------
   Deterministic seed data — gives a brand-new install the same realistic,
   fully-populated look as the sales demo. Generated relative to "today" so
   statuses (paid / due soon / overdue) are current on first run.

   CLI:
     node server/seed.js            -> seed only if the database is empty
     node server/seed.js --force    -> seed only if empty (same as above)
     node server/seed.js --reset    -> wipe all tables and re-seed
   ------------------------------------------------------------------------- */
const db = require('./db');
const U = require('./lib/util');

const CLEAN_SETTINGS = {
  gym: { name: 'My Gym', address: '', city: '', phone: '', mobile: '', email: '' },
  tiers: { Basic: 3000, Premium: 5000, Student: 2000, Family: 8000 },
  policy: { cycleDays: 30, dueSoonDays: 5 },
  version: '1.0.0'
};
function insertSettings(s) {
  const set = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');
  set.run('gym', JSON.stringify(s.gym));
  set.run('tiers', JSON.stringify(s.tiers));
  set.run('policy', JSON.stringify(s.policy));
  set.run('version', s.version);
}
function hasSettings() { return !!db.prepare("SELECT 1 FROM settings WHERE key='gym'").get(); }

const TIERS = { Basic: 3000, Premium: 5000, Student: 2000, Family: 8000 };
const TIER_NAMES = ['Basic', 'Premium', 'Student', 'Family'];
const METHODS = ['Cash', 'Card', 'Easypaisa', 'JazzCash'];
const FIRST = ['Ali','Sana','Bilal','Ayesha','Hassan','Mariam','Faisal','Zainab','Omar','Fatima',
  'Usman','Hira','Kamran','Nida','Imran','Sara','Tariq','Rabia','Saad','Komal',
  'Adeel','Maha','Junaid','Aliya','Hamza','Sadia','Waleed','Areeba','Asad','Iqra',
  'Noman','Beenish','Shahzad','Mehwish','Danish','Sumbal','Rizwan','Anum','Zeeshan','Hina'];
const LAST = ['Khan','Ahmed','Malik','Sheikh','Iqbal','Hussain','Siddiqui','Raza','Butt','Qureshi',
  'Chaudhry','Abbasi','Farooq','Javed','Aslam','Nawaz','Shah','Mughal','Rana','Baig'];

// deterministic PRNG so the seed is identical every install
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build() {
  const rnd = mulberry32(987654321);
  const ri = (a, b) => Math.floor(rnd() * (b - a + 1)) + a;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const TODAY = U.stripTime(new Date());

  // ---- staff ----
  const staff = [
    { code: 'S01', name: 'Faisal Tariq', role: 'Owner',        phone: '+92 300 2148860', salary: 0,     status: 'active',   join: U.addDays(TODAY, -1180) },
    { code: 'S02', name: 'Sana Khan',    role: 'Receptionist', phone: '+92 301 2233445', salary: 35000, status: 'active',   join: U.addDays(TODAY, -640) },
    { code: 'S03', name: 'Nadia Farooq', role: 'Receptionist', phone: '+92 333 7788991', salary: 32000, status: 'on leave', join: U.addDays(TODAY, -410) },
    { code: 'S04', name: 'Kamran Malik', role: 'Trainer',      phone: '+92 321 5566778', salary: 45000, status: 'active',   join: U.addDays(TODAY, -880) },
    { code: 'S05', name: 'Usman Sheikh', role: 'Trainer',      phone: '+92 345 9911223', salary: 42000, status: 'active',   join: U.addDays(TODAY, -520) },
    { code: 'S06', name: 'Akram Din',    role: 'Cleaner',      phone: '+92 312 4455667', salary: 22000, status: 'active',   join: U.addDays(TODAY, -300) }
  ];
  const RECORDERS = ['Faisal Tariq', 'Sana Khan', 'Nadia Farooq'];

  const users = [
    { name: 'Faisal Tariq', role: 'Owner',        email: 'faisal@demogym.pk', last: U.fmtDate(TODAY) },
    { name: 'Sana Khan',    role: 'Receptionist', email: 'sana@demogym.pk',   last: U.fmtDate(TODAY) },
    { name: 'Nadia Farooq', role: 'Receptionist', email: 'nadia@demogym.pk',  last: U.fmtDate(U.addDays(TODAY, -6)) }
  ];

  // ---- members ----
  const members = [];
  const usedNames = new Set();
  let idNum = 0;
  for (let i = 0; i < 160; i++) {
    idNum += ri(1, 2);
    const code = 'A' + String(idNum).padStart(3, '0');
    let first, last, name, guard = 0;
    do {
      first = FIRST[(i + guard) % FIRST.length];
      last = LAST[(i * 13 + 5 + guard * 7) % LAST.length];
      name = first + ' ' + last; guard++;
    } while (usedNames.has(name) && guard < 500);
    usedNames.add(name);

    const type = pick(TIER_NAMES);
    let joinDaysAgo, bucket;
    if (i < 10) { joinDaysAgo = ri(2, 18); bucket = 'paid'; }
    else {
      joinDaysAgo = ri(30, 540);
      const r = rnd();
      if (r < 0.60) bucket = 'paid';
      else if (r < 0.72) bucket = 'duesoon';
      else if (r < 0.90) bucket = 'overdue';
      else bucket = 'never';
    }
    const joinDate = U.addDays(TODAY, -joinDaysAgo);
    const enrolled = bucket !== 'never';
    members.push({
      code, name, type, joinDate, lastPayment: null, suspended: 0,
      fingerprint: enrolled ? 1 : 0, fpSamples: enrolled ? 3 : 0, fpEnrolledAt: enrolled ? joinDate : null,
      phone: '+92 3' + ri(0, 4) + ri(0, 9) + ' ' + String(ri(1000000, 9999999)),
      _bucket: bucket
    });
  }

  // ---- payments (monthly history per member) ----
  const payments = [];
  let payId = 1, paidToday = 0;
  members.forEach((m, idx) => {
    const rate = TIERS[m.type];
    let lastAgo;
    if (m._bucket === 'paid') lastAgo = ri(0, 22);
    else if (m._bucket === 'duesoon') lastAgo = ri(26, 30);
    else if (m._bucket === 'overdue') lastAgo = ri(34, 160);
    else return; // never paid
    const joinAgo = U.daysBetween(m.joinDate, TODAY);
    lastAgo = Math.min(lastAgo, joinAgo);
    if (m._bucket === 'paid' && paidToday < 8 && idx % 17 === 0) { lastAgo = 0; paidToday++; }

    const lastPay = U.addDays(TODAY, -lastAgo);
    m.lastPayment = lastPay;
    let d = new Date(lastPay), guard = 0;
    while (d >= m.joinDate && guard < 13) {
      const discount = (m.type === 'Family' && chance(0.25)) ? 500 : 0;
      payments.push({
        code: 'P' + String(payId++).padStart(4, '0'), date: new Date(d),
        memberCode: m.code, memberName: m.name, amount: rate - discount,
        month: U.fmtMonth(d), method: pick(METHODS), recordedBy: pick(RECORDERS)
      });
      d = U.addDays(d, -ri(28, 31)); guard++;
    }
  });

  // ---- expenses (12 months) ----
  const expenses = [];
  let expId = 1;
  const paidStaff = staff.filter((s) => s.role !== 'Owner');
  for (let mAgo = 11; mAgo >= 0; mAgo--) {
    const base = new Date(TODAY.getFullYear(), TODAY.getMonth() - mAgo, 1);
    const y = base.getFullYear(), mo = base.getMonth();
    const add = (day, category, description, amount) =>
      expenses.push({ code: 'E' + String(expId++).padStart(4, '0'), date: new Date(y, mo, day), category, description, amount, recordedBy: 'Faisal Tariq' });
    add(1, 'Rent', 'Monthly premises rent', 80000);
    paidStaff.forEach((s) => add(3, 'Salaries', 'Salary — ' + s.name + ' (' + s.role + ')', s.salary));
    add(6, 'Utilities', 'Electricity (K-Electric)', ri(28000, 52000));
    add(6, 'Utilities', 'Water board charges', ri(2500, 4000));
    add(7, 'Utilities', 'Internet (fibre)', 8500);
    add(ri(8, 20), 'Supplies', pick(['Cleaning supplies', 'Towels & toiletries', 'Protein bar stock', 'Front-desk stationery']), ri(6000, 16000));
    if (chance(0.5)) add(ri(10, 24), 'Maintenance', pick(['Treadmill belt service', 'AC servicing', 'Plumbing repair', 'Cable machine fix']), ri(5000, 22000));
    if (chance(0.4)) add(ri(5, 25), 'Marketing', pick(['Instagram ad campaign', 'Printed flyers', 'Ramzan promo banners', 'Referral rewards']), ri(8000, 30000));
    if (chance(0.3)) add(ri(12, 26), 'Equipment', pick(['Dumbbell set 5-25kg', 'Yoga mats (20)', 'Olympic barbell', 'Bench press station']), ri(18000, 95000));
    if (chance(0.15)) add(ri(14, 27), 'Other', pick(['Bank charges', 'Misc. petty cash', 'Eid bonus — staff']), ri(3000, 18000));
  }

  // ---- check-ins (90 days) ----
  const checkins = [];
  const activeMembers = members.filter((m) => m._bucket !== 'never');
  for (let dAgo = 89; dAgo >= 0; dAgo--) {
    const day = U.addDays(TODAY, -dAgo);
    const dow = day.getDay();
    const weekend = dow === 0 || dow === 6;
    let count = weekend ? ri(20, 33) : ri(34, 56);
    if (dAgo === 0) count = 41;
    for (let i = 0; i < count; i++) {
      const m = pick(activeMembers);
      const hr = chance(0.62) ? ri(17, 21) : ri(6, 16);
      checkins.push({ at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hr, ri(0, 59)), memberCode: m.code, memberName: m.name });
    }
  }

  const settings = {
    gym: { name: 'Demo Gym', address: 'Plot 14-C, Khayaban-e-Ittehad, DHA Phase 6', city: 'Karachi', phone: '+92 21 3584 9001', mobile: '+92 300 2148860', email: 'support@demogym.pk' },
    tiers: TIERS,
    policy: { cycleDays: 30, dueSoonDays: 5 },
    version: '1.0.0'
  };

  return { staff, users, members, payments, expenses, checkins, settings };
}

function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM members').get().n === 0;
}

function wipe() {
  db.exec("DELETE FROM checkins; DELETE FROM payments; DELETE FROM expenses; DELETE FROM fingerprints; DELETE FROM members; DELETE FROM staff; DELETE FROM users; DELETE FROM settings;");
}

function insertAll(data) {
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)');
  setSetting.run('gym', JSON.stringify(data.settings.gym));
  setSetting.run('tiers', JSON.stringify(data.settings.tiers));
  setSetting.run('policy', JSON.stringify(data.settings.policy));
  setSetting.run('version', data.settings.version);

  const insStaff = db.prepare('INSERT INTO staff(code,name,role,phone,salary,status,join_date) VALUES (@code,@name,@role,@phone,@salary,@status,@join_date)');
  data.staff.forEach((s) => insStaff.run({ code: s.code, name: s.name, role: s.role, phone: s.phone, salary: s.salary, status: s.status, join_date: U.fmtDate(s.join) }));

  const insUser = db.prepare('INSERT INTO users(name,role,email,last_login) VALUES (@name,@role,@email,@last)');
  data.users.forEach((u) => insUser.run(u));

  const insMember = db.prepare('INSERT INTO members(code,name,phone,type,join_date,last_payment,suspended,fingerprint,fp_samples,fp_enrolled_at) VALUES (@code,@name,@phone,@type,@join_date,@last_payment,@suspended,@fingerprint,@fp_samples,@fp_enrolled_at)');
  data.members.forEach((m) => insMember.run({
    code: m.code, name: m.name, phone: m.phone, type: m.type,
    join_date: U.fmtDate(m.joinDate), last_payment: m.lastPayment ? U.fmtDate(m.lastPayment) : null,
    suspended: m.suspended, fingerprint: m.fingerprint, fp_samples: m.fpSamples,
    fp_enrolled_at: m.fpEnrolledAt ? U.fmtDate(m.fpEnrolledAt) : null
  }));
  const codeToId = {};
  db.prepare('SELECT id, code FROM members').all().forEach((r) => (codeToId[r.code] = r.id));

  const insPay = db.prepare('INSERT INTO payments(code,date,member_id,member_code,member_name,amount,month,method,recorded_by) VALUES (@code,@date,@member_id,@member_code,@member_name,@amount,@month,@method,@recorded_by)');
  data.payments.forEach((p) => insPay.run({ code: p.code, date: U.fmtDate(p.date), member_id: codeToId[p.memberCode], member_code: p.memberCode, member_name: p.memberName, amount: p.amount, month: p.month, method: p.method, recorded_by: p.recordedBy }));

  const insExp = db.prepare('INSERT INTO expenses(code,date,category,description,amount,recorded_by) VALUES (@code,@date,@category,@description,@amount,@recorded_by)');
  data.expenses.forEach((e) => insExp.run({ code: e.code, date: U.fmtDate(e.date), category: e.category, description: e.description, amount: e.amount, recorded_by: e.recordedBy }));

  const insChk = db.prepare('INSERT INTO checkins(at,member_id,member_code,member_name) VALUES (@at,@member_id,@member_code,@member_name)');
  data.checkins.forEach((c) => insChk.run({ at: U.fmtDateTime(c.at), member_id: codeToId[c.memberCode], member_code: c.memberCode, member_name: c.memberName }));
}

function seedIfEmpty() {
  if (hasSettings()) return false;
  db.transaction(() => insertSettings(CLEAN_SETTINGS))();
  return true;
}

function resetClean() {
  db.transaction(() => { wipe(); insertSettings(CLEAN_SETTINGS); })();
}

function loadDemo() {
  const data = build();
  db.transaction(() => { wipe(); insertAll(data); })();
}

module.exports = { seedIfEmpty, resetClean, loadDemo, build };

// CLI
if (require.main === module) {
  (async () => {
    await db.init();
    const arg = process.argv[2];
    if (arg === '--demo') { loadDemo(); console.log('Loaded sample demo data.'); }
    else if (arg === '--reset') { resetClean(); console.log('Reset to a clean, empty install.'); }
    else { const did = seedIfEmpty(); console.log(did ? 'Initialised a clean install.' : 'Already initialised.'); }
    db.close();
  })();
}

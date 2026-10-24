// Shifoat Face ID (keldi-ketdi/davomat) tizimi — "shifoat-ish-keldi-ketdi"
// Firebase loyihasi — bu ilovadan BUTUNLAY ALOHIDA, o'g'il (firdavsomnibook)
// boshqaradigan tizim. 2026-10-06: Shoxrux so'rovi bilan — ish vaqti va
// haftalik dam olish kuni endi shu ilovada QAYTA QO'LDA kiritilmaydi, Face
// ID tizimidan O'QIB ko'rsatiladi (ism bo'yicha moslashtirib). Faqat
// O'QISH — bu yerdan hech narsa Face ID tomonga yozilmaydi.
//
// MUHIM #1 (aniqlangan): Face ID tomonidagi Firestore qoidalari o'qishni
// FAQAT "signed-in" (tizimga kirgan) sessiyaga ruxsat beradi — xuddi
// kioskning o'zi ham login so'ramasdan ANONIM kirish qilib o'qiganidek
// (firebaseAdapter.js:ensureKioskSession o'sha tomonda). Shu sababli bu
// yerda ham aynan shu — signInAnonymously — ishlatiladi.
//
// MUHIM #2 (aniqlangan, birinchi urinish xato edi): ish vaqti/dam olish
// kuni "employees" hujjatining o'zida EMAS — alohida "schedules"
// kolleksiyasida saqlanadi, har bir xodim uchun SANAGA BOG'LIQ
// versiyalar bilan: { employeeId, effectiveFrom (masalan "2000-01-01"),
// workStart, workEnd, workStart2, workEnd2, weeklyRestDay, ... }. Bir
// xodimning bir nechta versiyasi bo'lishi mumkin (ish vaqti o'zgarganda
// yangi versiya qo'shiladi); "hozirgi" versiya — effectiveFrom'i bugungi
// sanadan oshmagan versiyalar orasida ENG SO'NGGISI (Face ID ilovasining
// o'z mantig'i — getScheduleForDate() — aynan shunday ishlaydi).
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const FACE_ID_FIREBASE_CONFIG = {
  apiKey: "AIzaSyATounb2tfhnaytz7RofTIUGT99deEBOSs",
  authDomain: "shifoat-ish-keldi-ketdi.firebaseapp.com",
  projectId: "shifoat-ish-keldi-ketdi",
  storageBucket: "shifoat-ish-keldi-ketdi.firebasestorage.app",
  messagingSenderId: "786669171503",
  appId: "1:786669171503:web:da8a185e05f7715ddaa7da",
};

const REST_DAY_NAMES = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

function getFaceIdApp() {
  const existing = getApps().find((a) => a.name === "faceid-readonly");
  return existing || initializeApp(FACE_ID_FIREBASE_CONFIG, "faceid-readonly");
}

// Face ID loyihasiga anonim kirishni ta'minlaydi (kiosk qilgani kabi).
async function ensureFaceIdAuth(app) {
  const auth = getAuth(app);
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth;
}

async function getFaceIdDb() {
  const app = getFaceIdApp();
  await ensureFaceIdAuth(app);
  return getFirestore(app);
}

function normalizeName(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatTimeRange(start, end) {
  if (!start || !end) return "";
  return `${start}-${end}`;
}

// Bugungi sanani Face ID tizimidagi "effectiveFrom" bilan bir xil
// formatda ("YYYY-MM-DD") qaytaradi — qurilmaning mahalliy vaqtiga ko'ra.
function todayDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Bitta xodimning schedule versiyalari ichidan "hozirgi" (effectiveFrom'i
// bugungi sanadan oshmagan versiyalar orasida eng so'nggisi) versiyani
// tanlaydi — Face ID ilovasining o'zidagi getScheduleForDate() bilan bir
// xil mantiq.
function pickCurrentVersion(versions, dateKey) {
  const applicable = versions.filter((v) => v.effectiveFrom && v.effectiveFrom <= dateKey);
  const pool = applicable.length > 0 ? applicable : versions;
  if (pool.length === 0) return null;
  return pool.slice().sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
}

// 23.10.2026: Face ID saytidagi "Haftalik istisno" (weekdayOverrides) —
// ayrim hafta kunida boshqa ish vaqti. Sayt bilan bir xil mantiq
// (0=Dushanba ... 6=Yakshanba).
function applyWeekdayOverride(version, dateKey) {
  if (!version || !version.weekdayOverrides || !dateKey) return version;
  const [y, m, d] = String(dateKey).split("-").map(Number);
  const key = String((new Date(y, m - 1, d).getDay() + 6) % 7);
  const override = version.weekdayOverrides[key];
  if (!override) return version;
  const workStart = override.workStart || version.workStart;
  const workEnd = override.workEnd || version.workEnd;
  const overridesSecond = "workStart2" in override || "workEnd2" in override;
  const baseStart2 = version.workStart2 || null;
  const baseEnd2 = version.workEnd2 || null;
  const workStart2 = overridesSecond ? override.workStart2 || null : baseStart2;
  const workEnd2 = overridesSecond ? override.workEnd2 || null : baseEnd2;
  return { ...version, workStart, workEnd, workStart2, workEnd2, weekdayOverrideApplied: key };
}
// Shu kun uchun amaldagi jadval (versiya + haftalik istisno).
function pickScheduleForDate(versions, dateKey) {
  return applyWeekdayOverride(pickCurrentVersion(versions, dateKey), dateKey);
}

// Bitta schedule versiyasidan ko'rsatish uchun tayyor matnlarni hosil
// qiladi: ish vaqti (bitta yoki ikkita smena bo'lsa ikkalasi ham) va dam
// olish kuni nomi.
function formatSchedule(rec) {
  if (!rec) return null;
  const ranges = [formatTimeRange(rec.workStart, rec.workEnd), formatTimeRange(rec.workStart2, rec.workEnd2)].filter(Boolean);
  const workHoursText = ranges.length > 0 ? ranges.join(" va ") : "";
  const restDayIdx = typeof rec.weeklyRestDay === "number" ? rec.weeklyRestDay : -1;
  const restDayText = restDayIdx >= 0 && restDayIdx < REST_DAY_NAMES.length ? REST_DAY_NAMES[restDayIdx] : "";
  // restDayIdx ham qaytariladi (0=Dushanba...6=Yakshanba, -1=belgilanmagan)
  // — kalendarda haftaning shu kunini qizil rangda belgilash uchun kerak
  // (App.jsx: "Kech qolganlik jarimasi" ekrani).
  // 17.10.2026: Face ID'da endi bir nechta haftalik dam kuni va "2 haftada
  // 1 marta" dam ham bor — Buyruqlar kitobi (o'rinbosar) uchun.
  let restDays = [];
  if (Array.isArray(rec.weeklyRestDays)) restDays = rec.weeklyRestDays.map(Number).filter((n) => n >= 0 && n <= 6);
  else if (restDayIdx >= 0) restDays = [restDayIdx];
  const biweeklyRestFrom = /^\d{4}-\d{2}-\d{2}$/.test(rec.biweeklyRestFrom || "") ? rec.biweeklyRestFrom : null;
  return { workHoursText, restDayText, restDayIdx, restDays, biweeklyRestFrom, workStart: rec.workStart || "" };
}

// Shu jadval bo'yicha berilgan kun (YYYY-MM-DD) dam kunimi.
export function isFaceIdRestDay(sched, dateKey) {
  if (!sched || !dateKey) return false;
  const [y, m, d] = dateKey.split("-").map(Number);
  const idx = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=Du
  if (Array.isArray(sched.restDays) && sched.restDays.includes(idx)) return true;
  if (sched.biweeklyRestFrom) {
    const [a, b, c] = sched.biweeklyRestFrom.split("-").map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(a, b - 1, c)) / 864e5);
    if (((diff % 14) + 14) % 14 === 0) return true;
  }
  return false;
}

// Face ID tizimidagi BARCHA xodimlarning hozirgi ish vaqti/dam olish
// kunini bir yo'la o'qib, ism (kichik harf, probelsiz solishtirish)
// bo'yicha kalitlangan xarita qilib qaytaradi: { [normalizedName]:
// {workHoursText, restDayText} }. Internet yo'q yoki Face ID loyihasi
// ruxsat bermasa — jim xato qaytaradi (bo'sh xarita), ilova buzilmaydi,
// faqat bu ma'lumot ko'rsatilmay qoladi.
export async function fetchFaceIdSchedules() {
  try {
    const db = await getFaceIdDb();
    const [employeesSnap, schedulesSnap] = await Promise.all([
      getDocs(collection(db, "employees")),
      getDocs(collection(db, "schedules")),
    ]);

    const nameByEmployeeId = {};
    employeesSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const key = normalizeName(data.firstName || data.name);
      if (key) nameByEmployeeId[docSnap.id] = key;
    });

    const versionsByEmployeeId = {};
    schedulesSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (!data.employeeId) return;
      (versionsByEmployeeId[data.employeeId] ||= []).push(data);
    });

    const dateKey = todayDateKey();
    const map = {};
    for (const [employeeId, nameKey] of Object.entries(nameByEmployeeId)) {
      const versions = versionsByEmployeeId[employeeId];
      if (!versions || versions.length === 0) continue;
      const current = pickCurrentVersion(versions, dateKey);
      const formatted = formatSchedule(current);
      if (formatted) map[nameKey] = formatted;
    }
    return map;
  } catch (e) {
    return {};
  }
}

// 2026-10-06 (xodimlarning ishga KECH QOLGANLIK jarimasi, Shoxrux so'rovi):
// "1 daqiqa kechiriladi, har bir daqiqaga 1000 so'm" — bu hisob-kitob
// AYNAN shu qoidalar bilan Face ID tizimining o'zida (kiosk check-in
// vaqtida) avtomatik bajariladi va "attendance" hujjatiga lateMinutes /
// latePenalty maydonlari sifatida yozib qo'yiladi (settings: late_grace_
// minutes=1, late_penalty_per_minute=1000 — kiosk tomonidan). Shuning
// uchun bu yerda hisoblash QAYTARILMAYDI — faqat shu tayyor natija O'QIB
// ko'rsatiladi. BU — "Vazifalar jarimasi"dan (bonusPenaltyEntries) BUTUNLAY
// ALOHIDA tizim, ularning summalari hech qachon qo'shilmaydi.
function checkInToHHMM(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") {
    const m = v.match(/(\d{1,2}):(\d{2})/);
    if (m && !/^\d{4}-\d{2}-\d{2}T/.test(v)) return `${m[1].padStart(2, "0")}:${m[2]}`;
    const d = new Date(v);
    if (!isNaN(d)) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
  }
  let d = null;
  if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v.toDate === "function") d = v.toDate();
  else if (typeof v.seconds === "number") d = new Date(v.seconds * 1000);
  if (!d || isNaN(d)) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function hhmmToMin(t) {
  const m = (t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Kelgan vaqtga mos smena boshlanishini tanlaydi (ikki smena bo'lsa).
function minToHHMM(m) {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

// Kelgan vaqtga mos smena boshlanishini tanlaydi. Jadvaldagi vaqt kelgan
// vaqt va kechikish daqiqasiga mos kelmasa (1 daqiqa kechirim hisobga
// olinadi) — kelgan vaqtdan kechikishni ayirib, haqiqiy boshlanish vaqti
// hisoblanadi (noto'g'ri smenani ko'rsatmaslik uchun).
function pickShiftStart(sched, checkIn, lateMinutes) {
  const ci = hhmmToMin(checkIn);
  const starts = sched ? [sched.workStart, sched.workStart2].filter(Boolean) : [];
  if (ci == null) return starts[0] || "";
  let best = "";
  let bestDiff = Infinity;
  for (const st of starts) {
    const sm = hhmmToMin(st);
    if (sm == null) continue;
    const diff = Math.abs(ci - sm - lateMinutes);
    if (diff < bestDiff) { bestDiff = diff; best = st; }
  }
  if (best && bestDiff <= 1) return best;
  return minToHHMM(ci - lateMinutes);
}

// 2026-10-10: ishga ERTA kelish (belgilangan ish vaqtidan kamida 30 daqiqa
// oldin) ham shu "attendance" ma'lumotidan aniqlanadi. Bir kunda bir nechta
// yozuv bo'lsa — eng birinchi kelgan vaqt olinadi va BIRINCHI smena
// boshlanishi bilan solishtiriladi. Dam olish kunida kelgan bo'lsa —
// hisobga olinmaydi. 3 soatdan ortiq "erta" — ehtimol boshqa smena yoki
// xato skan, shuning uchun hisobga olinmaydi.
export const EARLY_MIN_MINUTES = 30;
const EARLY_MAX_MINUTES = 180;
// 2026-10-10: ish vaqtidan kamida 60 daqiqa KEYIN ketish. 5 soatdan ortig'i —
// ehtimol chiqishda belgilanmay qolgan / xato, hisobga olinmaydi.
export const LATE_LEAVE_MIN_MINUTES = 60;
const LATE_LEAVE_MAX_MINUTES = 300;

// Ketish vaqti Face ID'da qaysi maydonda saqlanishi aniq emas — eng ko'p
// uchraydigan nomlarning birinchi to'ldirilgani olinadi.
function pickCheckOut(data) {
  const v = data.checkOutTime ?? data.checkoutTime ?? data.checkOut ?? data.checkout ?? data.leaveTime ?? data.exitTime ?? data.outTime ?? data.leftAt;
  if (v != null && v !== "") return checkInToHHMM(v);
  const kind = String(data.type || data.action || data.kind || data.direction || "");
  if (/out|chiq|ket/i.test(kind)) return checkInToHHMM(data.time ?? data.timestamp ?? data.createdAt);
  return "";
}

function weekdayIdxMon0(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// 2026-10-10: avval "attendance" kolleksiyasi BUTUNLAY (barcha oylar) har
// 10 daqiqada har bir qurilmadan o'qilardi — kunlar o'tgan sari bu Face ID
// loyihasining bepul kunlik o'qish limitini (50 000) tugatib, kioskning
// o'zini ham to'xtatib qo'yishi mumkin edi. Endi faqat kerakli sanadan
// (fromDateKey, "YYYY-MM-DD") boshlab o'qiladi.
export async function fetchFaceIdAttendance(fromDateKey) {
  try {
    const db = await getFaceIdDb();
    const attendanceRef = collection(db, "attendance");
    const [employeesSnap, attendanceSnap, schedulesSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "employees")),
      getDocs(fromDateKey ? query(attendanceRef, where("dateKey", ">=", fromDateKey)) : attendanceRef),
      getDocs(collection(db, "schedules")).catch(() => null),
      // 24.10.2026: admin ismlari (tahrirlagan kim) — ruxsat bo'lmasa jim o'tadi.
      getDocs(collection(db, "users")).catch(() => null),
    ]);
    const userNames = {};
    if (usersSnap) usersSnap.forEach((d) => { const u = d.data() || {}; userNames[d.id] = u.fullName || u.username || ""; });
    // 24.10.2026: davomat QO'LDA o'zgartirilgan yozuvlar (kelish/ketish vaqti).
    const edits = [];
    const toMs = (v) => {
      if (v == null || v === "") return null;
      if (typeof v === "string") { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
      if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
      if (typeof v.toDate === "function") return v.toDate().getTime();
      if (typeof v.seconds === "number") return v.seconds * 1000;
      return null;
    };
    const versionsByEmployeeId = {};
    if (schedulesSnap) {
      schedulesSnap.forEach((d) => {
        const v = d.data() || {};
        if (v.employeeId) (versionsByEmployeeId[v.employeeId] ||= []).push(v);
      });
    }

    const nameByEmployeeId = {};
    employeesSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const name = data.firstName || data.name || "";
      if (name) nameByEmployeeId[docSnap.id] = name;
    });

    const late = [];
    const firstByDay = {};
    // Ketish belgilanmaganini aniqlash uchun: (xodim|kun) bo'yicha barcha
    // yozuvlardagi kelish/ketish belgilari yig'iladi (bir kunda bir nechta
    // hujjat bo'lishi mumkin).
    const shiftMarks = {};
    const lastOutByDay = {};
    // 23.10.2026: ikkinchi smenadan ketish vaqti (checkOutTime2) alohida.
    const out2ByDay = {};
    attendanceSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (!data.employeeId || !data.dateKey) return;
      const employeeName = nameByEmployeeId[data.employeeId];
      if (!employeeName) return;
      {
        const log = Array.isArray(data.editLog) ? data.editLog : [];
        const inMs = toMs(data.checkInTime);
        const srvInMs = toMs(data.serverCheckInAt);
        const outMs = toMs(data.checkOutTime);
        const srvOutMs = toMs(data.serverCheckOutAt);
        const offQ = !!data.offlineQueued;
        const inChanged = !offQ && inMs != null && srvInMs != null && Math.abs(inMs - srvInMs) > 2 * 60 * 1000;
        const outChanged = !offQ && outMs != null && srvOutMs != null && Math.abs(outMs - srvOutMs) > 2 * 60 * 1000;
        if (log.length || data.manuallyEditedAt || inChanged || outChanged) {
          edits.push({
            docId: docSnap.id,
            employeeId: data.employeeId,
            employeeName,
            nameKey: normalizeName(employeeName),
            dateKey: data.dateKey,
            editLog: log,
            manuallyEditedAt: data.manuallyEditedAt || "",
            manuallyEditedBy: data.manuallyEditedBy || "",
            checkIn: checkInToHHMM(data.checkInTime),
            checkOut: checkInToHHMM(data.checkOutTime),
            checkIn2: checkInToHHMM(data.checkInTime2),
            checkOut2: checkInToHHMM(data.checkOutTime2),
            serverCheckIn: srvInMs != null ? checkInToHHMM(new Date(srvInMs).toISOString()) : "",
            serverCheckOut: srvOutMs != null ? checkInToHHMM(new Date(srvOutMs).toISOString()) : "",
            inChanged,
            outChanged,
            lateMinutes: Number(data.lateMinutes) || 0,
            latePenalty: Number(data.latePenalty) || 0,
          });
        }
      }
      const checkIn = checkInToHHMM(data.checkInTime);
      const lateMinutes = Number(data.lateMinutes) || 0;
      const checkOut = pickCheckOut(data);
      {
        const k = `${data.employeeId}|${data.dateKey}`;
        const m = (shiftMarks[k] ||= { employeeName, dateKey: data.dateKey, in1: "", out1: false, in2: "", out2: false, endIso: null });
        if (checkIn && !m.in1) m.in1 = checkIn;
        if (checkOut) m.out1 = true;
        const in2 = checkInToHHMM(data.checkInTime2);
        if (in2 && !m.in2) m.in2 = in2;
        if (data.checkOutTime2) m.out2 = true;
        const endIso = data.scheduledEnd2 || data.scheduledEnd;
        if (endIso && !m.endIso) m.endIso = endIso;
      }
      if (data.checkOutTime2) {
        const k = `${data.employeeId}|${data.dateKey}`;
        const c2 = checkInToHHMM(data.checkOutTime2);
        const co2 = hhmmToMin(c2);
        if (co2 != null && (!out2ByDay[k] || co2 > out2ByDay[k].co)) out2ByDay[k] = { co: co2, checkOut: c2 };
      }
      if (checkOut) {
        const k = `${data.employeeId}|${data.dateKey}`;
        const co = hhmmToMin(checkOut);
        if (co != null && (!lastOutByDay[k] || co > lastOutByDay[k].co)) {
          lastOutByDay[k] = { co, checkOut, employeeId: data.employeeId, employeeName, dateKey: data.dateKey };
        }
      }
      if (checkIn) {
        const k = `${data.employeeId}|${data.dateKey}`;
        const ci = hhmmToMin(checkIn);
        if (!firstByDay[k] || ci < firstByDay[k].ci) {
          firstByDay[k] = { ci, checkIn, employeeId: data.employeeId, employeeName, dateKey: data.dateKey };
        }
      }
      if (lateMinutes <= 0) return;
      const sched = pickScheduleForDate(versionsByEmployeeId[data.employeeId] || [], data.dateKey);
      const workStart = pickShiftStart(sched, checkIn, lateMinutes);
      late.push({
        checkInHHMM: checkIn,
        workStart,
        employeeId: data.employeeId,
        employeeName,
        nameKey: normalizeName(employeeName),
        dateKey: data.dateKey,
        checkInTime: data.checkInTime || null,
        lateMinutes,
        latePenalty: Number(data.latePenalty) || 0,
      });
    });
    late.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));

    const early = [];
    Object.values(firstByDay).forEach((f) => {
      const sched = pickScheduleForDate(versionsByEmployeeId[f.employeeId] || [], f.dateKey);
      if (!sched || !sched.workStart) return;
      if (isFaceIdRestDay(formatSchedule(sched), f.dateKey)) return;
      const sm = hhmmToMin(sched.workStart);
      if (sm == null || f.ci == null) return;
      const earlyMinutes = sm - f.ci;
      if (earlyMinutes < EARLY_MIN_MINUTES || earlyMinutes > EARLY_MAX_MINUTES) return;
      early.push({
        employeeName: f.employeeName,
        nameKey: normalizeName(f.employeeName),
        dateKey: f.dateKey,
        checkInHHMM: f.checkIn,
        workStart: sched.workStart,
        earlyMinutes,
      });
    });
    early.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));

    // Kech ketish: kunning OXIRGI ketish vaqti — oxirgi smena tugashi bilan
    // solishtiriladi (ikki smena bo'lsa — workEnd2).
    // 23.10.2026: smenalar bo'yicha ketish: 1-smena chiqishi 1-smena oxiri
    // bilan, 2-smena chiqishi 2-smena oxiri bilan solishtiriladi (avval
    // 1-smena chiqishi 2-smena oxiri bilan solishtirilib, "500 daqiqa erta"
    // kabi noto'g'ri natija chiqardi).
    const endMin = (hhmm, startHHMM) => {
      let m = hhmmToMin(hhmm);
      if (m == null) return null;
      const st = hhmmToMin(startHHMM);
      if (m === 0 || (st != null && m < st)) m += 24 * 60;
      return m;
    };
    const outMin = (co, startHHMM) => {
      const st = hhmmToMin(startHHMM);
      return st != null && co < st - 6 * 60 ? co + 24 * 60 : co;
    };
    const shiftLeaves = (k, sched) => {
      const res = [];
      const o1 = lastOutByDay[k];
      const o2 = out2ByDay[k];
      const has2 = !!(sched.workStart2 && sched.workEnd2);
      if (o1 && sched.workEnd) {
        const e1 = endMin(sched.workEnd, sched.workStart);
        if (e1 != null) res.push({ shift: 1, workEnd: sched.workEnd, out: o1.checkOut, diff: outMin(o1.co, sched.workStart) - e1 });
      }
      if (has2 && o2) {
        const e2 = endMin(sched.workEnd2, sched.workStart2);
        if (e2 != null) res.push({ shift: 2, workEnd: sched.workEnd2, out: o2.checkOut, diff: outMin(o2.co, sched.workStart2) - e2 });
      }
      return { res, has2 };
    };
    const lateLeave = [];
    Object.keys(lastOutByDay).forEach((k) => {
      const f = lastOutByDay[k];
      const sched = pickScheduleForDate(versionsByEmployeeId[f.employeeId] || [], f.dateKey);
      if (!sched || !sched.workEnd) return;
      if (isFaceIdRestDay(formatSchedule(sched), f.dateKey)) return;
      const { res, has2 } = shiftLeaves(k, sched);
      // Kech ketish — kunning oxirgi smenasi bo'yicha.
      const last = has2 ? res.find((x) => x.shift === 2) : res.find((x) => x.shift === 1);
      if (!last) return;
      const extraMinutes = last.diff;
      if (extraMinutes < LATE_LEAVE_MIN_MINUTES || extraMinutes > LATE_LEAVE_MAX_MINUTES) return;
      lateLeave.push({
        employeeName: f.employeeName,
        nameKey: normalizeName(f.employeeName),
        dateKey: f.dateKey,
        checkOutHHMM: last.out,
        workEnd: last.workEnd,
        extraMinutes,
      });
    });
    lateLeave.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));

    // 2026-10-14: "Ishga keldi" bosilgan, lekin "ketish" bosilmagan kunlar.
    // Kun hali tugamagan bo'lsa (yoki smena tugaganiga 3 soat bo'lmagan
    // bo'lsa — tungi smena) — hali hisoblanmaydi.
    const missedCheckout = [];
    const now = Date.now();
    Object.values(shiftMarks).forEach((m) => {
      const missed1 = !!m.in1 && !m.out1;
      const missed2 = !!m.in2 && !m.out2;
      if (!missed1 && !missed2) return;
      const [y, mo, d] = m.dateKey.split("-").map(Number);
      const dayEnd = new Date(y, mo - 1, d + 1, 0, 0, 0).getTime();
      if (now < dayEnd) return;
      const endTs = m.endIso ? new Date(m.endIso).getTime() : NaN;
      if (Number.isFinite(endTs) && now < endTs + 3 * 3600 * 1000) return;
      missedCheckout.push({
        employeeName: m.employeeName,
        nameKey: normalizeName(m.employeeName),
        dateKey: m.dateKey,
        checkInHHMM: missed2 && !missed1 ? m.in2 : m.in1,
        secondShift: missed2 && !missed1,
      });
    });
    missedCheckout.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));
    // 23.10.2026: erta ketish (ruxsat va qoplash uchun) va har kunlik
    // kelish/ketish + amaldagi ish vaqti (qoplash hisobi uchun).
    const earlyLeave = [];
    const days = [];
    const dayKeys = new Set([...Object.keys(firstByDay), ...Object.keys(lastOutByDay)]);
    dayKeys.forEach((k) => {
      const fi = firstByDay[k];
      const lo = lastOutByDay[k];
      const base = fi || lo;
      const sched = pickScheduleForDate(versionsByEmployeeId[base.employeeId] || [], base.dateKey);
      if (!sched || !sched.workStart) return;
      const rest = isFaceIdRestDay(formatSchedule(sched), base.dateKey);
      const sm = hhmmToMin(sched.workStart);
      const { res } = shiftLeaves(k, sched);
      const lastShift = res.length ? res[res.length - 1] : null;
      const row = {
        employeeName: base.employeeName,
        nameKey: normalizeName(base.employeeName),
        dateKey: base.dateKey,
        firstIn: fi ? fi.checkIn : "",
        lastOut: lastShift ? lastShift.out : (lo ? lo.checkOut : ""),
        workStart: sched.workStart,
        workEnd: lastShift ? lastShift.workEnd : (sched.workEnd2 || sched.workEnd || ""),
        rest,
        morningExtra: fi && sm != null && !rest ? Math.max(0, sm - fi.ci) : 0,
        // Smena oxiridan keyin qolgan daqiqalar (har smena bo'yicha yig'indi).
        eveningExtra: rest ? 0 : res.reduce((a, x) => a + Math.max(0, x.diff), 0),
      };
      days.push(row);
      if (!rest) {
        // Erta ketish: har smena bo'yicha (smena oxiridan oldin chiqqan daqiqalar).
        const early = res.filter((x) => x.diff <= -2 && x.diff >= -12 * 60);
        if (early.length > 0) {
          const minutes = early.reduce((a, x) => a - x.diff, 0);
          const shown = early[early.length - 1];
          earlyLeave.push({ ...row, workEnd: shown.workEnd, lastOut: shown.out, earlyLeaveMinutes: minutes, shifts: early.map((x) => ({ shift: x.shift, workEnd: x.workEnd, out: x.out, minutes: -x.diff })) });
        }
      }
    });
    earlyLeave.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : 0));
    // 17.10.2026: Buyruqlar kitobi uchun - xodim qaysi kunlari ishga kelgan
    // ("Ishga keldi" bosilgan kunlar). Dam kunida buyruq jarimasi yozilmaydi.
    const worked = [];
    Object.values(shiftMarks).forEach((m) => {
      if (!m.in1 && !m.in2) return;
      worked.push({ employeeName: m.employeeName, nameKey: normalizeName(m.employeeName), dateKey: m.dateKey, checkInHHMM: m.in1 || m.in2 });
    });
    return { late, early, lateLeave, missedCheckout, worked, earlyLeave, days, edits, userNames, ok: true };
  } catch (e) {
    return { late: [], early: [], lateLeave: [], missedCheckout: [], worked: [], earlyLeave: [], days: [], edits: [], userNames: {} };
  }
}

export async function fetchFaceIdLateEntries(fromDateKey) {
  return (await fetchFaceIdAttendance(fromDateKey)).late;
}

export { normalizeName as normalizeFaceIdName };

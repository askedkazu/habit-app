/* ==========================================================
   リマインド通知を送るスクリプト
   ----------------------------------------------------------
   GitHub Actions（.github/workflows/notify.yml）から15分ごとに実行する。

   今日まだ達成していない人に、次の通知を送る（達成したらその日は送らない）:
   1. 勉強の予定の前のお知らせ：アプリに入れた予定の開始15分前ごろ（notifyPlans がオフなら送らない）
   2. 毎日のリマインド：通知時刻（notifyTime）を過ぎたら1回目。
      まだ勉強していなければ、notifyRepeatMin 分ごとに、1日 notifyRepeatMax 回まで送り直す。
      送り直しは夜遅く（23時以降）には送らない

   GitHub の定期実行は遅れることがあるため、1回目は通知時刻から3時間以内なら送る。

   必要な環境変数:
   - FIREBASE_SERVICE_ACCOUNT: Firebase のサービスアカウント鍵（JSON文字列）
   - TEST_SEND: "true" なら上の条件を無視して、通知オンの全員に今すぐ送る
     （動作確認用。その日の通常の通知には影響しない）
   ========================================================== */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP_URL = "https://askedkazu.github.io/habit-app/";
const DEFAULT_TIME = "20:00";
const DEFAULT_TZ = "Asia/Tokyo";
const DEFAULT_REPEAT_MIN = 60; // 送り直す間隔（分）。0 なら送り直さない
const DEFAULT_REPEAT_MAX = 3; // 1日に送る最大回数（1回目を含む）
const LATE_LIMIT_MINUTES = 180; // 1回目は、通知時刻からこの分数を過ぎたら送らない
const QUIET_FROM = 23 * 60; // この時刻（0時からの分）以降は送り直さない
const PLAN_AHEAD_MINUTES = 20; // 予定の開始この分前から知らせる（15分ごとの実行で取りこぼさない幅）
const PLAN_LATE_MINUTES = 5; // 予定の開始を過ぎてもこの分までは知らせる
const REPEAT_TOLERANCE_MINUTES = 5; // 定期実行のずれを吸収する

// 1回目：毎日同じ文言だと見慣れてしまうので、いくつかから選ぶ
const FIRST_MESSAGES = [
  "今日のちょいステップ、机に座るだけでOK！",
  "本を1ページ開くだけでも立派な一歩です📖",
  "5秒だけ、ノートを開いてみませんか？",
  "今日の一歩がまだです。小さくていいので始めよう！",
];
// 2回目以降（最後の1回は連続記録の話にする）
const REPEAT_MESSAGES = [
  "まだ間に合う！5分だけやってみよう⏱",
  "机に座るだけでも、今日の一歩になります🪑",
  "1ページだけ開いて、写真を撮ってみよう📸",
];

// 宛先が無効になったときのエラー（アプリを消した、通知をオフにした等）
const INVALID_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// 指定した地域での「今日の日付（YYYY-MM-DD）」と「0時からの経過分」を返す
export function localNow(timeZone, now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function toMinutes(time) {
  const [h, m] = String(time || DEFAULT_TIME).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : toMinutes(DEFAULT_TIME);
}

const clock = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

// 昨日までの連続日数（今日はまだ達成していない前提）
function streakUntilYesterday(history, today) {
  const set = new Set(history || []);
  const [y, m, d] = today.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d - 1));
  let streak = 0;
  while (set.has(day.toISOString().slice(0, 10))) {
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return streak;
}

/**
 * この人に今、通知を送るかを決める（Firestore にもFCMにも触らない）。
 * @returns {{ body: string, update: object, kind: string } | { skip: string }}
 */
export function decideReminder(user, now) {
  let local;
  try {
    local = localNow(user.notifyTz || DEFAULT_TZ, now);
  } catch {
    local = localNow(DEFAULT_TZ, now); // 地域名が不正なときは日本時間で扱う
  }
  const at = `現地時刻 ${clock(local.minutes)}`;
  if ((user.history || []).includes(local.date)) return { skip: `今日はすでに達成済み（${at}）` };

  // 今日すでに送った回数（以前のバージョンは lastNotifiedDate だけ記録していた）
  const isToday = user.reminderDate === local.date;
  const count = isToday ? user.reminderCount || 0 : user.lastNotifiedDate === local.date ? 1 : 0;
  const lastAt = isToday ? user.reminderLastAt || 0 : 0;

  // 1. 勉強の予定の前のお知らせ
  if (user.notifyPlans !== false) {
    const notifiedIds = user.planNotified?.date === local.date ? user.planNotified.ids || [] : [];
    const plan = (user.plans || []).find((p) => {
      if (p.date !== local.date || notifiedIds.includes(p.id)) return false;
      const diff = toMinutes(p.time) - local.minutes;
      return diff <= PLAN_AHEAD_MINUTES && diff >= -PLAN_LATE_MINUTES;
    });
    if (plan) {
      const book = plan.book ? `「${plan.book}」の` : "";
      return {
        kind: "plan",
        body: `📅 ${clock(toMinutes(plan.time))}から${book}勉強の予定です（${plan.minutes}分）。まずはちょいステップから！`,
        update: {
          planNotified: { date: local.date, ids: [...notifiedIds, plan.id] },
          // 予定のお知らせの直後に、毎日のリマインドが続けて鳴らないようにする
          reminderDate: local.date,
          reminderCount: count,
          reminderLastAt: now.getTime(),
        },
      };
    }
  }

  // 2. 毎日のリマインド
  const late = local.minutes - toMinutes(user.notifyTime);
  if (late < 0) return { skip: `通知時刻 ${user.notifyTime || DEFAULT_TIME} より前（${at}）` };

  const repeatMin = user.notifyRepeatMin ?? DEFAULT_REPEAT_MIN;
  const max = repeatMin > 0 ? user.notifyRepeatMax || DEFAULT_REPEAT_MAX : 1;
  if (count >= max) return { skip: `今日はすでに ${count} 回通知済み（${at}）` };

  if (count === 0) {
    if (late > LATE_LIMIT_MINUTES) return { skip: `通知時刻から3時間以上経過（${at}）` };
  } else {
    if (local.minutes >= QUIET_FROM) return { skip: `夜遅いので送り直さない（${at}）` };
    // 前回からの間隔（前回の時刻が分からなければ、通知時刻から数える）
    const sinceLast = lastAt ? (now.getTime() - lastAt) / 60000 : late - repeatMin * (count - 1);
    if (sinceLast < repeatMin - REPEAT_TOLERANCE_MINUTES) return { skip: `前回の通知から ${repeatMin} 分たっていない（${at}）` };
  }

  let body;
  if (count === 0) {
    body = pick(FIRST_MESSAGES);
  } else if (count === max - 1) {
    const streak = streakUntilYesterday(user.history, local.date);
    body =
      streak > 0
        ? `🔥 ${streak}日連続がかかってます！今日の一歩を、机に座るだけでもOK`
        : "今日最後のお知らせです。1ページだけでも開いてみよう📖";
  } else {
    body = pick(REPEAT_MESSAGES);
  }
  return {
    kind: count === 0 ? "first" : "repeat",
    body,
    update: { reminderDate: local.date, reminderCount: count + 1, reminderLastAt: now.getTime(), lastNotifiedDate: local.date },
  };
}

async function main() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.log("FIREBASE_SERVICE_ACCOUNT が未設定のため、通知は送りません。");
    return;
  }
  const testSend = process.env.TEST_SEND === "true";
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
  const db = getFirestore();
  const messaging = getMessaging();

  const now = new Date();
  const snap = await db.collection("users").where("notifyEnabled", "==", true).get();
  let sent = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const user = doc.data();
    const tokens = user.notifyTokens || [];
    if (tokens.length === 0) {
      skipped++;
      continue;
    }

    let body;
    let update = {};
    if (testSend) {
      // テスト送信では、その日の通知の記録を残さない（通常の通知を止めないため）
      body = "テスト通知です。これが届けば通知の設定は完了です🎉";
    } else {
      const decision = decideReminder(user, now);
      if (decision.skip) {
        // 送らなかった理由をログに残す（個人を特定する情報は出さない）
        console.log(`対象外: ${decision.skip}`);
        skipped++;
        continue;
      }
      ({ body, update } = decision);
      console.log(`送信する通知: ${decision.kind}`);
    }

    // 表示は sw.js が行うため、data だけを送る
    const res = await messaging.sendEachForMulticast({
      tokens,
      data: { title: "ちょいステップ習慣", body, url: APP_URL },
      webpush: { headers: { Urgency: "high", TTL: String(60 * 60) } },
    });

    // 無効になった宛先は消しておく（次回から送らない）
    const invalid = res.responses
      .map((r, i) => (!r.success && INVALID_TOKEN_ERRORS.has(r.error?.code) ? tokens[i] : null))
      .filter(Boolean);
    if (invalid.length) update.notifyTokens = FieldValue.arrayRemove(...invalid);
    if (Object.keys(update).length) await doc.ref.update(update);

    sent++;
    // 個人を特定できる情報（トークンやメール）はログに出さない
    console.log(`送信: 成功 ${res.successCount} / 失敗 ${res.failureCount}（無効な宛先 ${invalid.length} 件を削除）`);
  }

  console.log(`完了${testSend ? "（テスト送信）" : ""}: 通知した人 ${sent} 人 / 対象外 ${skipped} 人`);
}

// テストから decideReminder だけを読み込めるよう、直接実行したときだけ main を動かす
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

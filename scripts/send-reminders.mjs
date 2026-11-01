/* ==========================================================
   リマインド通知を送るスクリプト
   ----------------------------------------------------------
   GitHub Actions（.github/workflows/notify.yml）から15分ごとに実行する。

   送る条件（すべて満たす人だけ）:
   - 通知をオンにしている（notifyEnabled かつ 通知の宛先が1つ以上ある）
   - その人の地域の時刻で、通知時刻（notifyTime）を過ぎている
     （GitHub の定期実行は遅れることがあるため、3時間以内なら送る）
   - 今日まだ通知していない（lastNotifiedDate）
   - 今日まだ達成していない（history に今日の日付がない）

   必要な環境変数:
   - FIREBASE_SERVICE_ACCOUNT: Firebase のサービスアカウント鍵（JSON文字列）
   ========================================================== */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP_URL = "https://askedkazu.github.io/habit-app/";
const DEFAULT_TIME = "20:00";
const DEFAULT_TZ = "Asia/Tokyo";
const LATE_LIMIT_MINUTES = 180; // 通知時刻からこの分数を過ぎたら、その日は送らない

// 毎日同じ文言だと見慣れてしまうので、いくつかから選ぶ
const MESSAGES = [
  "今日のちょいステップ、机に座るだけでOK！",
  "本を1ページ開くだけでも立派な一歩です📖",
  "5秒だけ、ノートを開いてみませんか？",
  "今日の一歩がまだです。小さくていいので始めよう！",
];

// 宛先が無効になったときのエラー（アプリを消した、通知をオフにした等）
const INVALID_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccount) {
  console.log("FIREBASE_SERVICE_ACCOUNT が未設定のため、通知は送りません。");
  process.exit(0);
}

initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
const db = getFirestore();
const messaging = getMessaging();

// 指定した地域での「今日の日付（YYYY-MM-DD）」と「0時からの経過分」を返す
function localNow(timeZone, now) {
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

async function main() {
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

    let local;
    try {
      local = localNow(user.notifyTz || DEFAULT_TZ, now);
    } catch {
      local = localNow(DEFAULT_TZ, now); // 地域名が不正なときは日本時間で扱う
    }

    const late = local.minutes - toMinutes(user.notifyTime);
    const alreadyNotified = user.lastNotifiedDate === local.date;
    const achievedToday = (user.history || []).includes(local.date);
    if (late < 0 || late > LATE_LIMIT_MINUTES || alreadyNotified || achievedToday) {
      skipped++;
      continue;
    }

    const body = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
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
    const update = { lastNotifiedDate: local.date };
    if (invalid.length) update.notifyTokens = FieldValue.arrayRemove(...invalid);
    await doc.ref.update(update);

    sent++;
    // 個人を特定できる情報（トークンやメール）はログに出さない
    console.log(`送信: 成功 ${res.successCount} / 失敗 ${res.failureCount}（無効な宛先 ${invalid.length} 件を削除）`);
  }

  console.log(`完了: 通知した人 ${sent} 人 / 対象外 ${skipped} 人`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

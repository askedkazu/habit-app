/* ==========================================================
   カレンダーの予定（埋まっている時間帯）を読み込むスクリプト
   ----------------------------------------------------------
   GitHub Actions（.github/workflows/notify.yml）から15分ごとに実行する。

   - アプリで登録した「カレンダーの非公開URL（iCal形式）」を読み、
     今日から8日分の「予定で埋まっている時間帯」だけを users/{uid}.calendarBusy に保存する
     （予定の名前・場所・内容は保存しない）
   - 終日の予定と「予定なし（空き時間）」扱いの予定は、埋まっている時間に含めない
   - 1時間に1回、またはURLを登録・変更した直後に読み込む
   - アプリはこの時間帯をもとに、空き時間に勉強プランを立てる

   必要な環境変数:
   - FIREBASE_SERVICE_ACCOUNT: Firebase のサービスアカウント鍵（JSON文字列）
   ========================================================== */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import IcalExpander from "ical-expander";

const SYNC_INTERVAL_MS = 55 * 60 * 1000; // 同じ人を読み込み直す間隔（約1時間）
const RANGE_DAYS = 8;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024; // 大きすぎるカレンダーは読まない
const MAX_BLOCKS = 400;

// "webcal://" は "https://" に読み替える。http(s) 以外は受け付けない
export function normalizeUrl(raw) {
  const url = new URL(String(raw).trim().replace(/^webcals?:\/\//i, "https://"));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("URLの形式が正しくありません");
  return url.toString();
}

async function fetchIcs(rawUrl) {
  const res = await fetch(normalizeUrl(rawUrl), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "text/calendar, */*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`カレンダーを読み込めませんでした（${res.status}）`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("カレンダーが大きすぎて読み込めません");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("カレンダーのURLではないようです（iCal形式のURLを貼ってください）");
  return text;
}

/**
 * iCal のテキストから、[from, to) の範囲で予定が入っている時間帯を返す。
 * 繰り返しの予定も展開する。重なっている時間帯はまとめる。
 * @returns {{ s: number, e: number }[]} ミリ秒のUNIX時刻
 */
export function busyBlocks(icsText, from, to) {
  const expander = new IcalExpander({ ics: icsText, maxIterations: 2000 });
  const { events, occurrences } = expander.between(from, to);
  const blocks = [];
  const add = (event, start, end) => {
    if (start.isDate) return; // 終日の予定は勉強時間をふさがない
    const transp = event.component?.getFirstPropertyValue("transp");
    if (String(transp).toUpperCase() === "TRANSPARENT") return; // 「予定なし」として入れた予定
    const s = start.toJSDate().getTime();
    const e = (end || start).toJSDate().getTime();
    if (e > s) blocks.push({ s: Math.max(s, from.getTime()), e: Math.min(e, to.getTime()) });
  };
  events.forEach((ev) => add(ev, ev.startDate, ev.endDate));
  occurrences.forEach((oc) => add(oc.item, oc.startDate, oc.endDate));

  blocks.sort((a, b) => a.s - b.s);
  const merged = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e);
    else merged.push({ ...b });
  }
  return merged.slice(0, MAX_BLOCKS);
}

async function main() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.log("FIREBASE_SERVICE_ACCOUNT が未設定のため、カレンダーは読み込みません。");
    return;
  }
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
  const db = getFirestore();

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); // 時差を考えて前日から
  const to = new Date(from.getTime() + (RANGE_DAYS + 1) * 86400000);

  const snap = await db.collection("users").where("calendarUrl", ">", "").get();
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const user = doc.data();
    const lastSync = user.calendarSyncedAt?.toMillis?.() || 0;
    const changed = (user.calendarUpdatedAt?.toMillis?.() || 0) > lastSync;
    if (!changed && now.getTime() - lastSync < SYNC_INTERVAL_MS) {
      skipped++;
      continue;
    }
    try {
      const blocks = busyBlocks(await fetchIcs(user.calendarUrl), from, to);
      await doc.ref.update({
        calendarBusy: blocks,
        calendarSyncedAt: FieldValue.serverTimestamp(),
        calendarError: FieldValue.delete(),
      });
      synced++;
    } catch (err) {
      // 個人の予定やURLはログに出さない
      await doc.ref.update({
        calendarSyncedAt: FieldValue.serverTimestamp(),
        calendarError: String(err?.message || err).slice(0, 200),
      });
      failed++;
    }
  }
  console.log(`カレンダー: 読み込み ${synced} 人 / 失敗 ${failed} 人 / 今回は対象外 ${skipped} 人`);
}

// テストから busyBlocks だけを読み込めるよう、直接実行したときだけ main を動かす
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

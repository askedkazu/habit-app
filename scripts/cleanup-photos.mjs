/* ==========================================================
   古い証拠写真を消すスクリプト
   ----------------------------------------------------------
   GitHub Actions（.github/workflows/notify.yml）から15分ごとに実行する。
   photos に保存した証拠写真のうち、保存から60日たったものを消す
   （利用者・プライバシーのページに「60日で自動削除」と案内している）。

   必要な環境変数:
   - FIREBASE_SERVICE_ACCOUNT: Firebase のサービスアカウント鍵（JSON文字列）
   ========================================================== */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const KEEP_DAYS = 60;
const BATCH_SIZE = 300; // 1回で消す最大件数（残りは次の実行で消す）

async function main() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.log("FIREBASE_SERVICE_ACCOUNT が未設定のため、写真の削除はしません。");
    return;
  }
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
  const db = getFirestore();

  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const snap = await db.collection("photos").where("ts", "<", cutoff).limit(BATCH_SIZE).get();
  if (snap.empty) {
    console.log("証拠写真: 消す写真はありません");
    return;
  }
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  console.log(`証拠写真: ${KEEP_DAYS}日たった ${snap.size} 件を削除しました`);
}

// 直接実行したときだけ動かす
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

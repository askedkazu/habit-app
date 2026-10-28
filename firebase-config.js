/* ==========================================================
   Firebase の設定（アカウント機能用）
   ----------------------------------------------------------
   Firebase コンソール → プロジェクトの設定 → マイアプリ（ウェブアプリ）
   に表示される firebaseConfig の中身をここに貼り付ける。

   null にした場合はログイン機能が無効になり、
   これまで通りこの端末のブラウザだけにデータを保存する。

   ※この設定値は公開されても問題ない（秘密の鍵ではない）。
     データの保護は Firestore のセキュリティルールで行う（README参照）。
   ========================================================== */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDTeVeu8Aue6-BbNMY1dBLhOEMwUCQSozg",
  authDomain: "habit-app-e3b8b.firebaseapp.com",
  projectId: "habit-app-e3b8b",
  storageBucket: "habit-app-e3b8b.firebasestorage.app",
  messagingSenderId: "49158191283",
  appId: "1:49158191283:web:fa177b08eb7ecb7f3ad8c6",
  measurementId: "G-4TPPEGELX5",
};

/* ----------------------------------------------------------
   App Check（AIを自分のアプリ以外から使われないようにする仕組み）
   - provider: "recaptcha-enterprise"（Fraud Defense。推奨）または "recaptcha-v3"（Classic。非推奨）
   - siteKey : reCAPTCHA のサイトキー（公開して問題ない値）
   null にすると App Check を使わない
   ---------------------------------------------------------- */
window.FIREBASE_APP_CHECK = {
  provider: "recaptcha-enterprise", // Fraud Defense（旧称 reCAPTCHA Enterprise）
  siteKey: "6Lfi1AQuAAAAAAjyajy3--qRmePUGPjTOIFTySu3",
};

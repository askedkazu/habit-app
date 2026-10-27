/* ==========================================================
   Firebase の設定（アカウント機能用）
   ----------------------------------------------------------
   Firebase コンソール → プロジェクトの設定 → マイアプリ（ウェブアプリ）
   に表示される firebaseConfig の中身をここに貼り付ける。

   null のままの場合はログイン機能が無効になり、
   これまで通りこの端末のブラウザだけにデータを保存する。

   ※この設定値は公開されても問題ない（秘密の鍵ではない）。
     データの保護は Firestore のセキュリティルールで行う（README参照）。
   ========================================================== */
window.FIREBASE_CONFIG = null;

/* 貼り付け例:
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
*/

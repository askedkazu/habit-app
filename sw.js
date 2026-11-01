/* ==========================================================
   Service Worker（通知の受け取り役）
   ----------------------------------------------------------
   アプリを閉じていても、通知サーバー（GitHub Actions → FCM）から
   届いたプッシュを受け取って通知を表示する。
   ========================================================== */

// 新しい版を配信したら、すぐに入れ替える
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// プッシュを受け取ったら通知を表示する
// （iPhone では、受け取ったプッシュは必ず通知として表示する必要がある）
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* JSON でなければ既定の文言を使う */
  }
  // FCM のデータメッセージは { data: {...} } の形で届く
  const data = payload.data || payload;

  event.waitUntil(
    self.registration.showNotification(data.title || "ちょいステップ習慣", {
      body: data.body || "今日のちょいステップ、やってみよう！",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "daily-reminder", // 同じ通知が溜まらないよう、新しいもので置き換える
      data: { url: data.url || "./" },
    })
  );
});

// 通知をタップしたらアプリを開く（開いていれば前面に出す）
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

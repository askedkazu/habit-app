/* ==========================================================
   管理者ページ（admin.html）
   ----------------------------------------------------------
   - 証拠写真（photos）と、利用者ごとのアンケートの答え・教材・記録（users）を一覧する
   - 利用者は名前やメールアドレスではなく、UID から作った「利用者 #a1b2c3」で表示する
   - 読めるかどうかは Firestore のルール（isAdmin() に書いた管理者のUID）で決まる。
     権限がなければ、ルールに入れるための自分のUIDを表示する
   ========================================================== */
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.19.0";
const PAGE_SIZE = 30;

const $ = (id) => document.getElementById(id);
const el = {
  who: $("adminWho"),
  loginBtn: $("adminLoginBtn"),
  logoutBtn: $("adminLogoutBtn"),
  denied: $("adminDenied"),
  uid: $("adminUid"),
  copyUid: $("adminCopyUid"),
  msg: $("adminMsg"),
  body: $("adminBody"),
  viewPhotos: $("viewPhotos"),
  viewUsers: $("viewUsers"),
  photoUserFilter: $("photoUserFilter"),
  photoCountText: $("photoCountText"),
  photoList: $("photoList"),
  photoMoreBtn: $("photoMoreBtn"),
  userList: $("userList"),
  zoom: $("photoZoom"),
  zoomImg: $("photoZoomImg"),
};

const fb = { auth: null, db: null, authMod: null, fsMod: null };
const data = { users: [], photos: [], lastPhoto: null, filter: "" };

// UID から、毎回同じになる短い記号を作る（名前やメールアドレスは出さない）
function pseudonym(uid) {
  return `利用者 #${String(uid || "").slice(0, 6)}`;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function setMessage(text) {
  el.msg.textContent = text;
  el.msg.classList.toggle("hidden", !text);
}

async function init() {
  if (!window.FIREBASE_CONFIG) {
    setMessage("firebase-config.js が設定されていません。");
    return;
  }
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`),
    import(`${FIREBASE_SDK}/firebase-auth.js`),
    import(`${FIREBASE_SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(window.FIREBASE_CONFIG);
  fb.authMod = authMod;
  fb.fsMod = fsMod;
  fb.auth = authMod.getAuth(app);
  fb.db = fsMod.getFirestore(app);

  el.loginBtn.addEventListener("click", () =>
    authMod.signInWithPopup(fb.auth, new authMod.GoogleAuthProvider()).catch((err) => setMessage(`ログインできませんでした（${err.code || err.message}）`))
  );
  el.logoutBtn.addEventListener("click", () => authMod.signOut(fb.auth));
  el.copyUid.addEventListener("click", () => navigator.clipboard?.writeText(el.uid.value));
  el.photoMoreBtn.addEventListener("click", () => loadPhotos({ more: true }));
  el.photoUserFilter.addEventListener("change", () => {
    data.filter = el.photoUserFilter.value;
    loadPhotos();
  });
  document.querySelectorAll(".admin-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((b) => b.classList.toggle("selected", b === btn));
      el.viewPhotos.classList.toggle("hidden", btn.dataset.view !== "photos");
      el.viewUsers.classList.toggle("hidden", btn.dataset.view !== "users");
    })
  );
  el.zoom.addEventListener("click", () => el.zoom.classList.add("hidden"));

  authMod.onAuthStateChanged(fb.auth, async (user) => {
    el.loginBtn.classList.toggle("hidden", !!user);
    el.logoutBtn.classList.toggle("hidden", !user);
    el.who.textContent = user ? user.email || "" : "";
    el.denied.classList.add("hidden");
    el.body.classList.add("hidden");
    if (!user) {
      setMessage("ログインすると表示します。");
      return;
    }
    setMessage("読み込み中…");
    try {
      await loadUsers();
      await loadPhotos();
      setMessage("");
      el.body.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      if (err.code === "permission-denied") {
        setMessage("");
        el.uid.value = user.uid;
        el.denied.classList.remove("hidden");
      } else {
        setMessage(`読み込めませんでした（${err.code || err.message}）`);
      }
    }
  });
}

/* ---------- 利用者 ---------- */
async function loadUsers() {
  const { collection, getDocs } = fb.fsMod;
  const snap = await getDocs(collection(fb.db, "users"));
  data.users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  data.users.sort((a, b) => lastActive(b) - lastActive(a));

  el.photoUserFilter.innerHTML = '<option value="">すべて</option>';
  data.users.forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u.uid;
    opt.textContent = pseudonym(u.uid);
    el.photoUserFilter.append(opt);
  });
  renderUsers();
}

function lastActive(u) {
  const logs = u.logs || [];
  return Math.max(0, ...logs.map((l) => l.ts || 0));
}

function row(label, value) {
  const div = document.createElement("div");
  div.className = "flex gap-3 text-sm";
  const dt = document.createElement("span");
  dt.className = "w-24 shrink-0 text-slate-500";
  dt.textContent = label;
  const dd = document.createElement("span");
  dd.className = value ? "text-slate-800" : "text-slate-400";
  dd.textContent = value || "—";
  div.append(dt, dd);
  return div;
}

function renderUsers() {
  el.userList.innerHTML = "";
  if (data.users.length === 0) {
    el.userList.textContent = "まだ利用者がいません。";
    return;
  }
  data.users.forEach((u) => {
    const p = u.profile || {};
    // 同じ記録（ts が同じ）が重なっていたら1つにする（写真をあとで報告した記録は、報告済みの方を残す）
    const byTs = new Map();
    (u.logs || []).forEach((l) => {
      const prev = byTs.get(l.ts);
      if (!prev || (prev.pending && !l.pending)) byTs.set(l.ts, l);
    });
    const logs = [...byTs.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const minutes = logs.reduce((sum, l) => sum + (l.minutes || 0), 0);
    const card = document.createElement("section");
    card.className = "card space-y-1";

    const head = document.createElement("div");
    head.className = "flex items-center justify-between gap-2 mb-2";
    const name = document.createElement("p");
    name.className = "font-bold";
    name.textContent = pseudonym(u.uid);
    const last = document.createElement("span");
    last.className = "text-xs text-slate-500";
    last.textContent = lastActive(u) ? `最終記録 ${formatDateTime(lastActive(u))}` : "記録なし";
    head.append(name, last);
    card.append(head);

    card.append(
      row("立場", [p.status, p.grade, p.age].filter(Boolean).join("・")),
      row("目的", (p.purposes || []).join("、")),
      row("目標", [p.goal, p.examDate && `試験日 ${p.examDate}`].filter(Boolean).join(" ・ ")),
      row("目標時間", p.dailyTarget ? `${p.dailyTarget}分/日` : ""),
      row("時間帯", (p.studyTimes || []).join("、")),
      row("悩み", (p.worries || []).join("、")),
      row("教材", (u.books || []).join("、")),
      row("達成", `${(u.history || []).length}日 ・ 勉強 ${minutes}分 ・ 記録 ${logs.length}件`),
      row("通知", u.notifyEnabled ? `${u.notifyTime || "20:00"}（${(u.notifyTokens || []).length}台）` : "オフ"),
      row("写真の保存", u.savePhotos === false ? "しない" : "する")
    );

    if (logs.length) {
      const list = document.createElement("ul");
      list.className = "mt-2 text-xs text-slate-600 space-y-0.5";
      logs.slice(0, 5).forEach((l) => {
        const li = document.createElement("li");
        const score = l.pending ? "写真待ち" : l.total ? `${l.correct}/${l.total}問` : "";
        li.textContent = `${l.date}  ${l.book || "教材なし"}  ${l.minutes || 0}分  ${l.topic || ""}  ${score}`;
        list.append(li);
      });
      card.append(list);
    }
    el.userList.append(card);
  });
}

/* ---------- 証拠写真 ---------- */
async function loadPhotos({ more = false } = {}) {
  const { collection, getDocs, query, orderBy, limit, where, startAfter } = fb.fsMod;
  if (!more) {
    data.photos = [];
    data.lastPhoto = null;
    el.photoList.innerHTML = "";
  }
  if (data.filter) {
    // 利用者で絞り込むとき：「uid で絞る＋日時で並べる」には Firestore の複合インデックスが要るので、
    // 絞り込んだ分（60日分なので多くない）をまとめて読み、ここで新しい順に並べる
    const snap = await getDocs(query(collection(fb.db, "photos"), where("uid", "==", data.filter), limit(500)));
    const items = snap.docs.map((d) => d.data()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    data.photos = items;
    items.forEach(renderPhoto);
    el.photoMoreBtn.classList.add("hidden");
  } else {
    const parts = [collection(fb.db, "photos"), orderBy("ts", "desc")];
    if (data.lastPhoto) parts.push(startAfter(data.lastPhoto));
    parts.push(limit(PAGE_SIZE));
    const snap = await getDocs(query(...parts));
    data.lastPhoto = snap.docs[snap.docs.length - 1] || data.lastPhoto;
    const items = snap.docs.map((d) => d.data());
    data.photos.push(...items);
    items.forEach(renderPhoto);
    el.photoMoreBtn.classList.toggle("hidden", snap.docs.length < PAGE_SIZE);
  }
  el.photoCountText.textContent = data.photos.length ? `${data.photos.length}件を表示中（60日たった写真は自動で削除）` : "まだ写真がありません";
}

function renderPhoto(p) {
  const card = document.createElement("section");
  card.className = "card";
  const head = document.createElement("div");
  head.className = "flex items-center justify-between gap-2 text-sm";
  const name = document.createElement("span");
  name.className = "font-bold";
  name.textContent = pseudonym(p.uid);
  const when = document.createElement("span");
  when.className = "text-xs text-slate-500";
  when.textContent = formatDateTime(p.ts);
  head.append(name, when);

  const meta = document.createElement("p");
  meta.className = "text-xs text-slate-600 mt-1";
  const score = p.total ? `${p.correct}/${p.total}問` : "";
  meta.textContent = [p.book || "教材なし", p.topic, score, p.logTs ? "あとで報告" : ""].filter(Boolean).join(" ・ ");

  const grid = document.createElement("div");
  grid.className = "grid grid-cols-4 gap-1 mt-2";
  (p.images || []).forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "証拠写真";
    img.className = "w-full aspect-[3/4] object-cover rounded-lg cursor-zoom-in bg-slate-900";
    img.addEventListener("click", () => {
      el.zoomImg.src = src;
      el.zoom.classList.remove("hidden");
    });
    grid.append(img);
  });
  card.append(head, meta, grid);
  el.photoList.append(card);
}

init().catch((err) => {
  console.error(err);
  setMessage("管理者ページを読み込めませんでした。");
});

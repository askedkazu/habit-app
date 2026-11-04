/* ==========================================================
   ちょいステップ習慣 - アプリ本体
   ----------------------------------------------------------
   画面の流れ:
     STEP1 ショートステップ（チェック → 達成ボタン）
       ↓
     STEP2 証拠写真アップロード → Gemini API で3問生成
       ↓
     STEP3 確認テスト（1問ずつ回答・採点）
       ↓
     完了画面（テストクリア！習慣達成！）
   ========================================================== */

(() => {
  "use strict";

  /* ----------------------------------------------------------
   * 定数・設定
   * -------------------------------------------------------- */
  const STORAGE_KEYS = {
    apiKey: "habitApp.geminiApiKey",
    model: "habitApp.geminiModel",
    customSteps: "habitApp.customSteps", // 旧形式：既定のステップに追加した分だけ（steps がないときに読む）
    steps: "habitApp.steps", // 自分のちょいステップの一覧（既定のものも含む全部）
    history: "habitApp.history", // 達成した日付（YYYY-MM-DD）の配列
    logs: "habitApp.logs", // 記録（日時・テーマ・正解数など）の配列
    books: "habitApp.books", // 登録した教材名の配列
    profile: "habitApp.profile", // 最初のアンケートの答え（立場・目的・悩みなど）
  };
  // タイマーの開始時刻（端末ごとの値なのでアカウントには同期しない）
  const TIMER_KEY = "habitApp.timerStart";
  const MAX_STUDY_MINUTES = 600;

  // 既定のモデル。提供終了になった場合はここ（または画面の設定欄）を変更する
  const DEFAULT_MODEL = "gemini-3.8-flash";
  // 既定のモデルが混雑などで答えないときに使う、軽くて速い予備のモデル（Firebase 経由のとき）
  const FALLBACK_MODEL = "gemini-3.5-flash-lite";
  // 1回の問い合わせを打ち切るまでの時間。SDK の既定は180秒で、混雑時に3分待たされていた
  const AI_TIMEOUT_MS = 30_000;
  // 新規ユーザーには提供終了になった旧モデル。保存されていたら既定モデルに置き換える
  const RETIRED_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"];

  const GEMINI_ENDPOINT = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  // Firebase SDK の読み込み元（アカウント機能を使うときだけ読み込む）
  const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.19.0";

  // 送信前に画像を縮小する際の最大辺（px）。通信量とAPIの負荷を抑えるため
  const MAX_IMAGE_SIZE = 1280;

  // デフォルトの超低ハードルなステップ
  // （証拠写真をスマホで撮るので、「スマホを遠ざける」系ではなく集中モードにしている）
  const DEFAULT_STEPS = [
    "机に座った",
    "教科書・ノートを出した",
    "本を1ページ開いた",
    "スマホの集中モードをオンにした",
    "1行だけ読んだ／書いた",
  ];

  // アンケートで選べるちょいステップの候補
  const STEP_CANDIDATES = [
    ...DEFAULT_STEPS,
    "ペンを持った",
    "前回の続きのページを開いた",
    "単語を1つだけ覚えた",
    "問題を1問だけ解いた",
    "タイマーを5分セットした",
    "飲み物を用意した",
    "机の上を片づけた",
  ];

  // APIキー無しで動作確認できるデモ用の問題
  const DEMO_QUIZ = {
    topic: "デモ：日本の歴史",
    questions: [
      {
        question: "江戸幕府を開いた人物は誰？",
        choices: ["織田信長", "豊臣秀吉", "徳川家康", "足利尊氏"],
        answerIndex: 2,
        explanation: "1603年、徳川家康が征夷大将軍に任命され江戸幕府を開きました。",
      },
      {
        question: "鎌倉幕府が成立した場所はどこ？",
        choices: ["京都", "鎌倉", "奈良", "大阪"],
        answerIndex: 1,
        explanation: "源頼朝が相模国の鎌倉に幕府を開きました。",
      },
      {
        question: "明治維新の後、1889年に発布された憲法は？",
        choices: ["日本国憲法", "十七条の憲法", "大日本帝国憲法", "御成敗式目"],
        answerIndex: 2,
        explanation: "1889年（明治22年）に大日本帝国憲法が発布されました。",
      },
    ],
  };

  /* ----------------------------------------------------------
   * DOM 参照ヘルパー
   * -------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    // 設定
    settingsPanel: $("settingsPanel"),
    apiKeyInput: $("apiKeyInput"),
    toggleKeyVisibility: $("toggleKeyVisibility"),
    modelSelect: $("modelSelect"),
    saveApiKey: $("saveApiKey"),
    clearApiKey: $("clearApiKey"),
    apiKeyStatus: $("apiKeyStatus"),
    // アカウント
    accountBar: $("accountBar"),
    accountAvatar: $("accountAvatar"),
    accountName: $("accountName"),
    accountStatus: $("accountStatus"),
    loginBtn: $("loginBtn"),
    logoutBtn: $("logoutBtn"),
    // 達成状況
    streakCount: $("streakCount"),
    totalCount: $("totalCount"),
    stepper: $("stepper"),
    // タブ・ヘッダー
    headerTitle: $("headerTitle"),
    flowCloseBtn: $("flowCloseBtn"),
    tabBar: $("tabBar"),
    // ホーム
    startBtn: $("startBtn"),
    homeDate: $("homeDate"),
    homeGreeting: $("homeGreeting"),
    todayChip: $("todayChip"),
    weekRow: $("weekRow"),
    monthCount: $("monthCount"),
    bestStreak: $("bestStreak"),
    nextBadgeIcon: $("nextBadgeIcon"),
    nextBadgeText: $("nextBadgeText"),
    nextBadgeBar: $("nextBadgeBar"),
    recentLogs: $("recentLogs"),
    homeLoginNudge: $("homeLoginNudge"),
    homeLoginBtn: $("homeLoginBtn"),
    // 記録
    calPrev: $("calPrev"),
    calNext: $("calNext"),
    calTitle: $("calTitle"),
    calSummary: $("calSummary"),
    calGrid: $("calGrid"),
    badgeGrid: $("badgeGrid"),
    allLogs: $("allLogs"),
    // 設定
    customStepList: $("customStepList"),
    bookManageList: $("bookManageList"),
    // 勉強の記録
    bookList: $("bookList"),
    addBookForm: $("addBookForm"),
    newBookInput: $("newBookInput"),
    studyMinutes: $("studyMinutes"),
    minusTimeBtn: $("minusTimeBtn"),
    plusTimeBtn: $("plusTimeBtn"),
    timeChips: $("timeChips"),
    timerBtn: $("timerBtn"),
    studyNextBtn: $("studyNextBtn"),
    homeStudyTime: $("homeStudyTime"),
    homeGoal: $("homeGoal"),
    tipText: $("tipText"),
    // プロフィール・アンケート
    editProfileBtn: $("editProfileBtn"),
    profileSummary: $("profileSummary"),
    obBar: $("obBar"),
    obSkipBtn: $("obSkipBtn"),
    obPage: $("obPage"),
    obBackBtn: $("obBackBtn"),
    obNextBtn: $("obNextBtn"),

    bookTotals: $("bookTotals"),
    // STEP1
    shortStepList: $("shortStepList"),
    addStepForm: $("addStepForm"),
    newStepInput: $("newStepInput"),
    achieveBtn: $("achieveBtn"),
    // STEP2
    photoInput: $("photoInput"),
    photoPreview: $("photoPreview"),
    photoPlaceholder: $("photoPlaceholder"),
    cameraInput: $("cameraInput"),
    // 再読み込み
    reloadBtn: $("reloadBtn"),
    pullIndicator: $("pullIndicator"),
    generateBtn: $("generateBtn"),
    demoBtn: $("demoBtn"),
    loading: $("loading"),
    loadingText: $("loadingText"),
    quizTiming: $("quizTiming"),
    // ログイン（メールアドレス・Google）
    authModal: $("authModal"),
    authTitle: $("authTitle"),
    authCloseBtn: $("authCloseBtn"),
    authGoogleBtn: $("authGoogleBtn"),
    authForm: $("authForm"),
    authName: $("authName"),
    authEmail: $("authEmail"),
    authPassword: $("authPassword"),
    authSubmitBtn: $("authSubmitBtn"),
    authMsg: $("authMsg"),
    authForgotBtn: $("authForgotBtn"),
    authModeBtn: $("authModeBtn"),
    // カレンダー連携・勉強プラン
    calendarCard: $("calendarCard"),
    calendarLinked: $("calendarLinked"),
    calendarStatus: $("calendarStatus"),
    calendarUnlinkBtn: $("calendarUnlinkBtn"),
    calendarSetup: $("calendarSetup"),
    calendarProviders: $("calendarProviders"),
    calendarHowto: $("calendarHowto"),
    calendarUrlInput: $("calendarUrlInput"),
    calendarSaveBtn: $("calendarSaveBtn"),
    calendarMsg: $("calendarMsg"),
    planCard: $("planCard"),
    planToggle: $("planToggle"),
    planToday: $("planToday"),
    planNote: $("planNote"),
    planWeek: $("planWeek"),
    planGoogleBtn: $("planGoogleBtn"),
    planIcsBtn: $("planIcsBtn"),
    // リマインド通知
    notifyCard: $("notifyCard"),
    notifyStatus: $("notifyStatus"),
    notifyTime: $("notifyTime"),
    notifyOnBtn: $("notifyOnBtn"),
    notifyOffBtn: $("notifyOffBtn"),
    errorMsg: $("errorMsg"),
    // STEP3
    quizProgress: $("quizProgress"),
    quizScore: $("quizScore"),
    quizBar: $("quizBar"),
    quizTopic: $("quizTopic"),
    quizQuestion: $("quizQuestion"),
    quizChoices: $("quizChoices"),
    quizFeedback: $("quizFeedback"),
    nextQuestionBtn: $("nextQuestionBtn"),
    // 完了
    doneScore: $("doneScore"),
    doneMessage: $("doneMessage"),
    doneStreak: $("doneStreak"),
    doneStreakNote: $("doneStreakNote"),
    newBadges: $("newBadges"),
    restartBtn: $("restartBtn"),
    confetti: $("confetti"),
  };

  // 記録の流れ：1 ちょいステップ → 2 勉強の記録 → 3 証拠写真 → 4 確認テスト → 完了
  const screens = {
    1: $("step1"),
    2: $("stepStudy"),
    3: $("step2"),
    4: $("step3"),
    done: $("stepDone"),
  };

  /* ----------------------------------------------------------
   * アプリの状態
   * -------------------------------------------------------- */
  const state = {
    selectedFile: null, // 選択された画像ファイル
    quiz: null,         // { topic, questions: [...] }
    currentIndex: 0,    // 現在の問題番号
    correctCount: 0,    // 正解数
    studyBook: "",      // 選んだ教材（未選択なら空）
    studyMinutes: 0,    // 勉強時間（分）
  };

  /* ----------------------------------------------------------
   * localStorage ラッパー（プライベートモード等で失敗しても落ちないように）
   * -------------------------------------------------------- */
  const storage = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      scheduleCloudPush(); // ログイン中ならアカウントにも保存
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      scheduleCloudPush();
      try {
        localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    },
    getJSON(key, fallback) {
      try {
        return JSON.parse(this.get(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      return this.set(key, JSON.stringify(value));
    },
  };

  /* ==========================================================
   * 画面遷移
   * ========================================================== */
  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => {
      node.classList.toggle("hidden", key !== String(name));
    });

    // ステッパーの表示更新
    const current = name === "done" ? 5 : Number(name);
    el.stepper.querySelectorAll(".step").forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle("active", n === current);
      s.classList.toggle("done", n < current);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ==========================================================
   * 設定（APIキー）
   * ========================================================== */
  function initSettings() {
    const savedKey = storage.get(STORAGE_KEYS.apiKey, "");
    el.apiKeyInput.value = savedKey;
    el.modelSelect.value = getModel();
    updateApiKeyStatus();

    // Firebase 経由でAIを使える場合、利用者はAPIキーを設定しなくてよいので設定欄ごと隠す
    el.settingsPanel.classList.toggle("hidden", canUseFirebaseAI());

    el.toggleKeyVisibility.addEventListener("click", () => {
      const isPw = el.apiKeyInput.type === "password";
      el.apiKeyInput.type = isPw ? "text" : "password";
      el.toggleKeyVisibility.textContent = isPw ? "隠す" : "表示";
    });

    el.saveApiKey.addEventListener("click", () => {
      const key = el.apiKeyInput.value.trim();
      if (!key) {
        el.apiKeyStatus.textContent = "APIキーを入力してください。";
        return;
      }
      storage.set(STORAGE_KEYS.apiKey, key);
      saveModel();
      updateApiKeyStatus("保存しました ✅");
    });

    el.clearApiKey.addEventListener("click", () => {
      storage.remove(STORAGE_KEYS.apiKey);
      el.apiKeyInput.value = "";
      updateApiKeyStatus("削除しました");
    });

    el.modelSelect.addEventListener("change", saveModel);
  }

  // 保存済みのモデル名を返す（未設定・提供終了モデルなら既定モデル）
  function getModel() {
    const saved = storage.get(STORAGE_KEYS.model, "").trim();
    return saved && !RETIRED_MODELS.includes(saved) ? saved : DEFAULT_MODEL;
  }

  // 入力欄のモデル名を保存（"models/xxx" 形式で貼り付けられても動くように整形）
  function saveModel() {
    const model = el.modelSelect.value.trim().replace(/^models\//, "") || DEFAULT_MODEL;
    el.modelSelect.value = model;
    storage.set(STORAGE_KEYS.model, model);
  }

  function updateApiKeyStatus(msg) {
    const key = storage.get(STORAGE_KEYS.apiKey, "");
    const base = key ? `保存済みキー: ${key.slice(0, 4)}••••${key.slice(-4)}` : "APIキーは未設定です。";
    el.apiKeyStatus.textContent = msg ? `${msg}（${base}）` : base;
  }

  /* ==========================================================
   * アカウント（Firebase Authentication + Cloud Firestore）
   * ----------------------------------------------------------
   * - firebase-config.js に設定があるときだけ有効になる
   * - Googleでログインすると、users/{uid} のドキュメントに
   *   APIキー・モデル・追加ステップ・達成履歴を保存し、端末間で共有する
   * - localStorage は表示用のキャッシュとして使い続ける
   *   （ログイン時はアカウントの内容で上書き、ログアウト時は消去）
   * ========================================================== */
  const cloud = {
    auth: null,
    db: null,
    authMod: null, // firebase-auth モジュール
    fsMod: null,   // firebase-firestore モジュール
    aiMod: null,   // firebase-ai モジュール
    ai: null,      // Firebase AI Logic のインスタンス
    appCheck: null,    // App Check のインスタンス
    appCheckMod: null, // firebase-app-check モジュール
    user: null,
    pulling: false, // アカウントから読み込み中は書き戻さない
    calendar: null, // { url, busy, syncedAt, updatedAt, error } カレンダー連携の状態
    unsubscribeDoc: null, // アカウントのデータの変更を見張るのをやめる関数
    pushTimer: null,
  };

  // Firebase 経由でAIを呼べる環境か（設定があり、公開URLなどから開いている）
  function canUseFirebaseAI() {
    return !!window.FIREBASE_CONFIG && location.protocol !== "file:";
  }

  async function initCloud() {
    const config = window.FIREBASE_CONFIG;
    if (!config) return; // 未設定ならアカウント機能は使わない

    el.accountBar.classList.remove("hidden");
    el.loginBtn.addEventListener("click", openAuthModal);
    el.homeLoginBtn.addEventListener("click", openAuthModal);
    el.logoutBtn.addEventListener("click", logout);
    initAuthModal();
    initCalendar();

    // Googleログインはファイルを直接開いた状態（file://）では使えない
    if (location.protocol === "file:") {
      setAccountUI(null, "ログインは公開URL（GitHub Pages）から開いたときに使えます");
      el.loginBtn.disabled = true;
      return;
    }

    try {
      // SDK は必要なときだけ動的に読み込む
      const [appMod, authMod, fsMod, aiMod] = await Promise.all([
        import(`${FIREBASE_SDK}/firebase-app.js`),
        import(`${FIREBASE_SDK}/firebase-auth.js`),
        import(`${FIREBASE_SDK}/firebase-firestore.js`),
        import(`${FIREBASE_SDK}/firebase-ai.js`),
      ]);
      const app = appMod.initializeApp(config);
      // App Check は AI などを使う前に有効化しておく必要がある
      await initAppCheck(app);
      cloud.authMod = authMod;
      cloud.fsMod = fsMod;
      cloud.aiMod = aiMod;
      cloud.auth = authMod.getAuth(app);
      cloud.db = fsMod.getFirestore(app);
      // Firebase AI Logic（Gemini Developer API）。APIキーは Firebase 側で管理される
      cloud.ai = aiMod.getAI(app, { backend: new aiMod.GoogleAIBackend() });
      // リマインド通知（失敗してもアプリの他の機能は使えるようにする）
      await initNotify(app).catch((err) => console.error(err));

      // ログイン状態が変わるたび（ページを開いた直後も）呼ばれる
      authMod.onAuthStateChanged(cloud.auth, async (user) => {
        cloud.user = user;
        setAccountUI(user);
        if (user) {
          closeAuthModal();
          await pullFromCloud();
          watchUserDoc();
        }
        renderNotifyUI();
        renderCalendar();
      });
    } catch (err) {
      console.error(err);
      setAccountUI(null, "アカウント機能を読み込めませんでした");
    }
  }

  /**
   * App Check を有効化する（firebase-config.js の FIREBASE_APP_CHECK が設定されているときだけ）。
   * reCAPTCHA で「本物のこのアプリからのリクエストか」を確認し、
   * Firebase AI Logic などを他のサイトやスクリプトから勝手に使われないようにする。
   */
  async function initAppCheck(app) {
    const appCheck = window.FIREBASE_APP_CHECK;
    if (!appCheck?.siteKey) return;
    const mod = await import(`${FIREBASE_SDK}/firebase-app-check.js`);
    const Provider =
      appCheck.provider === "recaptcha-enterprise" ? mod.ReCaptchaEnterpriseProvider : mod.ReCaptchaV3Provider;
    cloud.appCheckMod = mod;
    cloud.appCheck = mod.initializeAppCheck(app, {
      provider: new Provider(appCheck.siteKey),
      isTokenAutoRefreshEnabled: true, // トークンの期限が切れる前に自動で更新する
    });
  }

  async function login() {
    if (!cloud.auth) return;
    const { GoogleAuthProvider, signInWithPopup } = cloud.authMod;
    try {
      await signInWithPopup(cloud.auth, new GoogleAuthProvider());
    } catch (err) {
      console.error(err);
      // ポップアップを閉じただけの場合は何も表示しない
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
      const msg =
        err.code === "auth/unauthorized-domain"
          ? "このURLはFirebaseで許可されていません（承認済みドメインに追加してください）"
          : authErrorMessage(err);
      setAccountUI(null, msg);
      showAuthMsg(msg);
    }
  }

  /* ---------- メールアドレスでのログイン・アカウント作成 ---------- */
  let authMode = "login"; // "login" | "signup"

  function openAuthModal() {
    if (!cloud.auth) return;
    setAuthMode("login");
    el.authMsg.classList.add("hidden");
    el.authModal.classList.remove("hidden");
  }

  function closeAuthModal() {
    el.authModal.classList.add("hidden");
    el.authPassword.value = "";
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === "signup";
    el.authTitle.textContent = signup ? "アカウントを作成" : "ログイン";
    el.authSubmitBtn.textContent = signup ? "メールアドレスで登録する" : "メールアドレスでログイン";
    el.authModeBtn.textContent = signup ? "すでにアカウントがある" : "アカウントを作成する";
    el.authName.classList.toggle("hidden", !signup);
    el.authForgotBtn.classList.toggle("invisible", signup);
    el.authPassword.autocomplete = signup ? "new-password" : "current-password";
    el.authMsg.classList.add("hidden");
  }

  function showAuthMsg(text, ok = false) {
    el.authMsg.textContent = text;
    el.authMsg.className = `text-sm mt-2 rounded-lg p-2 ${ok ? "msg-ok" : "msg-error"}`;
  }

  // Firebase のエラーを、利用者に分かる日本語にする
  function authErrorMessage(err) {
    const messages = {
      "auth/invalid-email": "メールアドレスの形式が正しくありません",
      "auth/missing-email": "メールアドレスを入力してください",
      "auth/missing-password": "パスワードを入力してください",
      "auth/weak-password": "パスワードは6文字以上にしてください",
      "auth/email-already-in-use": "このメールアドレスはすでに登録されています。「すでにアカウントがある」からログインしてください（Googleで登録した場合は「Googleでログイン」）",
      "auth/invalid-credential": "メールアドレスかパスワードが違います",
      "auth/wrong-password": "メールアドレスかパスワードが違います",
      "auth/user-not-found": "このメールアドレスのアカウントはありません。「アカウントを作成する」から登録してください",
      "auth/too-many-requests": "何度も失敗したため、一時的にログインできません。しばらく待ってからお試しください",
      "auth/network-request-failed": "通信に失敗しました。ネットワークを確認してください",
      "auth/operation-not-allowed": "メールアドレスでのログインが有効になっていません（管理者の設定が必要です）",
      "auth/popup-blocked": "ポップアップがブロックされました。ブラウザの設定で許可してください",
    };
    return messages[err?.code] || `ログインに失敗しました（${err?.code || err?.message}）`;
  }

  async function submitAuthForm(e) {
    e.preventDefault();
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendEmailVerification } =
      cloud.authMod;
    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    el.authSubmitBtn.disabled = true;
    try {
      if (authMode === "signup") {
        const { user } = await createUserWithEmailAndPassword(cloud.auth, email, password);
        const name = el.authName.value.trim();
        if (name) {
          await updateProfile(user, { displayName: name });
          setAccountUI(user); // ログイン直後の表示はメールアドレスなので、ニックネームに更新する
        }
        // 確認メールは届かなくても使えるようにする（パスワードを忘れたときに必要になる）
        sendEmailVerification(user).catch(() => {});
      } else {
        await signInWithEmailAndPassword(cloud.auth, email, password);
      }
      // ログインできたら onAuthStateChanged でシートを閉じる
    } catch (err) {
      console.error(err);
      showAuthMsg(authErrorMessage(err));
    } finally {
      el.authSubmitBtn.disabled = false;
    }
  }

  async function sendPasswordReset() {
    const email = el.authEmail.value.trim();
    if (!email) {
      showAuthMsg("パスワードを再設定するメールアドレスを入力してください");
      el.authEmail.focus();
      return;
    }
    try {
      await cloud.authMod.sendPasswordResetEmail(cloud.auth, email);
      showAuthMsg(`${email} にパスワード再設定のメールを送りました（届かないときは迷惑メールも確認してください）`, true);
    } catch (err) {
      showAuthMsg(authErrorMessage(err));
    }
  }

  function initAuthModal() {
    el.authCloseBtn.addEventListener("click", closeAuthModal);
    el.authModal.addEventListener("click", (e) => e.target === el.authModal && closeAuthModal());
    el.authGoogleBtn.addEventListener("click", login);
    el.authForm.addEventListener("submit", submitAuthForm);
    el.authForgotBtn.addEventListener("click", sendPasswordReset);
    el.authModeBtn.addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
  }

  async function logout() {
    if (!cloud.auth) return;
    // 保存待ちの変更があれば、ログアウト前にアカウントへ書き込んでおく
    if (cloud.pushTimer) {
      clearTimeout(cloud.pushTimer);
      cloud.pushTimer = null;
      await pushToCloud();
    }
    // ログアウトした端末に、その人の通知が届き続けないようにする
    if (getLocalNotifyToken()) await disableNotify().catch(() => {});
    cloud.unsubscribeDoc?.();
    cloud.unsubscribeDoc = null;
    cloud.calendar = null;
    await cloud.authMod.signOut(cloud.auth);
    // 次に使う人に記録やAPIキーが見えないよう、この端末のデータを消す
    Object.values(STORAGE_KEYS).forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    });
    refreshUserDataUI();
  }

  function setAccountUI(user, statusMsg) {
    el.loginBtn.classList.toggle("hidden", !!user);
    el.logoutBtn.classList.toggle("hidden", !user);
    el.accountAvatar.classList.toggle("hidden", !user?.photoURL);
    if (user?.photoURL) el.accountAvatar.src = user.photoURL;
    el.accountName.textContent = user ? user.displayName || user.email || "ログイン中" : "ログインしていません";
    el.accountStatus.textContent =
      statusMsg || (user ? "記録はアカウントに保存されています" : "ログインすると、AIで問題を作れて、記録もスマホとPCで共有できます");
    // ホームでもログインをすすめる（ログインできる環境で未ログインのとき）
    el.homeLoginNudge.classList.toggle("hidden", !!user || !cloud.auth);
  }

  function userDocRef() {
    return cloud.fsMod.doc(cloud.db, "users", cloud.user.uid);
  }

  // アカウントのデータを読み込み、この端末に反映する
  async function pullFromCloud() {
    cloud.pulling = true;
    try {
      const snap = await cloud.fsMod.getDoc(userDocRef());
      cloud.notifyTime = null; // 別のアカウントの設定が残らないようにする
      if (snap.exists()) {
        const d = snap.data();
        writeLocal(STORAGE_KEYS.apiKey, d.apiKey || null);
        writeLocal(STORAGE_KEYS.model, d.model || null);
        writeLocal(STORAGE_KEYS.customSteps, JSON.stringify(d.customSteps || []));
        // アカウントにまだ一覧がなければ、この端末の一覧を残す（次の保存でアカウントへ）
        if (d.steps?.length) writeLocal(STORAGE_KEYS.steps, JSON.stringify(d.steps));
        writeLocal(STORAGE_KEYS.books, JSON.stringify(d.books || []));
        // アカウントにまだ答えがなければ、この端末の答えを残す（次の保存でアカウントへ）
        if (d.profile) writeLocal(STORAGE_KEYS.profile, JSON.stringify(d.profile));
        writeLocal(STORAGE_KEYS.history, JSON.stringify(d.history || []));
        writeLocal(STORAGE_KEYS.logs, JSON.stringify(sortLogs(d.logs || [])));
        cloud.notifyTime = d.notifyTime || null;
      } else {
        // 初めてのログイン：この端末の記録をアカウントに引き継ぐ
        await pushToCloud();
      }
      refreshUserDataUI();
    } catch (err) {
      console.error(err);
      setAccountUI(cloud.user, "アカウントのデータを読み込めませんでした");
    } finally {
      cloud.pulling = false;
    }
  }

  // この端末のデータをアカウントに保存する
  async function pushToCloud() {
    cloud.pushTimer = null;
    if (!cloud.user) return;
    const { setDoc, serverTimestamp, arrayUnion } = cloud.fsMod;
    const data = {
      apiKey: storage.get(STORAGE_KEYS.apiKey, ""),
      model: storage.get(STORAGE_KEYS.model, ""),
      customSteps: storage.getJSON(STORAGE_KEYS.customSteps, []),
      steps: getAllSteps(),
      books: getBooks(),
      profile: getProfile(),
      updatedAt: serverTimestamp(),
    };
    // 達成履歴は上書きせず追加する（別の端末で達成した日が消えないように）
    const history = getHistory();
    if (history.length) data.history = arrayUnion(...history);
    // 記録も同じく追加していく（同じ内容の記録は Firestore 側で重複しない）
    const logs = getLogs();
    if (logs.length) data.logs = arrayUnion(...logs);
    try {
      await setDoc(userDocRef(), data, { merge: true });
      setAccountUI(cloud.user);
    } catch (err) {
      console.error(err);
      setAccountUI(cloud.user, "アカウントへの保存に失敗しました");
    }
  }

  // 保存操作が続いても1回にまとめてアカウントへ書き込む
  function scheduleCloudPush() {
    if (!cloud.user || cloud.pulling) return;
    clearTimeout(cloud.pushTimer);
    cloud.pushTimer = setTimeout(pushToCloud, 300);
  }

  // アカウントから読み込んだ値をそのまま localStorage に書く（書き戻しはしない）
  function writeLocal(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* noop */
    }
  }

  // ログイン・ログアウトでデータが入れ替わったときに画面を更新する
  function refreshUserDataUI() {
    el.apiKeyInput.value = storage.get(STORAGE_KEYS.apiKey, "");
    el.modelSelect.value = getModel();
    updateApiKeyStatus();
    renderShortSteps();
    renderBookList();
    renderProfileSummary();
    renderStats();
    // ログインしたらアカウントに答えがあった → アンケートは閉じる
    if (!TABS.onboarding.node.classList.contains("hidden") && getProfile().done) showTab("home");
  }

  /* ==========================================================
   * リマインド通知（Firebase Cloud Messaging）
   * ----------------------------------------------------------
   * - 「この端末で通知を受け取る」を押すと、通知の許可を取り、
   *   この端末の通知の宛先（FCMトークン）を users/{uid} に保存する
   * - 通知を送るのは GitHub Actions（.github/workflows/notify.yml）。
   *   15分ごとに、通知時刻を過ぎていて今日まだ達成していない人に送る
   * - アプリを閉じていても sw.js（Service Worker）が受け取って表示する
   * ========================================================== */
  const NOTIFY_TOKEN_KEY = "habitApp.notifyToken"; // この端末のFCMトークン
  const DEFAULT_NOTIFY_TIME = "20:00";

  const notify = {
    mod: null,       // firebase-messaging モジュール
    messaging: null,
    supported: false,
  };

  async function initNotify(app) {
    if (!window.FIREBASE_VAPID_KEY) return; // 未設定なら通知機能は出さない
    const mod = await import(`${FIREBASE_SDK}/firebase-messaging.js`);
    notify.mod = mod;
    notify.supported = await mod.isSupported().catch(() => false);
    if (notify.supported) notify.messaging = mod.getMessaging(app);

    el.notifyOnBtn.addEventListener("click", () => runNotifyAction(enableNotify));
    el.notifyOffBtn.addEventListener("click", () => runNotifyAction(disableNotify));
    el.notifyTime.addEventListener("change", saveNotifyTime);
  }

  function getLocalNotifyToken() {
    return storage.get(NOTIFY_TOKEN_KEY, "");
  }

  function setLocalNotifyToken(token) {
    // 端末ごとの値なのでアカウントには同期しない（writeLocal を使う）
    writeLocal(NOTIFY_TOKEN_KEY, token || null);
  }

  // 通知の許可状態（Notification がない環境では "unsupported"）
  function notifyPermission() {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  }

  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  // 通知カードの表示を、ログイン状態・端末の対応状況・許可状態に合わせて更新する
  function renderNotifyUI(message) {
    const show = !!(window.FIREBASE_VAPID_KEY && notify.mod && cloud.user);
    el.notifyCard.classList.toggle("hidden", !show);
    if (!show) return;

    el.notifyTime.value = cloud.notifyTime || DEFAULT_NOTIFY_TIME;
    const on = !!getLocalNotifyToken() && notifyPermission() === "granted";
    el.notifyOnBtn.classList.toggle("hidden", on);
    el.notifyOffBtn.classList.toggle("hidden", !on);
    el.notifyOnBtn.disabled = false;

    let status;
    if (message) {
      status = message;
    } else if (!notify.supported) {
      // iPhone はホーム画面に追加して開いたときだけ通知を使える
      status =
        isIOS() && !isStandalone()
          ? "通知を使うには、Safariの共有ボタン →「ホーム画面に追加」で追加したアプリから開いてください"
          : "このブラウザは通知に対応していません";
      el.notifyOnBtn.disabled = true;
    } else if (notifyPermission() === "denied") {
      status = "通知がブロックされています。端末の設定で、このアプリの通知を許可してください";
      el.notifyOnBtn.disabled = true;
    } else if (on) {
      status = `毎日 ${el.notifyTime.value} にお知らせします（その日達成済みなら送りません）`;
    } else {
      status = "毎日決まった時刻にお知らせします（その日達成済みなら送りません）";
    }
    el.notifyStatus.textContent = status;
  }

  // ボタン操作中は二重に押せないようにし、失敗したら理由を表示する
  async function runNotifyAction(action) {
    el.notifyOnBtn.disabled = true;
    el.notifyOffBtn.disabled = true;
    try {
      await action();
      renderNotifyUI();
    } catch (err) {
      console.error(err);
      renderNotifyUI(`通知の設定に失敗しました（${err.code || err.message}）`);
    } finally {
      el.notifyOffBtn.disabled = false;
    }
  }

  // この端末で通知を受け取れるようにする
  async function enableNotify() {
    // 許可ダイアログは、ボタンを押した直後に出す必要がある（iPhone の制約）
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("通知が許可されませんでした");
    }
    const registration = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const token = await notify.mod.getToken(notify.messaging, {
      vapidKey: window.FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error("通知の宛先を取得できませんでした");

    const { setDoc, arrayUnion } = cloud.fsMod;
    const time = el.notifyTime.value || DEFAULT_NOTIFY_TIME;
    await setDoc(
      userDocRef(),
      {
        notifyEnabled: true,
        notifyTime: time,
        notifyTz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
        notifyTokens: arrayUnion(token),
      },
      { merge: true }
    );
    cloud.notifyTime = time;
    setLocalNotifyToken(token);
  }

  // この端末への通知をやめる（他の端末の通知はそのまま）
  async function disableNotify() {
    const token = getLocalNotifyToken();
    if (token && cloud.user) {
      const { setDoc, arrayRemove } = cloud.fsMod;
      await setDoc(userDocRef(), { notifyTokens: arrayRemove(token) }, { merge: true });
    }
    if (notify.messaging) await notify.mod.deleteToken(notify.messaging).catch(() => {});
    setLocalNotifyToken(null);
  }

  // 通知時刻を変えたらアカウントに保存する（全端末共通）
  async function saveNotifyTime() {
    if (!cloud.user) return;
    const time = el.notifyTime.value || DEFAULT_NOTIFY_TIME;
    try {
      await cloud.fsMod.setDoc(
        userDocRef(),
        { notifyTime: time, notifyTz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo" },
        { merge: true }
      );
      cloud.notifyTime = time;
      renderNotifyUI();
    } catch (err) {
      console.error(err);
      renderNotifyUI("通知時刻を保存できませんでした");
    }
  }

  /* ==========================================================
   * カレンダー連携と勉強プラン
   * ----------------------------------------------------------
   * - 利用者が貼った「カレンダーの非公開URL（iCal形式）」を users/{uid}.calendarUrl に保存する
   * - GitHub Actions（scripts/sync-calendars.mjs）が予定の入っている時間帯だけを読み取り、
   *   users/{uid}.calendarBusy に保存する（ブラウザからは他サイトのカレンダーを直接読めないため）
   * - アプリはその時間帯を避けて、アンケートの「勉強しやすい時間帯」「1日の目標時間」から
   *   毎日の勉強プランを立てる
   * ========================================================== */
  const CALENDAR_HOWTO = {
    google: [
      "パソコンで Googleカレンダー を開き、右上の ⚙️ →「設定」",
      "左の「マイカレンダーの設定」で、自分のカレンダーを選ぶ",
      "下の方の「iCal 形式の非公開URL」をコピーする（「公開URL」ではない方）",
      "下の欄に貼り付けて「連携する」",
    ],
    icloud: [
      "iPhone の「カレンダー」アプリで、画面下の「カレンダー」をタップ",
      "使っているカレンダーの右の ⓘ をタップ",
      "「公開カレンダー」をオンにして「リンクを共有」→「コピー」",
      "下の欄に貼り付けて「連携する」（リンクを知っている人は予定を見られるので、他の人には教えないでください）",
    ],
    outlook: [
      "ブラウザで Outlook.com を開き、⚙️ 設定 →「予定表」→「共有予定表」",
      "「予定表を公開する」で、カレンダーと「空き時間情報のみ表示」を選んで「公開」",
      "表示された「ICS」のリンクをコピーする",
      "下の欄に貼り付けて「連携する」",
    ],
  };

  // アンケートの「勉強しやすい時間帯」→ 探す時間の範囲（0時からの分）
  const TIME_WINDOWS = {
    朝: [6 * 60, 8 * 60 + 30],
    昼休み: [12 * 60, 13 * 60],
    "放課後・仕事のあと": [16 * 60, 19 * 60],
    夜: [19 * 60, 22 * 60],
    寝る前: [21 * 60 + 30, 23 * 60 + 30],
  };
  const WIDE_WINDOW = [7 * 60, 23 * 60]; // 希望の時間帯が埋まっているときに探す範囲
  const PLAN_BUFFER_MIN = 10; // 予定の前後は少しあける
  const PLAN_DAYS = 7;

  // アカウントのデータの変更を見張る（GitHub Actions がカレンダーを読み込んだら、すぐ画面に出す）
  function watchUserDoc() {
    cloud.unsubscribeDoc?.();
    cloud.unsubscribeDoc = cloud.fsMod.onSnapshot(
      userDocRef(),
      (snap) => {
        const d = snap.data() || {};
        cloud.calendar = d.calendarUrl
          ? {
              url: d.calendarUrl,
              busy: Array.isArray(d.calendarBusy) ? d.calendarBusy : null,
              syncedAt: d.calendarSyncedAt?.toMillis?.() || 0,
              updatedAt: d.calendarUpdatedAt?.toMillis?.() || 0,
              error: d.calendarError || "",
            }
          : null;
        renderCalendar();
      },
      (err) => console.error(err)
    );
  }

  let calendarProvider = "google";

  function initCalendar() {
    el.calendarProviders.querySelectorAll("[data-provider]").forEach((btn) =>
      btn.addEventListener("click", () => {
        calendarProvider = btn.dataset.provider;
        renderCalendar();
      })
    );
    el.calendarSaveBtn.addEventListener("click", saveCalendarUrl);
    el.calendarUnlinkBtn.addEventListener("click", unlinkCalendar);
    el.planToggle.addEventListener("click", () => {
      const open = el.planWeek.classList.toggle("hidden");
      el.planToggle.textContent = open ? "7日分を見る" : "閉じる";
    });
    el.planIcsBtn.addEventListener("click", downloadPlanIcs);
  }

  async function saveCalendarUrl() {
    const url = el.calendarUrlInput.value.trim();
    el.calendarMsg.textContent = "";
    if (!/^(https?|webcals?):\/\/\S+$/i.test(url)) {
      el.calendarMsg.textContent = "https:// か webcal:// で始まるURLを貼り付けてください";
      return;
    }
    const { setDoc, serverTimestamp, deleteField } = cloud.fsMod;
    el.calendarSaveBtn.disabled = true;
    try {
      await setDoc(
        userDocRef(),
        { calendarUrl: url, calendarUpdatedAt: serverTimestamp(), calendarError: deleteField(), calendarBusy: deleteField() },
        { merge: true }
      );
      el.calendarUrlInput.value = "";
    } catch (err) {
      console.error(err);
      el.calendarMsg.textContent = "保存できませんでした。もう一度お試しください";
    } finally {
      el.calendarSaveBtn.disabled = false;
    }
  }

  async function unlinkCalendar() {
    const { setDoc, deleteField } = cloud.fsMod;
    await setDoc(
      userDocRef(),
      {
        calendarUrl: deleteField(),
        calendarBusy: deleteField(),
        calendarSyncedAt: deleteField(),
        calendarUpdatedAt: deleteField(),
        calendarError: deleteField(),
      },
      { merge: true }
    ).catch((err) => console.error(err));
  }

  function formatClock(date) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function renderCalendar() {
    const loggedIn = !!cloud.user;
    el.calendarCard.classList.toggle("hidden", !loggedIn);
    const cal = cloud.calendar;
    el.calendarLinked.classList.toggle("hidden", !cal);
    el.calendarSetup.classList.toggle("hidden", !!cal);

    el.calendarProviders.querySelectorAll("[data-provider]").forEach((btn) =>
      btn.classList.toggle("selected", btn.dataset.provider === calendarProvider)
    );
    el.calendarHowto.innerHTML = "";
    CALENDAR_HOWTO[calendarProvider].forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      el.calendarHowto.append(li);
    });

    if (cal) {
      const waiting = !cal.syncedAt || cal.updatedAt > cal.syncedAt;
      el.calendarStatus.className = `text-sm ${cal.error && !waiting ? "text-rose-600" : "text-slate-700"}`;
      el.calendarStatus.textContent = waiting
        ? "✅ 連携しました。予定を読み込み中です（最大15分ほどかかります）"
        : cal.error
          ? `⚠️ ${cal.error}。URLを確かめて、連携し直してください`
          : `✅ 連携中（${formatClock(new Date(cal.syncedAt))} に読み込み・これから8日間の予定 ${cal.busy?.length || 0} 件）`;
    }
    renderPlan();
  }

  /**
   * カレンダーの空き時間から、今日から PLAN_DAYS 日分の勉強時間を1日1つずつ決める。
   * 希望の時間帯 → 広い時間帯 → 時間を短くして、の順に探す。
   * @returns {{ day: Date, start?: Date, end?: Date, minutes?: number, relaxed?: string }[]}
   */
  function buildStudyPlan(busy, profile, now = new Date()) {
    const target = Math.min(profile.dailyTarget || 15, 120);
    const preferred = (profile.studyTimes || []).map((t) => TIME_WINDOWS[t]).filter(Boolean);
    const windows = preferred.length ? preferred : [TIME_WINDOWS["夜"]];
    const blocks = (busy || []).map((b) => ({ s: b.s - PLAN_BUFFER_MIN * 60000, e: b.e + PLAN_BUFFER_MIN * 60000 }));
    const isFree = (s, e) => !blocks.some((b) => s < b.e && e > b.s);

    // 空いている最初の時間を、15分刻みで探す
    const find = (day, [from, to], minutes) => {
      for (let m = from; m + minutes <= to; m += 15) {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
        const end = new Date(start.getTime() + minutes * 60000);
        if (start < new Date(now.getTime() + 5 * 60000)) continue; // もう過ぎた時間は使わない
        if (isFree(start.getTime(), end.getTime())) return { start, end, minutes };
      }
      return null;
    };

    const plan = [];
    for (let i = 0; i < PLAN_DAYS; i++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      let slot = null;
      for (const w of windows) if (!slot) slot = find(day, w, target);
      if (!slot) {
        const wide = find(day, WIDE_WINDOW, target);
        if (wide) slot = { ...wide, relaxed: "time" };
      }
      if (!slot && target > 5) {
        const short = find(day, WIDE_WINDOW, 5);
        if (short) slot = { ...short, relaxed: "short" };
      }
      plan.push({ day, ...(slot || {}) });
    }
    return plan;
  }

  let currentPlan = [];

  function renderPlan() {
    const cal = cloud.calendar;
    const show = !!(cloud.user && cal);
    el.planCard.classList.toggle("hidden", !show);
    if (!show) return;

    if (!cal.busy) {
      el.planToday.textContent = "カレンダーを読み込み中…";
      el.planNote.textContent = "連携してから最大15分ほどで、空き時間からプランを立てます";
      el.planWeek.innerHTML = "";
      el.planGoogleBtn.classList.add("hidden");
      el.planIcsBtn.classList.add("hidden");
      return;
    }

    const profile = getProfile();
    currentPlan = buildStudyPlan(cal.busy, profile);
    const today = currentPlan[0];
    const doneToday = getHistory().includes(dateKey());
    const timeText = (p) => `${formatClock(p.start)}〜${formatClock(p.end)}（${p.minutes}分）`;

    if (doneToday) {
      el.planToday.textContent = "今日はもう達成済み！🎉";
      const tomorrow = currentPlan[1];
      el.planNote.textContent = tomorrow?.start ? `明日は ${timeText(tomorrow)} があいています` : "";
    } else if (today.start) {
      el.planToday.textContent = `${timeText(today)} がおすすめ`;
      el.planNote.textContent =
        today.relaxed === "short"
          ? "今日は予定が多いので、5分だけでもOK"
          : today.relaxed === "time"
            ? "希望の時間帯は予定が入っているので、空いている時間にしました"
            : "カレンダーの空き時間から選びました";
    } else {
      el.planToday.textContent = "今日はもう空き時間がなさそう";
      el.planNote.textContent = "ちょいステップを1つだけでもOK。明日のプランは「7日分を見る」から";
    }

    el.planWeek.innerHTML = "";
    currentPlan.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-2 py-2";
      const day = document.createElement("span");
      day.className = "font-bold text-slate-700";
      day.textContent = `${i === 0 ? "今日" : i === 1 ? "明日" : `${p.day.getMonth() + 1}/${p.day.getDate()}`}（${WEEKDAYS[p.day.getDay()]}）`;
      const time = document.createElement("span");
      time.className = p.start ? "text-slate-600" : "text-slate-400";
      time.textContent = p.start ? timeText(p) : "空き時間なし";
      li.append(day, time);
      el.planWeek.append(li);
    });

    // カレンダーに入れるボタン：今日（達成済みなら明日）の予定
    const target = (doneToday ? currentPlan[1] : today)?.start ? (doneToday ? currentPlan[1] : today) : currentPlan.find((p) => p.start);
    el.planGoogleBtn.classList.toggle("hidden", !target);
    el.planIcsBtn.classList.toggle("hidden", !currentPlan.some((p) => p.start));
    if (target) el.planGoogleBtn.href = googleCalendarUrl(target);
  }

  // iCal / Google カレンダー用の日時（UTC）
  function toIcsUtc(date) {
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  const PLAN_EVENT_TITLE = "📚 ちょいステップ（勉強）";
  const APP_URL = "https://askedkazu.github.io/habit-app/";

  function googleCalendarUrl(p) {
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: PLAN_EVENT_TITLE,
      dates: `${toIcsUtc(p.start)}/${toIcsUtc(p.end)}`,
      details: `今日のちょいステップ。机に座るだけでもOK！\n${APP_URL}`,
    });
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  // 7日分のプランを .ics ファイルにして渡す（iPhone・Outlook などのカレンダーに入れられる）
  function downloadPlanIcs() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//chotto-step//study-plan//JA", "CALSCALE:GREGORIAN"];
    currentPlan
      .filter((p) => p.start)
      .forEach((p) => {
        lines.push(
          "BEGIN:VEVENT",
          `UID:chotto-step-${dateKey(p.day)}@askedkazu.github.io`,
          `DTSTAMP:${toIcsUtc(new Date())}`,
          `DTSTART:${toIcsUtc(p.start)}`,
          `DTEND:${toIcsUtc(p.end)}`,
          `SUMMARY:${PLAN_EVENT_TITLE}`,
          `DESCRIPTION:今日のちょいステップ。机に座るだけでもOK！\\n${APP_URL}`,
          "BEGIN:VALARM",
          "TRIGGER:-PT5M",
          "ACTION:DISPLAY",
          `DESCRIPTION:${PLAN_EVENT_TITLE}`,
          "END:VALARM",
          "END:VEVENT"
        );
      });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chotto-step-plan.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  /* ==========================================================
   * 達成履歴（連続日数・累計）
   * ========================================================== */
  // ローカル時刻ベースで YYYY-MM-DD を返す
  function dateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getHistory() {
    return storage.getJSON(STORAGE_KEYS.history, []);
  }

  // 今日を達成済みとして記録（同日の重複は記録しない）
  function recordAchievement() {
    const history = getHistory();
    const today = dateKey();
    if (!history.includes(today)) {
      history.push(today);
      storage.setJSON(STORAGE_KEYS.history, history);
    }
  }

  // 今日（未達成なら昨日）から遡って連続日数を数える
  function calcStreak(history) {
    const set = new Set(history);
    const d = new Date();
    if (!set.has(dateKey(d))) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (set.has(dateKey(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  // これまでで一番長く続いた連続日数
  function calcBestStreak(history) {
    const days = [...new Set(history)].sort().map(parseDateKey);
    let best = 0;
    let run = 0;
    days.forEach((d, i) => {
      const prev = days[i - 1];
      run = prev && Math.round((d - prev) / 86400000) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    });
    return best;
  }

  // "YYYY-MM-DD" → その日の0時（ローカル時刻）
  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  /* ---------- 記録（タイムライン用） ---------- */
  function getLogs() {
    return storage.getJSON(STORAGE_KEYS.logs, []);
  }

  function sortLogs(logs) {
    return [...logs].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }

  function addLog(log) {
    const logs = sortLogs([...getLogs(), log]).slice(-365); // 端末には直近365件まで
    storage.setJSON(STORAGE_KEYS.logs, logs);
  }

  /* ---------- バッジ ---------- */
  // type: "streak" は自己ベストの連続日数、"total" は累計達成日数で判定する
  const BADGES = [
    { id: "first", icon: "🌱", name: "はじめの一歩", type: "total", goal: 1 },
    { id: "streak3", icon: "🥉", name: "3日連続", type: "streak", goal: 3 },
    { id: "streak7", icon: "🥈", name: "7日連続", type: "streak", goal: 7 },
    { id: "total10", icon: "📘", name: "累計10日", type: "total", goal: 10 },
    { id: "streak14", icon: "🥇", name: "14日連続", type: "streak", goal: 14 },
    { id: "streak30", icon: "🏆", name: "30日連続", type: "streak", goal: 30 },
    { id: "total50", icon: "📚", name: "累計50日", type: "total", goal: 50 },
    { id: "total100", icon: "👑", name: "累計100日", type: "total", goal: 100 },
  ];

  function badgeProgress(badge, history) {
    const value = badge.type === "streak" ? calcBestStreak(history) : new Set(history).size;
    return { value: Math.min(value, badge.goal), earned: value >= badge.goal };
  }

  function earnedBadgeIds(history) {
    return BADGES.filter((b) => badgeProgress(b, history).earned).map((b) => b.id);
  }

  function badgeTile(badge, locked) {
    const div = document.createElement("div");
    div.className = `badge-tile${locked ? " locked" : ""}`;
    const icon = document.createElement("div");
    icon.className = "badge-icon";
    icon.textContent = badge.icon;
    const name = document.createElement("p");
    name.textContent = badge.name;
    div.append(icon, name);
    return div;
  }

  /* ---------- 画面の描画 ---------- */
  function renderStats() {
    renderHome();
    renderRecord();
  }

  function renderHome() {
    const history = getHistory();
    const set = new Set(history);
    const now = new Date();
    const doneToday = set.has(dateKey(now));

    el.homeDate.textContent = `${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）`;
    const hour = now.getHours();
    el.homeGreeting.textContent = doneToday
      ? "今日もよくがんばりました！"
      : hour < 11 ? "おはよう！今日も一歩だけ" : hour < 17 ? "こんにちは！今日の一歩はまだ？" : "こんばんは！5分だけやってみよう";
    el.todayChip.textContent = doneToday ? "今日は達成 ✓" : "今日はまだ";
    el.todayChip.classList.toggle("done", doneToday);
    el.streakCount.textContent = calcStreak(history);
    el.startBtn.textContent = doneToday ? "もう一度チャレンジする" : "今日のちょいステップを始める";

    // 今日・今週（月曜はじまり）の勉強時間
    const logs = getLogs();
    const weekStart = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
    const todayMin = logs.filter((l) => l.date === dateKey(now)).reduce((sum, l) => sum + (l.minutes || 0), 0);
    const weekMin = logs.filter((l) => l.date >= weekStart).reduce((sum, l) => sum + (l.minutes || 0), 0);
    const profile = getProfile();
    const target = profile.dailyTarget || 0;
    el.homeStudyTime.textContent = target
      ? `⏱ 今日 ${todayMin} / ${target}分${todayMin >= target ? " 達成！" : ""} ・ 今週 ${formatMinutes(weekMin)}`
      : `⏱ 今日 ${formatMinutes(todayMin)} ・ 今週 ${formatMinutes(weekMin)}`;
    // 目標と、試験日までのカウントダウン
    const left = daysUntil(profile.examDate);
    const countdown = left === null ? "" : left === 0 ? "今日が本番！" : `あと${left}日`;
    const goalText = [profile.goal, countdown].filter(Boolean).join(" ・ ") || "";
    el.homeGoal.classList.toggle("hidden", !goalText);
    el.homeGoal.textContent = goalText ? `🎯 ${profile.goal ? goalText : `試験まで ${countdown}`}` : "";

    el.tipText.textContent = todaysTip(profile, now);

    // 今週（月曜はじまり）の達成
    el.weekRow.innerHTML = "";
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const key = dateKey(d);
      const li = document.createElement("li");
      li.className = "week-day";
      if (set.has(key)) li.classList.add("done");
      if (key === dateKey(now)) li.classList.add("today");
      if (d > now) li.classList.add("future");
      const dot = document.createElement("span");
      dot.className = "week-dot";
      dot.textContent = set.has(key) ? "🔥" : String(d.getDate());
      const label = document.createElement("span");
      label.textContent = WEEKDAYS[d.getDay()];
      li.append(dot, label);
      el.weekRow.append(li);
    }

    // 数字
    const monthPrefix = dateKey(now).slice(0, 7);
    el.totalCount.textContent = set.size;
    el.monthCount.textContent = [...set].filter((k) => k.startsWith(monthPrefix)).length;
    el.bestStreak.textContent = calcBestStreak(history);

    // 次のバッジ（残り日数が一番少ないもの）
    const next = BADGES.map((b) => ({ b, ...badgeProgress(b, history) }))
      .filter((x) => !x.earned)
      .sort((x, y) => x.b.goal - x.value - (y.b.goal - y.value))[0];
    if (next) {
      el.nextBadgeIcon.textContent = next.b.icon;
      el.nextBadgeText.textContent = `${next.b.name} まで あと${next.b.goal - next.value}日`;
      el.nextBadgeBar.style.width = `${(next.value / next.b.goal) * 100}%`;
    } else {
      el.nextBadgeIcon.textContent = "👑";
      el.nextBadgeText.textContent = "すべてのバッジを獲得しました！";
      el.nextBadgeBar.style.width = "100%";
    }

    renderLogList(el.recentLogs, getLogs().reverse().slice(0, 3));
    if (cloud.calendar) renderPlan(); // 達成したらプランの表示も変える
  }

  // 記録の一覧（新しい順）を描画する
  function renderLogList(container, logs) {
    container.innerHTML = "";
    if (logs.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-note";
      li.textContent = "まだ記録がありません。今日の一歩から始めよう！";
      container.append(li);
      return;
    }
    logs.forEach((log) => {
      const d = parseDateKey(log.date);
      const time = log.ts ? new Date(log.ts) : null;
      const li = document.createElement("li");
      li.className = "log-item";

      const date = document.createElement("div");
      date.className = "log-date";
      const day = document.createElement("b");
      day.textContent = d.getDate();
      const md = document.createElement("span");
      md.textContent = `${d.getMonth() + 1}月(${WEEKDAYS[d.getDay()]})`;
      date.append(day, md);

      const body = document.createElement("div");
      body.className = "flex-1 min-w-0";
      const topic = document.createElement("p");
      topic.className = "text-sm font-bold truncate";
      topic.textContent = log.topic || "ちょいステップ達成";
      const sub = document.createElement("p");
      sub.className = "text-xs text-slate-500";
      const parts = [];
      if (log.book) parts.push(`📚 ${log.book}`);
      if (log.minutes) parts.push(`⏱ ${formatMinutes(log.minutes)}`);
      if (log.steps && !log.book && !log.minutes) parts.push(`ステップ ${log.steps}個`);
      if (time) parts.push(`${time.getHours()}:${String(time.getMinutes()).padStart(2, "0")}`);
      sub.textContent = parts.join(" ・ ");
      body.append(topic, sub);

      li.append(date, body);
      if (log.total) {
        const score = document.createElement("span");
        score.className = `log-score${log.correct === log.total ? " perfect" : ""}`;
        score.textContent = `${log.correct}/${log.total}問`;
        li.append(score);
      }
      container.append(li);
    });
  }

  // 記録タブ：カレンダー・バッジ・タイムライン
  function renderRecord() {
    const history = getHistory();
    const set = new Set(history);
    const now = new Date();
    const month = state.calMonth || new Date(now.getFullYear(), now.getMonth(), 1);
    state.calMonth = month;

    el.calTitle.textContent = `${month.getFullYear()}年${month.getMonth() + 1}月`;
    const prefix = dateKey(month).slice(0, 7);
    el.calSummary.textContent = `${[...set].filter((k) => k.startsWith(prefix)).length}日達成`;
    el.calNext.disabled = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
    el.calNext.style.opacity = el.calNext.disabled ? "0.3" : "1";

    el.calGrid.innerHTML = "";
    for (let i = 0; i < month.getDay(); i++) el.calGrid.append(document.createElement("span"));
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(month.getFullYear(), month.getMonth(), day);
      const key = dateKey(d);
      const cell = document.createElement("span");
      cell.className = "cal-day";
      if (set.has(key)) cell.classList.add("done");
      if (key === dateKey(now)) cell.classList.add("today");
      if (d > now) cell.classList.add("future");
      cell.textContent = day;
      el.calGrid.append(cell);
    }

    renderBookTotals();

    el.badgeGrid.innerHTML = "";
    BADGES.forEach((b) => el.badgeGrid.append(badgeTile(b, !badgeProgress(b, history).earned)));

    renderLogList(el.allLogs, getLogs().reverse());
  }

  function initRecord() {
    el.calPrev.addEventListener("click", () => {
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
      renderRecord();
    });
    el.calNext.addEventListener("click", () => {
      if (el.calNext.disabled) return;
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
      renderRecord();
    });
  }

  /* ==========================================================
   * STEP1: ショートステップ
   * ========================================================== */
  function getAllSteps() {
    const steps = storage.getJSON(STORAGE_KEYS.steps, null);
    if (Array.isArray(steps) && steps.length) return steps;
    // まだ一覧を保存していない（以前のバージョンから使っている）なら、既定＋追加した分
    return [...DEFAULT_STEPS, ...storage.getJSON(STORAGE_KEYS.customSteps, [])];
  }

  function saveSteps(steps) {
    const unique = [...new Set(steps.map((x) => x.trim()).filter(Boolean))];
    if (unique.length) storage.setJSON(STORAGE_KEYS.steps, unique);
  }

  function renderShortSteps() {
    el.shortStepList.innerHTML = "";
    getAllSteps().forEach((text, i) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "step-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = `step-${i}`;
      cb.addEventListener("change", updateAchieveButton);

      const span = document.createElement("span");
      span.textContent = text; // ユーザー入力を含むので textContent で安全に表示

      label.append(cb, span);
      li.append(label);
      el.shortStepList.append(li);
    });
    updateAchieveButton();
    renderCustomStepList();
  }

  // 設定タブ：ちょいステップの一覧（削除できる。最後の1つは消せない）
  function renderCustomStepList() {
    const steps = getAllSteps();
    el.customStepList.innerHTML = "";
    steps.forEach((text, i) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-2 py-2";
      const span = document.createElement("span");
      span.className = "text-sm";
      span.textContent = text;
      const del = document.createElement("button");
      del.className = "text-xs font-bold text-rose-500 px-2 py-1";
      del.textContent = "削除";
      del.disabled = steps.length <= 1;
      if (del.disabled) del.classList.add("opacity-30");
      del.addEventListener("click", () => {
        const next = getAllSteps();
        next.splice(i, 1);
        saveSteps(next);
        renderShortSteps();
      });
      li.append(span, del);
      el.customStepList.append(li);
    });
  }

  // 1つでもチェックがあれば達成ボタンを有効化
  function updateAchieveButton() {
    const checked = el.shortStepList.querySelectorAll("input:checked").length;
    el.achieveBtn.disabled = checked === 0;
    el.achieveBtn.textContent = checked
      ? `達成！（${checked}個クリア）次へ進む`
      : "達成！ 次へ進む";
  }

  function initShortSteps() {
    renderShortSteps();

    el.addStepForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = el.newStepInput.value.trim();
      if (!text) return;
      saveSteps([...getAllSteps(), text]);
      el.newStepInput.value = "";
      renderShortSteps();
    });

    el.achieveBtn.addEventListener("click", () => {
      state.checkedCount = el.shortStepList.querySelectorAll("input:checked").length;
      showScreen(2);
    });
  }

  /* ==========================================================
   * STEP2: 証拠写真のアップロード
   * ========================================================== */
  function initPhoto() {
    // カメラ撮影・アルバム選択のどちらでも同じ処理をする
    [el.cameraInput, el.photoInput].forEach((input) => {
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        input.value = ""; // 同じ写真を選び直しても change が発火するように
        if (!file) return;
        // HEIC などは type が空のことがあるので、空なら拡張子で判定する
        if (file.type ? !file.type.startsWith("image/") : !/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) {
          showError("画像ファイルを選択してください。");
          return;
        }
        state.selectedFile = file;
        hideError();

        // プレビュー表示（Object URL を使うと大きな画像でも軽量）
        if (el.photoPreview.src) URL.revokeObjectURL(el.photoPreview.src);
        el.photoPreview.src = URL.createObjectURL(file);
        el.photoPreview.classList.remove("hidden");
        el.photoPlaceholder.classList.add("hidden");
        el.generateBtn.disabled = false;
      });
    });

    el.generateBtn.addEventListener("click", onGenerateQuiz);

    el.demoBtn.addEventListener("click", () => {
      hideError();
      el.quizTiming.textContent = "";
      startQuiz(structuredClone(DEMO_QUIZ));
    });

    document.querySelectorAll(".back-btn").forEach((btn) =>
      btn.addEventListener("click", () => showScreen(btn.dataset.back))
    );
  }

  // 「写真を送信して問題生成」ボタンの処理
  async function onGenerateQuiz() {
    // Firebase 経由（利用者はログインだけでOK）か、自分のAPIキーで直接呼ぶかを決める
    const useFirebase = canUseFirebaseAI();
    const apiKey = storage.get(STORAGE_KEYS.apiKey, "");

    if (useFirebase && !cloud.user) {
      showError("問題を作るには、ホームか設定タブの「ログイン」からログインしてください。");
      return;
    }
    if (useFirebase && !cloud.ai) {
      showError("AIの準備ができていません。ページを再読み込みしてください。");
      return;
    }
    if (!useFirebase && !apiKey) {
      showError("Gemini APIキーが未設定です。設定タブの「AIの設定」から入力してください。");
      return;
    }
    if (!state.selectedFile) {
      showError("先に写真を選択してください。");
      return;
    }

    setLoading(true);
    hideError();
    try {
      setPhase("写真の準備");
      const { base64, mimeType } = await fileToResizedBase64(state.selectedFile, MAX_IMAGE_SIZE);
      timing.imageKB = Math.round((base64.length * 3) / 4 / 1024);
      let quiz;
      if (useFirebase) {
        quiz = await generateQuizWithFirebase({ base64, mimeType });
      } else {
        setPhase("AIで問題を作成");
        quiz = await generateQuizWithGemini({ apiKey, model: getModel(), base64, mimeType });
      }
      setLoading(false);
      el.quizTiming.textContent = `作成時間: ${timingSummary()}（写真 ${timing.imageKB}KB）`;
      startQuiz(quiz);
    } catch (err) {
      console.error(err);
      setLoading(false);
      showError(`${err.message || "問題の生成に失敗しました。"}\n\n（${timingSummary()}）`);
    } finally {
      setLoading(false);
    }
  }

  // 待ち時間が分かるよう、生成中は経過秒数を表示する
  // どの段階に何秒かかったかも記録し、遅いときの原因を調べられるようにする
  let loadingTimer = null;
  const timing = { phase: "", phaseStart: 0, log: [] };

  // 処理の段階を切り替える（前の段階の所要時間を記録）
  function setPhase(label) {
    const now = Date.now();
    if (timing.phase) timing.log.push(`${timing.phase} ${((now - timing.phaseStart) / 1000).toFixed(1)}秒`);
    timing.phase = label;
    timing.phaseStart = now;
    updateLoadingText();
  }

  function updateLoadingText() {
    if (!timing.phase) return;
    const sec = Math.floor((Date.now() - timing.phaseStart) / 1000);
    el.loadingText.textContent = `${timing.phase}…（${sec}秒）`;
  }

  // 各段階の所要時間をまとめた文字列（例: 写真の準備 0.3秒 / AIで問題を作成 8.2秒）
  function timingSummary() {
    return timing.log.join(" / ");
  }

  function setLoading(on) {
    el.loading.classList.toggle("hidden", !on);
    clearInterval(loadingTimer);
    if (on) {
      timing.phase = "";
      timing.log = [];
      loadingTimer = setInterval(updateLoadingText, 1000);
    } else if (timing.phase) {
      setPhase(""); // 最後の段階の時間を確定させる
    }
    el.generateBtn.disabled = on || !state.selectedFile;
    el.demoBtn.disabled = on;
    el.generateBtn.textContent = on ? "生成中…" : "写真を送信して問題生成";
  }

  function showError(msg) {
    el.errorMsg.textContent = msg;
    el.errorMsg.classList.remove("hidden");
  }
  function hideError() {
    el.errorMsg.classList.add("hidden");
  }

  /**
   * 画像ファイルを縮小して Base64（data: プレフィックス無し）に変換する。
   * スマホの写真は数MBあるため、長辺 maxSize px の JPEG に圧縮して送信する。
   * デコードできない形式（一部ブラウザでのHEIC等）は元データをそのまま返す。
   */
  async function fileToResizedBase64(file, maxSize) {
    try {
      const bitmap = await loadImage(file);
      const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg" };
    } catch {
      // フォールバック：縮小せずにそのまま送る
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
        reader.readAsDataURL(file);
      });
      return { base64: String(dataUrl).split(",")[1], mimeType: file.type || "image/jpeg" };
    }
  }

  // File → HTMLImageElement（EXIFの回転はモダンブラウザが自動で反映する）
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("decode failed"));
      };
      img.src = url;
    });
  }

  /* ==========================================================
   * Gemini API 呼び出し
   * ----------------------------------------------------------
   * REST: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   * - 画像は inline_data（Base64）で送信
   * - responseMimeType + responseSchema を指定し、
   *   決まった形のJSONだけが返ってくるようにする（構造化出力）
   * ========================================================== */

  // AIに返してほしいJSONの形（OpenAPIスキーマのサブセット）
  const QUIZ_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
      topic: {
        type: "STRING",
        description: "写真から読み取った学習内容のテーマ（短く）",
      },
      questions: {
        type: "ARRAY",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "OBJECT",
          properties: {
            question: { type: "STRING", description: "問題文" },
            choices: {
              type: "ARRAY",
              minItems: 4,
              maxItems: 4,
              items: { type: "STRING" },
              description: "選択肢（4つ）",
            },
            answerIndex: {
              type: "INTEGER",
              description: "正解の選択肢のインデックス（0始まり）",
            },
            explanation: { type: "STRING", description: "正解の簡潔な解説" },
          },
          required: ["question", "choices", "answerIndex", "explanation"],
          propertyOrdering: ["question", "choices", "answerIndex", "explanation"],
        },
      },
    },
    required: ["topic", "questions"],
    propertyOrdering: ["topic", "questions"],
  };

  // AIへの指示文
  const QUIZ_PROMPT = `あなたは学習をサポートする優しい家庭教師です。
添付の写真は、ユーザーが今勉強している教科書・ノート・参考書などのページです。

写真に写っている内容「だけ」に基づいて、理解を確認するための4択の確認テストを3問作成してください。

ルール:
- 問題・選択肢・解説はすべて日本語で書く（写真が英語教材などの場合、英単語・英文はそのまま使ってよい）
- 写真に書かれていることから答えが導ける問題にする（写真にない知識は問わない）
- 難易度は「さっと読めば解ける」程度のやさしめにする
- 選択肢は必ず4つ。正解は1つだけ。紛らわしすぎる選択肢は避ける
- answerIndex は正解の選択肢の位置（0〜3）
- explanation は1〜2文で簡潔に
- 写真が不鮮明、または学習内容が読み取れない場合は、写っている物から推測できる一般的な学習内容で問題を作り、topic に「（推測）」と付ける`;

  // 教材が選ばれていれば、問題作りの参考としてAIに伝える
  function buildQuizPrompt() {
    const notes = [];
    if (state.studyBook) {
      notes.push(`ユーザーが勉強している教材は「${state.studyBook}」です。写真の内容を優先し、教材名はテーマの推測に使ってください。`);
    }
    // アンケートの答えから、問題の難しさや言葉づかいを合わせる
    const { status, grade, age, purposes, examDate } = getProfile();
    const who = [status && grade ? `${status}${grade}` : status, age].filter(Boolean).join("・");
    if (who) notes.push(`ユーザーは「${who}」です。問題の難しさと言葉づかいをそれに合わせてください。`);
    if (purposes?.length) notes.push(`勉強の目的は「${purposes.join("、")}」です。`);
    const left = daysUntil(examDate);
    if (left !== null && left <= 60) notes.push(`目標の試験まであと${left}日です。本番を意識した問題にしてください。`);
    return notes.length ? `${QUIZ_PROMPT}\n\n参考：\n- ${notes.join("\n- ")}` : QUIZ_PROMPT;
  }

  /**
   * 画像を Gemini に送って3問のクイズを生成する
   * @returns {Promise<{topic:string, questions:Array}>}
   */
  async function generateQuizWithGemini({ apiKey, model, base64, mimeType }) {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: buildQuizPrompt() },
          ],
        },
      ],
      // temperature は指定せずモデルの既定値を使う（Gemini 3 系は既定値での利用が推奨）
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: QUIZ_RESPONSE_SCHEMA,
        // Gemini 3 系は既定でじっくり考えるため遅い。3問作る程度なら浅い思考で十分
        thinkingConfig: { thinkingLevel: "low" },
      },
    };

    // ネットワークが不安定な場合に備えてタイムアウトを設定
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let res;
    try {
      res = await fetch(GEMINI_ENDPOINT(model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey, // APIキーはヘッダーで渡す（URLに残さない）
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("タイムアウトしました。もう一度お試しください。");
      throw new Error("通信に失敗しました。ネットワーク接続を確認してください。");
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));

    // HTTPエラー時はAPIのエラーメッセージを分かりやすく表示
    if (!res.ok) {
      const apiMsg = data?.error?.message || res.statusText;
      if (res.status === 400 && /API key/i.test(apiMsg)) {
        throw new Error("APIキーが無効です。設定を確認してください。");
      }
      if (res.status === 429) {
        throw new Error("API の利用上限に達しました。しばらく待ってから再度お試しください。");
      }
      if (res.status === 404) {
        throw new Error(
          `モデル「${model}」は使えません。\n設定タブの「モデル」欄に、下の案内にあるモデル名を入力して保存してください。\n\n${apiMsg}`
        );
      }
      throw new Error(`Gemini API エラー (${res.status})\n${apiMsg}`);
    }

    // 安全フィルタ等でブロックされた場合
    if (data?.promptFeedback?.blockReason) {
      throw new Error(`画像がブロックされました（${data.promptFeedback.blockReason}）。別の写真でお試しください。`);
    }

    // 応答テキストを取り出す（thinking パートは除外）
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("");
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason || "不明";
      throw new Error(`AIから回答が得られませんでした（理由: ${reason}）。`);
    }

    return parseQuizJson(text);
  }

  /**
   * Firebase AI Logic 経由で、画像から3問のクイズを生成する。
   * APIキーは Firebase プロジェクト側で管理されるため、利用者の設定は不要。
   * モデルはサービス側で決める（DEFAULT_MODEL）。
   */
  async function generateQuizWithFirebase({ base64, mimeType }) {
    const { getGenerativeModel, Schema, ThinkingLevel } = cloud.aiMod;

    // QUIZ_RESPONSE_SCHEMA と同じ形を、Firebase SDK の Schema で表したもの
    const schema = Schema.object({
      properties: {
        topic: Schema.string({ description: "写真から読み取った学習内容のテーマ（短く）" }),
        questions: Schema.array({
          minItems: 3,
          maxItems: 3,
          items: Schema.object({
            properties: {
              question: Schema.string({ description: "問題文" }),
              choices: Schema.array({ items: Schema.string(), minItems: 4, maxItems: 4 }),
              answerIndex: Schema.integer({ description: "正解の選択肢のインデックス（0始まり）" }),
              explanation: Schema.string({ description: "正解の簡潔な解説" }),
            },
          }),
        }),
      },
    });

    // 試す順番：いつものモデル → だめなら軽くて速い予備のモデル
    const attempts = [
      {
        label: "AIで問題を作成",
        model: DEFAULT_MODEL,
        // Gemini 3 系は既定でじっくり考えるため遅い。3問作る程度なら浅い思考で十分
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
      { label: "予備のAIで問題を作成", model: FALLBACK_MODEL },
    ];

    // App Check の確認（初回は reCAPTCHA の読み込みがあるので、AIとは分けて計測する）
    if (cloud.appCheck) {
      setPhase("アプリの確認");
      await cloud.appCheckMod.getToken(cloud.appCheck).catch(() => {});
    }

    const failures = [];
    for (const attempt of attempts) {
      setPhase(attempt.label);
      const model = getGenerativeModel(cloud.ai, {
        model: attempt.model,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          ...(attempt.thinkingConfig && { thinkingConfig: attempt.thinkingConfig }),
        },
      });
      try {
        const result = await model.generateContent(
          [buildQuizPrompt(), { inlineData: { mimeType, data: base64 } }],
          { timeout: AI_TIMEOUT_MS }
        );
        const text = result.response.text();
        if (!text) throw new Error("AIから回答が得られませんでした");
        return parseQuizJson(text);
      } catch (err) {
        console.error(err);
        const msg = String(err?.message || err);
        // 予備のモデルでも直らない失敗は、すぐに理由を伝える
        if (/App Check/i.test(msg)) {
          throw new Error(`アプリの確認（App Check）に失敗しました。ページを再読み込みしてもだめなら、管理者に連絡してください。\n${msg}`);
        }
        if (/blocked|SAFETY/i.test(msg)) {
          throw new Error("画像がブロックされました。別の写真でお試しください。");
        }
        // 時間切れ・混雑・一時的なエラーなどは、次のモデルで試す
        failures.push(`${attempt.model}: ${/abort|timeout|timed out/i.test(msg) ? `${AI_TIMEOUT_MS / 1000}秒で時間切れ` : msg}`);
      }
    }

    const detail = failures.join("\n");
    if (/429|quota|RESOURCE_EXHAUSTED/i.test(detail)) {
      throw new Error(`AIの利用が混み合っているか、無料枠の上限に達しています。少し時間をおいてから、もう一度お試しください。\n\n${detail}`);
    }
    throw new Error(`AIが応答しませんでした。少し時間をおいてから、もう一度お試しください。\n\n${detail}`);
  }

  /**
   * AIの返したJSON文字列をパースし、形式を検証・正規化する
   */
  function parseQuizJson(text) {
    let obj;
    try {
      // 念のため ```json ... ``` で囲まれていた場合も取り除く
      const cleaned = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
      obj = JSON.parse(cleaned);
    } catch {
      throw new Error("AIの応答をJSONとして読み取れませんでした。もう一度お試しください。");
    }

    const questions = Array.isArray(obj?.questions) ? obj.questions : [];
    const valid = questions
      .filter(
        (q) =>
          q &&
          typeof q.question === "string" &&
          Array.isArray(q.choices) &&
          q.choices.length >= 2 &&
          Number.isInteger(q.answerIndex) &&
          q.answerIndex >= 0 &&
          q.answerIndex < q.choices.length
      )
      .slice(0, 3)
      .map((q) => ({
        question: q.question,
        choices: q.choices.map(String),
        answerIndex: q.answerIndex,
        explanation: typeof q.explanation === "string" ? q.explanation : "",
      }));

    if (valid.length === 0) {
      throw new Error("有効な問題が生成されませんでした。別の写真でお試しください。");
    }
    return { topic: String(obj.topic || ""), questions: valid };
  }

  /* ==========================================================
   * STEP3: 確認テスト
   * ========================================================== */

  // 正解位置の偏りを防ぐため、選択肢をシャッフル（正解インデックスも追従）
  function shuffleChoices(q) {
    const order = q.choices.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return {
      ...q,
      choices: order.map((i) => q.choices[i]),
      answerIndex: order.indexOf(q.answerIndex),
    };
  }

  function startQuiz(quiz) {
    state.quiz = { ...quiz, questions: quiz.questions.map(shuffleChoices) };
    state.currentIndex = 0;
    state.correctCount = 0;
    showScreen(4);
    renderQuestion();
  }

  function renderQuestion() {
    const { questions, topic } = state.quiz;
    const total = questions.length;
    const q = questions[state.currentIndex];

    el.quizProgress.textContent = `Q${state.currentIndex + 1} / ${total}`;
    el.quizScore.textContent = `正解 ${state.correctCount}`;
    el.quizBar.style.width = `${(state.currentIndex / total) * 100}%`;
    el.quizTopic.textContent = topic ? `テーマ：${topic}` : "";
    el.quizQuestion.textContent = q.question;
    el.quizFeedback.classList.add("hidden");
    el.nextQuestionBtn.classList.add("hidden");

    el.quizChoices.innerHTML = "";
    q.choices.forEach((choice, i) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.type = "button";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = "ABCDEFGH"[i] || String(i + 1);

      const txt = document.createElement("span");
      txt.textContent = choice;

      btn.append(label, txt);
      btn.addEventListener("click", () => answer(i));
      el.quizChoices.append(btn);
    });
  }

  // 回答の採点
  function answer(selected) {
    const q = state.quiz.questions[state.currentIndex];
    const isCorrect = selected === q.answerIndex;
    if (isCorrect) state.correctCount++;

    // 全選択肢を無効化し、正解・不正解を色で表示
    [...el.quizChoices.children].forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.answerIndex) btn.classList.add("correct");
      else if (i === selected) btn.classList.add("wrong");
    });

    el.quizFeedback.className = `mt-4 rounded-lg p-3 text-sm ${
      isCorrect ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
    }`;
    el.quizFeedback.innerHTML = "";
    const head = document.createElement("p");
    head.className = "font-bold mb-1";
    head.textContent = isCorrect
      ? "⭕ 正解！"
      : `❌ 不正解… 正解は「${q.choices[q.answerIndex]}」`;
    el.quizFeedback.append(head);
    if (q.explanation) {
      const exp = document.createElement("p");
      exp.textContent = q.explanation;
      el.quizFeedback.append(exp);
    }

    el.quizScore.textContent = `正解 ${state.correctCount}`;
    const isLast = state.currentIndex === state.quiz.questions.length - 1;
    el.nextQuestionBtn.textContent = isLast ? "結果を見る" : "次の問題へ";
    el.nextQuestionBtn.classList.remove("hidden");
  }

  function initQuiz() {
    el.nextQuestionBtn.addEventListener("click", () => {
      if (state.currentIndex < state.quiz.questions.length - 1) {
        state.currentIndex++;
        renderQuestion();
      } else {
        finishQuiz();
      }
    });
  }

  /* ==========================================================
   * 完了画面
   * ========================================================== */
  function finishQuiz() {
    // 達成前の状態（連続日数の演出と、新しいバッジの判定に使う）
    const before = getHistory();
    const doneBefore = before.includes(dateKey());
    const streakBefore = calcStreak(before);
    const bestBefore = calcBestStreak(before);
    const badgesBefore = earnedBadgeIds(before);

    // 「超低ハードル」コンセプトのため、全問解き終えたら正答数に関わらず達成扱い
    const total = state.quiz.questions.length;
    const c = state.correctCount;
    addLog({
      date: dateKey(),
      ts: Date.now(),
      topic: state.quiz.topic || "",
      correct: c,
      total,
      steps: state.checkedCount || 0,
      book: state.studyBook || "",
      minutes: state.studyMinutes || 0,
    });
    recordAchievement();
    renderStats();

    const after = getHistory();
    const streakAfter = calcStreak(after);
    showDoneStreak({ doneBefore, streakBefore, streakAfter, bestBefore });
    showNewBadges(earnedBadgeIds(after).filter((id) => !badgesBefore.includes(id)));

    el.doneScore.textContent = `${total}問中 ${c}問 正解`;
    el.doneMessage.textContent =
      c === total
        ? "パーフェクト！内容がしっかり頭に入っています 💯"
        : c > 0
        ? "よくできました！間違えた所をもう一度見直すとさらに◎"
        : "取り組んだこと自体が大きな一歩。明日も机に座るだけでOK！";

    showScreen("done");
    launchConfetti();
  }

  // 完了画面：連続日数が1つ増える演出
  function showDoneStreak({ doneBefore, streakBefore, streakAfter, bestBefore }) {
    el.doneStreak.classList.remove("bump");
    if (doneBefore) {
      el.doneStreak.textContent = streakAfter;
      el.doneStreakNote.textContent = "今日はもう達成済み。復習ナイス！";
      return;
    }
    el.doneStreak.textContent = streakBefore;
    el.doneStreakNote.textContent =
      streakAfter === 1
        ? "今日からスタート！明日も続けよう"
        : streakAfter > bestBefore
          ? `自己ベスト更新！ ${streakBefore}日 → ${streakAfter}日`
          : `${streakBefore}日 → ${streakAfter}日 に伸びました`;
    setTimeout(() => {
      el.doneStreak.textContent = streakAfter;
      el.doneStreak.classList.add("bump");
    }, 500);
  }

  // 完了画面：新しく獲得したバッジ
  function showNewBadges(ids) {
    el.newBadges.innerHTML = "";
    el.newBadges.classList.toggle("hidden", ids.length === 0);
    if (ids.length === 0) return;
    const title = document.createElement("p");
    title.className = "font-bold text-slate-700 mb-3";
    title.textContent = "🎉 新しいバッジを獲得！";
    const grid = document.createElement("div");
    grid.className = "flex justify-center gap-2";
    BADGES.filter((b) => ids.includes(b.id)).forEach((b) => grid.append(badgeTile(b, false)));
    el.newBadges.append(title, grid);
  }

  function launchConfetti() {
    const colors = ["#1a9cf0", "#22c55e", "#ff8a1f", "#f43f5e", "#facc15"];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = `${1.8 + Math.random() * 1.5}s`;
      p.style.animationDelay = `${Math.random() * 0.4}s`;
      el.confetti.append(p);
      p.addEventListener("animationend", () => p.remove());
    }
  }

  // 最初からやり直す（写真・チェックをリセット）
  function resetAll() {
    state.selectedFile = null;
    state.quiz = null;
    if (el.photoPreview.src) URL.revokeObjectURL(el.photoPreview.src);
    el.photoPreview.removeAttribute("src");
    el.photoPreview.classList.add("hidden");
    el.photoPlaceholder.classList.remove("hidden");
    el.generateBtn.disabled = true;
    hideError();
    renderShortSteps();
    // 教材は前回のものを選んだままにし、時間は0から（タイマー中はそのまま）
    if (!getBooks().includes(state.studyBook)) state.studyBook = "";
    renderBookList();
    setStudyMinutes(0);
    showScreen(1);
  }

  /* ==========================================================
   * 再読み込み（ホーム画面から開いたとき用）
   * ----------------------------------------------------------
   * iPhone でホーム画面に追加して開くと、ブラウザの再読み込みボタンが
   * ないため、ボタンと「引っぱって更新」を用意する
   * ========================================================== */
  function isStandalone() {
    return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  }

  // GitHub Pages はファイルを数分キャッシュするため、最新を取り直してから再読み込みする
  async function hardReload() {
    const assets = ["./", "index.html", "style.css", "firebase-config.js", "app.js"];
    await Promise.all(assets.map((url) => fetch(url, { cache: "reload" }).catch(() => {})));
    location.reload();
  }

  function initPullToRefresh() {
    const THRESHOLD = 80; // これ以上引っぱって離すと再読み込み（px）
    const indicator = el.pullIndicator;
    let startY = null;
    let distance = 0;

    const resetIndicator = () => {
      indicator.style.opacity = "0";
      indicator.style.transform = "";
    };

    window.addEventListener(
      "touchstart",
      (e) => {
        // 画面の一番上から、指1本で引っぱり始めたときだけ反応する
        startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
        distance = 0;
      },
      { passive: true }
    );

    window.addEventListener(
      "touchmove",
      (e) => {
        if (startY === null) return;
        distance = e.touches[0].clientY - startY;
        if (distance <= 0) return resetIndicator();
        const d = Math.min(distance, THRESHOLD * 1.5);
        indicator.style.opacity = String(Math.min(d / THRESHOLD, 1));
        indicator.style.transform = `translate(-50%, ${d * 0.6}px)`;
        indicator.textContent = distance >= THRESHOLD ? "↻ 離すと再読み込み" : "↓ 引っぱって更新";
      },
      { passive: true }
    );

    window.addEventListener("touchend", () => {
      if (startY === null) return;
      startY = null;
      if (distance >= THRESHOLD) {
        indicator.textContent = "再読み込み中…";
        hardReload();
      } else {
        resetIndicator();
      }
    });
  }

  /* ==========================================================
   * STEP2: 勉強の記録（教材と勉強時間）
   * ========================================================== */
  function getBooks() {
    return storage.getJSON(STORAGE_KEYS.books, []);
  }

  // 例: 45 → "45分"、130 → "2時間10分"
  function formatMinutes(min) {
    if (!min) return "0分";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? `${h}時間${m ? `${m}分` : ""}` : `${m}分`;
  }

  function setStudyMinutes(min) {
    state.studyMinutes = Math.max(0, Math.min(MAX_STUDY_MINUTES, Math.round(min)));
    el.studyMinutes.textContent = state.studyMinutes;
  }

  // 教材の選択ボタン（もう一度押すと選択を外す）
  function renderBookList() {
    const books = getBooks();
    el.bookList.innerHTML = "";
    if (books.length === 0) {
      const p = document.createElement("p");
      p.className = "text-sm text-slate-400";
      p.textContent = "まだ教材がありません。下から追加しよう";
      el.bookList.append(p);
    }
    books.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `book-chip${state.studyBook === name ? " selected" : ""}`;
      btn.textContent = name;
      btn.addEventListener("click", () => {
        state.studyBook = state.studyBook === name ? "" : name;
        renderBookList();
      });
      el.bookList.append(btn);
    });
    renderBookManageList();
  }

  // 設定タブ：登録した教材の一覧（削除できる。過去の記録の教材名は残る）
  function renderBookManageList() {
    const books = getBooks();
    el.bookManageList.innerHTML = "";
    if (books.length === 0) {
      const li = document.createElement("li");
      li.className = "text-sm text-slate-400 py-2";
      li.textContent = "まだありません";
      el.bookManageList.append(li);
      return;
    }
    books.forEach((name, i) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-2 py-2";
      const span = document.createElement("span");
      span.className = "text-sm truncate";
      span.textContent = name;
      const del = document.createElement("button");
      del.className = "text-xs font-bold text-rose-500 px-2 py-1";
      del.textContent = "削除";
      del.addEventListener("click", () => {
        const next = getBooks();
        next.splice(i, 1);
        storage.setJSON(STORAGE_KEYS.books, next);
        if (state.studyBook === name) state.studyBook = "";
        renderBookList();
      });
      li.append(span, del);
      el.bookManageList.append(li);
    });
  }

  // 記録タブ：教材ごとの合計勉強時間（多い順）
  function renderBookTotals() {
    const totals = {};
    getLogs().forEach((l) => {
      if (!l.minutes) return;
      const name = l.book || "教材なし";
      totals[name] = (totals[name] || 0) + l.minutes;
    });
    const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    el.bookTotals.innerHTML = "";
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-note";
      p.textContent = "勉強時間を記録すると、ここに教材ごとの合計が出ます";
      el.bookTotals.append(p);
      return;
    }
    const max = rows[0][1];
    rows.forEach(([name, min]) => {
      const row = document.createElement("div");
      const head = document.createElement("div");
      head.className = "flex items-center justify-between gap-2 text-sm mb-1";
      const label = document.createElement("span");
      label.className = "font-bold truncate";
      label.textContent = name;
      const value = document.createElement("span");
      value.className = "text-slate-500 whitespace-nowrap";
      value.textContent = formatMinutes(min);
      head.append(label, value);
      const bar = document.createElement("div");
      bar.className = "progress";
      const fill = document.createElement("div");
      fill.className = "progress-bar";
      fill.style.width = `${(min / max) * 100}%`;
      bar.append(fill);
      row.append(head, bar);
      el.bookTotals.append(row);
    });
  }

  /* ---------- タイマー ---------- */
  let timerTick = null;

  function timerStartedAt() {
    return Number(storage.get(TIMER_KEY, "")) || 0;
  }

  function renderTimer() {
    const started = timerStartedAt();
    el.timerBtn.classList.toggle("timer-running", !!started);
    if (!started) {
      el.timerBtn.textContent = "⏱ タイマーで計る";
      return;
    }
    const sec = Math.floor((Date.now() - started) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    el.timerBtn.textContent = `⏹ 止めて記録する（${mm}:${ss}）`;
  }

  // タイマーは開始時刻を保存するので、アプリを閉じても計り続けられる
  function toggleTimer() {
    const started = timerStartedAt();
    if (started) {
      const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
      writeLocal(TIMER_KEY, null);
      clearInterval(timerTick);
      setStudyMinutes(state.studyMinutes + minutes);
    } else {
      writeLocal(TIMER_KEY, String(Date.now()));
      timerTick = setInterval(renderTimer, 1000);
    }
    renderTimer();
  }

  function initStudy() {
    el.addBookForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = el.newBookInput.value.trim();
      if (!name) return;
      const books = getBooks();
      if (!books.includes(name)) {
        books.push(name);
        storage.setJSON(STORAGE_KEYS.books, books);
      }
      state.studyBook = name; // 追加した教材をそのまま選ぶ
      el.newBookInput.value = "";
      renderBookList();
    });
    el.minusTimeBtn.addEventListener("click", () => setStudyMinutes(state.studyMinutes - 5));
    el.plusTimeBtn.addEventListener("click", () => setStudyMinutes(state.studyMinutes + 5));
    el.timeChips.querySelectorAll("[data-min]").forEach((b) =>
      b.addEventListener("click", () => setStudyMinutes(Number(b.dataset.min)))
    );
    el.timerBtn.addEventListener("click", toggleTimer);
    el.studyNextBtn.addEventListener("click", () => {
      if (timerStartedAt()) toggleTimer(); // タイマー中なら止めて時間を記録する
      showScreen(3);
    });

    if (timerStartedAt()) timerTick = setInterval(renderTimer, 1000);
    renderTimer();
    renderBookList();
    setStudyMinutes(0);
  }

  /* ==========================================================
   * はじめてのアンケート（プロフィール）
   * ----------------------------------------------------------
   * 立場・年代・目的・目標・悩み・1日の目標時間を聞き、
   * ホームの目標表示・今日のヒント・AIの問題の難しさに使う。
   * どの質問も飛ばせる。設定タブから答え直せる。
   * ========================================================== */
  // 各ページの質問。when があるものは、それまでの答えによって表示する（例：高校生 → 何年生？）。
  // options が関数のものは、それまでの答えで選択肢が変わる
  const STUDENT_GRADES = {
    中学生: ["1年", "2年", "3年"],
    高校生: ["1年", "2年", "3年"],
    "大学生・専門学生": ["1年", "2年", "3年", "4年", "大学院"],
  };
  const EXAM_PURPOSES = ["受験・入試", "資格・検定", "学校の授業・定期テスト"];

  const ONBOARDING_PAGES = [
    {
      title: "まずは、あなたのことを教えてください",
      sub: "問題の難しさや声かけを、あなたに合わせます",
      fields: [
        { key: "status", label: "今の立場", type: "single", options: ["中学生", "高校生", "浪人生", "大学生・専門学生", "社会人", "その他"] },
        {
          key: "grade",
          label: "何年生？",
          type: "single",
          when: (p) => !!STUDENT_GRADES[p.status],
          options: (p) => STUDENT_GRADES[p.status],
        },
        {
          key: "age",
          label: "年代",
          type: "single",
          // 中高生は学年で分かるので聞かない
          when: (p) => p.status && p.status !== "中学生" && p.status !== "高校生",
          options: ["〜18歳", "19〜22歳", "23〜29歳", "30代", "40代", "50代以上"],
        },
      ],
    },
    {
      title: "何のために勉強していますか？",
      sub: "いくつでも選べます",
      fields: [
        { key: "purposes", label: "目的", type: "multi", options: [...EXAM_PURPOSES, "語学", "仕事のスキルアップ", "趣味・教養"] },
        { key: "goal", label: "目標（任意）", type: "text", placeholder: "例：3月の英検2級に合格する", maxLength: 40 },
        {
          key: "examDate",
          label: "目標の試験・テストの日（任意）",
          type: "date",
          note: "ホームに「あと○日」と出ます",
          when: (p) => (p.purposes || []).some((x) => EXAM_PURPOSES.includes(x)),
        },
      ],
    },
    {
      title: "勉強時間について教えてください",
      sub: "今の時間が少なくても大丈夫。ここから伸ばしていこう",
      fields: [
        { key: "currentMinutes", label: "今、1日どれくらい勉強してる？", type: "single", options: ["ほぼ0分", "15分くらい", "30分くらい", "1時間くらい", "2時間以上"] },
        {
          key: "dailyTarget",
          label: "1日の目標時間",
          type: "single",
          note: "まずは少なめがおすすめ。ちょいステップは5分からでOK！",
          options: [5, 10, 15, 30, 60, 90],
          format: (v) => `${v}分`,
        },
      ],
    },
    {
      title: "いつ・どこで勉強しますか？",
      sub: "いくつでも選べます",
      fields: [
        { key: "studyTimes", label: "勉強しやすい時間帯", type: "multi", options: ["朝", "昼休み", "放課後・仕事のあと", "夜", "寝る前", "バラバラ"] },
        { key: "places", label: "よく勉強する場所", type: "multi", options: ["家", "学校", "図書館", "カフェ", "電車・バス", "職場"] },
      ],
    },
    {
      title: "苦手な科目はありますか？",
      sub: "いくつでも選べます",
      fields: [{ key: "weakSubjects", label: "苦手な科目", type: "multi", options: ["英語", "数学", "国語", "理科", "社会", "特になし"] }],
    },
    {
      title: "ふだんの忙しさを教えてください",
      sub: "無理のないペースを一緒に考えます",
      fields: [{ key: "busy", label: "部活・仕事・バイト", type: "single", options: ["ほとんどない", "週に2〜3日", "ほぼ毎日"] }],
    },
    {
      title: "勉強の悩みはありますか？",
      sub: "あなたに合ったヒントを毎日お届けします",
      fields: [
        {
          key: "worries",
          label: "悩み（いくつでも）",
          type: "multi",
          options: ["続かない・三日坊主", "やる気が出ない", "ついスマホを触ってしまう", "勉強する時間がない", "何から始めればいいか分からない", "集中できない", "覚えてもすぐ忘れる"],
        },
        { key: "worryNote", label: "そのほか（任意）", type: "text", placeholder: "自由に書いてOK", maxLength: 100 },
      ],
    },
    {
      title: "あなたのちょいステップを選ぼう",
      sub: "やる気がなくてもできる、小さな一歩を選んでね。毎回この中から1つでもできればOK（あとで変えられます）",
      fields: [{ key: "steps", label: "ちょいステップ（いくつでも）", type: "steps" }],
    },
  ];

  // 悩みに合わせたヒント（選んだ悩みの中から日替わりで出す）
  const TIPS = {
    "続かない・三日坊主": "まずは「机に座るだけ」でOK。連続記録が伸びるほど、続けたくなります🔥",
    "やる気が出ない": "やる気は、始めてから出てくるもの。まずは5分だけタイマーを回してみよう",
    "ついスマホを触ってしまう": "勉強の前にスマホの集中モードをオンに。通知が来なければ、写真を撮るとき以外は触らずにすみます",
    "勉強する時間がない": "1日5分でも、1か月で2時間半。すき間時間に1ページだけ開いてみよう",
    "何から始めればいいか分からない": "手元の教材を1ページ開いて撮るだけ。AIがそのページの確認テストを作ります",
    "集中できない": "15分だけ、と区切るのがコツ。短く区切るほど集中しやすくなります",
    "覚えてもすぐ忘れる": "思い出す練習が一番の記憶法。確認テストで間違えた問題は、解説を読み直そう",
  };
  const DEFAULT_TIP = "今日の一歩は小さくてOK。続けることが一番の近道です";

  function resolveOptions(field, profile) {
    return typeof field.options === "function" ? field.options(profile) : field.options;
  }


  // 試験日までの日数（未設定・過去なら null）
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const diff = Math.round((parseDateKey(dateStr) - parseDateKey(dateKey())) / 86400000);
    return diff >= 0 ? diff : null;
  }

  function todaysTip(profile, now) {
    const tips = (profile.worries || []).map((w) => TIPS[w]).filter(Boolean);
    if (tips.length === 0) return DEFAULT_TIP;
    const dayNumber = Math.floor(parseDateKey(dateKey(now)) / 86400000);
    return tips[dayNumber % tips.length];
  }

  function getProfile() {
    return storage.getJSON(STORAGE_KEYS.profile, {}) || {};
  }

  // shown: 今のページで表示中の質問（あとから出てきた質問だけアニメーションさせるため）
  const onboarding = { page: 0, draft: {}, pages: ONBOARDING_PAGES, editing: false, shown: new Set() };

  // editing: 設定から答え直すとき（最後のボタンが「保存する」になる）
  function openOnboarding({ editing = false } = {}) {
    onboarding.page = 0;
    // ちょいステップはプロフィールとは別に保存しているので、今の一覧を選んだ状態で開く
    onboarding.draft = { ...getProfile(), steps: getAllSteps() };
    onboarding.editing = editing;
    showTab("onboarding");
    renderOnboardingPage({ newPage: true });
  }

  // 答えを保存してホームへ（「あとで」でも、それまでの答えは保存する）
  function finishOnboarding() {
    const { steps, ...profile } = onboarding.draft;
    if (steps?.length) saveSteps(steps); // 全部外した場合は、今までのステップのまま
    storage.setJSON(STORAGE_KEYS.profile, { ...profile, done: true, answeredAt: Date.now() });
    renderShortSteps();
    renderProfileSummary();
    renderStats();
    showTab("home");
  }

  // newPage: ページを移ったとき（画面全体をアニメーションさせる）。選択肢を押しただけのときは false
  function renderOnboardingPage({ newPage = false } = {}) {
    const pages = onboarding.pages;
    const page = pages[onboarding.page];
    const isLast = onboarding.page === pages.length - 1;
    el.obBar.style.width = `${((onboarding.page + 1) / pages.length) * 100}%`;
    el.obBackBtn.classList.toggle("hidden", onboarding.page === 0);
    el.obNextBtn.textContent = isLast ? (onboarding.editing ? "保存する" : "はじめる！") : "次へ";

    el.obPage.innerHTML = "";
    if (newPage) {
      onboarding.shown = new Set();
      // 画面切り替えのアニメーションをもう一度再生する
      el.obPage.classList.remove("screen");
      void el.obPage.offsetWidth;
      el.obPage.classList.add("screen");
    }
    const shownBefore = onboarding.shown;
    onboarding.shown = new Set();

    const title = document.createElement("h2");
    title.className = "font-bold text-lg";
    title.textContent = page.title;
    const sub = document.createElement("p");
    sub.className = "text-sm text-slate-500 mb-4";
    sub.textContent = page.sub;
    el.obPage.append(title, sub);

    page.fields.forEach((field) => {
      const draft = onboarding.draft;
      // 今の答えでは聞かない質問は出さず、前の答えも消す（例：高校生 → 社会人に変えたら学年を消す）
      if (field.when && !field.when(draft)) {
        delete draft[field.key];
        return;
      }
      const options = resolveOptions(field, draft);
      if (field.type === "single" && options && draft[field.key] !== undefined && !options.includes(draft[field.key])) {
        delete draft[field.key]; // 選択肢が変わって、前の答えが選べなくなった
      }

      onboarding.shown.add(field.key);
      // 答えに応じて新しく出てきた質問だけ、ふわっと表示する
      const revealed = !newPage && !shownBefore.has(field.key);
      const label = document.createElement("p");
      label.className = `field-label mt-4${revealed ? " reveal" : ""}`;
      label.textContent = field.label;
      el.obPage.append(label);
      if (field.note) {
        const note = document.createElement("p");
        note.className = "text-xs text-slate-500 -mt-1 mb-2";
        note.textContent = field.note;
        el.obPage.append(note);
      }

      if (field.type === "steps") {
        // 候補＋自分で追加したもの。選んだ順ではなく、候補の順→自分で追加した順に並べる
        const selected = draft.steps || [];
        const all = [...new Set([...STEP_CANDIDATES, ...selected])];
        const wrap = document.createElement("div");
        wrap.className = "flex flex-wrap gap-2";
        all.forEach((option) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `book-chip${selected.includes(option) ? " selected" : ""}`;
          btn.textContent = option;
          btn.addEventListener("click", () => {
            draft.steps = selected.includes(option) ? selected.filter((x) => x !== option) : [...selected, option];
            renderOnboardingPage();
          });
          wrap.append(btn);
        });
        const form = document.createElement("form");
        form.className = "flex gap-2 mt-3";
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 30;
        input.className = "input flex-1 min-w-0";
        input.placeholder = "自分で書いて追加（例：問題集を机に置いた）";
        const add = document.createElement("button");
        add.type = "submit";
        add.className = "btn-ghost text-sm";
        add.textContent = "追加";
        form.append(input, add);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          draft.steps = [...new Set([...selected, text])];
          renderOnboardingPage();
        });
        const hint = document.createElement("p");
        hint.className = `text-xs mt-2 ${selected.length ? "text-slate-400" : "text-rose-500"}`;
        hint.textContent = selected.length
          ? `${selected.length}個えらんでいます`
          : "1つも選ばないと、今までのステップのままになります";
        el.obPage.append(wrap, form, hint);
        return;
      }

      if (field.type === "date") {
        const input = document.createElement("input");
        input.type = "date";
        input.className = "input w-full";
        input.value = onboarding.draft[field.key] || "";
        input.addEventListener("change", () => {
          onboarding.draft[field.key] = input.value || undefined;
        });
        el.obPage.append(input);
        return;
      }

      if (field.type === "text") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input w-full";
        input.placeholder = field.placeholder || "";
        input.maxLength = field.maxLength || 100;
        input.value = onboarding.draft[field.key] || "";
        input.addEventListener("input", () => {
          onboarding.draft[field.key] = input.value.trim();
        });
        el.obPage.append(input);
        return;
      }

      const wrap = document.createElement("div");
      wrap.className = "flex flex-wrap gap-2";
      options.forEach((option) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const current = onboarding.draft[field.key];
        const selected = field.type === "multi" ? (current || []).includes(option) : current === option;
        btn.className = `book-chip${selected ? " selected" : ""}`;
        btn.textContent = field.format ? field.format(option) : option;
        btn.addEventListener("click", () => {
          if (field.type === "multi") {
            const list = new Set(onboarding.draft[field.key] || []);
            list.has(option) ? list.delete(option) : list.add(option);
            onboarding.draft[field.key] = [...list];
          } else {
            // もう一度押すと選択を外せる
            onboarding.draft[field.key] = current === option ? undefined : option;
          }
          renderOnboardingPage();
        });
        wrap.append(btn);
      });
      el.obPage.append(wrap);
    });
  }

  // 設定タブ：答えの一覧
  function renderProfileSummary() {
    const p = getProfile();
    const rows = [
      ["立場", [p.status, p.age].filter(Boolean).join("・")],
      ["目的", (p.purposes || []).join("、")],
      ["目標", p.goal],
      ["悩み", (p.worries || []).join("、")],
      ["1日の目標", p.dailyTarget ? `${p.dailyTarget}分` : ""],
      ["学年", p.grade],
      ["試験日", p.examDate ? `${p.examDate.replaceAll("-", "/")}${daysUntil(p.examDate) !== null ? `（あと${daysUntil(p.examDate)}日）` : ""}` : ""],
      ["今の勉強時間", p.currentMinutes],
      ["時間帯", (p.studyTimes || []).join("、")],
      ["場所", (p.places || []).join("、")],
      ["苦手科目", (p.weakSubjects || []).join("、")],
      ["部活・仕事", p.busy],
    ].filter(([, value]) => value); // 答えたものだけ表示
    el.profileSummary.innerHTML = "";
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-slate-400";
      empty.textContent = "まだ答えていません。「答え直す」から答えられます";
      el.profileSummary.append(empty);
      return;
    }
    rows.forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "flex gap-3";
      const dt = document.createElement("dt");
      dt.className = "w-20 shrink-0 text-slate-500";
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.className = value ? "text-slate-700" : "text-slate-400";
      dd.textContent = value || "未回答";
      row.append(dt, dd);
      el.profileSummary.append(row);
    });
  }

  function initOnboarding() {
    el.obNextBtn.addEventListener("click", () => {
      if (onboarding.page < onboarding.pages.length - 1) {
        onboarding.page++;
        renderOnboardingPage({ newPage: true });
      } else {
        finishOnboarding();
      }
    });
    el.obBackBtn.addEventListener("click", () => {
      onboarding.page = Math.max(0, onboarding.page - 1);
      renderOnboardingPage({ newPage: true });
    });
    el.obSkipBtn.addEventListener("click", finishOnboarding);
    el.editProfileBtn.addEventListener("click", () => openOnboarding({ editing: true }));
    renderProfileSummary();
  }

  /* ==========================================================
   * タブ（ホーム / 記録 / 設定）と記録の流れ
   * ========================================================== */
  const TABS = {
    home: { node: $("tabHome"), title: "ホーム" },
    record: { node: $("tabRecord"), title: "記録" },
    settings: { node: $("tabSettings"), title: "設定" },
    flow: { node: $("tabFlow"), title: "今日のちょいステップ" },
    onboarding: { node: $("tabOnboarding"), title: "はじめに" },
  };

  function showTab(name) {
    Object.entries(TABS).forEach(([key, tab]) => tab.node.classList.toggle("hidden", key !== name));
    el.headerTitle.textContent = TABS[name].title;
    // 記録の流れとアンケートの間はタブバーを隠す。記録の流れでは左上に「閉じる」を出す
    const inFlow = name === "flow";
    el.tabBar.classList.toggle("hidden", inFlow || name === "onboarding");
    el.flowCloseBtn.classList.toggle("hidden", !inFlow);
    el.tabBar.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    if (name === "record") renderRecord();
    window.scrollTo({ top: 0 });
  }

  function initTabs() {
    el.tabBar.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
    document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
    el.startBtn.addEventListener("click", () => {
      resetAll();
      showTab("flow");
    });
    el.flowCloseBtn.addEventListener("click", () => showTab("home"));
    el.restartBtn.addEventListener("click", () => {
      resetAll();
      showTab("home");
    });
  }

  /* ==========================================================
   * 初期化
   * ========================================================== */
  function init() {
    initSettings();
    initShortSteps();
    initPhoto();
    initQuiz();
    initRecord();
    initStudy();
    initOnboarding();
    initTabs();
    if (isStandalone()) {
      el.reloadBtn.classList.remove("hidden");
      el.reloadBtn.addEventListener("click", hardReload);
      initPullToRefresh();
    }
    renderStats();
    showScreen(1);
    showTab("home");
    // はじめて開いたときはアンケートから
    if (!getProfile().done) openOnboarding();
    initCloud();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

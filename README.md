# ちょいステップ習慣（MVP）

**▶ アプリを開く：https://askedkazu.github.io/habit-app/**

「超低ハードルな達成記録」と「証拠写真からのAIテスト自動生成」を組み合わせた習慣化支援Webアプリです。
HTML / CSS / JavaScript のみで動作し、ビルドは不要です。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | 画面構造（Tailwind CSS を CDN で読み込み） |
| `style.css` | 共通部品・アニメーションの追加スタイル |
| `app.js` | 画面遷移、ショートステップ、写真処理、Gemini API 呼び出し、クイズ採点、アカウント同期 |
| `firebase-config.js` | アカウント機能用の Firebase 設定（未設定ならログイン機能なし） |
| `build.py` | 1ファイル版 `habit-app.html` を作るスクリプト |
| `sw.js` | Service Worker。アプリを閉じていても通知を受け取って表示する |
| `manifest.webmanifest`, `icons/` | ホーム画面に追加したときのアプリ名・アイコン |
| `scripts/send-reminders.mjs` | リマインド通知を送るスクリプト（GitHub Actions から実行） |
| `scripts/sync-calendars.mjs` | カレンダーの予定（埋まっている時間帯）を読み込むスクリプト（GitHub Actions から実行） |
| `.github/workflows/notify.yml` | 15分ごとにカレンダーの読み込みと通知を実行する |

## 起動方法

カメラ起動や `fetch` を確実に動かすため、ローカルサーバー経由で開いてください。

```bash
cd habit-app
python3 -m http.server 8000
# → http://localhost:8000 をブラウザで開く
```

スマホ実機で試す場合は、PCと同じWi-Fiに繋いで `http://<PCのIPアドレス>:8000` を開きます
（`capture` 属性によるカメラ起動は HTTPS でなくても動作しますが、環境によっては HTTPS が必要です）。

## 使い方

1. 右上の ⚙️ から **Gemini APIキー** を入力して「保存」（[Google AI Studio](https://aistudio.google.com/apikey) で取得）
2. **STEP1**：「机に座った」などを1つ以上チェック →「達成！次へ進む」
3. **STEP2**：教科書・ノートを撮影（または写真を選択）→「写真を送信して問題生成」
4. **STEP3**：AIが作った4択3問に回答。1問ごとに正解／不正解と解説を表示
5. 全問終了で「テストクリア！習慣達成！」→ 連続日数・累計が更新されます

APIキーがなくても「APIキーなしでデモ問題を試す」で画面の流れを確認できます。

## Gemini API 連携の仕組み（`app.js`）

- エンドポイント: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- APIキーは `x-goog-api-key` ヘッダーで送信
- 画像は送信前に長辺1280pxのJPEGへ縮小し、`inline_data`（Base64）で送信
- `responseMimeType: "application/json"` と `responseSchema` で
  `{ topic, questions: [{ question, choices[4], answerIndex, explanation }] }` 形式のJSONを強制
- 応答は検証してから表示し、選択肢はシャッフルして正解位置の偏りを防止

## 注意

- APIキーはブラウザの localStorage に平文で保存されます。MVP・個人利用向けの実装です。
  公開サービスにする場合は、APIキーをサーバー側に置きプロキシ経由で呼び出してください。
- 保存データ（APIキー、追加したステップ、達成履歴）は端末のブラウザに保存されます。ログイン中はアカウント（Firestore）にも保存され、端末間で共有されます。

## 写真なしで記録 → あとで報告

- 証拠写真の画面の「写真なしで記録する（あとで報告）」で、写真とテストなしでもその日は達成になる（記録に `pending: true`）
- ホームの「📸」カードや記録の「📸 写真を報告」から、その記録の教材のまま写真を送って確認テストを受けられ、
  結果でその記録（テーマ・正解数）を更新する
- 記録はアカウントに「追加」で同期しているため、更新前の記録は `arrayRemove` で消し、読み込み時も同じ `ts` の記録は1つにまとめる

## 利用状況の集計（アナリティクス）とプライバシー

- Firebase の Google アナリティクス（`firebase-config.js` の `measurementId`）で、操作の回数を集計する。
  Firebase コンソール →「Analytics」→「イベント」で見られる（反映まで最大24時間ほど。「DebugView」ならすぐ確認できる）
- 送るのは操作の種類と数字だけ。名前・メールアドレス・アンケートの答え・記録の中身・写真は送らない
- 主なイベント：`app_open` / `login` / `sign_up` / `survey_complete` / `flow_start` / `steps_done` / `study_recorded` /
  `quiz_generate_start` / `quiz_generate_success`（model・seconds）/ `quiz_generate_error`（reason）/ `quiz_complete` /
  `photo_skip` / `photo_report_start` / `demo_quiz` / `plan_add` / `notify_enable` / `notify_disable` / `calendar_link` / `calendar_unlink`
- 設定タブの「🔒 プライバシー」で送信をオフにできる（端末ごと）。「プライバシーと利用状況について」で、保存するもの・
  管理者が見られること・外部に送るものを説明している

## 開発の流れ（機能を追加するとき）

1. 分割版（`index.html` / `style.css` / `app.js`）を編集する
2. `python3 build.py` を実行して、1ファイル版 `habit-app.html` を作り直す
3. 普段は `habit-app.html` をダブルクリックで開いて使う

## アカウント機能（Googleログインで端末間共有）の設定

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication** →「始める」→ ログイン方法で **Google** と **メール / パスワード** を有効化
   （Googleアカウントがない人は、メールアドレスとパスワードでアカウントを作れる）
3. Authentication → 設定 → **承認済みドメイン** に `askedkazu.github.io` を追加
4. **Firestore Database** → データベースを作成 → **ルール** に次を貼り付けて公開
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. プロジェクトの設定 → マイアプリ → ウェブアプリ（`</>`）を追加し、表示された `firebaseConfig` を `firebase-config.js` に貼り付ける
6. **AI Logic** →「始める」→ **Gemini Developer API** を選んで有効化
   （これで利用者はAPIキー不要。ログインするだけで問題を生成できる）
7. **App Check**（AIを他のサイトから勝手に使われないようにする）
   - [Google Cloud の reCAPTCHA（Fraud Defense）](https://console.cloud.google.com/security/recaptcha) で
     種類「ウェブ」、ドメイン `askedkazu.github.io` のキーを作成（チェックボックスのチャレンジはオフ）
   - Firebase → セキュリティ → App Check → アプリ → ウェブアプリに **Fraud Defense** でそのキーを登録
   - キーIDを `firebase-config.js` の `FIREBASE_APP_CHECK.siteKey` に設定

- Firebase 設定済みで公開URLから開いた場合、問題生成は Firebase AI Logic 経由（APIキーはプロジェクト側で管理、利用料もプロジェクト持ち）。
  ファイルを直接開いた場合や Firebase 未設定の場合は、従来どおり自分の Gemini APIキーで動作する
- データは `users/{uid}` に保存（APIキー、モデル、追加ステップ、教材、達成履歴、記録〔テーマ・正解数・教材・勉強時間〕）
- ログインは公開URL（GitHub Pages）や `localhost` で開いたときに使えます。ファイルを直接開いた場合（file://）は使えません
- ログアウトすると、その端末に保存されたデータは消去されます（アカウントには残ります）

## リマインド通知の設定

毎日決まった時刻に「今日のちょいステップ」を通知します。その日に達成するまで、間をあけて送り直します。
通知は GitHub Actions が15分ごとに確認して送るため、数分〜15分ほど遅れることがあります。

- 1回目：設定した時刻（3時間以上遅れたらその日は送らない）
- 送り直し：まだ達成していなければ 30分／1時間／2時間ごとに、1日 2／3／5 回まで（既定は1時間ごと・3回）。
  23時以降は送り直さない。最後の1回は連続記録の話にする
- 勉強の予定の前：アプリに入れた予定の開始15分前ごろ（オフにもできる）
- 達成した日は、それ以降は送らない
- 判定は `scripts/send-reminders.mjs` の `decideReminder()`（Firestore やFCMに触らないので単体で試せる）

1. Firebase → プロジェクトの設定 → **Cloud Messaging** →「ウェブ プッシュ証明書」で **鍵ペアを生成**し、
   公開鍵を `firebase-config.js` の `FIREBASE_VAPID_KEY` に設定
2. Firebase → プロジェクトの設定 → **サービス アカウント** →「新しい秘密鍵の生成」で JSON をダウンロード
3. GitHub のリポジトリ → Settings → Secrets and variables → Actions →「New repository secret」で、
   名前 `FIREBASE_SERVICE_ACCOUNT`、値に JSON の中身を丸ごと貼り付け
4. iPhone は「ホーム画面に追加」したアプリから開き、「この端末で通知を受け取る」を押す

- 通知の宛先（FCMトークン）・通知時刻・タイムゾーンは `users/{uid}` に保存
- ログアウトすると、その端末への通知は止まる
- GitHub は、リポジトリに60日間更新がないと定期実行を自動で止めます（Actions タブから再開できます）

## 勉強の予定とカレンダー連携

- ホームの「📅 今日の勉強の予定」と記録タブの「これからの予定」から、勉強の予定（日にち・時刻・時間・教材）を
  **このアプリの中に**追加・削除できる。予定は `users/{uid}.plans` に保存して端末間で共有（30日より前のものは消す）
- 設定タブの「📅 カレンダー連携」で、予定の入っている時間帯を**読むだけ**で取り込み、空き時間をおすすめする
  （「＋ この時間で予定に入れる」でアプリの予定にできる）。外部のカレンダーには書き込まない
- **Google カレンダーはワンタップ**：Google の許可画面で「許可」するだけ。ブラウザから Google Calendar API の
  `freeBusy`（空き時間情報）と `calendarList` だけを読む（スコープ：`calendar.freebusy`、`calendar.calendarlist.readonly`）。
  許可は約1時間で切れるので、アプリを開いたときに有効なら自動で、切れていれば「予定を読み込み直す」で読み直す
  - 事前に Google Cloud で **Google Calendar API を有効化**し、**OAuth 同意画面（Google Auth Platform）**にスコープを追加しておく
- **iPhone（iCloud）・Outlook、または Google の予備**：カレンダーの **iCal 形式のURL** を貼る
  - 対応：Google カレンダー（iCal 形式の非公開URL）、iPhone / iCloud（公開カレンダーのリンク）、Outlook（予定表の公開 → ICS）
  - 読み込みは GitHub Actions（`scripts/sync-calendars.mjs`）が1時間に1回（URLを登録した直後は次の15分ごとの実行で）行う。
    ブラウザからは他サイトのカレンダーを直接読めないため
  - 保存するのは今日から8日分の「埋まっている時間帯」だけ（予定の名前・場所・内容は保存しない）。終日の予定と「予定なし」の予定は除く
  - おすすめはアンケートの「勉強しやすい時間帯」「1日の目標時間」から決める。希望の時間帯が埋まっていれば 7〜23時の空き → 5分だけ、の順に探す
  - 予定を追加するとき、カレンダーの予定やほかの勉強の予定と重なっていれば注意を出す

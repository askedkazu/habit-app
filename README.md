# ちょいステップ習慣（MVP）

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

## 開発の流れ（機能を追加するとき）

1. 分割版（`index.html` / `style.css` / `app.js`）を編集する
2. `python3 build.py` を実行して、1ファイル版 `habit-app.html` を作り直す
3. 普段は `habit-app.html` をダブルクリックで開いて使う

## アカウント機能（Googleログインで端末間共有）の設定

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication** →「始める」→ ログイン方法で **Google** を有効化
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

- データは `users/{uid}` に保存（APIキー、モデル、追加ステップ、達成履歴）
- ログインは公開URL（GitHub Pages）や `localhost` で開いたときに使えます。ファイルを直接開いた場合（file://）は使えません
- ログアウトすると、その端末に保存されたデータは消去されます（アカウントには残ります）

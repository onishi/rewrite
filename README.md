# REWRITE

> 死ぬと時間は巻き戻り、レベルも装備も失われる。残るのは、知ってしまったことだけだ。
> ——そして、あなたが未来を書き換えた瞬間、その知識は嘘になる。

生成AIをゲームシステムの中心ではなく **接着剤** として組み込んだ、
ストーリー性のある **自動生成ダンジョンローグライク**。

全 8 階層の迷宮は毎 Run 自動生成される。死ねば階層もレベルも装備も失われるが、
**知ってしまったことだけは残る**。

- 設計書: [`design/DESIGN.md`](design/DESIGN.md)
- 設計自己レビュー: [`design/SELF_REVIEW.md`](design/SELF_REVIEW.md)

---

## 一番大事な性質

**生成AIを完全に削除しても、ローグライクとして成立する。**

戦闘・ビルド・シナジー・マップ・Knowledge・REWRITE・Boss 攻略・Ending 判定は
すべてゲームエンジン内の決定論的なコードで、LLM は一切関与しません。

```bash
npm run sim     # LLM を 1 度も呼ばずに 3 Run を自動プレイし、全文を出力
```

LLM が担当するのは「事前に列挙しきれない物語上の変化」だけです。

---

## 公開先

**https://rewrite.wagaya.workers.dev**

Cloudflare Workers（静的アセット + LLM プロキシ）で動作しています。
現在は `ANTHROPIC_API_KEY` が未設定のため **MOCK モード** です。
ゲームの全機能はそのまま遊べます（物語文だけが決定論的テンプレートになります）。

生成文を有効にする:

```bash
npx wrangler secret put ANTHROPIC_API_KEY    # 入力したキーはコードにも Git にも残らない
npx wrangler deploy                          # 反映
```

---

## 動かす

```bash
npm install
npm run build
npm start                      # http://localhost:5173
```

API キーなしでそのまま遊べます（UI に `MOCK` バッジが出ます）。
生成文を有効にする場合:

```bash
ANTHROPIC_API_KEY=sk-... npm start          # UI のバッジが AI になる
ANTHROPIC_API_KEY=sk-... REWRITE_MODEL=claude-opus-5 npm start
```

**API キーはブラウザに渡りません。** ゲームエンジンはブラウザ内で動作し、
LLM 呼び出しだけを `/api/llm/*` 経由でサーバへ委譲します。キーはサーバプロセスの
環境変数（Cloudflare では Worker のシークレット）にのみ存在します。

### その他のコマンド

```bash
npm test        # 69 テスト（戦闘 / Knowledge / REWRITE / LLM境界 / 自由行動 / 3Run検証）
npm run sim     # 3 Run の自動プレイ全文（設計 §22 の検証シナリオ）
```

### Cloudflare へのデプロイ

```bash
npm run cf:dev       # ローカルで Worker として起動（http://localhost:8787）
npm run cf:deploy    # ビルド → アセット収集 → wrangler deploy
npm run cf:secret    # ANTHROPIC_API_KEY を Worker のシークレットに登録
```

`npm run build:assets` が `build/` に公開バンドルを組み立てます（22 ファイル / 約 231 KB）。
ページが参照するパスをそのまま保つ必要があるため、`packages/web/public/` と、
コンパイル済みの `dist/web` `dist/core/src` だけをコピーします。
サーバ・Worker・テストの出力は公開バンドルに入りません。

Worker（`packages/worker/src/index.ts`）は Node 版サーバと同じ
`packages/core/src/llm/proxy.ts` を共有しており、検証・whitelist・mock フォールバックの
挙動は両者で完全に同一です。

---

## 構成

```
design/
  DESIGN.md              設計書（20項目）
  SELF_REVIEW.md         自己レビューと、それによる設計修正

packages/core/           ゲームエンジン（依存ゼロ・ブラウザでもNodeでも動く）
  src/types.ts           データモデル
  src/rng.ts             シード付き決定論的乱数（Math.random は一切使わない）
  src/content/           Skill 20 / Synergy 11 / Knowledge 25 / Item 20 /
                         Enemy 7 / Boss 3 / NPC 5 / WorldTruth 10 / Rewrite 6
  src/dungeon/
    types.ts             フロア・タイル・エンティティ
    generate.ts          フロア自動生成（部屋配置 → 通路 → 扉 → 役割 → 配置）
    runtime.ts           視界・経路探索・移動・敵AI
  src/engine/
    combat.ts            ターン制戦闘（Intent / Feint / 状態異常 / Guard / Focus）
    knowledge.ts         取得・信頼度・合成・無効化・効果解決
    run.ts               時計・探索・報酬・REWRITE 適用・RUN REPORT
    freeAction.ts        自由入力の判定（LLM は構造化のみ、判定はここ）
    game.ts              UI/サーバ共通のファサード
  src/llm/
    provider.ts          LLM 抽象インターフェース
    mock.ts              Mock Provider（LLM なしで全機能が動く）
    anthropic.ts         Anthropic Provider（サーバ専用・全呼び出しに mock フォールバック）
    validate.ts          JSON Schema 検証・whitelist・文字数クランプ
  test/                  69 テスト + 3 Run 自動シミュレータ

  src/llm/proxy.ts       サーバ側 LLM ディスパッチ（Node と Worker で共有）

packages/server/         ローカル開発用ホスト（node:http + 静的配信）
packages/worker/         Cloudflare Worker ホスト（本番）
packages/web/            UI（素の TypeScript + DOM、フレームワークなし）
tools/build-assets.mjs   公開バンドルの組み立て
wrangler.toml            Cloudflare 設定
```

---

## AI が触れないもの

HP / ダメージ / 能力値 / アイテム / Gold / 時刻 / マップ / Knowledge 取得状態 /
Skill / Status Effect / 敵の強さ / Drop / 成功判定 / Boss 条件 / Ending 条件 /
Trust / Suspicion / Distortion / 乱数

これを **3 層** で担保しています。

1. **Schema** — LLM のレスポンス型に、意味のある数値フィールドが存在しない
2. **Whitelist** — `proposeConsequences` はエンジンが渡した id からしか選べず、
   大きさ（`low`/`mid`/`high`）の実数値はエンジン側で決まる
3. **Sanitizer** — 検証に落ちた出力は Mock の決定論的テンプレートへ自動フォールバック

> LLM が「あなたの攻撃でドラゴンは死んだ」と書いても、`enemy.hp` は 1 も減りません。

テストで固定しています（`packages/core/test/llm-boundary.test.ts`）:

- 存在しない target / instrument / Knowledge id は捨てられる
- 発明された `actionId` は選択肢として採用されない
- whitelist 外の consequence は無視される
- **全呼び出しで例外を投げる敵対的 Provider を挿しても、HP が 1 も動かない**

ダンジョン側にも不変条件のテストを置いています（`packages/core/test/dungeon.test.ts`）:

- 全 8 階層 × 12 シードで、**到達できない床タイルが 1 つも存在しない**
- 階段は必ず到達可能で、入口の真上には出ない
- 同じシードは同じフロアを生成する
- エンティティが壁の中や互いの上に生成されない
- 部屋に入れば部屋全体が、通路では周囲 1 マスだけが見える

---

## AI が担当するもの

1. **列挙されていない逸脱の解釈**
   「毒殺されることを知っているので、王の料理を犬に食べさせる」という入力を
   `{verb:"give", target:"DOG", usesKnowledge:["K013"]}` に構造化する。
   **判定はしない。** K013 を持っているか、城にいるか、犬がいるかはエンジンが確認する。
2. **書き換えの余波の描写**
   RW01 の連鎖（密会消滅 → 警戒 → 粛清イベント出現）はエンジンが決める。
   「そのときハルガが何と言ったか」の組み合わせ爆発だけを AI が埋める。
3. **記憶する NPC の言葉**
   デジャヴ段階はエンジンが Run 数で決める。その段階で何と言うかを AI が書く。

---

## 遊び方の要点

| 要素 | 説明 |
|---|---|
| **ダンジョン** | 全 8 階層。部屋と通路、扉、階段。毎 Run 自動生成 |
| **視界** | 部屋に入るとその部屋全体が見える。通路は周囲 1 マス。松明で広がる |
| **時計** | 6:00 → 24:00 = 約 1080 歩。全フロアを調べ尽くす余裕は絶対にない |
| **灰** | 24:00 を過ぎると灰が降り、Guard を無視して毎分削られる |
| **戦闘** | 敵に体当たりでバトル画面へ。**避けて通ることもできる** |
| **Knowledge** | 文章ではなくルール。取得した瞬間に「何ができるようになったか」を提示する |
| **信頼度** | Confirmed / Uncertain / Rumor / Invalidated。不確かな知識は発動しないことがある |
| **合成** | 2 つの知識が揃うと自動で 3 つ目が生まれる（例: K005 + K006 → K021） |
| **REWRITE** | 知識を使って未来を潰す。**必ずその知識が Invalidated になる** |
| **Distortion** | REWRITE のたびに増え、`schedule` タグの知識を一斉に不確かにする |
| **死** | Knowledge は死んでも残る。Boss に負けると必ず 1 つ知識が手に入る |
| **自由行動** | 1 Run に 3 回だけ。毎ターン入力を求めない |

### 操作

| | |
|---|---|
| 移動 | 方向キー / WASD / テンキー（8方向）/ マップをクリック |
| 待つ | `5` `.` `Space` |
| 足元を調べる | `Enter` |

### 「知識を集めるほど簡単になる」のを防ぐ 3 重の仕掛け

1. REWRITE は必ず自分の前提を焼く（RW03 は K007 を焼き、`[偽物だと告げる]` が消える）
2. Distortion の蓄積で時刻系の知識が一斉に劣化する
3. Run 10 以降、騎士団長はループを記憶しており、**あなたが K004（火）を持っていることを知っている**

### Ending 3 種

| | 条件 |
|---|---|
| **E1 事件は解決した** | 騎士団長ヴェインを倒す |
| **E2 陰謀は暴かれた** | 宰相セルドを倒す。ただし K007 か K022 を **無効化せずに** 保持していること |
| **E3 REWRITE** | 灰の鍵と K018 を持って Boss に臨む。事件を解決せず、塔に登る |

E2 は「知識を使って宰相を引きずり出す」と「知識を残しておく」が両立しないと成立しない。
RW03 で宰相を表に出すと K007 が焼けるため、**同じ Run では E2 に届かない**。
これは仕様であり、逆説の実演そのものです。

---

## ライセンス

MIT

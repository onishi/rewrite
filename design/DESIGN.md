# REWRITE — ゲーム設計書 (v1.0)

> 実装前の設計フェーズ成果物。自己レビューは `design/SELF_REVIEW.md`、
> レビュー後の修正点は本書に反映済み（修正履歴は末尾 §21）。

---

## 1. コンセプト（一文）

**REWRITE とは、「死ぬと時間は巻き戻り、レベルも装備も仲間も失うが、"知ってしまったこと" だけは残る。
プレイヤーはその知識を使って、まだ起きていない出来事を先回りして潰し、世界に別の未来を歩ませるローグライクである。」**

補助的な一文（プレイヤー向けタグライン）:

> 「攻略情報は残る。ただし、あなたが世界を変えた瞬間、その攻略情報は嘘になる。」

この 2 文目が本作の設計上の背骨である。Knowledge は強化アイテムであると同時に **消費可能な賭け金** であり、
「知識を集めるほどゲームが簡単になる」構造を自ら壊し続ける。

---

## 2. コアループ

### 2.1 Run 内ループ（秒〜分単位）

```
ノード選択（危険度 / 報酬ヒント / 時間コストを見て判断）
  ↓
到着イベント（戦闘 / 社交 / 発見 / 店 / 祭壇 / 休息）
  ↓
解決（ターン制戦闘 or 選択肢 or 自由行動）
  ↓
報酬（Gold / Skill 3択 / Item / Knowledge）
  ↓
ビルドが変わる → 次に取れるリスクが変わる
  ↓
時計が進む（6:00 → 24:00）
  ↓（時間切れ or 城到達）
Boss
```

### 2.2 メタループ（Run をまたぐ）

```
死ぬ / クリアする
  ↓
RUN REPORT（今回得た Knowledge・初訪問・書き換えた歴史・最大シナジー）
  ↓
[ REWRITE ] ボタン
  ↓
Knowledge だけを持って 6:00 に戻る
  ↓
Run 開始時 & 道中で「REWRITE 行動」が選べるようになっている
  ↓
世界の予定が変わる → 前回と違う事件・違うボス・違う地形
  ↓
一部の Knowledge が Invalidated（自分で壊した未来）になる
  ↓
もう一度
```

### 2.3 3 種類の成長の担当範囲

| 成長 | 持続 | 担当するプレイ感 | 実装上の所在 |
|---|---|---|---|
| Run Growth | 1 Run | 「今回のビルドが噛み合った！」 | `RunState.skills / items / level` |
| Knowledge Growth | 恒久 | 「知ってるから突破できる」 | `MetaState.knowledge` |
| Mystery Growth | 恒久（プレイヤーの頭の中） | 「世界の正体が見えてきた」 | `MetaState.worldTruthDisclosure` |

---

## 3. 1 Run の具体例（Run 1・初回プレイ）

想定所要 **22 分**。時計は 6:00 開始、24:00 で強制 Boss。

| 時刻 | 場所 | 起きること | プレイヤーの判断 |
|---|---|---|---|
| 06:00 | 村アシュメア（Hub） | ハルガ（宿屋）と会話。無料行動 2 回 | 「装備を買う」か「噂を聞く」か |
| 08:00 | 森 / 墓地 / 街道 の 3 択 | 墓地は危険度★★だが報酬に `Knowledge` タグ | 危険を取るか |
| 08:00→10:00 | 墓地・外縁 | 腐食兵 ×2 戦闘。勝利 → Skill 3 択で **Necromancy** 取得 | |
| 10:00→12:00 | 墓地・納骨堂 | Necromancy で死体と会話 → **K002「墓守は生者を憎んでいない」** 取得 | |
| 12:00→14:00 | 城下町・市場 | 店。Gold 40。松明 or 聖水 or 鉄の護符 | |
| 14:00→16:00 | 地下水路 | 水路の蛭（Elite）。HP 48/72 まで削られる | 逃げる（1h 消費・報酬なし）か戦うか |
| 16:00→18:00 | 教会・礼拝堂 | 司祭オルドと社交。嘘を見抜けず空振り | Liar's Eye があれば別 |
| 18:00→20:00 | 城・外郭 | 騎士団兵 ×3。HP 20/72 | |
| 20:00→22:00 | 城・広間 | **選択**: 休息（HP 回復）か、光る扉（Knowledge 濃厚・入室時 HP -25%） | ← 本作の典型的ジレンマ |
| 22:00 | （扉を選ぶ） | **K007「王女は偽物である」** 取得。HP 5/72 | |
| 22:00→24:00 | Boss: 騎士団長ヴェイン | 第一形態で敗北 | |
| — | RUN REPORT | 新規 Knowledge 2 件 / 初訪問 4 / 最大シナジー なし | |

初回プレイヤーの感想として設計している着地点:

- 「普通のローグライクとして、ビルドを組んで戦って負けた」
- 「最後に取った K007 が、明らかにヤバい情報だった」
- 「死んでもこれは残るらしい。じゃあもう一回」

---

## 4. 3 Run 連続の具体的プレイ例

MVP の検証シナリオそのもの。**この 3 Run が成立しなければ MVP は失敗** とみなす。

### Run 1 — 「普通のローグライクとして遊ぶ」

§3 の通り。取得 Knowledge:

- `K002` 墓守は生者を憎んでいない（Confirmed）
- `K007` 王女は偽物である（Confirmed）

Boss 敗北。

### Run 2 — 「知っていることが強さになる」

開始画面に新要素が出る。

```
[ REWRITE 可能な行動 ]
  なし（対象となる人物にまだ会っていない）
[ 所持 Knowledge ]
  K002 / K007
```

- **08:00 墓地**: K002 があるため、墓守ネルとの遭遇が「戦闘」ではなく
  「会話」ノードになる。Run 1 では殴り合って HP を 30% 失った場所を、**ノーダメージ＋ Gold 60 で通過**。
  → 「知っているから突破できる」の初体験。ここは**明示的に UI で見せる**（`Knowledge により回避` のバッジ）。
- ネルとの会話で **K015「灰の塔の鍵は墓守が持つ」**（Uncertain）取得。
- 浮いた HP と時間で **教会・地下** へ寄り道 → **K012「教会の地下に"最初の書き換え"の記録がある」** 取得。
- 城で **K014「司祭は王女の入れ替わりを知っている」** 取得。
- ここで **Knowledge シナジーが自動発火**:
  `K007 + K014 → K022「司祭が入れ替わりを手配した」`（Uncertain）
  → ポップアップ「**2 つの知識が結びついた**」。プレイヤーが何もしていないのに世界の解像度が上がる瞬間。
- **Boss 戦**: K007 を所持しているため、戦闘中に特殊行動
  `[「王女は偽物だ」と言う]` が出現。ヴェインは 1 ターン Fear 状態（行動不能）。
  それでも第二形態で敗北。しかし敗北直前に **K009「第二形態は雷に弱い」** を取得。

Run 2 の体験: **「前回苦戦した場所を知識でショートカットできた」「ボスに新しい手札が増えた」**。

### Run 3 — 「REWRITE すると世界が予想外に変化する」

開始画面:

```
[ REWRITE 可能な行動 ]
  RW03  王女を本名で呼ぶ            required: K007(Confirmed)     cost: 1h
        → 予想される影響: 城の予定が変わる / K007 は Invalidated になる
  RW06  司祭に入れ替わりを問い詰める  required: K007 + K014        cost: 1h
```

プレイヤーは **RW03** を選ぶ。

engine が決定する結果（AI ではない）:

1. 偽王女リゼが城から逃走 → **城・広間ノードが「もぬけの殻」に差し替わる**
2. 宰相セルドが計画の露見を察知 → **新イベント「粛清」が城下町に出現**（Run 1-2 には存在しない）
3. Boss が **騎士団長ヴェイン → 宰相セルド** に差し替わる
4. `K007` が **Invalidated**（もう「王女は偽物」ではない。偽王女はもういないので）
   → Boss 戦の `[「王女は偽物だ」と言う]` は**使えなくなる**
5. `Distortion +2`

AI が生成する部分: 逃走した王女・動揺する城の描写、宰相の初登場セリフ、次への伏線 1 行。

その後:

- ビルドが完成する。`Premonition` + `Assassin` を引き当て、シナジー **「予見殺」** 成立
  → 敵の行動が見えている相手への先制がすべてクリティカル。雑魚戦が 1 ターンで終わる。
- `K009`（雷弱点）＋ 雷の雫（Item）で、本来なら削り切れない相手を溶かす。
- **騎士団長ヴェインとの戦闘そのものが発生しない**。Run 1 と 2 でボスだった男が、
  RW03 の結果として「王女を追って城を離れている」。城門で一言だけ残して去る。
- 代わりに **宰相セルド戦**。K007 が Invalidated なので影武者を盾にする戦法を崩せず、苦戦する。
  → **「知識を使ったせいで、知識が効かなくなった」** というこのゲームの中核体験。
- 敗北または辛勝。いずれにせよ **知らない未来が始まっている**。

3 Run 終了時点でプレイヤーが得ているもの:

1. ローグライクとして面白い（ビルド、3択、危険度判断、時計管理）
2. Knowledge が強さになる（回避・特殊行動・ショートカット）
3. REWRITE で世界が予想外に変わる（Boss が変わる、知識が死ぬ）

---

## 5. 戦闘システム

### 5.1 基本
ターン制。プレイヤー 1 体 vs 敵 1〜3 体。

**プレイヤーの行動（1 ターン 1 回）**

| 行動 | 効果 |
|---|---|
| Attack | 武器攻撃。Focus +1 |
| Skill | 装備スキル（最大 6）を使用。Focus を消費 |
| Item | 消費アイテム使用。ターンを消費しない Quick アイテムあり |
| Defend | Guard 獲得（6 + level×2）。Focus +2 |
| Special Action | **Knowledge / シナジーで条件を満たしたときだけ出現する文脈行動** |

**リソース**
- `HP`: 基本 60 + level×8
- `Focus`: 最大 5。ターン開始時 +2（Attack/Defend で追加取得）
- `Guard`: ダメージを肩代わり。自ターン開始時に消滅（`Ironblood` で持ち越し）

### 5.2 Intent（予告）システム
敵は行動を **予告** する。既定では **種別のみ**（攻撃 / 強攻撃 / 防御 / 弱体 / 特殊 / フェイント）が見え、
**数値は見えない**。

- `Premonition` → 数値と対象まで見える
- `Cold Reading` → 2 ターン先まで見える（代償: 最大 HP の 10%）
- `Liar's Eye` → **Feint（フェイント）** を見破る。Feint は「強攻撃に見えて実は弱体」といった偽の予告

この「予告が嘘をつくことがある」仕様が、Liar's Eye を戦闘スキルとしても物語スキルとしても成立させる。

### 5.3 状態異常（7 種）

| 名前 | 効果 |
|---|---|
| Burn N | ターン終了時 N ダメージ、N−1 |
| Bleed N | 行動するたび N ダメージ、N−1 |
| Poison N | ターン終了時 N ダメージ（**Guard 無視**）、減衰しない |
| Weak N | 与ダメージ −40%、N ターン |
| Vulnerable N | 被ダメージ +50%、N ターン |
| Fear N | N ターン行動不能（ボスは 1 ターンが上限） |
| Mark | 次に受ける攻撃が必ずクリティカル。消費 |

### 5.4 ダメージ式（engine が確定、AI は一切関与しない）

```
raw   = (base + flatBonus) * (1 + pctBonus) * critMult * weakMult * vulnMult * typeMult
dealt = max(1, floor(raw)) を Guard → HP の順に適用
```
- `critMult` = 2.0
- `typeMult` = 属性相性（Lightning vs Wet/Metal = 2.0 など）
- 乱数は **seeded RNG** のみ（`rng.range(0.92, 1.08)`）。再現性を担保する

### 5.5 戦闘を「避ける」ことも戦闘設計の一部

- `Silver Tongue` → 人型敵に `[交渉する]`
- `Knowledge` → `[K011 を突きつける]` で盗賊が退く
- `Premonition` → 初手の予告を見てから **逃走**（時間 1h コスト、報酬なし）

**戦わない選択肢が常に机の上にある**ことが、ビルドの幅そのものになる。

---

## 6. Skill 20 個

`W` = 世界／物語にも作用する。`C` = 戦闘専用。**W:13 / C:7** と、意図的に W を多くしている。

| # | 名前 | 戦闘での効果 | 戦闘外での効果 | 種 |
|---|---|---|---|---|
| S01 | Liar's Eye（嘘看破の眼） | Feint を見破る。偽予告の敵に +30% | 嘘をついている NPC が判別でき、専用選択肢が出る | W |
| S02 | Necromancy（死霊術） | 敵を倒すと Echo（その敵の技 1 回分）を獲得 | 死体と会話して Knowledge を得る | W |
| S03 | Premonition（予知） | 敵 Intent の数値・対象が見える | イベント選択肢に危険度が表示される | W |
| S04 | Silver Tongue（銀の舌） | 人型敵に `[交渉する]`（戦闘回避） | 交渉成功率 +30%、価格 −20% | W |
| S05 | Blood Price（血の代償） | HP を X 払い、次の攻撃に +X ダメージ | HP を払って危険な Knowledge を強引に取得 | W |
| S06 | Assassin（暗殺者） | Intent が判明している敵への先制が確定クリティカル | 夜間ノードで奇襲開始（敵 1 体減） | W |
| S07 | Torchbearer（松明持ち） | 攻撃に Burn 3 を付与（毎ターン 1 回） | 暗いノードの隠し発見を可視化。火を恐れる相手に特殊行動 | W |
| S08 | Ironblood（鉄血） | Guard 2 倍、次ターンに持ち越す | 体力消耗イベントのダメージ −50% | C |
| S09 | Chronicler（記録者） | — | 発見ノードの Knowledge +1、Knowledge 取得の時間コストが 0 | W |
| S10 | Thief's Grace（盗人の指） | 初撃で Gold を盗む | 店・NPC から盗める（失敗すると Suspicion +2） | W |
| S11 | Stormcall（雷招き） | 雷ダメージ。Wet / Metal に ×2 | 水路・鉄格子ギミックを破壊して近道 | W |
| S12 | Oathbreaker（誓い破り） | 協力中の NPC を犠牲に大ダメージ | 約束を破って即時報酬。Suspicion +3、該当 NPC の Trust 全損 | W |
| S13 | Empath（共感） | 敵の弱点属性が見える | NPC の隠れた Goal が見える | W |
| S14 | Second Wind（第二の息） | Run に 1 度、致死ダメージ時に HP 30% で復帰 | — | C |
| S15 | Royal Knowledge（王家の典礼） | `royal` タグの Knowledge を貴族系の敵に特殊行動として使える | 王族関連の会話選択肢が解禁 | W |
| S16 | Poisoner（毒使い） | 攻撃に Poison 4 を付与 | 食事・杯に毒を盛るイベント行動 | W |
| S17 | Echo Step（残響歩法） | 戦闘に 1 度、攻撃を完全回避 | Run に 1 度、移動時間 −2h | C |
| S18 | Martyr's Bargain（殉教者の取引） | 致死時、Uncertain な Knowledge を 1 つ Confirmed にして死ぬ | 「死んで知識を取る」プレイを制度化 | W |
| S19 | Cold Reading（読心） | 2 ターン先まで Intent 表示（開始時 最大 HP −10%） | 会話で相手の次の発言が 1 つ予告される | W |
| S20 | Archivist's Loop（記録の環） | — | Run 開始時に Uncertain な Knowledge を 1 つ Confirmed 化。REWRITE の時間コスト −1h | W |

---

## 7. Skill シナジー 10 個（実装は 11 個）

engine が保持する `SynergyRule[]`。成立時は UI に **「SYNERGY」** バナーが出る。

| # | 組み合わせ | 名前 | 効果 |
|---|---|---|---|
| Y01 | S02 + S01 | 死者の嘘 | 死体会話で得る Knowledge が Uncertain ではなく **Confirmed** になる。Echo 保持数 +1 |
| Y02 | S03 + S06 | 予見殺 | Intent が見えている敵への攻撃は**常に**クリティカル（先制に限らない） |
| Y03 | S04 + S15 | 王家の交渉 | `royal` Knowledge 所持時、本来不可能な交渉（Boss の戦闘回避を含む）が解禁 |
| Y04 | S05 + S08 | 鉄の代償 | Blood Price で払った HP と同量の Guard も同時に獲得 |
| Y05 | S07 + S11 | 嵐火 | 同一対象の Burn と Shock を起爆 → 合計スタック ×3 の一括ダメージ |
| Y06 | S16 + S04 | 毒杯 | 社交イベント中に毒殺を試みても露見しない（Suspicion 増加なし） |
| Y07 | S13 + S01 | 完全看破 | NPC の真の Goal と嘘を同時に表示。敵の Feint が全て無効化 |
| Y08 | S09 + S18 | 遺稿 | 死亡時、その Run で得た **すべての** Uncertain Knowledge が Confirmed になる |
| Y09 | S17 + S06 | 影撃 | 回避に成功した直後の攻撃がクリティカル＋ Mark 付与 |
| Y10 | S10 + S02 | 墓荒らし | 死体から Gold と Item もドロップする |
| Y11 | S19 + S03 | 未来視 | 3 ターン先まで Intent 表示。Cold Reading の HP コストが消える |

**設計意図**: Y02 / Y08 / Y03 は「これヤバいのでは？」を引き起こす担当。
特に **Y08（遺稿）は "死ぬほど得をする" ビルド** であり、リスク＆リターン設計の柱。

---

## 8. Knowledge 20 個（＋合成 5 個）

### 8.1 基礎 Knowledge

| ID | タイトル | 入手元 | 種別 | gameplayEffect（ルールのアンロック） |
|---|---|---|---|---|
| K001 | 森の霧は夜明けに晴れる | 森・観察 | route | 森ノードの時間コスト −1h、視界デバフ無効 |
| K002 | 墓守は生者を憎んでいない | 墓地・死体会話 | social | 墓守との遭遇が戦闘→会話に変化 |
| K003 | 宿屋の地下に隠し入口がある | 村・探索 | route | 村に隠しノード「宿屋地下」が出現 |
| K004 | 騎士団長は火を恐れている | 城下町・噂 | combat | Boss 戦に `[松明を突きつける]`（Fear 1 付与） |
| K005 | 騎士団長は 22 時に教会へ行く | 尾行イベント | schedule | 22 時の教会ノードに密会イベントが出現 |
| K006 | 宿屋の主人も 22 時に外出する | 村・張り込み | schedule | 22 時の宿屋が無人になり侵入可能 |
| K007 | 王女は偽物である | 城・隠し部屋 | truth/royal | Boss 戦に `[偽物だと告げる]`（Fear 1 / セルドの盾を破壊）。Ending B 条件 |
| K008 | 地下水路は城の井戸に繋がる | 水路・探索 | route | 水路 → 城 のショートカット（1 ステップ・2h 短縮） |
| K009 | ボスの第二形態は雷に弱い | Boss 戦で観測 | combat | 第二形態に対し Lightning ×2、`[雷を撃ち込む]` 解禁 |
| K010 | 聖水は不死者を一撃で滅ぼす | 教会・司祭 | combat | 聖水アイテムが Undead に即死効果 |
| K011 | 街道の盗賊は元騎士団の兵である | 盗賊・死体会話 | social | 盗賊と無条件で交渉可能（Silver Tongue 不要） |
| K012 | 教会の地下に「最初の書き換え」の記録がある | 教会・地下 | lore | 教会に隠し発見ノードが出現。WT05 開示 |
| K013 | 王は今夜毒を盛られる | 城・厨房 | schedule | 城イベントで毒殺阻止行動が解禁 |
| K014 | 司祭は王女の入れ替わりを知っている | 司祭・嘘看破 | social | 司祭を脅迫／交渉して真実を引き出せる |
| K015 | 灰の塔の鍵は墓守が持つ | 墓守・会話 | route | 墓守から鍵を入手可能。塔ルートの前提 |
| K016 | ループの起点は「灰の日」である | 教会・灰の扉 | lore | 灰の塔への入口が地図に現れる。WT09 開示 |
| K017 | 騎士団長もループを記憶している | Boss 戦 Run5+ | meta | ヴェインがプレイヤーの Knowledge に対策する（難化＋新ルート） |
| K018 | 「書き手」は塔の頂にいる | 灰の塔・門 | lore | 灰の鍵と併せ持つと Boss が「書き手」に差し替わる |
| K019 | REWRITE には代償がある | Distortion 5 到達 | meta | Distortion メーターが可視化される |
| K020 | 主人公自身が最初の書き換えの産物である | True Boss 前 | truth | Ending C（True）の条件 |

### 8.2 合成 Knowledge（§9）

| ID | 必要 | タイトル | 効果 |
|---|---|---|---|
| K021 | K005 + K006 | 二人は教会で密会している | 22 時の教会に密会ノードが確定出現。RW01 が解禁 |
| K022 | K007 + K014 | 司祭が入れ替わりを手配した | 司祭を Boss 前に排除可能。Ending B の確度上昇 |
| K023 | K009 + K017 | 騎士団長は雷耐性を得つつある | **K009 が Uncertain に格下げ**（逆説の実演） |
| K024 | K013 + K003 | 毒は宿屋の地下から運ばれる | 宿屋地下で毒の出所を押さえると王を確実に救える |
| K025 | K016 + K019 | 灰の日は REWRITE の累積で起きた | WT09/WT10 開示。Ending C ルートの中核 |

### 8.3 Knowledge の状態（逆説の実装）

```
Rumor       … 効果は発動するが 50% で不発。「たぶん本当」
Uncertain   … 効果は 75% で発動
Confirmed   … 100% 発動
Invalidated … 発動しない。使おうとすると「その未来はもう存在しない」と返され、1 ターン / 1h を失う
```

**格下げのトリガー**
- プレイヤー自身の REWRITE が、その Knowledge の前提を壊したとき → `Invalidated`
- 合成によって上書きされたとき（K023） → `Uncertain`
- Distortion が閾値を超えたとき、`schedule` タグの Knowledge が一斉に `Uncertain` 化

**格上げのトリガー**
- 同じ事実を別ルートで再観測 → `Confirmed`
- `S18 Martyr's Bargain` / `S20 Archivist's Loop` / シナジー Y01・Y08

---

## 9. Knowledge による特殊攻略例 10 個

| # | 使う Knowledge | 通常だと | Knowledge があると |
|---|---|---|---|
| 1 | K002 | 墓守と戦闘（HP −30%） | 会話ノードに変化。Gold と K015 を得て無傷通過 |
| 2 | K004 | 騎士団長第一形態を正面から削る | `[松明を突きつける]` → Fear 1。実質 1 ターン先制 |
| 3 | K007 | セルドは影武者を盾に被ダメ 80% カット | `[偽物だと告げる]` → 盾が消える |
| 4 | K008 | 城まで 2 ステップ（4h） | 井戸から直通（2h 節約 → 寄り道 1 回ぶん） |
| 5 | K009 | 第二形態で TPK 常連 | Lightning ×2。雷の雫 1 本で形態ごと飛ぶ |
| 6 | K010 | 腐食兵 3 体に 4 ターン | 聖水で 1 体即死。Elite も対象 |
| 7 | K011 | 街道の盗賊 Elite 戦 | 交渉成立。盗賊が **護衛として 1 戦だけ同行** |
| 8 | K013 + K024 | 王が死に、城が混乱（危険度 +1） | 毒の出所を押さえ王が生存 → 城に味方衛兵が出る |
| 9 | K021 | 22 時の教会は空 | 密会に踏み込める（高リスク・高 Knowledge） |
| 10 | K015 + K018 | 塔に入れない | 塔ルート解禁。True Boss へ |

---

## 10. NPC 5 人

| ID | 名前 | 役割 | 公開 Goal | 真の Goal（World Truth） | 性格 | ループ認識 |
|---|---|---|---|---|---|---|
| N01 | ハルガ | 宿屋の主人 | 宿を続けたい | 元王宮毒見役。過去を隠し通したい（WT04） | 無愛想・情に厚い・嘘が下手 | Run 6+ |
| N02 | ヴェイン | 騎士団長 / Boss A | 王国の秩序を守る | 王女の死を知り罪悪感で沈黙（WT03） | 実直・頑固・自罰的 | **Run 3+（最速）** |
| N03 | オルド | 司祭 | 教会と信徒を守る | 入れ替わりを手配した共犯（WT02） | 慇懃・雄弁・常習的に嘘をつく | しない |
| N04 | ネル | 墓守（子ども） | 埋葬を続ける | 失踪した姉を探している。姉＝「書き手」（WT07） | 率直・無邪気・恐れを知らない | Run 8+ |
| N05 | セルド | 宰相 / Boss B | 王を補佐する | 王権の簒奪。真犯人（WT01） | 温厚な仮面・計算高い | Run 10+ |

**Trust / Suspicion**: 各 NPC は `trust(-3..+3)` と、世界共通の `suspicion(0..10)` を持つ。
Trust は Run ごとにリセットされるが、**REWRITE で「知らないはずのこと」を言うと初手で Suspicion が跳ねる**。
これが REWRITE のコストの一部。

### 10.1 Loop Awareness（デジャヴ）

engine が `metaState.totalRuns` を見て、NPC のセリフテーブルの段階を上げる。AI には
「この NPC は現在デジャヴ段階 2 である」と構造化して渡すだけで、段階の決定は engine が行う。

| Run | ヴェインの反応 |
|---|---|
| 1-2 | 「何者だ」 |
| 3-5 | 「……以前、会ったことがあるか？」 |
| 6-9 | 「また、お前か」 |
| 10+ | 「今度は何を書き換えるつもりだ？」＋ **K017 取得可能。以後ヴェインはプレイヤーの既知 Knowledge に対策する** |

**優位性の崩壊**: Run 10 以降のヴェインは「プレイヤーが K004 を持っている」ことを知っており、
松明を予測して **Fear 耐性** を得ている。ただし同時に「火を恐れる自分」を自覚したことで
新たな会話ルートが開く。難化と解放が同時に起きる。

---

## 11. Boss 2 体

### Boss A — 騎士団長ヴェイン

- Phase 1「騎士団長」: HP 180。盾で Guard を張り、Feint を多用する（Liar's Eye が刺さる）
- Phase 2「誓いの残響」: HP 140。全体攻撃主体。**Lightning 弱点（K009 で判明）**

**攻略ルート（6 通り）**

| ルート | 条件 | 結果 |
|---|---|---|
| 正面突破 | なし | 純粋なビルド勝負 |
| 弱点を突く | K009 + 雷ダメージ源 | Phase 2 を 2 ターンで溶かす |
| 火で怯ませる | K004 + 松明 | 毎ターン Fear 判定。Run 10+ は無効化される |
| 過去を暴露する | K007 + K014（または K022） | 戦闘開始時に Phase 1 を**スキップ**、Phase 2 の HP −40 |
| 部下を寝返らせる | K011 + 盗賊と交渉済み | 増援が味方化。Boss の Guard 生成が止まる |
| 戦闘を発生させない | Y03（S04+S15）+ K021 | 密会の件で取引成立。**戦闘スキップで通過** |

### Boss B — 宰相セルド

出現条件: `RW02` または `RW03` を実行済み、もしくは Boss A を K007 所持で撃破。

- Phase 1「王の影」: HP 150。**影武者の盾**（被ダメ −80%）。K007 Confirmed の `[偽物だと告げる]` で盾破壊
- Phase 2「簒奪者」: HP 200。ターン経過で強化。長期戦するほど不利 → 速攻ビルド有利

**書き換えによる Boss 変更**: RW03 を実行すると、Boss A は「王女を追って不在」になり
**Boss 戦そのものが Boss B に差し替わる**。これが §17 の要求「Boss 戦を書き換える」の実装。

### True Boss —「書き手」

条件: **灰の鍵（`I_GRAVEKEY`）を所持し、かつ K018 を保持していること**。

- 鍵の入手経路は 2 つ: `RW04`（墓守に鍵のことを告げる — ただしネルは死ぬ）、または灰の扉のレア報酬
- K016 が「灰の塔・門」ノードを地図に出現させ、そこで K018 が手に入る
- 条件を満たすと `startBoss` が Boss を `B_WRITER` に差し替える。
  **事件を解決するのではなく、塔に登ることを選ぶ**という分岐であり、Ending C に到達する

---

## 12. World Truth（10 件）

engine が Run 0 で確定し、**以後 Run をまたいで不変**。AI はこれと矛盾してはならない。

| ID | 内容 | 開示条件 |
|---|---|---|
| WT01 | 真犯人は司祭ではなく宰相セルドである | K022 or Boss B 撃破 |
| WT02 | 王女は 3 年前に死に、現在の王女は宰相が用意した影武者 | K007 |
| WT03 | ヴェインは王女の死を知っており、罪悪感がループ記憶体質を招いた | K017 |
| WT04 | ハルガは元王宮の毒見役 | K024 |
| WT05 | 教会地下に「灰の日」の記録がある | K012 |
| WT06 | ループの原因は塔の頂にいる「書き手」 | K018 |
| WT07 | 「書き手」は墓守ネルの姉であり、主人公の姉でもある | K020 |
| WT08 | 主人公は最初の REWRITE によって生まれた、本来存在しない人間 | K020 |
| WT09 | REWRITE のたび Distortion が増え、限界を超えると世界が灰になる | K019 |
| WT10 | 「灰の日」はすでに 5 回起きている | K025 |

**AI への渡し方**: 全 10 件を `{id, statement, revealed}` で渡し、プロンプトで
「`revealed:false` の内容を**断定してはならない**が、矛盾する内容も書いてはならない。
示唆・伏線はよい」と制約する。犯人が毎回変わるミステリーにはならない。

---

## 13. マップ構造 — 自動生成ダンジョン

### 13.1 全体構造

村アシュメアの井戸から潜る **「灰の迷宮」全 8 階層**。各階層は毎 Run 自動生成される。

```
[ 村アシュメア ] 06:00  地上ハブ（行動 3 回まで）
        ↓ 井戸を降りる
 B1F 森の根          (forest)
 B2F 埋もれた街道    (road)
 B3F 墓所・外縁      (graveyard)
 B4F 墓所・深層      (graveyard)
 B5F 地下水路        (sewer)
 B6F 教会地下        (church)
 B7F 埋没した城下町  (town)
 B8F 玉座の下        (castle) ← Boss
```

各階層は既存の「地域」に対応しており、Knowledge の地域フックはそのまま効く。

### 13.2 フロア生成アルゴリズム

1. 6〜9 個の矩形の部屋を、互いに 2 タイル以上離して配置（220 回まで試行）
2. 配置順に隣同士を L 字の通路で接続 → **全部屋が必ず連結**
3. さらに 1〜2 本の通路を追加して閉路を作る（一本道にしない）
4. 通路のうち、部屋に 1 面だけ接するタイルを **扉** に変換
5. 入口から最も遠い部屋に **下り階段**（最下層では Boss）を置く
6. 残りの部屋に役割を割り当てる:
   宝物庫 / 祭壇 / 灰の扉 / 人物 / 篝火 / 商人
7. その階層の地域に対応する未取得 Knowledge を 1 つ配置する
8. 敵を `2 + 深度 × 0.7 + 危険度補正` 体、部屋にランダム配置（Elite 判定あり）

グリッドは 41〜53 × 23〜31。**同じシードは必ず同じフロアを生成する。**

### 13.3 視界

不思議のダンジョン型の「部屋明かり」方式。

| 状況 | 見える範囲 |
|---|---|
| 部屋の中 | その部屋の全体 + 壁 + 出入口 |
| 通路 | 自分の周囲 1 マス |
| 通路（松明所持） | 周囲 2 マス |
| 通路（Torchbearer 所持） | 周囲 3 マス |

一度見たタイルは記憶され、暗く表示される。
**松明が地下で意味を持つ**ため、`S07 Torchbearer` と `I_TORCH` が探索スキルとしても機能する。

### 13.4 時計＝探索予算

| 行動 | コスト |
|---|---|
| 1 歩 | 1 分 |
| 階段を降りる | 10 分 |
| 手がかりを調べる | 20 分（Chronicler で 0 分） |
| 灰の扉 | 20 分 |
| 篝火で休む / 鍛える | 30 分 |
| 会話 | 10 分 |
| REWRITE | 60 分（Archivist's Loop で 0 分） |

6:00 → 24:00 = **1080 分 = 実質 1080 歩**。
8 階層を降りるだけなら十分だが、**全フロアを隅々まで探索する余裕は絶対にない。**
「この階をもう少し調べるか、階段に向かうか」が毎フロアの基本判断になる。

### 13.5 24:00 以降 — 灰が降る

制限時間を過ぎると天井から灰が落ちはじめ、**Guard を無視するダメージ**が毎分入り、
超過時間に比例して増える。逃げ場はない。階段を探すか、ここで死んで知識を持ち帰るかを選ぶ。

これは「時間切れで強制ボス戦」の置き換えであり、
**「もう少しだけ」を必ず罰する**ための装置である。

### 13.6 戦闘への接続

グリッド上で敵に体当たりすると、**既存のターン制戦闘画面**が開く。
グリッド上で殴り合う方式にしなかったのは、Knowledge が
`[松明を突きつける]` のような**ボタンとして現れる**仕組みが本作の核だからである（§8）。

| 誰が接触したか | 効果 |
|---|---|
| プレイヤーが敵に体当たり | 先制を取れる（`S06 Assassin` が機能する） |
| 敵がプレイヤーに到達 | 不意打ち。先制権を失う |

敵は視界内に入ると起床し、経路探索でプレイヤーを追う。
**戦闘は回避可能**であり、通路を使って撒くことも、部屋を迂回することもできる。

### 13.7 毎 Run 変わるもの / 変わらないもの

| 変わる（seeded random） | 変わらない |
|---|---|
| 各階のフロア形状、部屋数、通路、扉、階段位置、敵編成と配置、Drop、Skill 3 択、Item、部屋の役割、Knowledge がどの部屋に落ちるか | 階層数（8）、各階層の地域と名前、NPC の正体、真犯人、ループの原因、Ending 条件 |

「フロアはランダム、真実は不変」。

## 14. リスク＆リターン設計

### 14.1 常に提示する 3 つの軸

1. **HP を賭ける**: 灰の扉 / Shrine / Blood Price
2. **時間を賭ける**: 寄り道 1 回 = Boss 前の休息 1 回ぶん
3. **未来を賭ける**: REWRITE = Knowledge を 1 つ焼いて世界を変える

### 14.2 「死ぬ覚悟で Knowledge だけ取りに行く」の制度化

- Knowledge は **取得した瞬間に MetaState へ書き込まれる**（Run クリアは不要）
- `S18 Martyr's Bargain`: 死亡時に Uncertain を 1 つ Confirmed 化
- `Y08 遺稿`: 死亡時に Run 中の Uncertain を **全て** Confirmed 化
- RUN REPORT に **「この Run の収穫」** を大きく表示し、死亡＝損失という印象を与えない

→ 終盤に HP 8 で「灰の扉」に入るのは**正しいプレイ**である、と設計上認める。

### 14.3 逆方向の圧力（死に得を防ぐ）

死が完全に得になるとテンポが崩れるため、以下を置く。

- `Distortion` は死亡でも減らない。Knowledge を稼ぐほど世界は歪み、敵が強くなる
- Run 内 Growth（Skill / Item / Level）は完全に失われるため、**クリア報酬（Ending 到達）でしか開かない要素**を置く
  （Ending A で `S20 Archivist's Loop` が Skill プールに追加、など）
- 同じ Knowledge は二度取れない。周回で「稼ぐ」ことはできない

---

## 15. REWRITE による歴史変更の具体例

`RewriteAction` は engine 定義のデータ。**効果は全て決定論的**で、AI は描写のみを担当する。

| ID | 行動 | 必要 Knowledge | engine が確定する結果 | 無効化される Knowledge | Distortion |
|---|---|---|---|---|---|
| RW01 | 宿屋の主人に「今夜 22 時、騎士団長と教会で会うだろう」と告げる | K005 or K021 | 密会が消滅 / ヴェイン警戒 → 城下町に「粛清」イベント追加 / 教会 22 時ノード消失 / ハルガ Trust −2, Suspicion +3 | K005, K021 | +2 |
| RW02 | 王に毒を警告する | K013 | 王が生存 / 城に味方衛兵 / **Boss が セルドに差し替わる** / 宰相の警戒 +1 | K013 | +2 |
| RW03 | 王女を本名（死んだ本物の名）で呼ぶ | K007 (Confirmed) | 偽王女が逃走 / 城・広間が空室化 / 粛清イベント出現 / **Boss B 出現** | K007 | +3 |
| RW04 | 墓守に鍵のことを告げる | K015 | 鍵を入手（塔ルート解禁）/ **ネルが次の Run で死亡している** | K015, K002 | +3 |
| RW05 | 盗賊に「お前は元騎士団だろう」と告げる | K011 | 盗賊が味方化（街道が安全 + 援軍 1 戦）/ 騎士団が盗賊を討伐 → **森の危険度 +2** | K011 | +1 |
| RW06 | 司祭に入れ替わりを問い詰める | K007 + K014 | 司祭が自白（WT01 開示）→ その後 自死 / 教会が Discovery ノード化 | K014, K022 | +2 |

### 15.1 §10 の連鎖の実装（RW01 の例）

engine 側の宣言的定義:

```ts
RW01.effects = [
  { kind: "cancelScheduledEvent", eventId: "EV_CHURCH_MEETING_22" },
  { kind: "npcFlag",  npc: "N02", flag: "alerted" },
  { kind: "injectNode", act: 2, node: "NODE_PURGE", replaces: "any:Social" },
  { kind: "invalidate", knowledge: ["K005", "K021"] },
  { kind: "trust", npc: "N01", delta: -2 },
  { kind: "suspicion", delta: +3 },
  { kind: "distortion", delta: +2 },
];
```

AI が担当するのはこの結果の **描写** と、ハルガの **その場のセリフ**、そして
「次に何かが起きそうだ」という **伏線 1 行** のみ。世界状態は 1 バイトも AI が触らない。

---

## 16. AI に任せる部分

1. **narrative** — 状況描写（**2 文以内**を強制。超過分は engine が切り捨てる）
2. **dialogue** — NPC のセリフ（性格・Goal・デジャヴ段階・Trust を入力に取る）
3. **reaction** — プレイヤーの逸脱行動に対する NPC / 世界の反応
4. **choices** — 提示する選択肢の**文言**。ただし各選択肢は engine 既知の `actionId` に紐付く
5. **consequence proposal** — 結果の提案。ただし **engine が提供したプリミティブの whitelist からの選択のみ**
6. **foreshadowing** — 未開示 World Truth への伏線 1 行
7. **interpretAction** — 自由入力を構造化 `ActionIntent` に変換する（判定はしない）

---

## 17. ゲームエンジンが管理する部分（AI 禁止領域）

**HP / ダメージ / 能力値 / アイテム / Gold / 時刻 / マップ / Knowledge 取得状態 /
Skill / Status Effect / 敵の強さ / Drop / 成功判定 / Boss 条件 / Ending 条件 /
Trust / Suspicion / Distortion / RNG**

### 17.1 構造的な担保

LLM の出力に HP やダメージを書かせない仕組みを **3 層** で担保する。

1. **Schema**: LLM のレスポンス型に数値フィールドが存在しない（`narrative` は string のみ）
2. **Whitelist**: `proposeConsequences` は `allowedPrimitives` に列挙した id からしか選べない。
   各プリミティブには engine 側で `magnitude` の上限がハードコードされている
3. **Sanitizer**: 検証で落ちた出力は Mock Provider の決定論的テンプレートに**自動フォールバック**する。
   LLM が落ちても壊れても、ゲームは止まらない

> 「あなたの攻撃でドラゴンは死んだ」と LLM が書いても、`enemy.hp` は 1 も減らない。
> 逆に engine が「ドラゴンは生きている」と言えば、narrative は再生成される。

---

## 18. データモデル

```ts
// ---- 恒久（Run をまたぐ）----
interface MetaState {
  totalRuns: number;
  knowledge: Record<KnowledgeId, KnowledgeRecord>;
  worldTruthDisclosure: Record<WorldTruthId, boolean>;
  distortion: number;            // 0..20
  executedRewrites: RewriteId[]; // 累積
  unlockedEndings: EndingId[];
  firstSeenLocations: LocationId[];
  bestSynergyEver: string | null;
}

interface KnowledgeRecord {
  id: KnowledgeId;
  title: string;
  description: string;
  reliability: "rumor" | "uncertain" | "confirmed" | "invalidated";
  discoveredAtRun: number;
  relatedNPCs: NpcId[];
  relatedLocations: LocationId[];
  tags: KnowledgeTag[];          // route | combat | social | schedule | lore | truth | royal | meta
  conditions?: KnowledgeCondition[];  // 効果が働く前提
  gameplayEffects: KnowledgeEffect[]; // ← 本体。文章ではなくルール
}

type KnowledgeEffect =
  | { kind: "unlockSpecialAction"; actionId: string; scope: "boss" | "combat" | "social" }
  | { kind: "elementMultiplier"; target: string; element: Element; mult: number }
  | { kind: "convertEncounter"; nodeTag: string; to: "social" }
  | { kind: "unlockRoute"; from: string; to: string; stepsSaved: number }
  | { kind: "revealNode"; nodeId: string }
  | { kind: "timeCost"; nodeTag: string; delta: number }
  | { kind: "unlockRewrite"; rewriteId: RewriteId }
  | { kind: "itemEffect"; itemId: string; vs: string; effect: "instantKill" }
  | { kind: "enableNegotiation"; enemyTag: string }
  | { kind: "discloseTruth"; truthId: WorldTruthId };

// ---- Run 単位 ----
interface RunState {
  runNumber: number; seed: string;
  clock: number;                 // 分。360 = 06:00
  player: PlayerState;           // hp/maxHp/focus/level/xp/gold/skills/items/statuses
  map: RunMap; position: NodeRef;
  npcTrust: Record<NpcId, number>;
  suspicion: number;
  activeSynergies: SynergyId[];
  worldDeltas: WorldDelta[];     // この Run で適用された書き換え
  log: LogEntry[];
  knowledgeGainedThisRun: KnowledgeId[];
  outcome: "running" | "dead" | "cleared";
}

interface CombatState {
  enemies: EnemyState[]; player: PlayerState;
  turn: number; phase: "player" | "enemy" | "over";
  intents: Record<EnemyId, Intent>;
  specialActions: SpecialAction[]; // Knowledge / シナジー由来
  rngCursor: number;
}

interface WorldDelta {
  rewriteId: RewriteId; atClock: number;
  effects: RewriteEffect[]; narrativeSeed: string;
}
```

---

## 19. LLM 入出力 Schema

Provider インターフェース（`packages/core/src/llm/provider.ts`）:

```ts
interface LLMProvider {
  generateNarrative(req: NarrativeRequest): Promise<NarrativeResponse>;
  interpretAction(req: InterpretRequest): Promise<InterpretResponse>;
  generateReaction(req: ReactionRequest): Promise<ReactionResponse>;
  proposeConsequences(req: ConsequenceRequest): Promise<ConsequenceResponse>;
}
```

### 19.1 共通入力（engine → AI）

```ts
interface WorldContext {
  worldTruths: { id: string; statement: string; revealed: boolean }[];
  npc?: { id; name; publicGoal; trueGoal?; personality; trust; dejaVuStage; knownLies };
  state: { clock: string; location: string; act: number; playerHpPct: number;
           suspicion: number; distortion: number; runNumber: number };
  knowledge: { id; title; reliability }[];   // プレイヤーが保持
  changedHistory: { rewriteId; summary }[];  // 本 Run の書き換え
  playerAction?: { raw: string } | { actionId: string };
}
```

### 19.2 出力 Schema（すべて検証必須・数値フィールドなし）

```jsonc
// NarrativeResponse
{ "narrative": "string (<=160 chars, <=2 sentences)",
  "foreshadowing": "string | null (<=60 chars)" }

// InterpretResponse  ← 自由入力の構造化。判定はしない
{ "verb": "attack|talk|persuade|deceive|steal|use|move|observe|give|destroy|hide|other",
  "target": "string|null",        // engine が既知エンティティに解決
  "instrument": "string|null",
  "usesKnowledge": ["K007"],
  "intentSummary": "string (<=60 chars)",
  "confidence": 0.0 }             // ← AI の自己申告。engine は参考値としてのみ使う

// ReactionResponse
{ "dialogue": "string (<=120 chars)",
  "mood": "calm|angry|afraid|amused|suspicious|broken",
  "choices": [ { "actionId": "string (engine 既知のみ)", "label": "string (<=28 chars)" } ] }

// ConsequenceResponse ← whitelist からの選択のみ
{ "picks": [ { "primitiveId": "string (allowedPrimitives に含まれること)",
               "magnitude": "low|mid|high" } ],   // 実数値は engine が決める
  "narrative": "string (<=160 chars)" }
```

### 19.3 検証パイプライン

```
LLM raw text
  → JSON parse（失敗 → Mock フォールバック）
  → Schema validate（型・長さ・enum・whitelist）
  → Entity resolve（target を既知 id に解決。未知なら null）
  → Clamp（文字数・選択肢数 上限 4）
  → engine が採用
```

いずれかの段階で落ちたら **Mock Provider の決定論的出力** を使う。
ネットワークが無い・API キーが無い・LLM が壊れた、いずれの場合もゲームは完走できる。

### 19.4 API キーの扱い

ブラウザは `/api/llm/*` を叩くだけ。キーは **サーバのプロセス環境変数**にのみ存在し、
クライアントへは一切送出しない。キー未設定ならサーバが `mock` モードを返し、UI は
「MOCK」バッジを表示してそのまま遊べる。

---

## 20. MVP 実装順序

| 段階 | 内容 | 完了判定 |
|---|---|---|
| M0 | 型定義・seeded RNG・コンテンツデータ（Skill/Item/Knowledge/Enemy/NPC/WorldTruth） | データが型検査を通る |
| M1 | **CombatEngine**（純粋関数・AI 非依存） | ヘッドレスで 100 戦が決着する |
| M2 | **DungeonEngine**（フロア生成・視界・移動・敵AI）＋ **RunEngine**（時計・報酬 3 択） | ヘッドレスで 1 Run が 8 階層を完走する |
| M3 | **KnowledgeEngine**（取得・信頼度・合成・効果解決） | K005+K006 → K021 が自動合成される |
| M4 | **RewriteEngine**（RW01-06 の決定論的適用） | RW03 で Boss が差し替わる |
| M5 | **MockLLMProvider** | LLM なしで全機能が動く |
| M6 | **3 Run 自動シミュレータ**（§4 の検証） | `npm run sim` が 3 Run を再現 |
| M7 | **UI**（ノード選択 / 戦闘 / Knowledge 一覧 / RUN REPORT / REWRITE） | 人間が遊べる |
| M8 | **AnthropicProvider + サーバ Proxy + 検証層** | キーがあれば AI、無ければ Mock |
| M9 | 自由行動入力欄 | 「犬に毒味させる」が構造化され engine が判定する |

**M1〜M7 まで LLM は一切登場しない。** これが「AI を全部消してもローグライクとして成立する」ことの構造的な保証である。

`npm run sim` は LLM を 1 度も呼ばずに 3 Run を自動プレイし、8 階層の踏破までを再現する。

---

## 21. 自己レビューによる修正履歴

`design/SELF_REVIEW.md` の指摘により、初稿から以下を変更した。

1. **時計をコアリソースに昇格**（初稿では雰囲気要素だった）
   → Knowledge の多くが「時間を節約する / 時間を要求する」効果を持つようになり、
     Knowledge が戦闘力ではなく **資源** として効くようになった
2. **Knowledge を「文章」から「ルール」へ徹底**
   → 全 25 件に `gameplayEffects` を必須化。効果を持たない Knowledge は作らない
3. **Feint（偽の Intent）を戦闘に追加**
   → Liar's Eye が戦闘スキルとしても独立して強くなり、W スキルが「戦闘では弱い」問題を解消
4. **死に得の抑制**（Distortion は死んでも減らない / 同じ Knowledge は二度取れない）
5. **AI 出力 Schema から数値フィールドを全廃**
   → 「LLM が HP を書き換える」事故が型レベルで起きなくなった
6. **RUN REPORT を「損失一覧」ではなく「収穫一覧」に再設計**
7. **Boss 攻略ルートを 6 通りに明示**（初稿は 3 通りで「Knowledge で楽になる」だけだった）

### 21.1 実装中に判明し、設計へ差し戻した項目

自動シミュレータ（`npm run sim`）と実ブラウザでの通しプレイによって、
机上の設計では見えなかった欠陥が 5 件見つかり、設計に反映した。

1. **戦闘が膠着し得た** — 防御し続けると勝ちも負けもしない状態が成立した。
   → 12 ターン以降、Guard を無視する「疲労」ダメージが増加する規則を追加
2. **敵の Guard が永久に累積していた** — プレイヤー側だけ毎ターン消滅する非対称なバグ。
   防御型 Boss が事実上の無敵になっていた。→ 敵の Guard も敵の行動時に消滅する
3. **探索主体のビルドが Boss に到達できなかった** — 戦闘以外で XP が入らず、
   寄り道を選ぶと Lv1 のまま Boss に着いた。→ 発見・会話・灰の扉にも XP を配分
4. **Boss 直前の回復手段が保証されていなかった** — 運が悪いと満身創痍で強制的に Boss 戦。
   → 最終ステップに必ず休息ノードを 1 つ配置し、「休むか、最後の秘密を取りに行くか」
     という本作らしい選択に変換した
5. **村で無限に休息できた** — テンポを壊す退屈な最適解。→ 村の行動を 3 回までに制限

いずれも「AI を足す前に、ローグライクとして壊れていないか」を検証したことで見つかった。

### 21.2 ノードマップ → 自動生成ダンジョンへの転換

初版はノード選択式（Slay the Spire 型）のマップだったが、
**自動生成ダンジョンとして作り直した**。Knowledge と時計の設計はそのまま活き、
むしろ噛み合いが良くなった。

| 要素 | ノード版 | ダンジョン版 |
|---|---|---|
| 探索 | 2〜3 択から 1 つ選ぶ | 41×27 のグリッドを歩く |
| 時計 | ノード 1 つ = 2h | 1 歩 = 1 分 |
| 戦闘 | ノードに入ると確定発生 | **回避できる**（通路で撒く・部屋を迂回する） |
| 視界 | 常に全体が見える | 部屋明かり + 記憶。松明で広がる |
| Knowledge の効果 | ノードを 1 つ増やす | 部屋を最初から可視化する / 階段を生やす / 敵を NPC に変える |
| 時間切れ | 消耗した状態で強制ボス戦 | 灰が降りはじめ、毎分削られる |

**この転換で良くなった点:**

1. **戦闘が選択になった。** ノード版では「戦闘ノードを選ぶ＝戦う」だったが、
   ダンジョンでは敵を見てから避けられる。`S03 Premonition` や松明の視界が
   「戦う相手を選ぶ」ための情報として機能しはじめた
2. **時計の刻みが細かくなった。** 2h 単位では「あと 1 つ寄り道できるか」しか問えなかったが、
   1 分単位なら「この部屋の隅まで見るか」まで問える
3. **松明が探索装備になった。** ノード版の `S07 Torchbearer` は実質ただの火力スキルだった

**この転換で難しくなった点と、その対処:**

- **1 Run が長くなる危険。** 8 階層すべてを掃除させると 30 分を超える。
  → 全探索できない時間予算にし、灰で強制的に追い立てる
- **Knowledge が集まりすぎる。** 灰の扉が毎フロア未知の知識を吐き出し、
  Run 1 で 25 件すべてが揃ってしまった。
  → 灰の扉の「禁忌の知識」は **1 Run に 1 回だけ**。死霊術は 2 回まで。
  結果、1 Run あたり 3〜5 件という意図した曲線に戻った

### 21.3 実装して初めて見つかった、ダンジョン特有の欠陥

1. **NPC が一マス幅の通路を永久に塞いだ。** 体当たりが常に会話を開くため、
   物理的に通り抜けられなかった。→ 話し終えた相手とは**すれ違える**ようにし、
   会話にも「すれ違って先へ進む」を用意した
2. **自動移動が一歩も動けなくなった。** 「起きている敵の間合いに入る手前で止まる」
   規則が強すぎ、敵が近くにいる間は移動そのものが拒否された。
   → 移動中の停止にのみ適用し、最初の一歩は必ず許可する
3. **会話で経過した時間に灰のダメージが入らなかった。**
   時計を進める箇所が 10 箇所以上に散らばっていたのが原因。
   → `spendTime()` 一箇所に集約した
4. **同じ NPC と無限に同じ会話ができた。** → 一度聞いた相手は選択肢が変わる
5. **眠っている敵が通路を塞ぐと目的地に到達できなかった。**
   → 迂回路がなければ敵を通る経路を選び、体当たりで解決させる

1・2・5 はいずれも「グリッド上では、あらゆるものが物理的な障害物になりうる」
という、ノード版には存在しなかった種類の問題である。

---
title: カンバン → Claude Code 実行UX設計
date: 2026-04-10
---

# カンバン → Claude Code 自然な実行フロー

## 核心コンセプト

カンバンのカードがそのまま「仕事の依頼書」になる。
ボタン1つで、カードの内容がClaude Codeへのプロンプトに変換され、
対応するゾーンにターミナルタイルが生まれ、実行が始まる。

## 既存インフラ（すでにある）

| 機能 | 場所 | 状態 |
|------|------|------|
| ターミナルタイル作成 | pty:create + canvas.tileAdd | 動作済み |
| ターミナルへのコマンド送信 | pty:write | 動作済み |
| Launch All（全ターミナル一斉実行） | Cmd+Shift+L | 動作済み |
| エージェントセッション追跡 | agent.sessionStart/End | 動作済み |
| ファイル操作追跡 | agent.fileTouched | 動作済み |
| ゾーン座標計算 | zone-renderer.js | 動作済み |

足りないのは「カード → 実行」の接続だけ。

---

## UX フロー

### Step 1: カードを書く（今と同じ）

Mキーでメモを開く → Zoneモードでカードを追加。

```
[INTELLIGENCE]        [HUNT]           [BLACKSMITH]
 "認証ミドルウェアの   "auth APIを       "テスト追加"
  競合調査"            実装する"
```

カードには:
- title: やること（= プロンプトの要約）
- notes: 詳細指示（= プロンプト本文）
- priority: 優先度
- due: 期限

### Step 2: カードの「Run」ボタンを押す（新規）

展開されたカードに「Run」ボタンを追加。押すと:

1. 対応するゾーンの空きスペースにターミナルタイルを自動生成
2. そのターミナルで `claude -p "カードのtitle + notes"` を実行
3. カードに実行中の視覚フィードバック（パルスアニメーション）
4. メモオーバーレイを自動で閉じて、キャンバスが該当ゾーンにパン

ユーザー体験:
  M → カード書く → Run → メモが閉じてゾーンにターミナルが現れ、Claude Codeが動いている

### Step 3: 実行結果の追跡（自動）

- ターミナルタイルのラベルにカードタイトルが設定される
- agent.sessionStart/End で実行状況を追跡
- 完了時: カードに「done」バッジ（手動 or exit code 0で自動）

---

## 実装詳細

### カードデータモデルの拡張

```javascript
Card: {
    id: string,
    title: string,        // → プロンプト要約
    due: string,
    priority: string,
    notes: string,        // → プロンプト詳細
    // 新規フィールド
    tileId: string | null,   // 紐づくターミナルタイルID
    status: "idle" | "running" | "done" | null,
}
```

### カード展開時のUIに「Run」ボタンを追加

Save / Cancel の横に Run ボタン。

```
[Task title                    ]
[Due: 2026-04-15] [Priority: High]
[Notes / details               ]
[                               ]
[Save] [Cancel]        [▶ Run]
```

### Run ボタンの処理

```javascript
async function runCard(card, col) {
    // 1. プロンプトを組み立て
    const prompt = card.notes
        ? `${card.title}\n\n${card.notes}`
        : card.title;

    // 2. ゾーンの空きスペースを計算
    const zone = ZONE_COLUMNS.find(z => z.id === col.id);
    const zoneData = getZones().find(z => z.id === col.id);
    const pos = findOpenSpotInZone(zoneData); // ゾーン内の空き座標

    // 3. ターミナルタイルを作成
    const tile = createCanvasTile("term", pos.x, pos.y, {
        label: card.title,
    });
    spawnTerminalWebview(tile, true);

    // 4. カードとタイルを紐づけ
    card.tileId = tile.id;
    card.status = "running";

    // 5. メモを閉じてゾーンにパン
    closeScratchpad();
    panToZone(col.id);

    // 6. Claude Code コマンドを送信（PTY準備完了後）
    setTimeout(() => {
        const escaped = prompt.replace(/'/g, "'\\''");
        const cmd = `claude -p '${escaped}'\n`;
        window.shellApi.ptyWrite(tile.ptySessionId, cmd);
    }, 500);

    renderKanban();
    saveCanvasDebounced();
}
```

### ゾーン内の空きスペース計算

```javascript
function findOpenSpotInZone(zone) {
    // ゾーン内の既存タイルを取得
    const existing = tiles.filter(t => {
        const cx = t.x + t.width / 2;
        const cy = t.y + t.height / 2;
        return cx >= zone.x && cx <= zone.x + zone.width
            && cy >= zone.y && cy <= zone.y + ZONE_H;
    });

    // グリッドベースで空きを探す
    const COLS = 4;
    const tileW = 500, tileH = 400, pad = 40;
    for (let row = 0; row < 10; row++) {
        for (let c = 0; c < COLS; c++) {
            const x = zone.x + pad + c * (tileW + pad);
            const y = zone.y + 80 + row * (tileH + pad);
            const overlaps = existing.some(t =>
                x < t.x + t.width && x + tileW > t.x &&
                y < t.y + t.height && y + tileH > t.y
            );
            if (!overlaps) return { x, y };
        }
    }
    // フォールバック: ゾーン左上
    return { x: zone.x + pad, y: zone.y + 80 };
}
```

---

## 全体のワークフロー

```
朝:
  M → Zoneモードのカンバンを開く
  INTELLIGENCEに調査タスクを並べる
  HUNTに実装タスクを並べる

作業開始:
  INTELLIGENCEのカードを開く → Run
  → メモ閉じる → キャンバスがINTELLIGENCEゾーンにパン
  → ターミナルが現れ、Claude Codeが調査を開始

並行作業:
  M → HUNTのカードを開く → Run
  → HUNTゾーンにもターミナルが生まれる
  → 複数のClaude Codeが並行で動く

完了:
  ターミナルの出力を確認
  カードを次のゾーンにドラッグ（HUNT → BLACKSMITH）
  または Archive にドロップ
```

---

## 追加UX（後で）

| 機能 | 内容 |
|------|------|
| Batch Run | 1つのゾーンの全カードを一斉実行 |
| Auto-advance | 完了したカードを自動で次のゾーンに移動 |
| カードからタイルへジャンプ | 実行中カードをクリック → キャンバスの該当ターミナルにパン |
| タイルからカードを逆引き | ターミナル右クリック → 「カンバンカードを表示」 |
| 実行ログ | カードのnotesに実行結果サマリーを自動追記 |

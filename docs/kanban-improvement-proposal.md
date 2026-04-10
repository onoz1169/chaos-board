---
title: カンバン改善提案 - ゾーン連携とUX修正
date: 2026-04-10
---

# カンバン改善提案

## 現状の問題

### 1. ゾーンとカンバンが完全に分離している

現在のアーキテクチャ:

- ゾーン: キャンバス上の5つの空間区画（INTELLIGENCE / HUNT / BLACKSMITH / REST / REFLECT）
- カンバン: スクラッチパッド（Memo）内の独立したタスクボード（Todo / Doing）
- 両者のデータモデルに相互参照なし

カンバンのカードにはゾーンIDもタイルIDもない。ゾーンのタイルにはカンバンカードへの参照がない。
2つの世界が同じJSONに保存されているだけで、意味的なつながりがゼロ。

chaos-boardの思想は「ゾーンがワークフローのステージを表す」こと。
INTELLIGENCE → HUNT → BLACKSMITH → REST → REFLECT のサイクルがある。
カンバンが「Todo / Doing」だけでは、このサイクルとの接点がない。

### 2. ESC/閉じるボタンの問題

コード分析の結果:

- `renderer.js:4149-4154` — windowレベルのESCハンドラ（captureフェーズ）
- `renderer.js:4506-4513` — カード編集中のESCハンドラ（cardEl上のkeydown）

**バグの正体**: カード編集中にESCを押すと、cardElのハンドラ（4507行）が`cancel()`を呼ぶ。
`cancel()`は`renderKanban()`を呼ぶだけで`expandedCardId = null`を**セットしない**。
結果: カードは閉じたように見えるが、イベントのバブリングで直後にwindowのESCハンドラが
`closeScratchpad()`を呼び、**オーバーレイ全体が閉じてしまう**。

ユーザーの期待: ESC 1回目 → カード編集を閉じる、ESC 2回目 → Memoオーバーレイを閉じる
実際の動作: ESC 1回でカード編集もオーバーレイも同時に閉じる

修正箇所: `cancel()`内で`expandedCardId = null`を設定し、cardElのESCハンドラで
`e.stopPropagation()`を追加する。

```javascript
// renderer.js:4489 — cancel()の修正
function cancel() {
    if (!card.title && !card.due && !card.priority && !card.notes) {
        col.cards = col.cards.filter((c) => c.id !== card.id);
    }
    expandedCardId = null;  // 追加
    renderKanban();
}

// renderer.js:4506 — ESCハンドラの修正
cardEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();  // 追加: windowのESCハンドラへの伝播を止める
        cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
    }
});
```

### 3. 閉じるボタンが効かない場面

`scratchpad-close`ボタン（x）のクリックハンドラは正しく登録されている（4131行）。
ただし、カンバンカード展開中にフォーカスがINPUT/TEXTAREA内にある場合、
クリックイベントがカードのblurを先にトリガーし、DOMが再描画されてボタン参照が失われる可能性がある。

---

## 改善提案

chaos-boardの思想: 「ゾーンは空間的な意味を持つガイド」「カンバンは戦術的タスクキュー」。
この2つを繋げることで、ワークフロー全体に一貫性を持たせる。

### A. ゾーン連携カンバン（核心の改善）

**現状**: カンバンのカラムは汎用的な「Todo / Doing」。ゾーンとの関係なし。

**提案**: カンバンのカラムをゾーンに対応させるモード。

```
[INTELLIGENCE]  [HUNT]   [BLACKSMITH]  [REST]  [REFLECT]
  調査タスク    実行中    改善中    待機     振り返り
    card1       card3     card5
    card2       card4
```

実装アプローチ:
- カードにオプションの`zoneId`フィールドを追加
- カラムを自由（現状）とゾーン連動の2モードで切り替え可能に
- ゾーンモード時、カードをドラッグ移動 → 対応するゾーンのサマリーにも反映
- カードクリック → キャンバス上の該当ゾーンにジャンプするオプション

カードのデータモデル拡張:
```javascript
{
    id: string,
    title: string,
    due: string,
    priority: "high" | "mid" | "low" | "",
    notes: string,
    zoneId: string | null,   // 新規: 紐づくゾーン
    tileIds: string[],       // 新規: 関連するタイルID群
}
```

### B. ESC階層の修正（即時修正）

ESCの期待動作を段階的にする:

1. カード編集中 → カード編集を閉じる（stopPropagation）
2. Memoオーバーレイ表示中 → オーバーレイを閉じる
3. キャンバス上 → 選択解除

上記の修正コードを適用するだけで解決。

### C. カンバンのUX改善

| 改善 | 内容 | 難易度 |
|------|------|--------|
| カード削除ボタン | `.kanban-card-delete`が参照されているが未実装。カード上にx ボタン追加 | 小 |
| カラム追加/削除 | ゾーンモードとは別に、自由モードでカラムを追加/削除可能に | 中 |
| ゾーンジャンプ | カードからCmd+クリックで関連ゾーンにキャンバスをパン | 中 |
| タイルからカード生成 | キャンバス上のタイル右クリック → 「カンバンに追加」 | 中 |
| ゾーンサマリーにカード数表示 | 各ゾーンのサマリーにカンバンカード数も反映 | 小 |
| ドラッグ中のビジュアル改善 | ドロップ先のハイライトを明確化、ゴースト表示 | 小 |

### D. カンバンのカオス思想への整合

chaos-boardは「構造を押し付けない」思想。カンバンも同様に:

- 固定カラム（Todo/Doing/Done）を押し付けず、ユーザーが自由にカラムを定義
- ゾーン連動は「オプション」であり、デフォルトは自由モード
- カードはミニマル（今の設計は正しい）、過度にフィールドを増やさない
- 「タイル = キャンバス上の成果物」「カード = やることの一行メモ」の役割分担を維持

---

## 実装優先度

1. **ESC修正** — cancel()にexpandedCardId = null追加 + stopPropagation（5分で直る）
2. **カード削除ボタン追加** — 既存の.kanban-card-delete参照を活かす（15分）
3. **ゾーン連動カラムモード** — カンバンの価値を根本的に変える改善（数時間）
4. **タイル→カード双方向リンク** — 空間とタスクの接続（半日）

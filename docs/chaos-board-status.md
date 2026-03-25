---
title: chaos-board 現状分析 - Claude Codeが動くMiroへの道
date: 2026-03-25
---

# chaos-board 現状分析

## 結論: 65-70% 完成

基盤は固い。キャンバス、タイル、JSON-RPC APIが揃っている。
不足しているのは機能であり、アーキテクチャではない。

---

## 現在できること

### キャンバス
- 無限パン&ズーム（33%-100%、グリッドスナップ20px）
- Space+ドラッグ、スクロール、Cmd+±でズーム
- キャンバス状態の永続化（JSON、500msデバウンス保存）

### タイル 8種
| Type | 内容 | 特徴 |
|------|------|------|
| term | ターミナル | tmuxバックド、永続セッション |
| note | Markdown | BlockNote/TipTapリッチエディタ |
| code | コードエディタ | Monaco、言語自動検出 |
| image | 画像表示 | PNG/JPG/GIF/SVG/WebP |
| graph | D3グラフ | フォルダ構造の可視化 |
| browser | ブラウザ | Chromium webview |
| text | Sticky Note | 軽量テキスト、フォントサイズ変更可 |
| draw | 描画 | フリーハンド、6色、3サイズ |

### 空間整理
- グループ（名前付き、色付きコンテナ）
- コネクション（タイル間の有向接続、ラベル/色）
- ゾーン（矩形領域でセマンティックグルーピング）

### 描画&注釈
- ペン: 6色 x 3サイズ + Undo/Clear
- 消しゴム
- 永続化（canvasのJSONに含まれる）

### ツールドック（今回追加）
- Pointer(V) / Terminal(T) / Sticky(N) / Browser(W) / Draw(D)
- Pen(P) / Eraser(E)
- Launch All / Help
- ホバーツールチップ付き

---

## Claude Code連携（JSON-RPC API）

### 通信方式
- Unixドメインソケット: `~/.collaborator/ipc.sock`
- JSON-RPC 2.0（改行区切り）
- `rpc.discover` でメソッド一覧取得可能

### 利用可能なAPIメソッド

| メソッド | 動作 |
|---------|------|
| `canvas.tileList` | 全タイル一覧取得 |
| `canvas.tileAdd` | タイル作成（type, filePath, position, size） |
| `canvas.tileRemove` | タイル削除 |
| `canvas.tileMove` | タイル移動 |
| `canvas.tileResize` | タイルリサイズ |
| `canvas.viewportGet` | ビューポート状態取得 |
| `canvas.viewportSet` | パン/ズーム設定 |

### Claude Codeからの操作例
```bash
SOCK=$(cat ~/.collaborator/socket-path)
# タイル一覧
echo '{"jsonrpc":"2.0","id":1,"method":"canvas.tileList","params":{}}' | nc -U "$SOCK"
# タイル作成
echo '{"jsonrpc":"2.0","id":2,"method":"canvas.tileAdd","params":{"type":"note","filePath":"/tmp/note.md"}}' | nc -U "$SOCK"
# タイル移動
echo '{"jsonrpc":"2.0","id":3,"method":"canvas.tileMove","params":{"tileId":"xxx","position":{"x":100,"y":200}}}' | nc -U "$SOCK"
```

---

## Miro比較チェックリスト

| 機能 | 状態 | 備考 |
|------|------|------|
| 無限キャンバス | done | |
| Sticky Note | done | |
| フリーハンド描画 | done | |
| テキスト編集 | done | Note/Code/Text |
| フレーム/グループ | partial | グループあり、ビジュアルフレームなし |
| リアルタイムコラボ | none | ローカルのみ |
| テンプレート | none | |
| エクスポート | limited | JSONのみ、画像/PDF無し |
| 図形/コネクタ | partial | コネクションあり、図形プリミティブなし |
| Undo/Redo | partial | 描画のみ、タイル操作は未対応 |
| 検索 | done | Cmd+K |
| グリッドスナップ | done | |
| 自動レイアウト | none | |
| タイルZ-index | done | |

---

## 不足している機能（優先度順）

### 高優先（エージェント自動化に必須）
1. **バッチタイル操作** - 一度に10+タイルを正確な位置に作成
2. **自動レイアウトアルゴリズム** - グリッド/階層/力指向グラフ
3. **Group/Zone RPCメソッド** - canvas.groupAdd, canvas.connectionAdd

### 中優先
4. **空間クエリAPI** - 「この領域内のタイルは？」「隣接タイルは？」
5. **タイル内容読み取り** - タイルのテキスト/コードを取得するAPI
6. **タイル操作のUndo/Redo** - トランザクションログ
7. **テンプレートシステム** - ダッシュボード/3分割/グリッド等のプリセット

### 低優先（将来）
8. **リアルタイム同期** - マルチエージェント協調（CRDT必要）
9. **カスタム図形** - 矩形/円/矢印等のプリミティブ
10. **画像/PDFエクスポート**

---

## 技術スタック
- Electron 40, React 19, Tailwind CSS 4
- Monaco（コードエディタ）, BlockNote/TipTap（Markdown）
- xterm.js + tmux（ターミナル）, D3（グラフ）
- JSON-RPC 2.0 over Unix socket

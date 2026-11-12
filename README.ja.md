# woslicer-dx

[English](README.md) · [中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md)

wosderge の woslicerIII をベースにした、BMS 向けのオフライン音声スライサー。

![タイムライン](screenshots/timeline.png)

## 機能

- WAV/OGG の読み込み、WAV スライスの書き出し、`.wos` プロジェクトと BMSE クリップボードに対応。
- スナップ、範囲選択、クオンタイズ、元に戻す／やり直しを備えたタイムライン編集。
- 再生速度を変えたモニタリング、キュー音、タップ補正。
- 周波数帯域の表示と自動カット検出。
- 内蔵 BMHelper：鍵盤音用 MIDI パートを録音シーケンスと WAVE 定義に分割し、切断位置をタイムラインへ適用。
- 英語・中国語・日本語・韓国語の UI。「About」にバージョン、コミット、ビルド日時を表示。

## 実行

リポジトリの Actions にあるビルド成果物をダウンロードして展開します。

| プラットフォーム | 形式 | アプリ |
| --- | --- | --- |
| Windows | `.7z` | `woslicer-dx.exe` |
| Linux | `.tar.xz` | `woslicer-dx` |
| macOS | `.zip` | `woslicer-dx.app` |

macOS の CI ビルドは公証されていません。本アプリはファイルをローカルで処理し、実行時にネットワーク接続は不要です。

Web 版はブラウザーで直接動作します：[woslicer-dx app](https://woslicer-dx.pages.dev/) （インストール不要）。

ソースから実行するには Node.js 24、npm、Git、Rust stable ツールチェーンが必要です。Tauri のパッケージングにはプラットフォームごとの追加ツール（Linux は WebKit/GTK、Windows は WebView2）も必要です。

```sh
npm ci
npm start
```

## 操作

| キー | 動作 |
| --- | --- |
| Space | 再生 / 一時停止 |
| Enter / `,` / `.` | 再生ヘッドまたはカーソル位置にカットを追加 |
| Z | カーソル位置のカットを切り替え |
| 方向キー | グリッド / 小節単位で移動。Shift+左右で 1 tick |
| P / O | 現在 / 前のスライスを試聴 |
| Q / W | グリッド密度を下げる / 上げる |
| `[` / `]` | モニタリング速度を下げる / 上げる |
| Ctrl+C / X / V | 選択したマーカーをコピー / 切り取り / 貼り付け |
| Ctrl+Z / Ctrl+Shift+Z | 元に戻す / やり直す |
| M | すべてのスライスを書き出す |
| T / Y | `.wos` の保存 / 読み込み |
| V / B | BMSE クリップボードへの書き込み / 読み込み |

左ドラッグでカットを描画、右ドラッグで消去、Shift/Ctrl+ドラッグで範囲選択、カットをドラッグすると選択範囲が移動します。Ctrl+ホイールでズーム、中ボタンドラッグでパン。Alt を押している間はスナップが無効になります。

## 開発

```sh
npm run typecheck
npm test
npm run build
npm run test:app-ui
npm run package

```

音声は内部的に 16-bit に変換され、書き出しは 16-bit PCM です。原版との比較テストには外部のフィクスチャが必要で、無い場合はスキップされます。

[CI](docs/CI.md)、[バージョン規則](docs/VERSIONING.md)、[変更履歴](CHANGELOG.md) を参照してください。

## ライセンスとクレジット

オリジナルの woslicer II/III: **wosderge**。コントリビューターが権利を持つ部分は [MIT](LICENSE) です。原版由来の部分とサードパーティの依存関係はこの許諾に含まれません。範囲と帰属については [NOTICE](NOTICE) を参照してください。

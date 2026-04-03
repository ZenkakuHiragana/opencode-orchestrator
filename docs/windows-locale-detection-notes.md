# Windows locale detection notes

このドキュメントは、OpenCode Orchestrator CLI が Windows 環境で表示言語
（UI/display language）を判定するための実装方針と、その根拠となる公開
ドキュメントをまとめたものです。R10 "Windows locale detection backed by
public documentation" の補足資料として扱います。

## 参照した主なドキュメント

- **Get-WinUILanguageOverride (International モジュール)**  
  https://learn.microsoft.com/en-us/powershell/module/international/get-winuilanguageoverride  
  現在のユーザーについて、UI 言語のオーバーライド設定を返します。
  `(Get-WinUILanguageOverride).UILanguage` は、オーバーライドが設定されて
  いれば `ja-JP` や `en-US` のようなロケールタグを返し、未設定の場合は
  空になります。

- **Get-UICulture (PowerShell)**  
  公式ドキュメント: `Get-UICulture` は PowerShell セッションの UI カルチャ
  を表し、実際に UI テキストがどの言語で表示されるかに近い値を返します。  
  参照例: https://ss64.com/ps/get-uiculture.html

- **Get-WinSystemLocale (International モジュール)**  
  https://learn.microsoft.com/en-us/powershell/module/international/get-winsystemlocale  
  システム全体の既定ロケール（フォーマットや非 Unicode アプリのコード
  ページなど）を返します。UI 言語と一致しない構成もあり得ます。

- **Configure International Settings in Windows**  
  https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/configure-international-settings-in-windows  
  Windows における言語パック、表示言語、システムロケールなどの設定項目
  を概観し、International モジュールの位置付けを確認するために利用して
  います。

## 実装方針の概要

`src/i18n/locale-detection.ts` の Windows 分岐 (`platform === "win32"`) では、
次の優先順位で UI 言語に相当するロケールタグを取得し、`ja*` かどうかで
日本語/英語を判定します。

1. **UI 言語オーバーライド (Get-WinUILanguageOverride)**

   ```powershell
   (Get-WinUILanguageOverride).UILanguage
   ```

   - 非空の値が得られれば、もっともユーザー意図に近い UI 言語と見なし、
     `source: "windows_ui_override"` として採用します。

2. **UI カルチャ (Get-UICulture)**

   ```powershell
   (Get-UICulture).Name
   ```

   - UI オーバーライドが空、もしくはコマンドが失敗した場合は、UI カルチャ
     の `Name` を取得し、`source: "windows_ui_culture"` として利用します。

3. **システムロケール (Get-WinSystemLocale)**

   ```powershell
   (Get-WinSystemLocale).Name
   ```

   - 上記 2 つがいずれも空/失敗だった場合の最後のフォールバックとして
     システムロケールを参照し、`source: "windows_system_locale"` として
     `ja*` / 非 `ja*` を判定します。

4. **すべて失敗した場合のフォールバック**
   - PowerShell 自体が利用できない、もしくはすべてのコマンドが空文字を
     返した場合には、安全な既定値として英語 (`language: "en"`) を選び、
     `source: "windows_default"` として報告します。

実際のコマンド実行は `child_process.spawnSync` を通じて行い、非 0 ステー
タスや空の stdout の場合は「値が取得できなかった」として扱います。

## Node.js 実装上の注意

- Windows 向け実装は `WindowsLocaleDetector` という関数型で抽象化され、
  プロダクションコードでは `createDefaultWindowsLocaleDetector()` が
  PowerShell コマンドを叩きます。
- テストでは、この detector を差し替えることで実際に PowerShell を
  起動せずに UI オーバーライド / UI カルチャ / システムロケールの
  組み合わせをシミュレートしています。
  - 例: UI オーバーライドのみ `ja-JP`、その他 `en-US` など。
- `ja*` 判定は Unix と同様に `tag.toLowerCase().startsWith("ja")` で行い、
  `ja`, `ja-JP`, `ja-JP.UTF-8` などをすべて日本語として扱います。

この戦略により、Windows では UI 言語オーバーライド → UI カルチャ →
システムロケールの順に、公式ドキュメントに基づいた形で UI 言語に近い
ロケールタグを取得し、最終的に i18n メッセージカタログの選択に利用でき
るようになっています。

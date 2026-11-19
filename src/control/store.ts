// パッチファイルの保存先の口(data-contract §7)。実体は差し替えられる:
// サーバーの専用フォルダ(src/server/)、タブからサーバーへ中継する実装、試験用のメモリ上の実装。
// ここでは「名前 → 文書の文字列」の出し入れだけを扱う。名前の書式・上書きの権限・件数の上限などの規則は、
// 契約(data-contract §7、operation-contract §15.3)に従って呼ぶ側と実体の両方で守る。

export interface StoredPatchInfo {
  /** パッチ名(拡張子なし。data-contract DAT-31 の書式)。 */
  name: string;
  /** ファイルの大きさ [バイト]。 */
  bytes: number;
  /** 最終更新時刻(RFC 3339、UTC)。 */
  modified_at: string;
}

export type StoreError =
  | "not_found" // その名前のファイルがない
  | "exists" // 上書きを指定していないのに既にある
  | "invalid_name" // 名前が書式に合わない(フォルダの外を指す名前を含む)
  | "too_many" // フォルダ内のファイル数が上限
  | "too_large" // 大きさが上限を超える
  | "failed"; // その他の失敗(読み書きのエラー)

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError; message?: string };

export interface PatchStore {
  list(): Promise<StoreResult<StoredPatchInfo[]>>;
  /** 文書の文字列をそのまま返す(検証は呼ぶ側)。 */
  read(name: string): Promise<StoreResult<{ text: string; info: StoredPatchInfo }>>;
  /** overwrite が false のとき、既にあれば "exists"。 */
  write(name: string, text: string, overwrite: boolean): Promise<StoreResult<StoredPatchInfo>>;
  remove(name: string): Promise<StoreResult<null>>;
}

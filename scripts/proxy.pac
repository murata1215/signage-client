/**
 * プロキシ自動設定ファイル (PAC: Proxy Auto-Configuration)
 *
 * 用途:
 *   サイネージクライアントのブラウザ（Chrome キオスクモード）で使用する。
 *   社内ネットワーク宛の通信は直接接続し、
 *   外部サイト（Yahoo 等）へのアクセスは社内プロキシを経由する。
 *
 * プロキシサーバー:
 *   210.175.128.100:8080（認証なし）
 *
 * @param {string} url - アクセス先の完全なURL
 * @param {string} host - アクセス先のホスト名
 * @returns {string} プロキシ設定文字列（"DIRECT" または "PROXY host:port"）
 */
function FindProxyForURL(url, host) {

  // --- 社内ネットワーク（10.x.x.x）は直接接続 ---
  // 社内サイネージサーバー等、プライベートIPアドレスへのアクセスは
  // プロキシを経由せず直接接続する
  if (isInNet(host, "10.0.0.0", "255.0.0.0")) {
    return "DIRECT";
  }

  // --- 172.16.x.x ～ 172.31.x.x（プライベートIP）も直接接続 ---
  if (isInNet(host, "172.16.0.0", "255.240.0.0")) {
    return "DIRECT";
  }

  // --- 192.168.x.x（プライベートIP）も直接接続 ---
  if (isInNet(host, "192.168.0.0", "255.255.0.0")) {
    return "DIRECT";
  }

  // --- localhost / 127.0.0.1 は直接接続 ---
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    isInNet(host, "127.0.0.0", "255.0.0.0")
  ) {
    return "DIRECT";
  }

  // --- 上記以外の外部サイトはプロキシ経由 ---
  // Yahoo 等の外部Webサイトへのアクセスに使用
  return "PROXY 210.175.128.100:8080";
}

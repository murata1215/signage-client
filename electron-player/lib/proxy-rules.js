/**
 * プロキシ設定モジュール
 *
 * 目的:
 *   Electron の session.setProxy() に渡すプロキシ設定を管理する。
 *   社内ネットワーク宛の通信は直接接続し、
 *   外部サイトへのアクセスは社内プロキシを経由する。
 *
 * 既存の scripts/proxy.pac のロジックを Electron の
 * proxyRules / proxyBypassRules 形式に変換したもの。
 *
 * 使用方法:
 *   const { getProxyConfig } = require('./proxy-rules');
 *   await session.defaultSession.setProxy(getProxyConfig());
 */

'use strict';

// =====================================================
// プロキシ設定定数
// =====================================================

/** @type {string} 社内プロキシサーバーのアドレス（認証なし） */
const PROXY_SERVER = '210.175.128.100:8080';

/**
 * プロキシをバイパスする（直接接続する）ネットワーク範囲
 * 社内ネットワーク（プライベートIPアドレス帯）を列挙
 *
 * @type {string[]}
 */
const BYPASS_RULES = [
  '10.0.0.0/8',        // クラスA プライベートIP（社内サイネージサーバー等）
  '172.16.0.0/12',     // クラスB プライベートIP
  '192.168.0.0/16',    // クラスC プライベートIP
  'localhost',          // ローカルホスト
  '127.0.0.1',         // ループバックアドレス
  '<local>'            // Electron: ローカルアドレス全般
];

/**
 * Electron の session.setProxy() に渡すプロキシ設定オブジェクトを返す
 *
 * 動作:
 *   - HTTP/HTTPS 通信は PROXY_SERVER を経由
 *   - BYPASS_RULES に一致するアドレスは直接接続（プロキシなし）
 *
 * @returns {{proxyRules: string, proxyBypassRules: string}} プロキシ設定
 */
function getProxyConfig() {
  return {
    // HTTP と HTTPS の両方で同じプロキシを使用
    proxyRules: `http=http://${PROXY_SERVER};https=http://${PROXY_SERVER}`,
    // 社内ネットワークはプロキシをバイパス
    proxyBypassRules: BYPASS_RULES.join(',')
  };
}

module.exports = {
  getProxyConfig,
  PROXY_SERVER,
  BYPASS_RULES
};

// Ed25519 签名/验签：仅使用 node:crypto，密钥以裸 hex 表示，便于和客户端
// cfms-extension 的 32 字节 seed/public key 格式互换。
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

// PKCS#8 / SPKI 的固定前缀，尾部 32 字节即 Ed25519 种子/公钥。
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function assertHex(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${label} 必须是 hex 字符串`);
  }
  if (value.length !== 64) throw new Error(`${label} 必须是 32 字节（64 个 hex 字符）`);
  return value.toLowerCase();
}

export function privateKeyFromSeed(seedHex) {
  const seed = Buffer.from(assertHex(seedHex, 'Ed25519 seed'), 'hex');
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

export function publicKeyFromHex(publicKeyHex) {
  const raw = Buffer.from(assertHex(publicKeyHex, 'Ed25519 公钥'), 'hex');
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

export function signBytes(seedHex, data) {
  return cryptoSign(null, Buffer.from(data), privateKeyFromSeed(seedHex));
}

export function verifyBytes(publicKeyHex, data, signatureBytes) {
  try {
    return cryptoVerify(
      null,
      Buffer.from(data),
      publicKeyFromHex(publicKeyHex),
      Buffer.from(signatureBytes),
    );
  } catch {
    return false;
  }
}

/** 生成一对 Ed25519 密钥，返回裸 hex（seed / public key）。 */
export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKeyHex: pkcs8.subarray(pkcs8.length - 32).toString('hex'),
    publicKeyHex: spki.subarray(spki.length - 32).toString('hex'),
  };
}

const fs = require('fs');
const crypto = require('crypto');

// vault_ids.md から ENCRYPTED_DATA を取り出す
const content = fs.readFileSync('/home/hrm/projects/dtwant/dt_world/content/project-x/vault_ids.md', 'utf8');
const match = content.match(/const ENCRYPTED_DATA = "(.*?)";/);
if (!match) {
  console.error('ENCRYPTED_DATA not found in vault_ids.md');
  process.exit(1);
}

const base64Data = match[1];
const rawBuffer = Buffer.from(base64Data, 'base64');

// パケット切り出し
const iv = rawBuffer.subarray(0, 12);
const tag = rawBuffer.subarray(12, 28);
const ciphertext = rawBuffer.subarray(28);

// 鍵導出
const pass1 = "dt";
const pass2 = "project-x";
const keySource = pass1 + ":" + pass2;
const keyHash = crypto.createHash('sha256').update(keySource, 'utf8').digest();

try {
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyHash, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, null, 'utf8');
  decrypted += decipher.final('utf8');
  console.log('Decryption SUCCESS!');
  console.log('Decrypted Length:', decrypted.length);
  console.log('Preview:', decrypted.substring(0, 200));
} catch (err) {
  console.error('Decryption FAILED:', err.message);
}

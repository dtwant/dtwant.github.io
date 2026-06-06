const fs = require('fs');
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;

async function testDecryption() {
  const content = fs.readFileSync('/home/hrm/projects/dtwant/dt_world/content/project-x/vault_ids.md', 'utf8');
  const match = content.match(/const ENCRYPTED_DATA = "(.*?)";/);
  if (!match) {
    console.error('ENCRYPTED_DATA not found');
    return;
  }
  const encryptedData = match[1];

  async function decryptData(pass1, pass2) {
    try {
      const rawData = Buffer.from(encryptedData, 'base64');
      const rawBuffer = new Uint8Array(rawData);

      const iv = rawBuffer.slice(0, 12);
      const tag = rawBuffer.slice(12, 28);
      const ciphertext = rawBuffer.slice(28);

      const dataToDecrypt = new Uint8Array(ciphertext.length + tag.length);
      dataToDecrypt.set(ciphertext);
      dataToDecrypt.set(tag, ciphertext.length);

      const keySource = pass1.trim() + ":" + pass2.trim();
      const encoder = new TextEncoder();
      const keyData = encoder.encode(keySource);
      const keyHash = await subtle.digest('SHA-256', keyData);

      const aesKey = await subtle.importKey(
        'raw',
        keyHash,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const decryptedBuffer = await subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          tagLength: 128
        },
        aesKey,
        dataToDecrypt
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (e) {
      console.error(`Failed with key "${pass1}:${pass2}":`, e.message);
      return null;
    }
  }

  // 1211:20050101 での復号テスト
  console.log('Testing "1211:20050101"...');
  let result = await decryptData("1211", "20050101");
  if (result) {
    console.log('Decryption SUCCESS with "1211:20050101"!');
    console.log('Length:', result.length);
    console.log('Preview:', result.substring(0, 200));
    return;
  }

  // dt:project-x での復号テスト
  console.log('Testing "dt:project-x"...');
  result = await decryptData("dt", "project-x");
  if (result) {
    console.log('Decryption SUCCESS with "dt:project-x"!');
    console.log('Length:', result.length);
    console.log('Preview:', result.substring(0, 200));
    return;
  }
}

testDecryption();

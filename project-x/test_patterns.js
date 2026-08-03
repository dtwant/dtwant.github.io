const fs = require('fs');
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;

async function runTests() {
  const content = fs.readFileSync('/home/hrm/projects/dtwant/dt_world/content/project-x/vault_ids.md', 'utf8');
  const match = content.match(/const ENCRYPTED_DATA = "(.*?)";/);
  if (!match) {
    console.error('ENCRYPTED_DATA not found');
    return;
  }
  const encryptedData = match[1];
  console.log('Matched ENCRYPTED_DATA Length:', encryptedData.length);
  const rawData = Buffer.from(encryptedData, 'base64');
  console.log('Decoded buffer byte length:', rawData.length);
  const rawBuffer = new Uint8Array(rawData);

  const keys = [
    { pass1: "1211", pass2: "20050101", format: "pass1:pass2" },
    { pass1: "1211", pass2: "20050101", format: "pass1pass2" },
    { pass1: "dt", pass2: "project-x", format: "pass1:pass2" },
    { pass1: "dt", pass2: "project-x", format: "pass1pass2" }
  ];

  // パターンA: IV (12B) + Tag (16B) + Ciphertext (Remaining)
  // 復号時には Ciphertext + Tag を subtle.decrypt に渡す
  function getBuffersPatternA(buf) {
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const ciphertext = buf.slice(28);
    const dataToDecrypt = new Uint8Array(ciphertext.length + tag.length);
    dataToDecrypt.set(ciphertext);
    dataToDecrypt.set(tag, ciphertext.length);
    return { iv, dataToDecrypt };
  }

  // パターンB: IV (12B) + Ciphertext (Remaining) + Tag (16B)
  // 復号時には Ciphertext + Tag (すなわち元のバッファの12バイト目以降) をそのまま subtle.decrypt に渡す
  function getBuffersPatternB(buf) {
    const iv = buf.slice(0, 12);
    const dataToDecrypt = buf.slice(12); // Ciphertext + Tag がすでに結合されている
    return { iv, dataToDecrypt };
  }

  const patterns = [
    { name: "Pattern A (IV + Tag + Ciphertext)", getBuffers: getBuffersPatternA },
    { name: "Pattern B (IV + Ciphertext + Tag)", getBuffers: getBuffersPatternB }
  ];

  for (const pattern of patterns) {
    console.log(`\n=== Testing ${pattern.name} ===`);
    const { iv, dataToDecrypt } = pattern.getBuffers(rawBuffer);

    for (const keyInfo of keys) {
      for (const trim of [true, false]) {
        let keySource = "";
        if (keyInfo.format === "pass1:pass2") {
          keySource = trim 
            ? `${keyInfo.pass1.trim()}:${keyInfo.pass2.trim()}`
            : `${keyInfo.pass1}:${keyInfo.pass2}`;
        } else {
          keySource = trim
            ? `${keyInfo.pass1.trim()}${keyInfo.pass2.trim()}`
            : `${keyInfo.pass1}${keyInfo.pass2}`;
        }

        try {
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
          const decryptedText = decoder.decode(decryptedBuffer);

          console.log(`SUCCESS! Pattern: ${pattern.name}, KeySource: "${keySource}"`);
          console.log(`Decrypted text preview (first 150 chars):`);
          console.log(decryptedText.substring(0, 150));
          return; // 成功したら終了
        } catch (e) {
          // 失敗した場合はログを出さずに次を試す
        }
      }
    }
  }
  console.log("\nAll patterns and keys failed.");
}

runTests();

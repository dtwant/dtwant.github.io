const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const htmlContent = `<h2 class="section-label">1. 各ツール別 Vault ID リスト</h2>

<div class="vault-card">
  <div class="vault-title">📅 時間割 (Timetable Log)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>dt_subject_progress</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="6a1d8e11ddf5aa59f78004cd">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">📆 カレンダー (Chrono Grid)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>chrono_grid</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="69e6507baaba8821971c2a31">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">📝 タスクカレンダー (Task Calendar)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>0723_task_calendar</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="6a004707adc21f119a7bbbff">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">💳 支払い台帳 (Payment Ledger)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>payment_ledger</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="69f0d7d0aaba8821974a2f3d">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">⚖️ 体重管理 (Weight Log)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>weight_log_master</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="6a05f3eeadc21f119a7bbbff">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">📚 漫画棚 (Manga Shelf)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>manga_shelf</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="69b0373a8d9bd565842d399b">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">📖 小説棚 (Novel Shelf)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>novel_shelf</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="69cfbb5e856a682189f780b3">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">🎬 映画棚 (Movie Shelf)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>movie_shelf</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="69cfa930856a682189f72fca">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>

<div class="vault-card">
  <div class="vault-title">🔔 締切管理 (Deadline Manager)</div>
  <div class="vault-meta">保管庫名 (X-Bin-Name): <code>deadline_manager</code></div>
  <div class="vault-id-row">
    <input type="password" readonly class="vault-id-val" value="69e5cb6e856a682189517a30">
    <button class="vault-copy-btn">COPY</button>
  </div>
</div>`;

const pass1 = "1211";
const pass2 = "20050101";
const keySource = pass1.trim() + ":" + pass2.trim();
const keyHash = crypto.createHash('sha256').update(keySource, 'utf8').digest();

// AES-256-GCM暗号化 (Web Crypto API と同じ構造にするために、最後を Pattern B (IV + ciphertext + tag) にします。
// ブラウザ側の復号ロジックが Pattern B (iv = slice(0,12), dataToDecrypt = slice(12)) に修正されたため、
// パッキングは [IV (12B)] + [Ciphertext] + [Tag (16B)] の順で結合します。
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', keyHash, iv);

let ciphertext = cipher.update(htmlContent, 'utf8');
ciphertext = Buffer.concat([ciphertext, cipher.final()]);
const tag = cipher.getAuthTag();

// Pattern B 結合: [IV] + [Ciphertext] + [Tag]
const packet = Buffer.concat([iv, ciphertext, tag]);
const base64Packet = packet.toString('base64');

// vault_ids.md を読み込んで更新
const mdPath = path.join(__dirname, 'vault_ids.md');
let mdContent = fs.readFileSync(mdPath, 'utf8');

const regex = /const ENCRYPTED_DATA = ".*?";/;
if (regex.test(mdContent)) {
  mdContent = mdContent.replace(regex, `const ENCRYPTED_DATA = "${base64Packet}";`);
  fs.writeFileSync(mdPath, mdContent, 'utf8');
  console.log("SUCCESS: vault_ids.md has been successfully encrypted and updated!");
  console.log("Ciphertext Length:", base64Packet.length);
} else {
  console.error("ERROR: const ENCRYPTED_DATA declaration not found in vault_ids.md");
}

// DtSync グローバルオブジェクト (軍用暗号化 & 高速KVSスマートマージ同期)
window.DtSync = (() => {
  const BACKUP_KEY = 'dt_subject_progress_data_backup';
  let config = {
    storageKey: 'dt_subject_progress_data',
    onSyncComplete: null
  };
  
  // ログ出力用関数
  function log(msg) {
    const logEl = document.getElementById('sync-log');
    if (logEl) {
      logEl.style.display = 'block';
      logEl.innerHTML += `\n> ${msg}`;
      logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(`[DtSync] ${msg}`);
  }
  
  // 安全退避バックアップ (シャドウバックアップ)
  function makeShadowBackup(data) {
    try {
      if (data) {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
      }
    } catch(e) {
      console.error("Backup failed", e);
    }
  }

  // 手動バックアップのテキスト生成
  function exportLocalData() {
    try {
      const data = localStorage.getItem(config.storageKey);
      if (!data) return "{}";
      return data;
    } catch(e) {
      return "ERROR: " + e.message;
    }
  }

  // データの正当性検証
  function validateData(data) {
    if (!data) return false;
    if (typeof data !== 'object') return false;
    return true;
  }
  
  // Web Crypto API でキー生成
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // 暗号化 (AES-GCM 256)
  async function encryptData(text, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      enc.encode(text)
    );
    
    const result = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.byteLength);
    result.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);
    
    return btoa(String.fromCharCode.apply(null, result));
  }

  // 復言 (AES-GCM 256)
  async function decryptData(base64Str, password) {
    const binaryDer = atob(base64Str);
    const len = binaryDer.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryDer.charCodeAt(i);
    }
    
    const salt = bytes.slice(0, 16);
    const iv = bytes.slice(16, 28);
    const encrypted = bytes.slice(28);
    
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encrypted
    );
    
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  }

  // 同期キーからバケットIDと暗号化パスワードを抽出
  function parseSyncKey(syncKey) {
    const clean = syncKey.trim().toUpperCase();
    if (clean.startsWith('DTSYNC-')) {
      const bucketId = clean.replace('DTSYNC-', '').toLowerCase();
      return { bucketId: bucketId, password: clean };
    }
    return { bucketId: clean.toLowerCase(), password: clean };
  }

  // クラウドとのデータ競合解決 (スマートマージ)
  function mergeData(local, remote) {
    if (!local) return remote || {};
    if (!remote) return local || {};
    
    const merged = JSON.parse(JSON.stringify(local)); // ディープコピー
    
    Object.keys(remote).forEach(subject => {
      if (!merged[subject]) {
        merged[subject] = remote[subject];
        return;
      }
      
      Object.keys(remote[subject]).forEach(lessonIdx => {
        const localLesson = merged[subject][lessonIdx];
        const remoteLesson = remote[subject][lessonIdx];
        
        if (!localLesson) {
          merged[subject][lessonIdx] = remoteLesson;
          return;
        }
        
        const localTime = localLesson.updated_at || 0;
        const remoteTime = remoteLesson.updated_at || 0;
        
        if (remoteTime > localTime) {
          merged[subject][lessonIdx] = remoteLesson;
        }
      });
    });
    
    return merged;
  }

  // keyvalue.xyz のエンドポイント取得
  function getEndpoint(bucketId) {
    return `https://keyvalue.xyz/v1/dt_sync_${bucketId}`;
  }

  // クラウドに保存する
  async function uploadToCloud(data, syncKey) {
    if (!syncKey) return;
    try {
      const { bucketId, password } = parseSyncKey(syncKey);
      const url = getEndpoint(bucketId);
      const text = JSON.stringify(data);
      const encrypted = await encryptData(text, password);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: encrypted
      });
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      log("UPLOAD COMPLETED.");
    } catch(e) {
      log(`UPLOAD FAILED: ${e.message}`);
      throw e;
    }
  }

  // クラウドから読み込む
  async function downloadFromCloud(syncKey) {
    if (!syncKey) return null;
    try {
      const { bucketId, password } = parseSyncKey(syncKey);
      const url = getEndpoint(bucketId);
      const response = await fetch(url);
      if (response.status === 404) {
        log("NO CLOUD ARCHIVE FOUND. INITIAL UPLOAD PENDING.");
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const encrypted = await response.text();
      if (!encrypted || encrypted.trim() === "") return null;
      
      const decrypted = await decryptData(encrypted, password);
      return JSON.parse(decrypted);
    } catch(e) {
      log(`DOWNLOAD FAILED: ${e.message}`);
      throw e;
    }
  }

  // 同期キーの保存
  function saveSyncKey(key) {
    localStorage.setItem('dt_sync_key', key);
  }

  // 同期キーの取得
  function getSyncKey() {
    return localStorage.getItem('dt_sync_key');
  }

  // 同期処理の中核
  async function syncProcess() {
    const syncKey = getSyncKey();
    if (!syncKey) return;
    
    log("ESTABLISHING ENCRYPTED CONNECTION...");
    try {
      let localData = {};
      try {
        localData = JSON.parse(localStorage.getItem(config.storageKey)) || {};
      } catch(e) {
        localData = {};
      }
      
      const remoteData = await downloadFromCloud(syncKey);
      
      let mergedData = localData;
      if (remoteData) {
        mergedData = mergeData(localData, remoteData);
        log("DATA DECRYPTED AND MERGED SUCCESSFULLY.");
      } else {
        log("NO REMOTE DATA. INITIALIZING CLOUD VAULT...");
      }
      
      Object.keys(mergedData).forEach(subject => {
        Object.keys(mergedData[subject]).forEach(idx => {
          if (!mergedData[subject][idx].updated_at) {
            mergedData[subject][idx].updated_at = Date.now();
          }
        });
      });
      
      if (!validateData(mergedData)) {
        throw new Error("Merged data validation failed.");
      }
      
      makeShadowBackup(localData);
      
      localStorage.setItem(config.storageKey, JSON.stringify(mergedData));
      
      await uploadToCloud(mergedData, syncKey);
      
      if (config.onSyncComplete) {
        config.onSyncComplete(mergedData);
      }
      
      updateUI();
      log("SYNC SUCCESSFUL.");
      
      const now = new Date();
      const timeStr = now.getFullYear() + '.' + String(now.getMonth()+1).padStart(2,'0') + '.' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
      const timeEl = document.getElementById('sync-time');
      if (timeEl) timeEl.textContent = timeStr;
    } catch(e) {
      log(`SYNC FAILED: ${e.message}`);
      alert(`同期失敗: ${e.message}`);
    }
  }

  // 定期自動同期のタイマー
  let autoSyncInterval = null;
  function startAutoSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    autoSyncInterval = setInterval(() => {
      syncProcess();
    }, 180000);
  }

  function stopAutoSync() {
    if (autoSyncInterval) {
      clearInterval(autoSyncInterval);
      autoSyncInterval = null;
    }
  }

  // UI状態の更新
  function updateUI() {
    const syncKey = getSyncKey();
    const statusEl = document.getElementById('sync-status');
    const cryptoEl = document.getElementById('sync-crypto');
    const initView = document.getElementById('sync-init-view');
    const inputView = document.getElementById('sync-input-view');
    const activeView = document.getElementById('sync-active-view');
    const keyDisplay = document.getElementById('sync-key-display');
    const logEl = document.getElementById('sync-log');

    if (syncKey) {
      if (statusEl) {
        statusEl.textContent = 'ONLINE';
        statusEl.style.color = 'var(--cmd-green)';
        statusEl.style.textShadow = '0 0 8px var(--cmd-green)';
      }
      if (cryptoEl) {
        cryptoEl.textContent = 'SHIELDED (AES)';
        cryptoEl.style.color = 'var(--cmd-purple)';
      }
      if (initView) initView.style.display = 'none';
      if (inputView) inputView.style.display = 'none';
      if (activeView) activeView.style.display = 'block';
      if (keyDisplay) keyDisplay.value = syncKey;
      if (logEl) logEl.style.display = 'block';
    } else {
      if (statusEl) {
        statusEl.textContent = 'OFFLINE';
        statusEl.style.color = 'var(--neon-pink)';
        statusEl.style.textShadow = '0 0 8px var(--neon-pink)';
      }
      if (cryptoEl) {
        cryptoEl.textContent = 'INACTIVE';
        cryptoEl.style.color = '#666';
      }
      if (initView) initView.style.display = 'block';
      if (inputView) inputView.style.display = 'none';
      if (activeView) activeView.style.display = 'none';
      if (keyDisplay) keyDisplay.value = '';
    }
  }

  // コントロールパネルのDOM生成
  function injectSyncPanelHTML() {
    const container = document.getElementById('cyber-sync-panel');
    if (!container) return;

    container.className = 'tt-section monitor-section';
    container.style.cssText = 'display: block; border-color: var(--cmd-purple); background: rgba(10, 5, 20, 0.85); box-shadow: 0 0 30px rgba(188, 19, 254, 0.15); margin-top: 2rem; position: relative;';
    
    container.innerHTML = `
      <div class="monitor-header" style="border-bottom-color: rgba(188, 19, 254, 0.3); background: rgba(188, 19, 254, 0.05); color: var(--cmd-purple); text-shadow: 0 0 8px var(--cmd-purple);">
        <div>[ SYSTEM: CLOUD SYNC PROTOCOL ]</div>
      </div>
      <div style="padding: 1.2rem; display: flex; flex-direction: column; gap: 1rem;">
        <!-- ステータス表示 -->
        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.8rem; font-family: 'Orbitron', sans-serif; font-size: 0.78rem;">
          <div>STATUS: <span id="sync-status" style="color: var(--neon-pink); font-weight: bold; text-shadow: 0 0 8px var(--neon-pink);">OFFLINE</span></div>
          <div>ENCRYPTION: <span id="sync-crypto" style="color: #666;">INACTIVE</span></div>
          <div>LAST SYNC: <span id="sync-time" style="color: rgba(200,220,200,0.5);">-</span></div>
        </div>
        
        <!-- 未同期時の表示 -->
        <div id="sync-init-view" style="display: block;">
          <p style="font-size: 0.72rem; color: rgba(200, 220, 200, 0.4); font-family: 'JetBrains Mono', monospace; margin: 0 0 1rem 0;">
            > CLOUD SYNC MODULE: INACTIVE_
          </p>
          <div style="display: flex; gap: 0.8rem; flex-wrap: wrap;">
            <button class="att-btn delayed-status" id="btn-sync-generate" style="flex: 1; min-width: 150px; font-size: 0.72rem; padding: 0.6rem 1rem; border-color: var(--cmd-amber); color: var(--cmd-amber);">
              GENERATE NEW SYNC KEY
            </button>
            <button class="att-btn exempt-status" id="btn-sync-link" style="flex: 1; min-width: 150px; font-size: 0.72rem; padding: 0.6rem 1rem; border-color: var(--cmd-purple); color: var(--cmd-purple);">
              LINK EXISTING TERMINAL
            </button>
          </div>
        </div>

        <!-- キー入力エリア -->
        <div id="sync-input-view" style="display: none;">
          <label style="font-family: 'Orbitron', sans-serif; font-size: 0.7rem; color: var(--cmd-purple); margin-bottom: 0.4rem; display: block;">ENTER EXISTING SYNC KEY:</label>
          <div style="display: flex; gap: 0.6rem;">
            <input type="text" id="sync-key-input" class="cyber-memo-input" placeholder="DTSYNC-XXXX-XXXX-XXXX-XXXX" style="border-color: var(--cmd-purple); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;">
            <button class="att-btn active-status" id="btn-sync-connect" style="flex: 0; min-width: 80px; font-size: 0.72rem; padding: 0.4rem 0.8rem; border-color: var(--cmd-green); color: var(--cmd-green);">
              CONNECT
            </button>
          </div>
          <div style="margin-top: 0.6rem; text-align: right;">
            <button id="btn-sync-cancel" style="background: none; border: none; color: var(--neon-pink); font-family: 'Orbitron', sans-serif; font-size: 0.65rem; cursor: pointer;">CANCEL</button>
          </div>
        </div>

        <!-- 同期有効化時の表示 -->
        <div id="sync-active-view" style="display: none;">
          <div style="background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(188, 19, 254, 0.2); padding: 0.8rem; margin-bottom: 1rem; position: relative;">
            <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: var(--cmd-purple); margin-bottom: 0.4rem;">TERMINAL SYNC KEY:</div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.8rem;">
              <input type="password" id="sync-key-display" readonly style="background: none; border: none; color: var(--cmd-amber); font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; font-weight: bold; width: 65%; outline: none;" value="">
              <div style="display: flex; gap: 0.4rem;">
                <button id="btn-sync-toggle-show" style="background: none; border: 1px solid rgba(255,255,255,0.2); color: #ccc; font-family: 'Orbitron', sans-serif; font-size: 0.6rem; padding: 0.2rem 0.4rem; cursor: pointer;">SHOW</button>
                <button id="btn-sync-copy" style="background: none; border: 1px solid var(--cmd-purple); color: var(--cmd-purple); font-family: 'Orbitron', sans-serif; font-size: 0.6rem; padding: 0.2rem 0.4rem; cursor: pointer;">COPY</button>
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <button class="att-btn active-status" id="btn-sync-now" style="flex: 1; font-size: 0.72rem; padding: 0.5rem; border-color: var(--cmd-green); color: var(--cmd-green);">
              FORCE SYNC NOW
            </button>
            <button class="att-btn offline-status" id="btn-sync-disconnect" style="flex: 1; font-size: 0.72rem; padding: 0.5rem; border-color: var(--neon-pink); color: var(--neon-pink);">
              TERMINATE SYNC
            </button>
          </div>
        </div>
        
        <!-- 手動バックアップ / エクスポート -->
        <div style="border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.65rem; color: rgba(200,220,200,0.4);">DATA INTEGRITY SECURITY PROTOCOL</span>
          <button id="btn-sync-backup-export" style="background: none; border: 1px solid rgba(255,255,255,0.2); color: rgba(200,220,200,0.6); font-family: 'Orbitron', sans-serif; font-size: 0.6rem; padding: 0.2rem 0.6rem; cursor: pointer; transition: all 0.2s;">
            MANUAL BACKUP EXPORT
          </button>
        </div>

        <div id="sync-backup-view" style="display: none; background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255,255,255,0.15); padding: 0.8rem;">
          <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: var(--cmd-amber); margin-bottom: 0.4rem;">RAW DATA EXPORT:</div>
          <textarea id="sync-backup-text" readonly style="width: 100%; height: 80px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: var(--cmd-green); font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; padding: 0.4rem; resize: none; margin-bottom: 0.5rem;"></textarea>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <button id="btn-sync-backup-copy" style="background: none; border: 1px solid var(--cmd-amber); color: var(--cmd-amber); font-family: 'Orbitron', sans-serif; font-size: 0.6rem; padding: 0.2rem 0.5rem; cursor: pointer;">COPY DATA</button>
            <button id="btn-sync-backup-import-toggle" style="background: none; border: none; color: var(--cmd-purple); font-family: 'Orbitron', sans-serif; font-size: 0.6rem; cursor: pointer;">IMPORT MODE</button>
            <button id="btn-sync-backup-close" style="background: none; border: none; color: #888; font-family: 'Orbitron', sans-serif; font-size: 0.6rem; cursor: pointer;">CLOSE</button>
          </div>
        </div>

        <div id="sync-import-view" style="display: none; background: rgba(0, 0, 0, 0.7); border: 1px solid var(--cmd-purple); padding: 0.8rem;">
          <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: var(--cmd-purple); margin-bottom: 0.4rem;">PASTE BACKUP DATA TO IMPORT:</div>
          <textarea id="sync-import-text" style="width: 100%; height: 80px; background: rgba(0,0,0,0.5); border: 1px solid rgba(188,19,254,0.3); color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; padding: 0.4rem; resize: none; margin-bottom: 0.5rem;"></textarea>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <button id="btn-sync-import-run" style="background: none; border: 1px solid var(--cmd-purple); color: var(--cmd-purple); font-family: 'Orbitron', sans-serif; font-size: 0.6rem; padding: 0.2rem 0.5rem; cursor: pointer; font-weight: bold;">APPLY IMPORT</button>
            <button id="btn-sync-import-close" style="background: none; border: none; color: #888; font-family: 'Orbitron', sans-serif; font-size: 0.6rem; cursor: pointer;">CANCEL</button>
          </div>
        </div>

        <!-- ログ表示エリア -->
        <div id="sync-log" style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: rgba(0, 255, 102, 0.75); background: rgba(0, 5, 0, 0.75); padding: 0.5rem; border: 1px solid rgba(0, 255, 102, 0.15); height: 80px; overflow-y: auto; display: none; white-space: pre-wrap; word-break: break-all;"></div>
      </div>
    `;

    // イベントバインディング
    document.getElementById('btn-sync-generate').addEventListener('click', async () => {
      if (confirm("同期キーを生成し、クラウド同期を開始しますか？\n(既存のデータは安全に保護されます)")) {
        try {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let rawBucketId = '';
          for (let i = 0; i < 16; i++) {
            rawBucketId += chars.charAt(Math.floor(Math.random() * chars.length));
          }
          const key = `DTSYNC-${rawBucketId}`;
          saveSyncKey(key);
          updateUI();
          log(`NEW SYNC KEY GENERATED: ${key}`);
          await syncProcess();
          startAutoSync();
        } catch(e) {
          alert(`同期失敗: ${e.message}`);
        }
      }
    });

    document.getElementById('btn-sync-link').addEventListener('click', () => {
      document.getElementById('sync-init-view').style.display = 'none';
      document.getElementById('sync-input-view').style.display = 'block';
    });

    document.getElementById('btn-sync-cancel').addEventListener('click', () => {
      document.getElementById('sync-init-view').style.display = 'block';
      document.getElementById('sync-input-view').style.display = 'none';
    });

    document.getElementById('btn-sync-connect').addEventListener('click', async () => {
      const inputVal = document.getElementById('sync-key-input').value.trim().toUpperCase();
      if (!inputVal.startsWith('DTSYNC-') || inputVal.split('-').length !== 2) {
        alert("無効な同期キー形式です。");
        return;
      }
      if (confirm("この同期キーでクラウドに接続し、同期しますか？")) {
        saveSyncKey(inputVal);
        updateUI();
        log(`CONNECTED.`);
        await syncProcess();
        startAutoSync();
      }
    });

    document.getElementById('btn-sync-toggle-show').addEventListener('click', (e) => {
      const display = document.getElementById('sync-key-display');
      if (display.type === 'password') {
        display.type = 'text';
        e.target.textContent = 'HIDE';
      } else {
        display.type = 'password';
        e.target.textContent = 'SHOW';
      }
    });

    document.getElementById('btn-sync-copy').addEventListener('click', () => {
      const display = document.getElementById('sync-key-display');
      navigator.clipboard.writeText(display.value).then(() => {
        alert("コピーしました。");
      }).catch(err => {
        log(`COPY FAILED: ${err.message}`);
      });
    });

    document.getElementById('btn-sync-now').addEventListener('click', async () => {
      await syncProcess();
    });

    document.getElementById('btn-sync-disconnect').addEventListener('click', () => {
      if (confirm("同期を解除しますか？")) {
        stopAutoSync();
        localStorage.removeItem('dt_sync_key');
        updateUI();
        log("SYNC TERMINATED.");
      }
    });

    // 手動バックアップエクスポート
    document.getElementById('btn-sync-backup-export').addEventListener('click', () => {
      document.getElementById('sync-backup-view').style.display = 'block';
      document.getElementById('sync-import-view').style.display = 'none';
      document.getElementById('sync-backup-text').value = exportLocalData();
    });

    document.getElementById('btn-sync-backup-close').addEventListener('click', () => {
      document.getElementById('sync-backup-view').style.display = 'none';
    });

    document.getElementById('btn-sync-backup-copy').addEventListener('click', () => {
      const txt = document.getElementById('sync-backup-text');
      navigator.clipboard.writeText(txt.value).then(() => {
        alert("コピーしました。");
      }).catch(err => {
        alert("コピー失敗: " + err.message);
      });
    });

    document.getElementById('btn-sync-backup-import-toggle').addEventListener('click', () => {
      document.getElementById('sync-backup-view').style.display = 'none';
      document.getElementById('sync-import-view').style.display = 'block';
    });

    document.getElementById('btn-sync-import-close').addEventListener('click', () => {
      document.getElementById('sync-import-view').style.display = 'none';
    });

    document.getElementById('btn-sync-import-run').addEventListener('click', () => {
      const val = document.getElementById('sync-import-text').value.trim();
      if (!val) {
        alert("空です。");
        return;
      }
      try {
        const parsed = JSON.parse(val);
        if (!validateData(parsed)) {
          throw new Error("Invalid structure.");
        }
        if (confirm("インポートを実行しますか？(既存データは上書きされます)")) {
          const currentLocal = localStorage.getItem(config.storageKey);
          if (currentLocal) {
            localStorage.setItem(BACKUP_KEY, currentLocal);
          }
          localStorage.setItem(config.storageKey, JSON.stringify(parsed));
          alert("成功しました。リロードします。");
          window.location.reload();
        }
      } catch(e) {
        alert("失敗: " + e.message);
      }
    });
  }

  // 初期化関数
  function init(options) {
    if (options) {
      if (options.storageKey) config.storageKey = options.storageKey;
      if (options.onSyncComplete) config.onSyncComplete = options.onSyncComplete;
    }
    
    injectSyncPanelHTML();
    updateUI();
    
    const syncKey = getSyncKey();
    if (syncKey) {
      log(`ESTABLISHED CONNECTION WITH NODE ID: ${syncKey.substring(0, 15)}...`);
      syncProcess();
      startAutoSync();
    }
  }

  return {
    init: init,
    triggerUpload: (data) => {
      const syncKey = getSyncKey();
      if (syncKey) {
        uploadToCloud(data, syncKey);
      }
    }
  };
})();

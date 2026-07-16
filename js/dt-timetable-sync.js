// DtSync グローバルオブジェクト (jsonbin.io スマートマージ同期)
window.DtSync = (() => {
  const BACKUP_KEY = 'dt_subject_progress_data_backup';
  const BLOB_KEY = 'dt_timetable_sync_blob'; // localStorage に保存するBlob IDキー
  
  // Chrono Grid と共通の jsonbin.io マスターキーを取得、無ければデフォルト
  const JB_KEY_DEFAULT = '$2a$10$iVNuU6AA4DGWLiU8/Gl.oOIvr166q/dgd995DrQ1ziA/9eSq7Fh7q';
  
  function getJbKey() {
    if (window.PWAConfigSync) {
      return window.PWAConfigSync.getApiKey();
    }
    const key = localStorage.getItem('cg_jb_key') || JB_KEY_DEFAULT;
    return key.trim();
  }
  
  let config = {
    storageKey: 'dt_subject_progress_data',
    onSyncComplete: null
  };
  
  let blobId = localStorage.getItem(BLOB_KEY) || null;
  let isBackoffActive = false;
  
  // ログ出力
  function log(msg) {
    const logEl = document.getElementById('sync-log');
    if (logEl) {
      logEl.innerHTML += `\n> ${msg}`;
      logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(`[DtSync] ${msg}`);
  }
  
  // 安全退避バックアップ
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

  // jsonbin.io のエンドポイント取得
  const JB_CREATE = 'https://api.jsonbin.io/v3/b';
  const binUrl = () => `https://api.jsonbin.io/v3/b/${blobId}/latest`;
  const binPut = () => `https://api.jsonbin.io/v3/b/${blobId}`;
  const JB_HDR = () => ({ 'X-Master-Key': getJbKey(), 'Content-Type': 'application/json' });

  // クラウドに保存する
  async function uploadToCloud(data) {
    if (!blobId) return;
    try {
      const response = await fetch(binPut(), {
        method: 'PUT',
        headers: JB_HDR(),
        body: JSON.stringify(data)
      });
      if (response.status === 429) {
        handleRateLimit();
        throw new Error("API Rate Limit (429)");
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      log("UPLOAD COMPLETED.");
    } catch(e) {
      log(`UPLOAD FAILED: ${e.message}`);
      throw e;
    }
  }

  // クラウドから読み込む
  async function downloadFromCloud() {
    if (!blobId) return null;
    try {
      const response = await fetch(binUrl(), {
        headers: { 'X-Master-Key': getJbKey() },
        cache: 'no-store'
      });
      if (response.status === 429) {
        handleRateLimit();
        throw new Error("API Rate Limit (429)");
      }
      if (response.status === 404) {
        log("NO CLOUD ARCHIVE FOUND.");
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      return json.record || json;
    } catch(e) {
      log(`DOWNLOAD FAILED: ${e.message}`);
      throw e;
    }
  }

  // 新規 Blob 作成 (POST)
  async function createRemoteVault(initialData) {
    // 空オブジェクトによる500エラー防止のための初期スキーマ構築
    const sendData = (initialData && Object.keys(initialData).length > 0) 
      ? initialData 
      : { version: 1.0, updated_at: Date.now(), subjects: {} };
      
    try {
      const response = await fetch(JB_CREATE, {
        method: 'POST',
        headers: { ...JB_HDR(), 'X-Bin-Name': 'dt_subject_progress' },
        body: JSON.stringify(sendData)
      });
      if (response.status === 429) {
        handleRateLimit();
        throw new Error("API Rate Limit (429)");
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const resJson = await response.json();
      return resJson.metadata.id; // 生成された一意の ID
    } catch(e) {
      log(`BLOB CREATION FAILED: ${e.message}`);
      throw e;
    }
  }

  // 429レートリミット時のバックオフ処理
  function handleRateLimit() {
    if (!isBackoffActive) {
      isBackoffActive = true;
      log("ENFORCING SYNC BACKOFF...");
      stopAutoSync();
      startAutoSync(600000); // 10分間隔に一時引き伸ばし
      setTimeout(() => {
        isBackoffActive = false;
        log("BACKOFF RESOLVED. RESETTING TIMERS.");
        stopAutoSync();
        startAutoSync(180000); // 3分間隔に復帰
      }, 600000);
    }
  }

  // フラッシュエフェクトを実行するヘルパー
  function flashSuccessPanel() {
    const container = document.getElementById('cyber-sync-panel');
    if (container) {
      container.style.transition = 'all 0.15s ease-out';
      container.style.borderColor = 'var(--cmd-green)';
      container.style.boxShadow = '0 0 35px rgba(0, 255, 102, 0.4)';
      
      setTimeout(() => {
        container.style.borderColor = 'var(--cmd-purple)';
        container.style.boxShadow = '0 0 30px rgba(188, 19, 254, 0.15)';
      }, 800);
    }
  }

  // 同期処理の中核
  async function syncProcess() {
    if (!blobId) return;
    
    log("CONNECTING TO CLOUD ARCHIVE...");
    try {
      let localData = {};
      try {
        localData = JSON.parse(localStorage.getItem(config.storageKey)) || {};
      } catch(e) {
        localData = {};
      }
      
      const remoteData = await downloadFromCloud();
      
      let mergedData = localData;
      if (remoteData) {
        mergedData = mergeData(localData, remoteData);
        log("DATA MERGED SUCCESSFULLY.");
      } else {
        log("NO REMOTE DATA. INITIALIZING CLOUD VAULT...");
      }
      
      Object.keys(mergedData).forEach(subject => {
        if (typeof mergedData[subject] === 'object' && mergedData[subject] !== null) {
          Object.keys(mergedData[subject]).forEach(idx => {
            if (mergedData[subject][idx] && !mergedData[subject][idx].updated_at) {
              mergedData[subject][idx].updated_at = Date.now();
            }
          });
        }
      });
      
      if (!validateData(mergedData)) {
        throw new Error("Merged data validation failed.");
      }
      
      makeShadowBackup(localData);
      
      localStorage.setItem(config.storageKey, JSON.stringify(mergedData));
      
      await uploadToCloud(mergedData);
      
      if (config.onSyncComplete) {
        config.onSyncComplete(mergedData);
      }
      
      updateUI();
      log("SYNC SUCCESSFUL.");
      flashSuccessPanel();
      
      const now = new Date();
      const timeStr = now.getFullYear() + '.' + String(now.getMonth()+1).padStart(2,'0') + '.' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
      const timeEl = document.getElementById('sync-time');
      if (timeEl) {
        timeEl.textContent = timeStr;
        timeEl.style.color = 'var(--cmd-green)';
      }
    } catch(e) {
      log(`SYNC FAILED: ${e.message}`);
      
      const statusEl = document.getElementById('sync-status');
      if (statusEl) {
        statusEl.textContent = `ERR (${e.message.substring(0, 12)})`;
        statusEl.style.color = 'var(--cmd-red)';
        statusEl.style.textShadow = '0 0 8px var(--cmd-red)';
        statusEl.classList.add('blink-error');
      }
      
      const container = document.getElementById('cyber-sync-panel');
      if (container) {
        container.style.transition = 'all 0.1s ease-out';
        container.style.borderColor = 'var(--cmd-red)';
        container.style.boxShadow = '0 0 30px rgba(255, 0, 51, 0.3)';
        setTimeout(() => {
          container.style.borderColor = 'var(--cmd-purple)';
          container.style.boxShadow = '0 0 30px rgba(188, 19, 254, 0.15)';
        }, 1000);
      }
    }
  }

  // 定期自動同期のタイマー
  let autoSyncInterval = null;
  function startAutoSync(customInterval) {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    const interval = customInterval || 180000;
    autoSyncInterval = setInterval(() => {
      syncProcess();
    }, interval);
  }

  function stopAutoSync() {
    if (autoSyncInterval) {
      clearInterval(autoSyncInterval);
      autoSyncInterval = null;
    }
  }

  // UI状態の更新
  function updateUI() {
    const statusEl = document.getElementById('sync-status');
    const cryptoEl = document.getElementById('sync-crypto');
    const initView = document.getElementById('sync-init-view');
    const inputView = document.getElementById('sync-input-view');
    const activeView = document.getElementById('sync-active-view');
    const keyDisplay = document.getElementById('sync-key-display');

    if (statusEl) {
      statusEl.classList.remove('blink-error');
    }

    if (blobId) {
      if (statusEl) {
        statusEl.textContent = 'ONLINE';
        statusEl.style.color = 'var(--cmd-green)';
        statusEl.style.textShadow = '0 0 8px var(--cmd-green)';
      }
      if (cryptoEl) {
        cryptoEl.textContent = 'SHIELDED (JSONBIN)';
        cryptoEl.style.color = 'var(--cmd-purple)';
      }
      if (initView) initView.style.display = 'none';
      if (inputView) inputView.style.display = 'none';
      if (activeView) activeView.style.display = 'block';
      if (keyDisplay) keyDisplay.value = blobId;
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

  // エラー点滅用のCSSスタイルインジェクション
  function injectErrorBlinkCSS() {
    if (document.getElementById('sync-blink-css')) return;
    const style = document.createElement('style');
    style.id = 'sync-blink-css';
    style.textContent = `
      @keyframes sync-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      .blink-error {
        animation: sync-blink 1s infinite;
      }
    `;
    document.head.appendChild(style);
  }

  // コントロールパネルのDOM生成
  function injectSyncPanelHTML() {
    const container = document.getElementById('cyber-sync-panel');
    if (!container) return;

    injectErrorBlinkCSS();

    container.className = 'tt-section monitor-section';
    container.style.cssText = 'display: block; border-color: var(--cmd-purple); background: rgba(10, 5, 20, 0.85); box-shadow: 0 0 30px rgba(188, 19, 254, 0.15); margin-top: 2rem; position: relative; transition: all 0.3s;';
    
    container.innerHTML = `
      <div class="monitor-header" style="border-bottom-color: rgba(188, 19, 254, 0.3); background: rgba(188, 19, 254, 0.05); color: var(--cmd-purple); text-shadow: 0 0 8px var(--cmd-purple);">
        <div>[ CLOUD SYNC SYSTEM ]</div>
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
            > STATUS: CLOUD SYNC MODULE INACTIVE. ESTABLISH SECURE LINK OR GENERATE NEW VAULT.
          </p>
          <div style="display: flex; gap: 0.8rem; flex-wrap: wrap;">
            <button class="att-btn delayed-status" id="btn-sync-generate" style="flex: 1; min-width: 140px; font-size: 0.72rem; padding: 0.6rem 1rem; border-color: var(--cmd-amber); color: var(--cmd-amber);">
              CREATE NEW VAULT
            </button>
            <button class="att-btn exempt-status" id="btn-sync-link" style="flex: 1; min-width: 140px; font-size: 0.72rem; padding: 0.6rem 1rem; border-color: var(--cmd-purple); color: var(--cmd-purple);">
              LINK EXISTING VAULT
            </button>
            <button class="att-btn active-status" id="btn-sync-import-cg" style="flex: 1.5; min-width: 180px; font-size: 0.72rem; padding: 0.6rem 1rem; border-color: var(--cmd-green); color: var(--cmd-green); background: rgba(0, 255, 102, 0.04);">
              IMPORT CHRONO_GRID CONFIG
            </button>
          </div>
        </div>

        <!-- キー入力エリア -->
        <div id="sync-input-view" style="display: none;">
          <label style="font-family: 'Orbitron', sans-serif; font-size: 0.7rem; color: var(--cmd-purple); margin-bottom: 0.4rem; display: block;">ENTER EXISTING VAULT ID:</label>
          <div style="display: flex; gap: 0.6rem;">
            <input type="text" id="sync-key-input" class="cyber-memo-input" placeholder="Enter Bin ID" style="border-color: var(--cmd-purple); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem;">
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
            <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: var(--cmd-purple); margin-bottom: 0.4rem;">TERMINAL VAULT ID:</div>
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
        
        <!-- アコーディオン式ドック -->
        <div style="border-top: 1px dashed rgba(188, 19, 254, 0.2); margin-top: 0.8rem; padding-top: 0.5rem;">
          <button id="btn-toggle-console-dock" style="width: 100%; background: none; border: none; color: rgba(188, 19, 254, 0.7); font-family: 'Orbitron', sans-serif; font-size: 0.7rem; padding: 0.4rem 0; cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s;">
            <span>[▶] ADVANCED CONSOLE DOCK</span>
            <span id="console-dock-indicator" style="font-size:0.6rem; color:#888;">COLLAPSED</span>
          </button>
          
          <div id="console-dock-content" style="display: none; flex-direction: column; gap: 1rem; margin-top: 0.8rem; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 0.8rem;">
            <!-- 手動バックアップ / エクスポート -->
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <span style="font-size: 0.65rem; color: rgba(200,220,200,0.4);">DATA INTEGRITY SECURITY PROTOCOL</span>
              <button id="btn-sync-backup-export" style="background: none; border: 1px solid rgba(255,255,255,0.2); color: rgba(200,220,200,0.6); font-family: 'Orbitron', sans-serif; font-size: 0.6rem; padding: 0.2rem 0.6rem; cursor: pointer; transition: all 0.2s;">
                MANUAL BACKUP EXPORT
              </button>
            </div>
    
            <div id="sync-backup-view" style="display: none; background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255,255,255,0.15); padding: 0.8rem;">
              <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: var(--cmd-amber); margin-bottom: 0.4rem;">RAW DATA EXPORT:</div>
              <textarea id="sync-backup-text" readonly style="width: 100%; height: 80px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: var(--cmd-green); font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; padding: 0.4rem; resize: none; margin-bottom: 0.5rem;"></textarea>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <button id="btn-sync-backup-copy" style="background: none; border: 1px solid var(--cmd-amber); color: var(--cmd-amber); font-family: 'Orbitron', sans-serif; font-size: 0.65rem; cursor: pointer;">COPY DATA</button>
                <button id="btn-sync-backup-import-toggle" style="background: none; border: none; color: var(--cmd-purple); font-family: 'Orbitron', sans-serif; font-size: 0.65rem; cursor: pointer;">IMPORT MODE</button>
                <button id="btn-sync-backup-close" style="background: none; border: none; color: #888; font-family: 'Orbitron', sans-serif; font-size: 0.65rem; cursor: pointer;">CLOSE</button>
              </div>
            </div>
    
            <div id="sync-import-view" style="display: none; background: rgba(0, 0, 0, 0.7); border: 1px solid var(--cmd-purple); padding: 0.8rem;">
              <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: var(--cmd-purple); margin-bottom: 0.4rem;">PASTE BACKUP DATA TO IMPORT:</div>
              <textarea id="sync-import-text" style="width: 100%; height: 80px; background: rgba(0,0,0,0.5); border: 1px solid rgba(188,19,254,0.3); color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; padding: 0.4rem; resize: none; margin-bottom: 0.5rem;"></textarea>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <button id="btn-sync-import-run" style="background: none; border: solid 1px var(--cmd-purple); color: var(--cmd-purple); font-family: 'Orbitron', sans-serif; font-size: 0.65rem; padding: 0.2rem 0.5rem; cursor: pointer; font-weight: bold;">APPLY IMPORT</button>
                <button id="btn-sync-import-close" style="background: none; border: none; color: #888; font-family: 'Orbitron', sans-serif; font-size: 0.65rem; cursor: pointer;">CANCEL</button>
              </div>
            </div>
    
            <!-- ログ表示エリア -->
            <div>
              <div style="font-family: 'Orbitron', sans-serif; font-size: 0.62rem; color: rgba(0, 255, 102, 0.5); margin-bottom: 0.3rem;">SYSTEM DEPLOYMENT LOGS:</div>
              <div id="sync-log" style="font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: rgba(0, 255, 102, 0.75); background: rgba(0, 5, 0, 0.75); padding: 0.5rem; border: 1px solid rgba(0, 255, 102, 0.15); height: 100px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // アコーディオンの開閉処理
    const toggleBtn = document.getElementById('btn-toggle-console-dock');
    const dockContent = document.getElementById('console-dock-content');
    const dockIndicator = document.getElementById('console-dock-indicator');
    
    if (toggleBtn && dockContent && dockIndicator) {
      toggleBtn.addEventListener('click', () => {
        if (dockContent.style.display === 'none') {
          dockContent.style.display = 'flex';
          dockIndicator.textContent = 'ACTIVE';
          dockIndicator.style.color = 'var(--cmd-green)';
          toggleBtn.querySelector('span').textContent = '[▼] ADVANCED CONSOLE DOCK';
        } else {
          dockContent.style.display = 'none';
          dockIndicator.textContent = 'COLLAPSED';
          dockIndicator.style.color = '#888';
          toggleBtn.querySelector('span').textContent = '[▶] ADVANCED CONSOLE DOCK';
        }
      });
    }

    // カレンダー設定のインポート処理
    const importCgBtn = document.getElementById('btn-sync-import-cg');
    if (importCgBtn) {
      importCgBtn.addEventListener('click', () => {
        const cgKey = localStorage.getItem('cg_jb_key') || '';
        const cgBlob = localStorage.getItem('dt_chrono_grid_blob') || '';
        
        if (!cgKey && !cgBlob) {
          log("NO CHRONO_GRID CONFIG FOUND IN LOCALSTORAGE.");
          alert("カレンダーの同期設定がブラウザに見つかりません。先にカレンダー側で同期設定を保存してください。");
          return;
        }
        
        if (cgKey) {
          localStorage.setItem('cg_jb_key', cgKey.trim());
          log("CHRONO_GRID API KEY IMPORTED.");
        }
        
        log("INTEGRATION SUCCESSFUL. READY FOR DEPLOY.");
        alert("カレンダーの設定（APIキー）を時間割同期モジュールに正常にインポートしました。");
        window.location.reload();
      });
    }

    // イベントバインディング
    document.getElementById('btn-sync-generate').addEventListener('click', async () => {
      if (confirm("同期用保管庫（Vault）を作成し、クラウド同期を開始しますか？")) {
        try {
          log("CREATING SECURE CLOUD VAULT...");
          
          let localData = {};
          try {
            localData = JSON.parse(localStorage.getItem(config.storageKey)) || {};
          } catch(e) {
            localData = {};
          }
          
          const newId = await createRemoteVault(localData);
          blobId = newId;
          localStorage.setItem(BLOB_KEY, blobId);
          if (window.PWAConfigSync) {
            await window.PWAConfigSync.syncAppBinId('timetable', blobId);
          }
          
          updateUI();
          log(`NEW VAULT LINKED: ${blobId}`);
          await syncProcess();
          startAutoSync();
        } catch(e) {
          log(`VAULT CREATION FAILED: ${e.message}`);
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
      const inputVal = document.getElementById('sync-key-input').value.trim();
      if (!inputVal) {
        alert("Vault IDを入力してください。");
        return;
      }
      if (confirm("このVault IDでクラウドに接続し、同期しますか？")) {
        blobId = inputVal;
        localStorage.setItem(BLOB_KEY, blobId);
        if (window.PWAConfigSync) {
          await window.PWAConfigSync.syncAppBinId('timetable', blobId);
        }
        updateUI();
        log(`VAULT SELECTED: ${blobId}`);
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
        log("VAULT ID COPIED TO CLIPBOARD.");
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
        localStorage.removeItem(BLOB_KEY);
        blobId = null;
        updateUI();
        log("SYNC PROTOCOL TERMINATED.");
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
        log("RAW DATA COPIED.");
      }).catch(err => {
        log("COPY FAILED: " + err.message);
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
        alert("データが入力されていません。");
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
          log("MANUAL IMPORT SUCCESSFUL. RELOADING PAGE.");
          window.location.reload();
        }
      } catch(e) {
        alert("インポート失敗: " + e.message);
      }
    });
  }

  // 同期処理へのデバウンス (Chrono Grid に合わせ、タイピング時は 1秒間静止後に集約アップロード)
  let uploadDebounceTimer = null;
  function triggerUpload(data) {
    if (!blobId) return;
    
    log("PENDING UPLOAD (DEBOUNCING)...");
    
    if (uploadDebounceTimer) clearTimeout(uploadDebounceTimer);
    
    uploadDebounceTimer = setTimeout(async () => {
      try {
        log("EXECUTING DEBOUNCED UPLOAD...");
        await uploadToCloud(data);
      } catch(e) {
        log(`DEBOUNCED UPLOAD FAILED: ${e.message}`);
      }
    }, 1000);
  }

  // 初期化関数
  async function init(options) {
    if (options) {
      if (options.storageKey) config.storageKey = options.storageKey;
      if (options.onSyncComplete) config.onSyncComplete = options.onSyncComplete;
    }
    
    if (window.PWAConfigSync) {
      blobId = await window.PWAConfigSync.syncAppBinId('timetable', blobId);
      if (blobId) {
        localStorage.setItem(BLOB_KEY, blobId);
      }
    }

    injectSyncPanelHTML();
    updateUI();
    
    if (blobId) {
      log(`ESTABLISHED CONNECTION WITH VAULT ID: ${blobId.substring(0, 15)}...`);
      syncProcess();
      startAutoSync();
    }
  }

  return {
    init: init,
    triggerUpload: triggerUpload
  };
})();

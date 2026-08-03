// DtSync グローバルオブジェクト (jsonbin.io スマートマージ同期)
window.DtSync = (() => {
  const BACKUP_KEY = 'dt_subject_progress_data_backup';
  const BLOB_KEY = 'dt_timetable_sync_blob'; // localStorage に保存するBlob IDキー
  
  // Chrono Grid と共通の jsonbin.io マスターキーを取得、無ければデフォルト
  const JB_KEY_DEFAULT = '$2a$10$C0Z.Fl3F.BCvUaC5rHVt3OD6aYt8SXRkmXExr3mfmtCrGdDzG8Aae';
  
  function getJbKey() {
    // 優先度: PWAConfigSync(shared_jsonbin_api_key) → cg_jb_key(カレンダー) → デフォルト
    if (window.PWAConfigSync) {
      const sharedKey = window.PWAConfigSync.getApiKey();
      // デフォルトキーしか返ってこない場合、cg_jb_keyにカレンダーの有効なキーがあるかもしれない
      if (sharedKey && sharedKey !== JB_KEY_DEFAULT) {
        return sharedKey;
      }
    }
    const cgKey = localStorage.getItem('cg_jb_key');
    if (cgKey && cgKey.trim()) {
      // カレンダーの有効なキーが見つかったらPWAConfigSyncにも同期しておく
      if (window.PWAConfigSync) {
        window.PWAConfigSync.setApiKey(cgKey.trim());
      }
      return cgKey.trim();
    }
    return JB_KEY_DEFAULT;
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
        if (response.status === 403) {
          log("ACCESS FORBIDDEN (403). CLEARING EXPIRED VAULT KEY FOR AUTO-RECOVERY...");
          localStorage.removeItem(BLOB_KEY);
          blobId = null;
          if (window.PWAConfigSync) {
            await window.PWAConfigSync.syncAppBinId('timetable', null);
          }
          setTimeout(() => { window.location.reload(); }, 300);
        }
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
        timeEl.className = 'apple-status-val';
      }
    } catch(e) {
      log(`SYNC FAILED: ${e.message}`);
      
      const statusEl = document.getElementById('sync-status');
      if (statusEl) {
        statusEl.textContent = `エラー`;
        statusEl.className = 'apple-status-val offline blink-error';
      }
      
      const container = document.getElementById('cyber-sync-panel');
      if (container) {
        container.style.transition = 'all 0.15s ease-out';
        container.style.borderColor = 'var(--apple-red)';
        container.style.boxShadow = '0 0 30px rgba(255, 59, 48, 0.35)';
        setTimeout(() => {
          container.style.borderColor = 'var(--apple-border)';
          container.style.boxShadow = '0 8px 40px rgba(0, 0, 0, 0.3)';
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
    const topBadge = document.getElementById('sync-badge-top');

    if (statusEl) {
      statusEl.classList.remove('blink-error', 'offline', 'online', 'syncing');
    }
    if (topBadge) {
      topBadge.classList.remove('badge-ok', 'badge-err');
    }

    if (blobId) {
      if (statusEl) {
        statusEl.textContent = '同期中';
        statusEl.className = 'apple-status-val online';
      }
      if (cryptoEl) {
        cryptoEl.textContent = '有効 (JSONBIN)';
        cryptoEl.className = 'apple-status-val online';
      }
      if (initView) initView.style.display = 'none';
      if (inputView) inputView.style.display = 'none';
      if (activeView) activeView.style.display = 'block';
      if (keyDisplay) keyDisplay.value = blobId;
      
      if (topBadge) {
        topBadge.textContent = '● SYNCED';
        topBadge.classList.add('badge-ok');
      }
    } else {
      if (statusEl) {
        statusEl.textContent = '未接続';
        statusEl.className = 'apple-status-val offline';
      }
      if (cryptoEl) {
        cryptoEl.textContent = '無効';
        cryptoEl.className = 'apple-status-val val-inactive';
      }
      if (initView) initView.style.display = 'block';
      if (inputView) inputView.style.display = 'none';
      if (activeView) activeView.style.display = 'none';
      if (keyDisplay) keyDisplay.value = '';

      if (topBadge) {
        topBadge.textContent = '◌ OFFLINE';
        topBadge.classList.add('badge-err');
      }
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
    // ヘッダーへの同期バッジ動的インジェクション
    const titleRow = document.querySelector('.cmd-title-row');
    if (titleRow && !document.getElementById('sync-badge-top')) {
      const badgeSpan = document.createElement('span');
      badgeSpan.id = 'sync-badge-top';
      badgeSpan.style.cssText = 'cursor: pointer; font-size: 11px; padding: 3px 8px; border-radius: 12px; font-weight: bold; font-family: "Orbitron", sans-serif; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: #888; transition: all 0.2s;';
      badgeSpan.textContent = '◌ OFFLINE';
      
      // クリックで手動同期を実行
      badgeSpan.addEventListener('click', async () => {
        if (!blobId) {
          if (confirm("時間割の同期保管庫を新しく作成して同期を開始しますか？")) {
            log("CREATING NEW VAULT VIA BADGE CLICK...");
            try {
              let localData = {};
              try {
                const raw = localStorage.getItem(config.storageKey);
                if (raw) localData = JSON.parse(raw);
              } catch(e) {}
              const newId = await createRemoteVault(localData);
              blobId = newId;
              localStorage.setItem(BLOB_KEY, newId);
              if (window.PWAConfigSync) {
                await window.PWAConfigSync.syncAppBinId('timetable', newId);
              }
              log(`NEW VAULT CREATED: ${newId}`);
              updateUI();
              syncProcess();
              startAutoSync();
            } catch(e) {
              alert("作成失敗: " + e.message);
            }
          }
        } else {
          log("FORCE SYNC TRIGGERED BY BADGE CLICK...");
          syncProcess();
        }
      });
      titleRow.appendChild(badgeSpan);
    }

    const container = document.getElementById('cyber-sync-panel');
    if (!container) return;

    container.className = 'apple-sync-panel';
    
    container.innerHTML = `
      <div class="apple-sync-header">
        <h2 class="apple-sync-title">クラウド同期設定</h2>
      </div>
      <div class="apple-sync-body">
        <!-- ステータス表示 -->
        <div class="apple-sync-status-row">
          <div class="apple-status-item">接続状況: <span id="sync-status" class="apple-status-val offline">未接続</span></div>
          <div class="apple-status-item">暗号化: <span id="sync-crypto" class="apple-status-val val-inactive">無効</span></div>
          <div class="apple-status-item">最終更新: <span id="sync-time" class="apple-status-val val-time">-</span></div>
        </div>
        
        <!-- 未同期時の表示 -->
        <div id="sync-init-view" style="display: block;">
          <p class="apple-sync-desc">
            クラウドと同期されていません。新規保管庫を作成するか、既存の保管庫に接続してください。
          </p>
          <div class="apple-btn-grid">
            <button class="apple-btn apple-btn-accent" id="btn-sync-generate">
              新規保管庫の作成
            </button>
            <button class="apple-btn apple-btn-secondary" id="btn-sync-link">
              既存の保管庫に接続
            </button>
            <button class="apple-btn apple-btn-secondary" id="btn-sync-import-cg" style="grid-column: span 2;">
              タスクカレンダーの設定から同期を適用
            </button>
          </div>
        </div>

        <!-- キー入力エリア -->
        <div id="sync-input-view" style="display: none;">
          <label class="apple-input-label">接続する保管庫のID（BIN ID）を入力してください:</label>
          <div class="apple-input-group">
            <input type="text" id="sync-key-input" class="apple-text-input" placeholder="Bin ID を入力">
            <button class="apple-btn apple-btn-accent" id="btn-sync-connect">
              接続
            </button>
          </div>
          <div style="margin-top: 0.8rem; text-align: right;">
            <button id="btn-sync-cancel" class="apple-link-btn">キャンセル</button>
          </div>
        </div>

        <!-- 同期有効化時の表示 -->
        <div id="sync-active-view" style="display: none;">
          <div class="apple-vault-card">
            <div class="apple-vault-label">接続中の BIN ID:</div>
            <div class="apple-vault-row">
              <input type="password" id="sync-key-display" readonly class="apple-vault-input" value="">
              <div class="apple-vault-actions">
                <button id="btn-sync-toggle-show" class="apple-btn apple-btn-small">表示</button>
                <button id="btn-sync-copy" class="apple-btn apple-btn-small">コピー</button>
              </div>
            </div>
          </div>
          <div class="apple-btn-grid">
            <button class="apple-btn apple-btn-accent" id="btn-sync-now">
              今すぐ手動同期
            </button>
            <button class="apple-btn apple-btn-danger" id="btn-sync-disconnect">
              同期を解除
            </button>
          </div>
        </div>
        
        <!-- アコーディオン式ドック -->
        <div class="apple-console-section">
          <button id="btn-toggle-console-dock" class="apple-console-toggle">
            <span>[▶] 詳細設定 / システムログ</span>
            <span id="console-dock-indicator">COLLAPSED</span>
          </button>
          
          <div id="console-dock-content" style="display: none;">
            <div class="apple-console-row">
              <span class="apple-console-desc">DATA INTEGRITY SECURITY PROTOCOL</span>
              <button id="btn-sync-backup-export" class="apple-btn apple-btn-small">
                手動データバックアップ
              </button>
            </div>
    
            <div id="sync-backup-view" style="display: none;" class="apple-raw-view">
              <div class="apple-raw-title">エクスポートされたRAWデータ:</div>
              <textarea id="sync-backup-text" readonly class="apple-raw-textarea"></textarea>
              <div class="apple-raw-actions">
                <button id="btn-sync-backup-copy" class="apple-btn apple-btn-small">データをコピー</button>
                <button id="btn-sync-backup-import-toggle" class="apple-btn apple-btn-small">インポートに切替</button>
                <button id="btn-sync-backup-close" class="apple-btn apple-btn-small">閉じる</button>
              </div>
            </div>
    
            <div id="sync-import-view" style="display: none;" class="apple-raw-view">
              <div class="apple-raw-title">インポートするRAWデータを貼り付けてください:</div>
              <textarea id="sync-import-text" class="apple-raw-textarea"></textarea>
              <div class="apple-raw-actions">
                <button id="btn-sync-import-run" class="apple-btn apple-btn-small apple-btn-accent">適用</button>
                <button id="btn-sync-import-close" class="apple-btn apple-btn-small">キャンセル</button>
              </div>
            </div>
    
            <!-- ログ表示エリア -->
            <div class="apple-log-section">
              <div class="apple-log-title">システム同期ログ:</div>
              <div id="sync-log" class="apple-log-textarea"></div>
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

    // 自動保管庫作成 (他ツールとの挙動統一)
    if (!blobId) {
      log("NO VAULT ID DETECTED. ATTEMPTING AUTOMATIC VAULT CREATION...");
      try {
        let localData = {};
        try {
          const raw = localStorage.getItem(config.storageKey);
          if (raw) localData = JSON.parse(raw);
        } catch(e) {}
        const newId = await createRemoteVault(localData);
        blobId = newId;
        localStorage.setItem(BLOB_KEY, newId);
        if (window.PWAConfigSync) {
          await window.PWAConfigSync.syncAppBinId('timetable', newId);
        }
        log(`AUTOMATIC VAULT CREATED: ${newId}`);
      } catch(e) {
        log(`AUTOMATIC VAULT CREATION FAILED: ${e.message}`);
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

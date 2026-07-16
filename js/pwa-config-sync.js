/**
 * PWA Config Sync Manager
 * LocalStorageとJSONBinのマスターBinを利用して、同一Origin内の複数PWA間でAPIキーや各Bin IDを同期します。
 */
(function() {
  const MASTER_BIN_KEY = 'shared_master_bin_id';
  const API_KEY_KEY = 'shared_jsonbin_api_key';
  const BINS_CACHE_KEY = 'shared_pwa_bins_cache';
  
  // 各ツール名と、対応する個別LocalStorage同期用キー
  const APP_KEYS_MAP = {
    manga: 'ms_blob_id',
    novel: 'ns_blob_id',
    movie: 'mt_blob_id',
    feeding: 'dt_feeding_log_bin_id',
    timetable: 'dt_timetable_sync_blob',
    diary: 'sd_gaman_sync_key',
    task_calendar: 'dt_task_cal_bin_id',
    calendar: 'dt_chrono_grid_blob',
    report_card: 'sd_academic_sync_key',
    deadline: 'dt_deadline_blob_id',
    tasklist: 'dt_tasks_blob',
    payment: 'dt_pay_blob',
    vocal_range: 'dt_vocal_range_blob',
    library: 'dt_library_blob'
  };
  
  // デフォルトのマスターAPIキー (公開されてもデータ破壊は起きないよう基本的には個人の読み書き用)
  const DEFAULT_API_KEY = '$2a$10$iVNuU6AA4DGWLiU8/Gl.oOIvr166q/dgd995DrQ1ziA/9eSq7Fh7q';

  window.PWAConfigSync = {
    APP_KEYS_MAP, // 外部公開
    // マスターBin IDを取得
    getMasterBinId() {
      return localStorage.getItem(MASTER_BIN_KEY) || '';
    },

    // マスターBin IDを設定
    setMasterBinId(id) {
      if (id) {
        localStorage.setItem(MASTER_BIN_KEY, id.trim());
      } else {
        localStorage.removeItem(MASTER_BIN_KEY);
      }
      window.dispatchEvent(new Event('storage'));
    },

    // APIキーを取得 (未設定ならデフォルトキーを返す)
    getApiKey() {
      return localStorage.getItem(API_KEY_KEY) || DEFAULT_API_KEY;
    },

    // APIキーを設定
    setApiKey(key) {
      if (key) {
        localStorage.setItem(API_KEY_KEY, key.trim());
      } else {
        localStorage.removeItem(API_KEY_KEY);
      }
      window.dispatchEvent(new Event('storage'));
    },

    // キャッシュされたすべての Bin ID マップを取得
    getBinsMap() {
      const map = {};
      try {
        const cache = localStorage.getItem(BINS_CACHE_KEY);
        if (cache) Object.assign(map, JSON.parse(cache));
      } catch (e) {}

      // 各アプリの実際のLocalStorageに入っているIDをスキャンして反映
      for (const [appKey, lsKey] of Object.entries(APP_KEYS_MAP)) {
        const val = localStorage.getItem(lsKey);
        if (val && val !== 'local' && val !== 'undefined' && val !== 'null' && val.trim() !== '') {
          map[appKey] = val.trim();
        }
      }
      return map;
    },

    // キャッシュされた特定のアプリ of Bin ID を取得
    getCachedBinId(appKey) {
      return this.getBinsMap()[appKey] || null;
    },

    // キャッシュに特定のアプリ of Bin ID を設定
    setCachedBinId(appKey, binId) {
      try {
        const map = this.getBinsMap();
        if (binId) {
          map[appKey] = binId;
        } else {
          delete map[appKey];
        }
        localStorage.setItem(BINS_CACHE_KEY, JSON.stringify(map));
        window.dispatchEvent(new Event('storage'));
      } catch (e) {
        console.error("Failed to cache bin ID:", e);
      }
    },

    // リモートのマスターBinからデータを同期する
    async fetchMasterConfig() {
      const masterBinId = this.getMasterBinId();
      const apiKey = this.getApiKey();
      if (!masterBinId) return null;

      try {
        const res = await fetch(`https://api.jsonbin.io/v3/b/${masterBinId}/latest`, {
          headers: { 'X-Master-Key': apiKey },
          cache: 'no-store'
        });
        if (!res.ok) throw new Error(`Fetch master bin failed: ${res.status}`);
        const data = await res.json();
        
        const record = data.record || {};
        const remoteBins = record.bins || {};
        
        // ローカルの既存キャッシュとマージする (リモート優先)
        const localBins = this.getBinsMap();
        const mergedBins = { ...localBins, ...remoteBins };
        
        localStorage.setItem(BINS_CACHE_KEY, JSON.stringify(mergedBins));

        // 各アプリのLocalStorageキーにそれぞれのIDを配信
        for (const [appKey, lsKey] of Object.entries(APP_KEYS_MAP)) {
          if (mergedBins[appKey]) {
            localStorage.setItem(lsKey, mergedBins[appKey]);
          }
        }
        
        if (record.apiKey && record.apiKey !== DEFAULT_API_KEY) {
          this.setApiKey(record.apiKey);
        }
        
        window.dispatchEvent(new Event('storage'));
        return mergedBins;
      } catch (e) {
        console.error("Failed to fetch master config from JSONBin:", e);
        return null;
      }
    },

    // ローカルのキャッシュをリモートのマスターBinに保存する
    async pushMasterConfig() {
      const masterBinId = this.getMasterBinId();
      const apiKey = this.getApiKey();
      const bins = this.getBinsMap();
      
      const payload = {
        bins: bins,
        apiKey: apiKey === DEFAULT_API_KEY ? "" : apiKey, // デフォルトキーの場合は保存しない
        updatedAt: new Date().toISOString()
      };

      try {
        if (masterBinId) {
          // 既存マスターBinの更新 (PUT)
          const res = await fetch(`https://api.jsonbin.io/v3/b/${masterBinId}`, {
            method: 'PUT',
            headers: {
              'X-Master-Key': apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error(`Push master config failed: ${res.status}`);
          return masterBinId;
        } else {
          // マスターBinの新規作成 (POST)
          const res = await fetch('https://api.jsonbin.io/v3/b', {
            method: 'POST',
            headers: {
              'X-Master-Key': apiKey,
              'Content-Type': 'application/json',
              'X-Bin-Name': 'pwa_master_config',
              'X-Bin-Private': 'true'
            },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error(`Create master config failed: ${res.status}`);
          const data = await res.json();
          const newId = data.metadata.id;
          this.setMasterBinId(newId);
          return newId;
        }
      } catch (e) {
        console.error("Failed to push master config to JSONBin:", e);
        throw e;
      }
    },

    // アプリのIDを同期する (起動時や設定変更時に呼び出し)
    async syncAppBinId(appKey, currentBinId) {
      const cached = this.getCachedBinId(appKey);
      
      const isCurrentValid = currentBinId && 
                             currentBinId !== 'local' && 
                             currentBinId !== 'undefined' && 
                             currentBinId !== 'null' && 
                             currentBinId.trim() !== '';
      
      // 1. 新しいIDがアプリ側で生成または入力され、キャッシュと異なる場合
      if (isCurrentValid && currentBinId !== cached) {
        this.setCachedBinId(appKey, currentBinId);
        
        // マスターBinが存在するならリモートへプッシュ
        if (this.getMasterBinId()) {
          try {
            await this.pushMasterConfig();
          } catch (e) {
            console.warn("Could not push new app bin ID to master config, saved locally.");
          }
        }
        return currentBinId;
      }
      
      // 2. アプリ側に有効なIDがなく、キャッシュ側にIDがある場合はキャッシュの値を優先適用
      if (!isCurrentValid && cached) {
        return cached;
      }

      return currentBinId;
    }
  };
})();

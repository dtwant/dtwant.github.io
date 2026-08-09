(() => {
  'use strict';

  const DB_NAME = 'sd_report_db';
  const DB_VERSION = 1;
  const APP_NAME = 'AcademicReport';
  const DATA_VERSION = 2;
  const ACADEMIC_PROFILE = Object.freeze({
    id: 'kagoshima-kosen-50-2026-information-15',
    academicYear: 2026,
    grade: 2
  });
  const BIN_URL = 'https://api.jsonbin.io/v3/b';
  const SYLLAGET_PAGE = 'https://syllaget.crystaworld.dev/schools/50/2026/15';
  const SYLLAGET_DETAIL = 'https://syllaget-api.crystaworld.dev/api/schools/50/details/2026/15/';
  const REFERENCE_DATE = '2026-08-09';
  const SEMESTERS = ['first', 'second'];
  const SEMESTER_LABELS = { first: '前期', second: '後期' };
  const PERIOD_LABELS = { first: '前期', second: '後期', full: '通年' };
  const KIND_LABELS = {
    exam: '試験',
    assignment: '提出物・レポート',
    quiz: '小テスト',
    presentation: '発表',
    participation: '平常点・取組',
    other: 'その他'
  };
  const STATUS_LABELS = {
    done: '提出済み',
    missing: '未提出',
    late: '遅延提出',
    exempt: '評価対象外'
  };
  const MIDTERM_EVIDENCE = {
    '0029': 'explicit', '0032': 'explicit', '0033': 'explicit', '0036': 'explicit',
    '0037': 'explicit', '0043': 'explicit', '0045': 'explicit', '0046': 'explicit',
    '0047': 'explicit', '0048': 'explicit', '0052': 'explicit',
    '0027': 'inferred', '0034': 'inferred', '0035': 'inferred', '0042': 'inferred'
  };

  const category = (id, name, weight, kind, extra = {}) => ({ id, name, weight, kind, ...extra });
  const preset = (code, name, credits, period, midtermPolicy, categories, note = '') => ({
    code,
    name,
    credits,
    period,
    midtermPolicy,
    categories,
    note,
    midtermEvidence: MIDTERM_EVIDENCE[code] || 'unknown',
    sourceUrl: `${SYLLAGET_DETAIL}${code}`
  });

  // 2026年度 鹿児島高専 情報工学科2年。保健体育の別クラス0028は0027に集約。
  // Syllagetは本サイトOriginからのAPIアクセスを許可しないため、出典日付きで静的収録する。
  const SYLLABUS_PRESETS = [
    preset('0027', '保健体育Ⅱ', 2, 'full', 'none', [
      category('skill', '技能', 30, 'other'),
      category('sport_test', 'スポーツテスト', 30, 'other'),
      category('participation', '態度・意欲', 30, 'participation'),
      category('report', 'レポート', 10, 'assignment')
    ], '定期試験によらない各種評価'),
    preset('0029', '英語論理・表現基礎', 1, 'second', 'none', [
      category('exam', '試験', 50, 'exam', { examRole: 'final' }),
      category('presentation', '授業内発表', 50, 'presentation')
    ], 'シラバスに「中間試験は実施しない」と明記'),
    preset('0030', '国語表現', 1, 'first', 'unknown', [
      category('exam', '試験', 40, 'exam'),
      category('report', '提出物レポート', 25, 'assignment'),
      category('quiz', '小テスト', 35, 'quiz')
    ]),
    preset('0031', '倫理Ⅰ', 1, 'first', 'unknown', [
      category('exam', '試験', 70, 'exam'),
      category('other', 'その他', 30, 'assignment')
    ], 'レポート課題を含む'),
    preset('0032', '英語ⅡＡ', 2, 'first', 'held', [
      category('exam', '試験', 60, 'exam'),
      category('quiz', '小テスト', 10, 'quiz'),
      category('participation', '平常点', 30, 'participation')
    ], '中間試験の実施を明記'),
    preset('0033', '英語ⅡB', 2, 'second', 'held', [
      category('exam', '試験', 60, 'exam'),
      category('quiz', '小テスト', 10, 'quiz'),
      category('participation', '平常点', 30, 'participation')
    ], '中間試験の実施を明記'),
    preset('0034', '工学実習Ⅰ', 2, 'first', 'none', [
      category('presentation', '発表', 30, 'presentation'),
      category('report', 'レポート', 70, 'assignment')
    ], '試験0%'),
    preset('0035', '工学実習Ⅱ', 2, 'second', 'none', [
      category('report_content', '実習レポート内容', 20, 'assignment'),
      category('consideration', '検討課題内容', 20, 'assignment'),
      category('report_submission', '実習レポート提出', 30, 'assignment'),
      category('participation', '実習の取り組み方', 30, 'participation')
    ], '試験によらない実習評価'),
    preset('0036', '情報処理Ⅱ', 2, 'full', 'alternative', [
      category('exam', '試験', 100, 'exam')
    ], '通常の中間試験に代えて単元ごとの試験を実施'),
    preset('0037', '論理回路Ⅰ', 1, 'first', 'held', [
      category('exam_final', '定期試験', 50, 'exam', { examRole: 'final' }),
      category('exam_mid', '中間試験', 50, 'exam', { examRole: 'mid' })
    ]),
    preset('0038', '電気電子工学概論', 1, 'first', 'unknown', [
      category('exam', '試験', 50, 'exam'),
      category('report', 'レポート', 20, 'assignment'),
      category('quiz', '小テスト', 30, 'quiz')
    ]),
    preset('0039', '電子計算機ⅠA', 1, 'second', 'unknown', [
      category('exam', '試験', 40, 'exam'),
      category('quiz', '小テスト', 25, 'quiz'),
      category('report', 'レポート', 20, 'assignment'),
      category('participation', '平常点', 15, 'participation')
    ]),
    preset('0040', '古典探求', 1, 'second', 'unknown', [
      category('exam', '定期試験', 40, 'exam'),
      category('quiz', '小テスト', 35, 'quiz'),
      category('report', '提出物レポート', 25, 'assignment')
    ]),
    preset('0041', '倫理Ⅱ', 1, 'second', 'unknown', [
      category('exam', '試験', 60, 'exam'),
      category('summary_print', '授業まとめプリント', 10, 'assignment'),
      category('minute_paper', 'ミニッツペーパー', 10, 'participation'),
      category('report', 'レポート', 20, 'assignment')
    ]),
    preset('0042', 'リベラルアーツⅠ', 1, 'first', 'none', [
      category('presentation', '発表', 40, 'presentation'),
      category('assignment', '提出物', 45, 'assignment'),
      category('survey', 'アンケート', 15, 'other')
    ], '試験0%'),
    preset('0043', '線形代数２', 1, 'second', 'held', [
      category('exam', '中間・期末試験', 75, 'exam'),
      category('assignment', '小テスト・課題等', 25, 'assignment')
    ]),
    preset('0044', '物理ⅡB', 1, 'second', 'unknown', [
      category('exam', '試験', 70, 'exam'),
      category('other', 'その他', 30, 'other')
    ]),
    preset('0045', '論理回路Ⅱ', 1, 'second', 'held', [
      category('exam_final', '定期試験', 50, 'exam', { examRole: 'final' }),
      category('exam_mid', '中間試験', 50, 'exam', { examRole: 'mid' })
    ]),
    preset('0046', '微分積分１', 2, 'first', 'held', [
      category('exam', '中間・期末試験', 75, 'exam'),
      category('assignment', '小テスト・課題等', 25, 'assignment')
    ]),
    preset('0047', '微分積分２', 2, 'second', 'held', [
      category('exam', '中間・期末試験', 75, 'exam'),
      category('assignment', '小テスト・課題等', 25, 'assignment')
    ]),
    preset('0048', '線形代数１', 1, 'first', 'held', [
      category('exam', '中間・期末試験', 75, 'exam'),
      category('assignment', '小テスト・課題等', 25, 'assignment')
    ]),
    preset('0049', '物理ⅡA', 2, 'first', 'unknown', [
      category('exam', '試験', 70, 'exam'),
      category('other', 'その他', 30, 'other')
    ]),
    preset('0050', '化学Ⅲ', 1, 'first', 'unknown', [
      category('exam', '試験', 70, 'exam'),
      category('other', 'その他', 30, 'other')
    ]),
    preset('0051', '化学Ⅳ', 1, 'second', 'unknown', [
      category('exam', '試験', 70, 'exam'),
      category('other', 'その他', 30, 'other')
    ]),
    preset('0052', '自然科学', 2, 'full', 'held', [
      category('exam', '試験', 70, 'exam'),
      category('other', 'その他', 30, 'other')
    ], '中間試験の実施を明記')
  ];

  const LEGACY_ID_TO_CODE = {
    health_pe_2: '0027',
    japanese_exp: '0030',
    ethics_1: '0031',
    english_2a: '0032',
    english_2b: '0033',
    eng_practice_1: '0034',
    eng_practice_2: '0035',
    info_proc_2: '0036',
    logic_cir_1: '0037',
    elec_intro: '0038',
    comp_arch_1a: '0039',
    ethics_2: '0041',
    liberal_1: '0042',
    linear_alg_2: '0043',
    physics_2b: '0044',
    logic_cir_2: '0045',
    diff_calc_1: '0046',
    diff_calc_2: '0047',
    linear_alg_1: '0048',
    physics_2a: '0049',
    chemistry_3: '0050',
    chemistry_4: '0051',
    nat_science: '0052'
  };

  const DEFAULT_SETTINGS = {
    schemaVersion: DATA_VERSION,
    profileId: ACADEMIC_PROFILE.id,
    scheme: 'old',
    academicYear: ACADEMIC_PROFILE.academicYear,
    grade: ACADEMIC_PROFILE.grade,
    currentSemester: 'first',
    initialized: false,
    dataUpdatedAt: 0,
    lastSyncAt: 0,
    tombstones: { subjects: {}, items: {} }
  };

  const state = {
    db: null,
    settings: structuredCloneSafe(DEFAULT_SETTINGS),
    syncConfig: { key: '', binId: '', syncEnabled: false, disconnected: false },
    subjects: [],
    grades: {},
    semester: 'first',
    subjectFilter: 'current',
    subjectSearch: '',
    selectedSubjectId: null,
    selectedPresets: new Set(),
    subjectModalTab: 'preset',
    syncTimer: null,
    syncQueue: Promise.resolve(),
    pendingCloudSync: false,
    pendingSyncRender: false,
    migrationChanged: false,
    confirmAction: null,
    dialogFocus: new WeakMap()
  };

  function structuredCloneSafe(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cleanNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function uid(prefix) {
    if (crypto && typeof crypto.randomUUID === 'function') return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[・･\s_\-]/g, '')
      .replace(/ⅰ/g, 'i')
      .replace(/ⅱ/g, 'ii');
  }

  function inferCategoryKind(categoryValue) {
    if (categoryValue && KIND_LABELS[categoryValue.kind]) return categoryValue.kind;
    const text = normalizeName(`${categoryValue?.id || ''}${categoryValue?.name || ''}`);
    if (/exam|試験/.test(text)) return 'exam';
    if (/report|assignment|提出|課題|レポート|プリント/.test(text)) return 'assignment';
    if (/quiz|小テスト|テスト/.test(text)) return 'quiz';
    if (/presentation|発表|スピーチ/.test(text)) return 'presentation';
    if (/participation|平常|態度|意欲|取組|取り組み/.test(text)) return 'participation';
    return 'other';
  }

  function normalizeCategory(value, index = 0) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      ...source,
      id: String(source.id || `cat_${index}_${Date.now()}`),
      name: String(source.name || `評価項目 ${index + 1}`),
      weight: clamp(cleanNumber(source.weight, 0), 0, 100),
      kind: inferCategoryKind(source)
    };
  }

  function normalizeSubject(value, index = 0) {
    const source = value && typeof value === 'object' ? value : {};
    const categories = Array.isArray(source.categories)
      ? source.categories.map(normalizeCategory)
      : defaultCategories();
    const midtermPolicies = source.midtermPolicies && typeof source.midtermPolicies === 'object'
      ? { ...source.midtermPolicies }
      : {};
    if (source.midtermPolicy) {
      SEMESTERS.forEach(term => {
        if (!midtermPolicies[term]) midtermPolicies[term] = source.midtermPolicy;
      });
    }
    return {
      ...source,
      id: String(source.id || uid(`subject_${index}`)),
      name: String(source.name || '名称未設定'),
      credits: clamp(cleanNumber(source.credits, 1), 0, 20),
      period: ['first', 'second', 'full'].includes(source.period) ? source.period : 'full',
      categories,
      midtermPolicies,
      midtermUserOverrides: source.midtermUserOverrides && typeof source.midtermUserOverrides === 'object'
        ? { ...source.midtermUserOverrides }
        : {},
      gpaEligible: source.gpaEligible !== false,
      gpaExclusionReason: String(source.gpaExclusionReason || ''),
      schemaVersion: DATA_VERSION
    };
  }

  function defaultCategories() {
    return [
      category('exam', '試験', 60, 'exam'),
      category('report', '提出物・レポート', 30, 'assignment'),
      category('quiz', '小テスト', 10, 'quiz')
    ];
  }

  function findPresetForSubject(subject) {
    const code = subject?.syllabusCode || LEGACY_ID_TO_CODE[subject?.id];
    if (code) return SYLLABUS_PRESETS.find(item => item.code === code) || null;
    const normalized = normalizeName(subject?.name);
    const aliases = {
      '微分積分i': '0046', '微分積分1': '0046',
      '微分積分ii': '0047', '微分積分2': '0047',
      '線形代数i': '0048', '線形代数1': '0048',
      '線形代数ii': '0043', '線形代数2': '0043',
      '物理2a': '0049', '物理iia': '0049',
      '物理2b': '0044', '物理iib': '0044',
      '情報処理2': '0036', '情報処理ii': '0036',
      '英語2a': '0032', '英語iia': '0032',
      '英語2b': '0033', '英語iib': '0033',
      'リベラルi': '0042', 'リベラルアーツi': '0042',
      '電子計算機ia': '0039', '電子計算機1a': '0039'
    };
    const direct = SYLLABUS_PRESETS.find(item => normalizeName(item.name) === normalized);
    return direct || SYLLABUS_PRESETS.find(item => item.code === aliases[normalized]) || null;
  }

  function periodIncludes(subject, semester) {
    return subject.period === 'full' || subject.period === semester;
  }

  function getSubject(subjectId) {
    return state.subjects.find(subject => subject.id === subjectId) || null;
  }

  function getCategoriesByKind(subject, kind) {
    return (subject.categories || []).filter(item => inferCategoryKind(item) === kind);
  }

  function getCategory(subject, categoryId) {
    return (subject.categories || []).find(item => item.id === categoryId) || null;
  }

  function getMidtermPolicy(subject, semester = state.semester) {
    const direct = subject.midtermPolicies?.[semester] || subject.midtermPolicy;
    if (['held', 'none', 'alternative', 'unknown'].includes(direct)) return direct;
    const mid = getTermItems(subject.id, semester).find(item => item.isExam && item.examType === 'mid');
    return mid?.isSkipped ? 'none' : 'unknown';
  }

  function isJsonBinId(value) {
    return /^[0-9a-f]{24}$/i.test(String(value || '').trim());
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
        if (!database.objectStoreNames.contains('subjects')) database.createObjectStore('subjects', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('grades')) database.createObjectStore('grades', { keyPath: 'subjectId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB could not be opened'));
    });
  }

  async function readLocalState() {
    const transaction = state.db.transaction(['settings', 'subjects', 'grades'], 'readonly');
    const settingsStore = transaction.objectStore('settings');
    const settingsRequest = settingsStore.get('app_settings');
    const syncRequest = settingsStore.get('sync_config');
    const legacyKeyRequest = settingsStore.get('sd_academic_sync_key');
    const subjectRequest = transaction.objectStore('subjects').getAll();
    const gradeRequest = transaction.objectStore('grades').getAll();
    const [savedSettings, savedSync, dbSyncKey, subjectRows, gradeRows] = await Promise.all([
      requestToPromise(settingsRequest),
      requestToPromise(syncRequest),
      requestToPromise(legacyKeyRequest),
      requestToPromise(subjectRequest),
      requestToPromise(gradeRequest)
    ]);
    await transactionDone(transaction);

    const wasV2 = Number(savedSettings?.schemaVersion || 0) >= DATA_VERSION;
    state.settings = {
      ...structuredCloneSafe(DEFAULT_SETTINGS),
      ...(savedSettings && typeof savedSettings === 'object' ? savedSettings : {})
    };
    state.settings.tombstones = {
      subjects: { ...(savedSettings?.tombstones?.subjects || {}) },
      items: { ...(savedSettings?.tombstones?.items || {}) }
    };
    if (!wasV2) {
      // 対象ページは2026年度2年＝通常は令和7年度入学生。旧実装の誤った初期値を是正する。
      state.settings.schemaVersion = DATA_VERSION;
    }
    // この画面はSyllagetの学校50・2026年度・学科15専用。表示だけを別年度へ
    // 変えて同じ成績レコードへ混在させない。
    state.settings.profileId = ACADEMIC_PROFILE.id;
    state.settings.academicYear = ACADEMIC_PROFILE.academicYear;
    state.settings.grade = ACADEMIC_PROFILE.grade;
    state.settings.scheme = 'old';
    state.settings.initialized = true;
    state.semester = SEMESTERS.includes(state.settings.currentSemester) ? state.settings.currentSemester : 'first';

    state.syncConfig = {
      key: '',
      binId: '',
      syncEnabled: false,
      disconnected: false,
      ...(savedSync && typeof savedSync === 'object' ? savedSync : {})
    };
    const localKey = localStorage.getItem('sd_academic_sync_key');
    const persistedKey = [dbSyncKey, state.syncConfig.binId, state.syncConfig.key].find(isJsonBinId) || '';
    const externalKey = isJsonBinId(localKey) ? localKey : '';
    let syncConfigChanged = false;
    // Sync Settingsが解除後に新しいIDを明示配信した場合は、解除markerより新設定を優先する。
    if (state.syncConfig.disconnected === true && externalKey && externalKey !== persistedKey) {
      state.syncConfig.disconnected = false;
      syncConfigChanged = true;
    }
    const candidateKey = [externalKey, persistedKey].find(isJsonBinId) || '';
    if (candidateKey) {
      state.syncConfig.key = candidateKey;
      state.syncConfig.binId = candidateKey;
      // v1のsync_configにはsyncEnabledがない。既存Binは解除扱いにせず継続利用する。
      state.syncConfig.syncEnabled = state.syncConfig.disconnected !== true;
      localStorage.setItem('sd_academic_sync_key', candidateKey);
      if (savedSync?.syncEnabled !== state.syncConfig.syncEnabled || savedSync?.binId !== candidateKey) syncConfigChanged = true;
    } else {
      state.syncConfig.key = '';
      state.syncConfig.binId = '';
      state.syncConfig.syncEnabled = false;
    }

    state.subjects = (Array.isArray(subjectRows) ? subjectRows : []).map(normalizeSubject);
    state.grades = {};
    (Array.isArray(gradeRows) ? gradeRows : []).forEach(row => {
      if (row && row.subjectId) state.grades[row.subjectId] = row.terms && typeof row.terms === 'object' ? row.terms : {};
    });

    state.migrationChanged = !wasV2 || syncConfigChanged;
    state.subjects.forEach(subject => {
      if (ensureCanonicalTerms(subject)) state.migrationChanged = true;
    });
    if (!wasV2) {
      // v1には更新時刻がなく、旧クラウド値が新しいと誤判定され得る。移行時の
      // ローカルsnapshotを一度だけ明示的に最新化して、オフライン編集を守る。
      const migratedAt = Date.now();
      state.settings.dataUpdatedAt = migratedAt;
      state.subjects.forEach(subject => { subject.updatedAt = migratedAt; });
      Object.values(state.grades).forEach(terms => {
        Object.values(terms || {}).forEach(rows => {
          if (!Array.isArray(rows)) return;
          rows.forEach(item => { if (item && typeof item === 'object') item.updatedAt = migratedAt; });
        });
      });
    }
    await persistMigrationIfNeeded();
  }

  function resolveExamCategory(subject, examType) {
    const examCategories = getCategoriesByKind(subject, 'exam');
    if (!examCategories.length) return null;
    return examCategories.find(item => item.examRole === examType)
      || examCategories.find(item => !item.examRole || item.examRole === 'any')
      || examCategories[0];
  }

  function createExamItem(subject, semester, examType, customName = '') {
    const examCategory = resolveExamCategory(subject, examType);
    if (!examCategory) return null;
    const policy = getMidtermPolicy(subject, semester);
    const isMid = examType === 'mid';
    const name = customName || (isMid
      ? (policy === 'alternative' ? '代替試験' : '中間試験')
      : '期末試験');
    return {
      id: uid(`exam_${examType}_${semester}`),
      categoryId: examCategory.id,
      name,
      isExam: true,
      examType,
      score: null,
      outOf: 100,
      isSkipped: isMid && policy === 'none',
      submitted: 'done',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function itemHasUserData(item) {
    return numberOrNull(item?.score) !== null
      || item?.submitted === 'missing'
      || item?.submitted === 'late'
      || Boolean(item?.memo)
      || Boolean(item?.dueDate);
  }

  function isEmptyGeneratedExam(item) {
    return Boolean(item?.isExam && ['mid', 'final'].includes(item.examType) && !itemHasUserData(item));
  }

  function chooseLegacyExam(midRows, finalRows, examType) {
    const preferred = examType === 'mid' ? midRows : finalRows;
    const fallback = examType === 'mid' ? finalRows : midRows;
    return preferred.find(item => item?.isExam && item.examType === examType && itemHasUserData(item))
      || fallback.find(item => item?.isExam && item.examType === examType && itemHasUserData(item))
      || preferred.find(item => item?.isExam && item.examType === examType)
      || fallback.find(item => item?.isExam && item.examType === examType)
      || null;
  }

  function mergeLegacySemester(subject, semester, terms) {
    const midRows = Array.isArray(terms[`${semester}-mid`]) ? terms[`${semester}-mid`] : [];
    const finalRows = Array.isArray(terms[`${semester}-final`]) ? terms[`${semester}-final`] : [];
    const merged = [];
    const usedExamIds = new Set();
    const selectedMid = chooseLegacyExam(midRows, finalRows, 'mid');
    const selectedFinal = chooseLegacyExam(midRows, finalRows, 'final');

    [selectedMid, selectedFinal].forEach(exam => {
      if (!exam) return;
      const examType = exam.examType === 'mid' ? 'mid' : 'final';
      const targetCategory = resolveExamCategory(subject, examType);
      merged.push({
        ...exam,
        categoryId: targetCategory?.id || exam.categoryId || 'exam',
        updatedAt: exam.updatedAt || exam.createdAt || Date.now()
      });
      usedExamIds.add(exam.id);
    });

    const byId = new Map();
    [...midRows, ...finalRows].forEach(item => {
      if (!item || usedExamIds.has(item.id)) return;
      if (item.isExam && !itemHasUserData(item)) return;
      const key = String(item.id || uid('legacy_item'));
      const current = byId.get(key);
      const itemTime = cleanNumber(item.updatedAt || item.createdAt, 0);
      const currentTime = cleanNumber(current?.updatedAt || current?.createdAt, -1);
      if (!current || itemTime >= currentTime) {
        const duplicateExam = Boolean(item.isExam && ['mid', 'final'].includes(item.examType));
        byId.set(key, {
          ...item,
          id: key,
          name: duplicateExam
            ? `移行保留: ${item.name || (item.examType === 'mid' ? '中間試験' : '期末試験')}`
            : (item.isExam && !item.examType ? `移行済み: ${item.name || '試験'}` : (item.name || '名称未設定')),
          isSkipped: duplicateExam ? true : Boolean(item.isSkipped),
          memo: duplicateExam
            ? [item.memo, '旧画面の別期間にも得点がありました。二重計算を防ぐため計算対象外で保持しています。'].filter(Boolean).join('\n')
            : item.memo,
          updatedAt: item.updatedAt || item.createdAt || Date.now()
        });
      }
    });
    merged.push(...byId.values());

    const hasExamCategory = getCategoriesByKind(subject, 'exam').length > 0;
    if (hasExamCategory && periodIncludes(subject, semester)) {
      ['mid', 'final'].forEach(examType => {
        const roleCategory = resolveExamCategory(subject, examType);
        const roleRequired = roleCategory && (!roleCategory.examRole || roleCategory.examRole === examType || roleCategory.examRole === 'any');
        if (roleRequired && !merged.some(item => item.isExam && item.examType === examType)) {
          const exam = createExamItem(subject, semester, examType);
          if (exam) merged.push(exam);
        }
      });
    }
    return merged;
  }

  function normalizeItem(item, subject, semester) {
    const source = item && typeof item === 'object' ? item : {};
    const categoryValue = getCategory(subject, source.categoryId);
    const isExam = Boolean(source.isExam) || inferCategoryKind(categoryValue) === 'exam';
    return {
      ...source,
      id: String(source.id || uid('item')),
      name: String(source.name || (isExam ? '試験' : '名称未設定')),
      categoryId: String(source.categoryId || resolveExamCategory(subject, source.examType)?.id || subject.categories?.[0]?.id || 'other'),
      isExam,
      score: numberOrNull(source.score),
      outOf: Math.max(0.1, cleanNumber(source.outOf, 100)),
      submitted: ['done', 'missing', 'late', 'exempt'].includes(source.submitted) ? source.submitted : 'done',
      lateDeduction: clamp(cleanNumber(source.lateDeduction, 20), 0, 100),
      createdAt: cleanNumber(source.createdAt, Date.now()),
      updatedAt: cleanNumber(source.updatedAt || source.createdAt, Date.now()),
      semester
    };
  }

  function ensureCanonicalTerms(subject) {
    let changed = false;
    const terms = state.grades[subject.id] && typeof state.grades[subject.id] === 'object'
      ? state.grades[subject.id]
      : {};
    if (!state.grades[subject.id]) changed = true;

    SEMESTERS.forEach(semester => {
      if (!Array.isArray(terms[semester])) {
        terms[semester] = mergeLegacySemester(subject, semester, terms);
        changed = true;
      }
      const normalized = terms[semester].map(item => normalizeItem(item, subject, semester));
      if (JSON.stringify(normalized) !== JSON.stringify(terms[semester])) changed = true;
      terms[semester] = normalized;

      if (periodIncludes(subject, semester) && getCategoriesByKind(subject, 'exam').length) {
        ['mid', 'final'].forEach(examType => {
          const roleCategory = resolveExamCategory(subject, examType);
          const roleRequired = roleCategory && (!roleCategory.examRole || roleCategory.examRole === examType || roleCategory.examRole === 'any');
          if (roleRequired && !terms[semester].some(item => item.isExam && item.examType === examType)) {
            const exam = createExamItem(subject, semester, examType);
            if (exam) {
              terms[semester].push(exam);
              changed = true;
            }
          }
        });
      }
    });
    state.grades[subject.id] = terms;
    return changed;
  }

  function getTermItems(subjectId, semester = state.semester) {
    return Array.isArray(state.grades[subjectId]?.[semester]) ? state.grades[subjectId][semester] : [];
  }

  async function persistMigrationIfNeeded() {
    if (!state.migrationChanged) return;
    const transaction = state.db.transaction(['settings', 'subjects', 'grades'], 'readwrite');
    transaction.objectStore('settings').put(state.settings, 'app_settings');
    transaction.objectStore('settings').put(state.syncConfig, 'sync_config');
    if (isJsonBinId(state.syncConfig.binId)) {
      transaction.objectStore('settings').put(state.syncConfig.binId, 'sd_academic_sync_key');
    }
    state.subjects.forEach(subject => transaction.objectStore('subjects').put(subject));
    Object.entries(state.grades).forEach(([subjectId, terms]) => {
      transaction.objectStore('grades').put({ subjectId, terms });
    });
    await transactionDone(transaction);
    state.migrationChanged = false;
  }

  async function saveSettingsOnly() {
    const transaction = state.db.transaction(['settings'], 'readwrite');
    transaction.objectStore('settings').put(state.settings, 'app_settings');
    transaction.objectStore('settings').put(state.syncConfig, 'sync_config');
    if (isJsonBinId(state.syncConfig.binId)) {
      transaction.objectStore('settings').put(state.syncConfig.binId, 'sd_academic_sync_key');
    }
    await transactionDone(transaction);
  }

  async function saveSubjectAndGrades(subject, options = {}) {
    const transaction = state.db.transaction(['subjects', 'grades'], 'readwrite');
    transaction.objectStore('subjects').put(subject);
    transaction.objectStore('grades').put({ subjectId: subject.id, terms: state.grades[subject.id] || {} });
    await transactionDone(transaction);
    if (options.markChanged !== false) await markDataChanged();
  }

  async function saveGrades(subjectId, options = {}) {
    const transaction = state.db.transaction(['grades'], 'readwrite');
    transaction.objectStore('grades').put({ subjectId, terms: state.grades[subjectId] || {} });
    await transactionDone(transaction);
    if (options.markChanged !== false) await markDataChanged();
  }

  async function saveAllRecords(options = {}) {
    const transaction = state.db.transaction(['settings', 'subjects', 'grades'], 'readwrite');
    transaction.objectStore('settings').put(state.settings, 'app_settings');
    transaction.objectStore('settings').put(state.syncConfig, 'sync_config');
    const subjectStore = transaction.objectStore('subjects');
    const gradeStore = transaction.objectStore('grades');
    state.subjects.forEach(subject => subjectStore.put(subject));
    Object.entries(state.grades).forEach(([subjectId, terms]) => gradeStore.put({ subjectId, terms }));
    await transactionDone(transaction);
    if (options.markChanged !== false) await markDataChanged();
  }

  async function markDataChanged() {
    state.settings.dataUpdatedAt = Date.now();
    await saveSettingsOnly();
    scheduleBackgroundSync();
  }

  function evaluateItem(item) {
    if (!item || item.isSkipped || item.submitted === 'exempt') return { included: false };
    const outOf = Math.max(0.1, cleanNumber(item.outOf, 100));
    let score = numberOrNull(item.score);
    if (item.submitted === 'missing') score = 0;
    if (score === null) return { included: false };
    score = clamp(score, 0, outOf);
    if (item.submitted === 'late') {
      const deduction = clamp(cleanNumber(item.lateDeduction, 20), 0, 100);
      score *= (1 - deduction / 100);
    }
    return { included: true, score, outOf };
  }

  function validateScoreFields(scoreInput, outOfInput) {
    scoreInput?.setCustomValidity('');
    outOfInput?.setCustomValidity('');
    const outOf = numberOrNull(outOfInput?.value);
    const score = numberOrNull(scoreInput?.value);
    if (outOf === null || outOf <= 0) {
      outOfInput?.setCustomValidity('満点は0より大きい数で入力してください。');
      outOfInput?.reportValidity();
      return null;
    }
    if (score !== null && (score < 0 || score > outOf)) {
      scoreInput?.setCustomValidity(`得点は0〜${formatCredit(outOf)}点で入力してください。`);
      scoreInput?.reportValidity();
      return null;
    }
    return { score, outOf };
  }

  function calculateSubjectGrade(subject, semester = state.semester) {
    const categories = Array.isArray(subject.categories) ? subject.categories : [];
    const items = subject.period === 'full'
      ? SEMESTERS.flatMap(term => getTermItems(subject.id, term))
      : getTermItems(subject.id, semester);
    const relevantSemesters = subject.period === 'full' ? SEMESTERS : [semester];
    const activeCategories = categories.filter(categoryValue => {
      if (inferCategoryKind(categoryValue) !== 'exam' || categoryValue.examRole !== 'mid') return true;
      // 「中間なし」の学期しかない中間専用配点は、獲得不能な未来点として
      // 残さず計算分母から外す。共通試験カテゴリは期末へ自然に再配分される。
      return !relevantSemesters.every(term => getMidtermPolicy(subject, term) === 'none');
    });
    const totalWeight = activeCategories.reduce((sum, item) => sum + Math.max(0, cleanNumber(item.weight, 0)), 0);
    if (totalWeight <= 0) {
      return {
        score: null,
        observedScore: null,
        currentPoints: 0,
        contribution: 0,
        coverage: 0,
        coveragePercent: 0,
        totalWeight: 0,
        rangeMin: 0,
        rangeMax: 100,
        complete: false,
        categoryResults: [],
        formula: '評価割合を設定してください'
      };
    }

    let currentPoints = 0;
    let coveredWeight = 0;
    const categoryResults = activeCategories.map(categoryValue => {
      const weight = Math.max(0, cleanNumber(categoryValue.weight, 0));
      const categoryItems = items.filter(item => item.categoryId === categoryValue.id);
      const activeItems = categoryItems.filter(item => !item.isSkipped && item.submitted !== 'exempt');
      const evaluated = activeItems.map(evaluateItem).filter(result => result.included);
      const earned = evaluated.reduce((sum, result) => sum + result.score, 0);
      const possible = evaluated.reduce((sum, result) => sum + result.outOf, 0);
      const scheduledPossible = activeItems.reduce((sum, item) => sum + Math.max(0.1, cleanNumber(item.outOf, 100)), 0);
      const itemCoverage = scheduledPossible > 0 ? clamp(possible / scheduledPossible, 0, 1) : 0;
      const rate = possible > 0 ? clamp((earned / possible) * 100, 0, 100) : null;
      const coveredCategoryWeight = rate === null ? 0 : weight * itemCoverage;
      const contribution = rate === null ? 0 : (rate / 100) * coveredCategoryWeight;
      if (rate !== null && weight > 0) coveredWeight += coveredCategoryWeight;
      currentPoints += contribution;
      return {
        id: categoryValue.id,
        name: categoryValue.name,
        kind: inferCategoryKind(categoryValue),
        weight,
        rate,
        contribution,
        itemCoverage,
        evaluatedCount: evaluated.length,
        itemCount: activeItems.length
      };
    });

    const observedScore = coveredWeight > 0 ? clamp((currentPoints / coveredWeight) * 100, 0, 100) : null;
    const contribution = clamp((currentPoints / totalWeight) * 100, 0, 100);
    const coveragePercent = clamp((coveredWeight / totalWeight) * 100, 0, 100);
    const remainingWeight = Math.max(0, totalWeight - coveredWeight);
    const rangeMin = contribution;
    const rangeMax = clamp(((currentPoints + remainingWeight) / totalWeight) * 100, 0, 100);
    const complete = coveredWeight >= totalWeight - 0.001;
    const categoryFormula = categoryResults
      .filter(result => result.rate !== null && result.weight > 0)
      .map(result => `${result.name} ${result.rate.toFixed(1)}% × ${result.weight}%`)
      .join(' ＋ ');

    return {
      score: observedScore,
      observedScore,
      currentPoints,
      contribution,
      coverage: coveredWeight,
      coveragePercent,
      totalWeight,
      rangeMin,
      rangeMax,
      complete,
      categoryResults,
      formula: categoryFormula || '得点または提出状況を入力してください'
    };
  }

  function getGradeInfo(score) {
    if (score === null || score === undefined || !Number.isFinite(Number(score))) {
      return { label: '—', gp: null, tone: 'empty' };
    }
    const value = clamp(Number(score), 0, 100);
    const gp = value >= 90 ? 4 : value >= 80 ? 3 : value >= 70 ? 2 : value >= 60 ? 1 : 0;
    const tone = value >= 80 ? 'excellent' : value >= 60 ? 'pass' : 'fail';
    if (state.settings.scheme === 'new') {
      const label = value >= 90 ? '秀' : value >= 80 ? '優' : value >= 70 ? '良' : value >= 60 ? '可' : '不可';
      return { label, gp, tone };
    }
    const label = value >= 80 ? '優' : value >= 70 ? '良' : value >= 60 ? '可' : '不可';
    return { label, gp, tone };
  }

  function getGPAPoints(scoreOrGrade) {
    if (typeof scoreOrGrade === 'number') return getGradeInfo(scoreOrGrade).gp ?? 0;
    if (scoreOrGrade && typeof scoreOrGrade === 'object' && Number.isFinite(scoreOrGrade.score)) {
      return getGradeInfo(scoreOrGrade.score).gp ?? 0;
    }
    return 0;
  }

  function dashboardValues() {
    const activeSubjects = state.subjects.filter(subject => periodIncludes(subject, state.semester));
    const evaluated = activeSubjects
      .map(subject => ({ subject, result: calculateSubjectGrade(subject) }))
      .filter(row => row.result.observedScore !== null);
    const evaluatedCredits = evaluated.reduce((sum, row) => sum + Math.max(0, row.subject.credits), 0);
    const gpaRows = evaluated.filter(row => row.subject.gpaEligible !== false);
    const gpaCredits = gpaRows.reduce((sum, row) => sum + Math.max(0, row.subject.credits), 0);
    const weightedScore = evaluated.reduce((sum, row) => sum + row.result.observedScore * row.subject.credits, 0);
    const weightedGP = gpaRows.reduce((sum, row) => sum + getGPAPoints(row.result.observedScore) * row.subject.credits, 0);
    const gpa = gpaCredits > 0 ? weightedGP / gpaCredits : null;
    const average = evaluatedCredits > 0 ? weightedScore / evaluatedCredits : null;
    const totalCredits = activeSubjects.reduce((sum, subject) => sum + Math.max(0, subject.credits), 0);
    const expectedCredits = evaluated
      .filter(row => row.result.observedScore >= 60)
      .reduce((sum, row) => sum + Math.max(0, row.subject.credits), 0);

    const assignmentRows = [];
    activeSubjects.forEach(subject => {
      getTermItems(subject.id).forEach(item => {
        const categoryValue = getCategory(subject, item.categoryId);
        if (inferCategoryKind(categoryValue) === 'assignment' && item.submitted !== 'exempt') assignmentRows.push(item);
      });
    });
    const submittedCount = assignmentRows.filter(item => item.submitted === 'done' || item.submitted === 'late').length;
    const submissionRate = assignmentRows.length ? (submittedCount / assignmentRows.length) * 100 : null;
    return {
      activeSubjects,
      evaluated,
      evaluatedCredits,
      gpaRows,
      gpaCredits,
      gpa,
      average,
      totalCredits,
      expectedCredits,
      assignments: assignmentRows.length,
      submittedCount,
      submissionRate
    };
  }

  function alignSemesterToSubject(subject, options = {}) {
    if (!subject || periodIncludes(subject, state.semester)) return false;
    state.semester = subject.period === 'second' ? 'second' : 'first';
    state.settings.currentSemester = state.semester;
    if (options.persist !== false) {
      saveSettingsOnly().catch(error => console.error('Could not persist the active semester.', error));
    }
    return true;
  }

  function renderApp() {
    const drawerSubject = state.selectedSubjectId && $('rc-detail-drawer').open
      ? getSubject(state.selectedSubjectId)
      : null;
    if (drawerSubject) alignSemesterToSubject(drawerSubject);
    renderContext();
    renderTermTabs();
    renderDashboard();
    renderSubjectList();
    updateSyncUI();
    if (state.selectedSubjectId && $('rc-detail-drawer').open) renderSubjectDrawer();
  }

  function hasBlockingDataDialog() {
    return [
      'rc-detail-drawer',
      'rc-subject-modal',
      'rc-subject-edit-modal',
      'rc-assessment-modal',
      'rc-confirm-modal'
    ].some(id => $(id)?.open);
  }

  function renderAfterCloudSync() {
    if (hasBlockingDataDialog()) {
      state.pendingSyncRender = true;
      return;
    }
    state.pendingSyncRender = false;
    renderApp();
  }

  function flushDeferredInteractionWork() {
    setTimeout(() => {
      if (hasBlockingDataDialog()) return;
      if (state.pendingSyncRender) {
        state.pendingSyncRender = false;
        renderApp();
      }
      if (state.pendingCloudSync) {
        state.pendingCloudSync = false;
        clearTimeout(state.syncTimer);
        enqueueSync(() => syncWithCloud({ silent: true }));
      }
    }, 0);
  }

  function renderContext() {
    $('rc-context-label').textContent = `${state.settings.academicYear} · 情報工学科 ${state.settings.grade}年`;
  }

  function renderTermTabs() {
    document.querySelectorAll('#rc-term-tabs [data-term]').forEach(button => {
      const active = button.dataset.term === state.semester;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function renderDashboard() {
    const values = dashboardValues();
    $('rc-gpa-val').textContent = values.gpa === null ? '—' : values.gpa.toFixed(2);
    $('rc-gpa-ring').setAttribute('aria-label', values.gpa === null
      ? '暫定GPAは未算出です'
      : `暫定GPA ${values.gpa.toFixed(2)}`);
    $('rc-gpa-ring').style.setProperty('--rc5-progress', `${values.gpa === null ? 0 : (values.gpa / 4) * 360}deg`);
    $('rc-gpa-scheme-label').textContent = values.gpa === null
      ? '規程GP換算 · 暫定'
      : `${values.gpaRows.length}科目 · ${formatCredit(values.gpaCredits)}単位で加重`;
    $('rc-avg-val').textContent = values.average === null ? '—' : values.average.toFixed(1);
    $('rc-avg-detail').textContent = values.average === null ? '評価入力なし' : `${values.evaluated.length}科目の暫定値`;
    $('rc-credits-val').textContent = values.evaluated.length ? formatCredit(values.expectedCredits) : '—';
    $('rc-total-credits-label').textContent = `対象 ${formatCredit(values.totalCredits)}単位 · 暫定60点以上`;
    $('rc-sub-rate-val').textContent = values.submissionRate === null ? '—' : Math.round(values.submissionRate);
    $('rc-sub-ratio-label').textContent = values.assignments
      ? `${values.submittedCount} / ${values.assignments} 件提出`
      : '提出物なし';
  }

  function formatCredit(value) {
    const number = cleanNumber(value, 0);
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  function formatScoreForDisplay(value) {
    const number = clamp(cleanNumber(value, 0), 0, 100);
    // 暫定値を上方向へ丸めて評価境界を越えたように見せない。
    return (Math.floor((number + Number.EPSILON) * 10) / 10).toFixed(1);
  }

  function hasManualSyllabusChanges(subject) {
    return cleanNumber(subject?.customizedAt, 0) > 0
      || Object.values(subject?.midtermUserOverrides || {}).some(Boolean);
  }

  function markSyllabusCustomized(subject, changedAt = Date.now()) {
    if (subject?.syllabusCode) subject.customizedAt = changedAt;
  }

  function subjectAccent(result) {
    if (result.observedScore === null) return '#747985';
    if (result.observedScore >= 80) return '#6e8cff';
    if (result.observedScore >= 60) return '#34d47b';
    return '#ff626b';
  }

  function filteredSubjects() {
    const query = normalizeName(state.subjectSearch);
    return state.subjects
      .filter(subject => {
        if (state.subjectFilter === 'current' && !periodIncludes(subject, state.semester)) return false;
        if (['first', 'second', 'full'].includes(state.subjectFilter) && subject.period !== state.subjectFilter) return false;
        if (query && !normalizeName(subject.name).includes(query)) return false;
        return true;
      })
      .sort((left, right) => {
        const leftCurrent = periodIncludes(left, state.semester) ? 0 : 1;
        const rightCurrent = periodIncludes(right, state.semester) ? 0 : 1;
        return leftCurrent - rightCurrent || left.name.localeCompare(right.name, 'ja');
      });
  }

  function renderSubjectList() {
    const subjects = filteredSubjects();
    const list = $('rc-subject-list');
    const empty = $('rc-subject-empty');
    list.innerHTML = subjects.map(subject => {
      const result = calculateSubjectGrade(subject);
      const grade = getGradeInfo(result.observedScore);
      const score = result.observedScore === null ? '—' : formatScoreForDisplay(result.observedScore);
      const sourceBadge = subject.syllabusCode ? '<span class="rc5-subject-source-badge">SYLLABUS</span>' : '';
      const customizedBadge = subject.syllabusCode && hasManualSyllabusChanges(subject)
        ? '<span class="rc5-subject-source-badge rc5-customized-badge">変更あり</span>'
        : '';
      const gpaBadge = subject.gpaEligible === false ? '<span class="rc5-subject-source-badge rc5-gpa-excluded-badge">GPA対象外</span>' : '';
      const coverageText = result.coveragePercent > 0 ? `評価済み ${Math.round(result.coveragePercent)}%` : '未入力';
      const customizationLabel = subject.syllabusCode && hasManualSyllabusChanges(subject) ? '、シラバス情報を手動変更済み' : '';
      const accessibleResult = result.observedScore === null
        ? '得点未入力'
        : `${score}点、評価${grade.label}${grade.gp === null ? '' : `、GP ${grade.gp}`}${subject.gpaEligible === false ? '、GPA対象外' : ''}`;
      return `
        <button class="rc5-subject-card" type="button" data-subject-id="${escapeHTML(subject.id)}" style="--rc-card-accent:${subjectAccent(result)}" aria-label="${escapeHTML(`${subject.name}。${PERIOD_LABELS[subject.period]}、${formatCredit(subject.credits)}単位${customizationLabel}。${accessibleResult}。${coverageText}。成績詳細を開く`)}">
          <span class="rc5-subject-copy">
            <span>
              <span class="rc5-subject-name">${escapeHTML(subject.name)}</span>
              <span class="rc5-subject-meta">
                <span class="rc5-subject-period-badge">${PERIOD_LABELS[subject.period]}</span>
                <span>${formatCredit(subject.credits)}単位</span>
                ${sourceBadge}
                ${customizedBadge}
                ${gpaBadge}
              </span>
            </span>
            <span class="rc5-subject-coverage">${coverageText}${result.complete ? ' · 入力完了' : ''}</span>
          </span>
          <span class="rc5-subject-result">
            <span class="rc5-subject-score">${score}${score === '—' ? '' : '<small>点</small>'}</span>
            <span class="rc5-subject-grade">${escapeHTML(grade.label)}${grade.gp === null ? '' : ` · GP${grade.gp}`}</span>
          </span>
        </button>`;
    }).join('');

    const noRows = subjects.length === 0;
    list.hidden = noRows;
    empty.hidden = !noRows;
    if (noRows) {
      const title = empty.querySelector('h3');
      const copy = empty.querySelector('p');
      if (state.subjects.length && (state.subjectSearch || state.subjectFilter !== 'all')) {
        title.textContent = '条件に合う科目がありません';
        copy.textContent = '検索語や絞り込みを変更してください。';
      } else {
        title.textContent = '履修科目を登録しましょう';
        copy.textContent = '2026年度シラバスから選ぶと、単位数と評価割合をまとめて設定できます。';
      }
    }

    document.querySelectorAll('#rc-subject-filters [data-filter]').forEach(button => {
      const active = button.dataset.filter === state.subjectFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderSubjectDrawer() {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    ensureCanonicalTerms(subject);
    $('rc-drawer-subject-name').textContent = subject.name;
    $('rc-drawer-subject-meta').textContent = `${PERIOD_LABELS[subject.period]} · ${formatCredit(subject.credits)}単位 · ${SEMESTER_LABELS[state.semester]}`;
    const canonicalCount = SEMESTERS.reduce((sum, semester) => sum + getTermItems(subject.id, semester).length, 0);
    $('rc-subject-info-summary').textContent = `${subject.name} · ${formatCredit(subject.credits)}単位 · ${PERIOD_LABELS[subject.period]} · ${canonicalCount}件の記録`;
    renderDrawerScore(subject);
    renderDrawerSource(subject);
    renderGpaPolicy(subject);
    renderMidtermPolicy(subject);
    renderExams(subject);
    renderCategories(subject);
    renderAssessments(subject);
  }

  function renderDrawerScore(subject) {
    const result = calculateSubjectGrade(subject);
    const grade = getGradeInfo(result.observedScore);
    $('rc-drawer-live-score').textContent = result.observedScore === null ? '—' : formatScoreForDisplay(result.observedScore);
    $('rc-drawer-live-badge').textContent = grade.gp === null ? '未入力' : `${grade.label} · GP ${grade.gp}`;
    $('rc-drawer-contribution').textContent = `${result.currentPoints.toFixed(1)} / ${result.totalWeight || 100}`;
    $('rc-drawer-coverage-bar').style.width = `${result.coveragePercent}%`;
    $('rc-score-title').textContent = subject.period === 'full' ? 'FULL-YEAR PREVIEW' : 'INPUT-BASED PREVIEW';
    $('rc-drawer-live-formula').textContent = result.observedScore === null
      ? result.formula
      : `${subject.period === 'full' ? '通年累計 · ' : ''}${result.complete ? '総合見込' : '入力済み換算'} ${formatScoreForDisplay(result.observedScore)}点 · 評価済み ${Math.round(result.coveragePercent)}%`;
    $('rc-drawer-score-range').textContent = result.observedScore === null
      ? '最終到達範囲 0.0–100.0点'
      : `現在獲得 ${result.contribution.toFixed(1)}点 · 最終到達範囲 ${result.rangeMin.toFixed(1)}–${result.rangeMax.toFixed(1)}点`;
  }

  function renderDrawerSource(subject) {
    const panel = $('rc-drawer-source-panel');
    const linkedPreset = findPresetForSubject(subject);
    if (!linkedPreset) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    $('rc-drawer-source-title').textContent = `2026年度 ${linkedPreset.name}`;
    const sourceNotes = [];
    if (hasManualSyllabusChanges(subject)) {
      sourceNotes.push('手動変更あり。科目情報・評価基準・中間試験方式の一部が公式値と異なる可能性があります。「基準を再適用」で公式値へ戻せます（確認済みの中間試験方式は保持）。');
    }
    sourceNotes.push(linkedPreset.note || 'シラバスの総合評価割合を使用できます。');
    $('rc-drawer-source-copy').textContent = sourceNotes.join(' ');
    $('rc-drawer-source-link').href = linkedPreset.sourceUrl;
    $('rc-apply-preset-btn').textContent = subject.syllabusCode ? '基準を再適用' : '評価基準を適用';
  }

  function renderGpaPolicy(subject) {
    const eligible = subject.gpaEligible !== false;
    $('rc-gpa-eligible').value = String(eligible);
    $('rc-gpa-exclusion-field').hidden = eligible;
    $('rc-gpa-exclusion-reason').value = subject.gpaExclusionReason || '';
  }

  async function updateGpaPolicy() {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    subject.gpaEligible = $('rc-gpa-eligible').value !== 'false';
    subject.gpaExclusionReason = $('rc-gpa-exclusion-reason').value.trim();
    subject.updatedAt = Date.now();
    $('rc-gpa-exclusion-field').hidden = subject.gpaEligible;
    await saveSubjectAndGrades(subject);
    renderDashboard();
    renderSubjectList();
  }

  function renderMidtermPolicy(subject) {
    const policy = getMidtermPolicy(subject);
    const examCategories = getCategoriesByKind(subject, 'exam');
    $('rc-midterm-section').hidden = examCategories.length === 0;
    $('rc-exam-section').hidden = examCategories.length === 0;
    document.querySelectorAll('#rc-midterm-policy [data-policy]').forEach(button => {
      const active = button.dataset.policy === policy;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const linkedPreset = findPresetForSubject(subject);
    const evidence = subject.midtermEvidence || linkedPreset?.midtermEvidence || 'unknown';
    const evidenceLabel = evidence === 'explicit'
      ? 'シラバスに明記'
      : evidence === 'inferred'
        ? '評価項目から推定'
        : '要確認';
    const note = policy === 'unknown'
      ? '要確認 · 中間試験の記載を確認して選択してください'
      : `${evidenceLabel}${linkedPreset?.note ? ` · ${linkedPreset.note}` : ''}`;
    const excludedMidWeight = policy === 'none'
      ? examCategories
        .filter(categoryValue => categoryValue.examRole === 'mid')
        .reduce((sum, categoryValue) => sum + Math.max(0, cleanNumber(categoryValue.weight, 0)), 0)
      : 0;
    $('rc-midterm-source-note').textContent = excludedMidWeight > 0
      ? `${note} · 中間専用${formatCredit(excludedMidWeight)}%は計算対象外`
      : note;
    $('rc-add-exam-btn').hidden = policy !== 'alternative';
  }

  function renderExams(subject) {
    const container = $('rc-drawer-regular-exams');
    const exams = getTermItems(subject.id).filter(item => item.isExam);
    if (!exams.length) {
      container.innerHTML = '<div class="rc5-list-empty">この科目は試験を評価に使用しません。</div>';
      return;
    }
    container.innerHTML = exams.map(item => {
      const categoryValue = getCategory(subject, item.categoryId);
      const score = numberOrNull(item.score);
      const custom = !['mid', 'final'].includes(item.examType);
      return `
        <div class="rc5-exam-row${item.isSkipped ? ' is-skipped' : ''}" data-item-id="${escapeHTML(item.id)}">
          <div class="rc5-exam-name">
            <strong>${escapeHTML(item.name)}</strong>
            <span>${escapeHTML(categoryValue?.name || '試験')} · ${item.isSkipped ? '成績計算から除外' : '評価対象'}</span>
          </div>
          <div class="rc5-mini-score">
            <input type="number" inputmode="decimal" min="0" step="0.1" data-exam-field="score" value="${score === null ? '' : score}" aria-label="${escapeHTML(item.name)}の得点" ${item.isSkipped ? 'disabled' : ''}>
            <span>/</span>
            <input type="number" inputmode="decimal" min="0.1" step="0.1" data-exam-field="outOf" value="${escapeHTML(item.outOf || 100)}" aria-label="${escapeHTML(item.name)}の満点" ${item.isSkipped ? 'disabled' : ''}>
          </div>
          <button class="${custom ? 'rc5-row-menu-button' : 'rc5-skip-button'}${item.isSkipped ? ' is-active' : ''}" type="button" data-exam-action="${custom ? 'delete' : 'skip'}" aria-pressed="${item.isSkipped}">${custom ? '削除' : (item.isSkipped ? '非実施' : '除外')}</button>
        </div>`;
    }).join('');
  }

  function kindOptions(selected) {
    return Object.entries(KIND_LABELS).map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
  }

  function renderCategories(subject) {
    const container = $('rc-drawer-categories');
    container.innerHTML = (subject.categories || []).map(categoryValue => `
      <div class="rc5-category-row" data-category-id="${escapeHTML(categoryValue.id)}">
        <label class="rc5-compact-field rc5-category-name"><span>項目名</span><input type="text" maxlength="60" value="${escapeHTML(categoryValue.name)}" data-category-field="name"></label>
        <label class="rc5-compact-field rc5-category-kind"><span>種類</span><select data-category-field="kind">${kindOptions(inferCategoryKind(categoryValue))}</select></label>
        <label class="rc5-compact-field rc5-weight-input rc5-category-weight"><span>配点</span><input type="number" min="0" max="100" step="1" value="${escapeHTML(categoryValue.weight)}" data-category-field="weight"></label>
        <button class="rc5-row-menu-button" type="button" data-category-action="delete" aria-label="${escapeHTML(categoryValue.name)}を削除">削除</button>
      </div>`).join('');
    renderCategoryStatus(subject);
  }

  function renderCategoryStatus(subject) {
    const sum = (subject.categories || []).reduce((total, item) => total + cleanNumber(item.weight, 0), 0);
    const status = $('rc-category-sum-warning');
    status.classList.toggle('is-warning', Math.abs(sum - 100) > 0.001);
    status.textContent = Math.abs(sum - 100) <= 0.001
      ? '配点合計 100% · シラバスと整合'
      : `配点合計 ${sum}% · 100%になるよう調整してください`;
  }

  function renderAssessments(subject) {
    const container = $('rc-drawer-items');
    const items = getTermItems(subject.id)
      .filter(item => !item.isExam)
      .sort((left, right) => String(left.dueDate || '9999').localeCompare(String(right.dueDate || '9999')) || cleanNumber(left.createdAt) - cleanNumber(right.createdAt));
    $('rc-drawer-items-title').textContent = `${SEMESTER_LABELS[state.semester]}の提出物・小テスト`;
    if (!items.length) {
      container.innerHTML = '<div class="rc5-list-empty">個別の提出物や小テストを追加できます。</div>';
      return;
    }
    container.innerHTML = items.map(item => {
      const categoryValue = getCategory(subject, item.categoryId);
      const score = numberOrNull(item.score);
      const due = item.dueDate ? formatDate(item.dueDate) : '';
      const statusClass = item.submitted === 'missing' ? ' is-missing' : item.submitted === 'late' ? ' is-late' : '';
      const evaluated = evaluateItem(item);
      let scoreText = score === null ? '未採点' : `${formatCredit(score)} / ${formatCredit(item.outOf || 100)}`;
      let calculationNote = '';
      if (item.submitted === 'missing') {
        scoreText = `0 / ${formatCredit(item.outOf || 100)}`;
        calculationNote = '未提出のため0点で計算';
      } else if (item.submitted === 'exempt') {
        scoreText = '計算対象外';
        calculationNote = '得点と配点から除外';
      } else if (item.submitted === 'late' && score !== null && evaluated.included) {
        scoreText = `実効 ${formatCredit(evaluated.score)} / ${formatCredit(evaluated.outOf)}`;
        calculationNote = `入力 ${formatCredit(score)}点 · ${formatCredit(item.lateDeduction ?? 20)}%減点`;
      }
      return `
        <article class="rc5-assessment-row" data-item-id="${escapeHTML(item.id)}">
          <div class="rc5-assessment-main">
            <strong>${escapeHTML(item.name)}</strong>
            <span>${escapeHTML(categoryValue?.name || '未分類')}${due ? ` · 期限 ${escapeHTML(due)}` : ''}</span>
            <div class="rc5-assessment-meta"><span class="rc5-assessment-badge${statusClass}">${STATUS_LABELS[item.submitted] || '提出済み'}</span>${calculationNote ? `<span class="rc5-effective-note">${escapeHTML(calculationNote)}</span>` : ''}</div>
          </div>
          <div class="rc5-assessment-score">${escapeHTML(scoreText)}</div>
          <button class="rc5-row-menu-button" type="button" data-item-action="edit" aria-label="${escapeHTML(item.name)}を編集">編集</button>
        </article>`;
    }).join('');
  }

  function formatDate(isoDate) {
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return isoDate;
    return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date);
  }

  function japanDateStamp(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function isolateToolSurface() {
    const portalNodes = [
      $('rc-app'),
      ...document.querySelectorAll('.rc5-dialog'),
      $('rc-toast-container')
    ].filter(Boolean);
    portalNodes.forEach(node => {
      node.dataset.rc5Portal = 'true';
      if (node.parentElement !== document.body) document.body.appendChild(node);
    });
    [...document.body.children].forEach(node => {
      if (node.dataset.rc5Portal === 'true' || ['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) return;
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
      node.dataset.rc5BackgroundHidden = 'true';
    });
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    const element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const subjectId = element?.closest?.('[data-subject-id]')?.dataset.subjectId || '';
    const itemId = element?.closest?.('[data-item-id]')?.dataset.itemId || '';
    state.dialogFocus.set(dialog, { element, elementId: element?.id || '', subjectId, itemId });
    dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function restoreDialogFocus(dialog) {
    const reference = state.dialogFocus.get(dialog);
    state.dialogFocus.delete(dialog);
    let target = reference?.element?.isConnected ? reference.element : null;
    if (!target && reference?.elementId) target = document.getElementById(reference.elementId);
    if (!target && reference?.itemId) {
      target = [...document.querySelectorAll('[data-item-id]')]
        .find(row => row.dataset.itemId === reference.itemId)
        ?.querySelector('[data-item-action="edit"], button');
      if (!target) target = $('rc-add-item-btn');
    }
    if (!target && reference?.subjectId) {
      target = [...document.querySelectorAll('[data-subject-id]')]
        .find(card => card.dataset.subjectId === reference.subjectId);
      if (!target) target = $('rc-add-subject-btn');
    }
    if (target?.isConnected && typeof target.focus === 'function') {
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }

  function openSubjectDrawer(subjectId) {
    const subject = getSubject(subjectId);
    if (!subject) return;
    state.selectedSubjectId = subjectId;
    const semesterChanged = alignSemesterToSubject(subject);
    renderSubjectDrawer();
    openDialog($('rc-detail-drawer'));
    if (semesterChanged) {
      renderTermTabs();
      renderDashboard();
      renderSubjectList();
    }
  }

  function closeSubjectDrawer() {
    closeDialog($('rc-detail-drawer'));
    state.selectedSubjectId = null;
  }

  function openSubjectEditModal() {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    $('rc-subject-edit-form').dataset.subjectId = subject.id;
    $('rc-subject-edit-name').value = subject.name;
    $('rc-subject-edit-credits').value = subject.credits;
    $('rc-subject-edit-period').value = subject.period;
    openDialog($('rc-subject-edit-modal'));
    requestAnimationFrame(() => $('rc-subject-edit-name').focus());
  }

  function periodMovePlan(currentPeriod, nextPeriod) {
    if (currentPeriod === nextPeriod || nextPeriod === 'full') return null;
    if (nextPeriod === 'first') return { from: 'second', to: 'first' };
    if (nextPeriod === 'second') return { from: 'first', to: 'second' };
    return null;
  }

  function plannedMidtermDecisionMove(subject, plan) {
    const policies = { ...(subject.midtermPolicies || {}) };
    const overrides = { ...(subject.midtermUserOverrides || {}) };
    if (!plan) return { policies, overrides };

    const targetMidterm = getTermItems(subject.id, plan.to)
      .find(item => item.isExam && item.examType === 'mid');
    const sourceOverride = overrides[plan.from] === true;
    const targetOverride = overrides[plan.to] === true;
    const targetPolicy = getMidtermPolicy(subject, plan.to);
    const targetWithActiveData = Boolean(targetMidterm && targetMidterm.isSkipped !== true && itemHasUserData(targetMidterm));
    const targetExplicitlySkipped = Boolean(targetMidterm?.isSkipped === true && (
      targetOverride || itemHasUserData(targetMidterm) || targetPolicy !== 'none'
    ));

    if (!targetOverride && targetExplicitlySkipped) {
      policies[plan.to] = 'none';
      overrides[plan.to] = true;
    } else if (!targetOverride && targetWithActiveData) {
      policies[plan.to] = ['held', 'alternative'].includes(targetPolicy) ? targetPolicy : 'held';
      overrides[plan.to] = true;
    } else if (!targetOverride && sourceOverride) {
      policies[plan.to] = getMidtermPolicy(subject, plan.from);
      overrides[plan.to] = true;
    }

    if (sourceOverride) delete overrides[plan.from];
    return { policies, overrides };
  }

  function moveSubjectTermRecords(subjectId, plan, movedAt) {
    if (!plan) return 0;
    const sourceRows = [...getTermItems(subjectId, plan.from)];
    if (!sourceRows.length) return 0;
    if (!state.grades[subjectId]) state.grades[subjectId] = {};
    if (!Array.isArray(state.grades[subjectId][plan.to])) state.grades[subjectId][plan.to] = [];
    const targetRows = state.grades[subjectId][plan.to];
    sourceRows.forEach(item => {
      const duplicateTarget = item.isExam
        && ['mid', 'final'].includes(item.examType)
        ? targetRows.find(target => target.isExam && target.examType === item.examType)
        : null;
      if (duplicateTarget && isEmptyGeneratedExam(item)) {
        state.settings.tombstones.items[item.id] = movedAt;
        return;
      }
      if (duplicateTarget && isEmptyGeneratedExam(duplicateTarget)) {
        state.settings.tombstones.items[duplicateTarget.id] = movedAt;
        targetRows.splice(targetRows.indexOf(duplicateTarget), 1);
      }
      const conflictingUserExam = Boolean(duplicateTarget && !isEmptyGeneratedExam(duplicateTarget));
      const nextId = uid('item');
      state.settings.tombstones.items[item.id] = movedAt;
      targetRows.push({
        ...item,
        id: nextId,
        movedFromId: item.id,
        semester: plan.to,
        ...(conflictingUserExam ? {
          name: `移動保留: ${item.name || (item.examType === 'mid' ? '中間試験' : '期末試験')}`,
          isSkipped: true,
          memo: [item.memo, '開講期の変更時に同種の試験があったため、二重計算を防いで保持しています。'].filter(Boolean).join('\n')
        } : {}),
        updatedAt: movedAt
      });
    });
    state.grades[subjectId][plan.from] = [];
    return sourceRows.length;
  }

  async function saveSubjectEdit(event) {
    event.preventDefault();
    const subject = getSubject($('rc-subject-edit-form').dataset.subjectId);
    if (!subject) return;
    const name = $('rc-subject-edit-name').value.trim();
    const credits = numberOrNull($('rc-subject-edit-credits').value);
    const period = $('rc-subject-edit-period').value;
    if (!name) {
      $('rc-subject-edit-name').focus();
      return;
    }
    if (credits === null || credits < 0.5 || credits > 20) {
      $('rc-subject-edit-credits').setCustomValidity('単位数は0.5〜20で入力してください。');
      $('rc-subject-edit-credits').reportValidity();
      return;
    }
    $('rc-subject-edit-credits').setCustomValidity('');
    if (!['first', 'second', 'full'].includes(period)) return;

    const plan = periodMovePlan(subject.period, period);
    const moveCount = plan ? getTermItems(subject.id, plan.from).length : 0;
    if (moveCount) {
      const confirmed = await showConfirm(
        '開講期と記録を変更',
        `${SEMESTER_LABELS[plan.from]}の${moveCount}件を${SEMESTER_LABELS[plan.to]}へ移動して、開講期を「${PERIOD_LABELS[period]}」に変更します。得点・提出状況・メモは保持します。`,
        '移動して変更'
      );
      if (!confirmed) return;
    }

    const syllabusFieldsChanged = Boolean(subject.syllabusCode) && (
      subject.name !== name
      || cleanNumber(subject.credits, 0) !== credits
      || subject.period !== period
    );
    const updatedAt = Date.now();
    const movedMidtermState = plannedMidtermDecisionMove(subject, plan);
    moveSubjectTermRecords(subject.id, plan, updatedAt);
    subject.name = name;
    subject.credits = credits;
    subject.period = period;
    subject.midtermPolicies = movedMidtermState.policies;
    subject.midtermUserOverrides = movedMidtermState.overrides;
    subject.updatedAt = updatedAt;
    if (syllabusFieldsChanged) markSyllabusCustomized(subject, updatedAt);
    if (!periodIncludes(subject, state.semester)) {
      state.semester = period === 'second' ? 'second' : 'first';
      state.settings.currentSemester = state.semester;
    }
    ensureCanonicalTerms(subject);
    SEMESTERS.forEach(semester => {
      const policy = getMidtermPolicy(subject, semester);
      if (['held', 'none', 'alternative'].includes(policy)) applyPolicyToExamItems(subject, semester, policy);
    });
    await saveSubjectAndGrades(subject);
    closeDialog($('rc-subject-edit-modal'));
    renderApp();
    showToast(`${subject.name}の基本情報を更新しました。`);
  }

  function existingSubjectForPreset(presetValue) {
    return state.subjects.find(subject => {
      const code = subject.syllabusCode || LEGACY_ID_TO_CODE[subject.id];
      return code === presetValue.code || normalizeName(subject.name) === normalizeName(presetValue.name);
    }) || null;
  }

  function openSubjectModal(startOnCustom = false) {
    state.selectedPresets.clear();
    state.subjectModalTab = startOnCustom ? 'custom' : 'preset';
    $('rc-preset-search').value = '';
    $('rc-preset-select-all').textContent = '全25科目を選択';
    $('rc-custom-subject-form').reset();
    $('rc-modal-sub-credits').value = '1';
    renderSubjectModalTabs();
    renderPresetList();
    openDialog($('rc-subject-modal'));
  }

  function closeSubjectModal() {
    closeDialog($('rc-subject-modal'));
  }

  function renderSubjectModalTabs() {
    const presetMode = state.subjectModalTab === 'preset';
    $('rc-preset-pane').hidden = !presetMode;
    $('rc-custom-subject-form').hidden = presetMode;
    document.querySelectorAll('[data-subject-tab]').forEach(button => {
      const active = button.dataset.subjectTab === state.subjectModalTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $('rc-preset-selection-count').hidden = !presetMode;
    $('rc-preset-selection-count').textContent = `${state.selectedPresets.size}科目を選択`;
    $('rc-modal-sub-save').textContent = presetMode ? '追加・基準更新' : '科目を作成';
  }

  function renderPresetList() {
    const query = normalizeName($('rc-preset-search')?.value);
    const rows = SYLLABUS_PRESETS.filter(item => !query || normalizeName(item.name).includes(query));
    $('rc-preset-list').innerHTML = rows.map(item => {
      const existing = existingSubjectForPreset(item);
      const selected = state.selectedPresets.has(item.code);
      const weights = item.categories.map(categoryValue => `${categoryValue.name}${categoryValue.weight}%`).join(' / ');
      const action = existing ? (existing.syllabusCode ? '基準を更新' : '既存科目と照合') : (item.note || '追加可能');
      return `
        <label class="rc5-preset-option${existing ? ' is-existing' : ''}">
          <input type="checkbox" value="${item.code}" data-preset-code="${item.code}"${selected ? ' checked' : ''} aria-label="${escapeHTML(item.name)}を選択">
          <span class="rc5-preset-copy">
            <strong>${escapeHTML(item.name)}</strong>
            <span>${escapeHTML(weights)}</span>
          </span>
          <span class="rc5-preset-period">${PERIOD_LABELS[item.period]} · ${formatCredit(item.credits)}単位<em>${escapeHTML(action)}</em></span>
        </label>`;
    }).join('');
    $('rc-preset-selection-count').textContent = `${state.selectedPresets.size}科目を選択`;
  }

  function createSubjectFromPreset(presetValue) {
    const subject = normalizeSubject({
      id: `syll_2026_${presetValue.code}`,
      name: presetValue.name,
      credits: presetValue.credits,
      period: presetValue.period,
      categories: structuredCloneSafe(presetValue.categories),
      syllabusCode: presetValue.code,
      syllabusUrl: presetValue.sourceUrl,
      syllabusPage: SYLLAGET_PAGE,
      evaluationSource: `Syllaget 2026 / ${REFERENCE_DATE}`,
      sourceNote: presetValue.note,
      midtermEvidence: presetValue.midtermEvidence,
      midtermPolicies: { first: presetValue.midtermPolicy, second: presetValue.midtermPolicy },
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    state.grades[subject.id] = {};
    ensureCanonicalTerms(subject);
    return subject;
  }

  function mappedPresetCategory(item, oldCategory, presetCategories) {
    const direct = presetCategories.find(categoryValue => categoryValue.id === item.categoryId);
    if (direct) return direct;
    const oldKind = item.isExam ? 'exam' : inferCategoryKind(oldCategory);
    if (oldKind === 'exam') {
      return presetCategories.find(categoryValue => inferCategoryKind(categoryValue) === 'exam' && categoryValue.examRole === item.examType)
        || presetCategories.find(categoryValue => inferCategoryKind(categoryValue) === 'exam' && !categoryValue.examRole)
        || presetCategories.find(categoryValue => inferCategoryKind(categoryValue) === 'exam');
    }
    return presetCategories.find(categoryValue => inferCategoryKind(categoryValue) === oldKind) || null;
  }

  async function applyPresetToSubject(subject, presetValue, options = {}) {
    const movePlan = periodMovePlan(subject.period, presetValue.period);
    const moveCount = movePlan ? getTermItems(subject.id, movePlan.from).length : 0;
    const movedMidtermState = plannedMidtermDecisionMove(subject, movePlan);
    if (moveCount && options.periodMoveConfirmed !== true) {
      const confirmed = await showConfirm(
        '開講期と記録を更新',
        `公式の開講期「${PERIOD_LABELS[presetValue.period]}」へ戻すため、${SEMESTER_LABELS[movePlan.from]}の${moveCount}件を${SEMESTER_LABELS[movePlan.to]}へ移動します。得点・提出状況・メモは保持し、重複する試験は計算対象外で残します。`,
        '移動して適用'
      );
      if (!confirmed) return false;
    }
    const updatedAt = Date.now();
    moveSubjectTermRecords(subject.id, movePlan, updatedAt);
    const oldCategories = structuredCloneSafe(subject.categories || []);
    const nextCategories = structuredCloneSafe(presetValue.categories).map(normalizeCategory);
    const oldCategoryMap = new Map(oldCategories.map(item => [item.id, item]));
    const nextMidtermOverrides = movedMidtermState.overrides;
    const nextMidtermPolicies = {};
    SEMESTERS.forEach(semester => {
      const current = movedMidtermState.policies[semester] || getMidtermPolicy(subject, semester);
      const userOverride = nextMidtermOverrides[semester] === true;
      nextMidtermPolicies[semester] = (userOverride || (presetValue.midtermPolicy === 'unknown' && current !== 'unknown'))
        ? current
        : presetValue.midtermPolicy;
    });
    SEMESTERS.forEach(semester => {
      getTermItems(subject.id, semester).forEach(item => {
        const target = mappedPresetCategory(item, oldCategoryMap.get(item.categoryId), nextCategories);
        if (target) {
          item.categoryId = target.id;
        } else if (!nextCategories.some(categoryValue => categoryValue.id === item.categoryId)) {
          const oldCategory = oldCategoryMap.get(item.categoryId) || category(item.categoryId || uid('legacy_cat'), '旧評価項目', 0, 'other');
          nextCategories.push({ ...normalizeCategory(oldCategory), weight: 0, name: `${oldCategory.name || '旧評価項目'}（保持）` });
        }
        item.updatedAt = updatedAt;
      });
    });
    Object.assign(subject, {
      name: presetValue.name,
      credits: presetValue.credits,
      period: presetValue.period,
      categories: nextCategories,
      syllabusCode: presetValue.code,
      syllabusUrl: presetValue.sourceUrl,
      syllabusPage: SYLLAGET_PAGE,
      evaluationSource: `Syllaget 2026 / ${REFERENCE_DATE}`,
      sourceNote: presetValue.note,
      midtermEvidence: presetValue.midtermEvidence,
      midtermPolicies: nextMidtermPolicies,
      midtermUserOverrides: nextMidtermOverrides,
      customizedAt: 0,
      schemaVersion: DATA_VERSION,
      updatedAt
    });
    ensureCanonicalTerms(subject);
    SEMESTERS.forEach(semester => {
      const policy = nextMidtermPolicies[semester];
      if (['held', 'none', 'alternative'].includes(policy)) applyPolicyToExamItems(subject, semester, policy);
    });
    return true;
  }

  async function saveSelectedPresets() {
    if (!state.selectedPresets.size) {
      showToast('追加または更新する科目を選んでください。', 'error');
      return;
    }
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const code of state.selectedPresets) {
      const presetValue = SYLLABUS_PRESETS.find(item => item.code === code);
      if (!presetValue) continue;
      const existing = existingSubjectForPreset(presetValue);
      if (existing) {
        if (await applyPresetToSubject(existing, presetValue)) updated += 1;
        else skipped += 1;
      } else {
        state.subjects.push(createSubjectFromPreset(presetValue));
        added += 1;
      }
    }
    await saveAllRecords();
    closeSubjectModal();
    renderApp();
    const parts = [];
    if (added) parts.push(`${added}科目を追加`);
    if (updated) parts.push(`${updated}科目の評価基準を更新`);
    if (skipped) parts.push(`${skipped}科目は変更せず`);
    showToast(parts.join('、') + (added || updated ? 'しました。' : '。'));
  }

  async function saveCustomSubject() {
    const name = $('rc-modal-sub-name').value.trim();
    if (!name) {
      $('rc-modal-sub-name').focus();
      showToast('科目名を入力してください。', 'error');
      return;
    }
    const creditInput = $('rc-modal-sub-credits');
    const credits = numberOrNull(creditInput.value);
    if (credits === null || credits < 0.5 || credits > 20) {
      creditInput.setCustomValidity('単位数は0.5〜20で入力してください。');
      creditInput.reportValidity();
      return;
    }
    creditInput.setCustomValidity('');
    const period = $('rc-modal-sub-period').value;
    const policy = $('rc-modal-sub-midterm').value;
    if (!['first', 'second', 'full'].includes(period) || !['held', 'none', 'alternative'].includes(policy)) return;
    const subject = normalizeSubject({
      id: uid('subject'),
      name,
      credits,
      period,
      categories: defaultCategories(),
      midtermPolicies: { first: policy, second: policy },
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    state.subjects.push(subject);
    state.grades[subject.id] = {};
    ensureCanonicalTerms(subject);
    await saveSubjectAndGrades(subject);
    closeSubjectModal();
    renderApp();
    showToast(`${name}を追加しました。`);
  }

  async function saveSubjectModal() {
    if (state.subjectModalTab === 'preset') return saveSelectedPresets();
    return saveCustomSubject();
  }

  async function setMidtermPolicy(subject, policy) {
    if (!['held', 'none', 'alternative'].includes(policy)) return;
    subject.midtermPolicies = { ...(subject.midtermPolicies || {}), [state.semester]: policy };
    subject.midtermUserOverrides = { ...(subject.midtermUserOverrides || {}), [state.semester]: true };
    subject.updatedAt = Date.now();
    applyPolicyToExamItems(subject, state.semester, policy);
    ensureCanonicalTerms(subject);
    await saveSubjectAndGrades(subject);
    renderSubjectDrawer();
    renderDashboard();
    renderSubjectList();
  }

  function applyPolicyToExamItems(subject, semester, policy) {
    if (!periodIncludes(subject, semester)) return;
    const rows = getTermItems(subject.id, semester);
    let mid = rows.find(item => item.isExam && item.examType === 'mid');
    if (!mid && getCategoriesByKind(subject, 'exam').length) {
      mid = createExamItem(subject, semester, 'mid');
      if (mid) rows.push(mid);
    }
    if (mid) {
      mid.isSkipped = policy === 'none';
      if (policy === 'alternative' && (mid.name === '中間試験' || !mid.name)) mid.name = '代替試験';
      if (policy === 'held' && mid.name === '代替試験') mid.name = '中間試験';
      mid.updatedAt = Date.now();
    }
  }

  async function updateExamField(row, field, input) {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    const item = getTermItems(subject.id).find(entry => entry.id === row.dataset.itemId);
    if (!item) return;
    const validated = validateScoreFields(
      row.querySelector('[data-exam-field="score"]'),
      row.querySelector('[data-exam-field="outOf"]')
    );
    if (!validated) return;
    if (field === 'score') item.score = validated.score;
    if (field === 'outOf') item.outOf = validated.outOf;
    item.updatedAt = Date.now();
    await saveGrades(subject.id);
    renderDrawerScore(subject);
    renderDashboard();
    renderSubjectList();
  }

  async function handleExamAction(row, action) {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    const items = getTermItems(subject.id);
    const item = items.find(entry => entry.id === row.dataset.itemId);
    if (!item) return;
    if (action === 'skip') {
      item.isSkipped = !item.isSkipped;
      item.updatedAt = Date.now();
      if (item.examType === 'mid') {
        subject.midtermPolicies = { ...(subject.midtermPolicies || {}), [state.semester]: item.isSkipped ? 'none' : 'held' };
        subject.midtermUserOverrides = { ...(subject.midtermUserOverrides || {}), [state.semester]: true };
        subject.updatedAt = item.updatedAt;
        markSyllabusCustomized(subject, item.updatedAt);
        await saveSubjectAndGrades(subject);
      } else {
        await saveGrades(subject.id);
      }
      renderSubjectDrawer();
      renderDashboard();
      renderSubjectList();
      return;
    }
    if (action === 'delete') {
      const confirmed = await showConfirm('試験を削除', `「${item.name}」を削除します。入力した得点も消えます。`, '削除');
      if (!confirmed) return;
      state.grades[subject.id][state.semester] = items.filter(entry => entry.id !== item.id);
      state.settings.tombstones.items[item.id] = Date.now();
      await saveGrades(subject.id);
      renderSubjectDrawer();
      renderDashboard();
      renderSubjectList();
    }
  }

  async function updateCategory(row, field, value) {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    const categoryValue = subject.categories.find(item => item.id === row.dataset.categoryId);
    if (!categoryValue) return;
    if (field === 'kind' && value !== inferCategoryKind(categoryValue)) {
      const referenced = Object.values(state.grades[subject.id] || {})
        .flatMap(rows => Array.isArray(rows) ? rows : [])
        .filter(item => item.categoryId === categoryValue.id);
      const protectedItems = referenced.filter(item => !isEmptyGeneratedExam(item));
      if (protectedItems.length) {
        row.querySelector('[data-category-field="kind"]').value = inferCategoryKind(categoryValue);
        showToast('記録が紐づく種類は変更できません。記録を移動または削除してから変更してください。', 'error');
        return;
      }
      const deletedAt = Date.now();
      SEMESTERS.forEach(semester => {
        const rows = getTermItems(subject.id, semester);
        rows.filter(item => item.categoryId === categoryValue.id && isEmptyGeneratedExam(item)).forEach(item => {
          state.settings.tombstones.items[item.id] = deletedAt;
        });
        state.grades[subject.id][semester] = rows.filter(item => !(item.categoryId === categoryValue.id && isEmptyGeneratedExam(item)));
      });
    }
    if (field === 'name') categoryValue.name = String(value).trim() || '名称未設定';
    if (field === 'kind') categoryValue.kind = KIND_LABELS[value] ? value : 'other';
    if (field === 'weight') categoryValue.weight = clamp(cleanNumber(value, 0), 0, 100);
    subject.updatedAt = Date.now();
    markSyllabusCustomized(subject, subject.updatedAt);
    if (field === 'kind') ensureCanonicalTerms(subject);
    await saveSubjectAndGrades(subject);
    renderCategoryStatus(subject);
    renderDrawerScore(subject);
    if (field === 'name' || field === 'kind') renderAssessments(subject);
    if (field === 'kind') {
      renderMidtermPolicy(subject);
      renderExams(subject);
    }
    renderDashboard();
    renderSubjectList();
  }

  async function addCategory() {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    subject.categories.push(category(uid('cat'), '新しい評価項目', 0, 'assignment'));
    subject.updatedAt = Date.now();
    markSyllabusCustomized(subject, subject.updatedAt);
    await saveSubjectAndGrades(subject);
    renderSubjectDrawer();
  }

  async function deleteCategory(row) {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    const categoryId = row.dataset.categoryId;
    const categoryValue = getCategory(subject, categoryId);
    if (!categoryValue) return;
    const referencedItems = SEMESTERS.flatMap(semester => getTermItems(subject.id, semester)).filter(item => item.categoryId === categoryId);
    const generatedItems = referencedItems.filter(isEmptyGeneratedExam);
    const protectedItems = referencedItems.filter(item => !isEmptyGeneratedExam(item));
    const message = protectedItems.length
      ? `「${categoryValue.name}」を削除します。紐づく${protectedItems.length}件の記録は、0%の退避カテゴリへ移して保持します。`
      : `「${categoryValue.name}」を削除します。`;
    if (!await showConfirm('評価割合を削除', message, '削除')) return;
    const deletedAt = Date.now();
    if (generatedItems.length) {
      const generatedIds = new Set(generatedItems.map(item => item.id));
      generatedItems.forEach(item => { state.settings.tombstones.items[item.id] = deletedAt; });
      SEMESTERS.forEach(semester => {
        state.grades[subject.id][semester] = getTermItems(subject.id, semester).filter(item => !generatedIds.has(item.id));
      });
    }
    if (protectedItems.length) {
      const fallback = {
        ...normalizeCategory(categoryValue),
        id: uid('preserved'),
        name: `${categoryValue.name}（0%で保持）`,
        weight: 0,
        preservedFromCategoryId: categoryId
      };
      subject.categories.push(fallback);
      protectedItems.forEach(item => {
        item.categoryId = fallback.id;
        item.updatedAt = deletedAt;
      });
    }
    subject.categories = subject.categories.filter(item => item.id !== categoryId);
    subject.updatedAt = Date.now();
    markSyllabusCustomized(subject, subject.updatedAt);
    await saveSubjectAndGrades(subject);
    renderSubjectDrawer();
    renderDashboard();
    renderSubjectList();
  }

  async function applyPresetFromDrawer() {
    const subject = getSubject(state.selectedSubjectId);
    const linkedPreset = findPresetForSubject(subject);
    if (!subject || !linkedPreset) return;
    const movePlan = periodMovePlan(subject.period, linkedPreset.period);
    const moveCount = movePlan ? getTermItems(subject.id, movePlan.from).length : 0;
    const moveMessage = moveCount
      ? ` ${SEMESTER_LABELS[movePlan.from]}の${moveCount}件は${SEMESTER_LABELS[movePlan.to]}へ移し、重複する試験は二重計算せず保持します。`
      : '';
    const confirmed = await showConfirm(
      'シラバス基準を適用',
      `「${linkedPreset.name}」の単位数・開講期・評価割合・未確認の中間試験方式を更新します。手動で確認した方式と、入力済みの得点・提出物は保持します。${moveMessage}`,
      '適用'
    );
    if (!confirmed) return;
    const currentSubject = getSubject(subject.id);
    if (!currentSubject) return;
    const applied = await applyPresetToSubject(currentSubject, linkedPreset, { periodMoveConfirmed: moveCount > 0 });
    if (!applied) return;
    await saveSubjectAndGrades(currentSubject);
    renderApp();
    showToast('2026年度シラバスの評価基準を適用しました。');
  }

  function tombstoneSubjectItems(subjectId, deletedAt) {
    Object.values(state.grades[subjectId] || {}).forEach(rows => {
      if (!Array.isArray(rows)) return;
      rows.forEach(item => {
        if (!item?.id) return;
        state.settings.tombstones.items[item.id] = Math.max(
          cleanNumber(state.settings.tombstones.items[item.id], 0),
          deletedAt
        );
      });
    });
  }

  async function deleteSelectedSubject() {
    const subject = getSubject(state.selectedSubjectId);
    if (!subject) return;
    if (!await showConfirm('科目を削除', `「${subject.name}」と、この科目の成績記録を削除します。`, '削除')) return;
    const deletedAt = Date.now();
    tombstoneSubjectItems(subject.id, deletedAt);
    const transaction = state.db.transaction(['subjects', 'grades'], 'readwrite');
    transaction.objectStore('subjects').delete(subject.id);
    transaction.objectStore('grades').delete(subject.id);
    await transactionDone(transaction);
    state.subjects = state.subjects.filter(item => item.id !== subject.id);
    delete state.grades[subject.id];
    state.settings.tombstones.subjects[subject.id] = deletedAt;
    await markDataChanged();
    closeSubjectDrawer();
    renderApp();
    showToast(`${subject.name}を削除しました。`);
  }

  function populateAssessmentSubjects(selectedSubjectId, semester) {
    const select = $('rc-assessment-subject');
    const rows = state.subjects.filter(subject => periodIncludes(subject, semester));
    select.innerHTML = rows.map(subject => `<option value="${escapeHTML(subject.id)}"${subject.id === selectedSubjectId ? ' selected' : ''}>${escapeHTML(subject.name)}</option>`).join('');
  }

  function updateAssessmentCategories(selectedCategoryId = '') {
    const subject = getSubject($('rc-assessment-subject').value);
    const kind = $('rc-assessment-kind').value;
    const select = $('rc-assessment-category');
    if (!subject) {
      select.innerHTML = '';
      return;
    }
    const matching = subject.categories.filter(categoryValue => inferCategoryKind(categoryValue) === kind);
    const other = subject.categories.filter(categoryValue => inferCategoryKind(categoryValue) !== kind);
    const options = [...matching, ...other].map(categoryValue => `<option value="${escapeHTML(categoryValue.id)}"${categoryValue.id === selectedCategoryId ? ' selected' : ''}>${escapeHTML(categoryValue.name)} · ${categoryValue.weight}%</option>`);
    options.push(`<option value="__new__"${!matching.length && !selectedCategoryId ? ' selected' : ''}>「${KIND_LABELS[kind]}」カテゴリを新規作成（0%）</option>`);
    select.innerHTML = options.join('');
    $('rc-assessment-category-note').textContent = !matching.length
      ? '対応する評価割合がないため、保存時に0%のカテゴリを作ります。配点は科目詳細で設定してください。'
      : '選んだ評価割合の中で、複数項目は満点合計に対する得点率で集計します。';
  }

  function openAssessmentModal(kind = 'assignment', options = {}) {
    if (!state.subjects.length) {
      showToast('先に科目を追加してください。', 'error');
      openSubjectModal();
      return;
    }
    const subjectId = options.subjectId || state.selectedSubjectId || state.subjects.find(subject => periodIncludes(subject, state.semester))?.id || state.subjects[0].id;
    const semester = options.semester || state.semester;
    const item = options.item || null;
    $('rc-assessment-form').reset();
    $('rc-assessment-id').value = item?.id || '';
    $('rc-assessment-modal-title').textContent = item ? '評価項目を編集' : '評価項目を追加';
    $('rc-assessment-term').value = semester;
    populateAssessmentSubjects(subjectId, semester);
    $('rc-assessment-subject').value = subjectId;
    const subject = getSubject(subjectId);
    const categoryValue = item ? getCategory(subject, item.categoryId) : null;
    $('rc-assessment-kind').value = item?.isExam ? 'exam' : (categoryValue ? inferCategoryKind(categoryValue) : kind);
    $('rc-assessment-name').value = item?.name || defaultAssessmentName($('rc-assessment-kind').value);
    $('rc-assessment-score').value = numberOrNull(item?.score) === null ? '' : item.score;
    $('rc-assessment-outof').value = item?.outOf || 100;
    $('rc-assessment-status').value = item?.submitted || 'done';
    $('rc-assessment-due').value = item?.dueDate || '';
    $('rc-assessment-late').value = item?.lateDeduction ?? 20;
    $('rc-assessment-memo').value = item?.memo || '';
    $('rc-assessment-delete').hidden = !item;
    $('rc-assessment-form').dataset.originalSubjectId = subjectId;
    $('rc-assessment-form').dataset.originalSemester = semester;
    updateAssessmentCategories(item?.categoryId || '');
    updateLateField();
    openDialog($('rc-assessment-modal'));
    requestAnimationFrame(() => $('rc-assessment-name').focus());
  }

  function defaultAssessmentName(kind) {
    return {
      assignment: '新しい提出物',
      quiz: '小テスト',
      presentation: '発表',
      participation: '平常点',
      exam: '追加試験',
      other: '評価項目'
    }[kind] || '評価項目';
  }

  function updateLateField() {
    $('rc-late-field').hidden = $('rc-assessment-status').value !== 'late';
  }

  async function saveAssessment(event) {
    event.preventDefault();
    const form = $('rc-assessment-form');
    const subject = getSubject($('rc-assessment-subject').value);
    const semester = $('rc-assessment-term').value;
    if (!subject || !SEMESTERS.includes(semester)) return;
    if (!periodIncludes(subject, semester)) {
      showToast(`${subject.name}は${SEMESTER_LABELS[semester]}の科目ではありません。`, 'error');
      return;
    }
    const name = $('rc-assessment-name').value.trim();
    if (!name) {
      $('rc-assessment-name').focus();
      return;
    }
    const validatedScore = validateScoreFields($('rc-assessment-score'), $('rc-assessment-outof'));
    if (!validatedScore) return;
    let categoryId = $('rc-assessment-category').value;
    const kind = $('rc-assessment-kind').value;
    if (categoryId === '__new__') {
      const newCategory = category(uid('cat'), KIND_LABELS[kind], 0, kind);
      subject.categories.push(newCategory);
      categoryId = newCategory.id;
      subject.updatedAt = Date.now();
      markSyllabusCustomized(subject, subject.updatedAt);
    }

    const originalItemId = $('rc-assessment-id').value;
    const originalSubjectId = form.dataset.originalSubjectId;
    const originalSemester = form.dataset.originalSemester;
    let existing = null;
    if (originalItemId) {
      existing = getTermItems(originalSubjectId, originalSemester).find(item => item.id === originalItemId) || null;
      state.grades[originalSubjectId][originalSemester] = getTermItems(originalSubjectId, originalSemester).filter(item => item.id !== originalItemId);
    }
    const now = Date.now();
    const moved = Boolean(existing && (originalSubjectId !== subject.id || originalSemester !== semester));
    const itemId = moved ? uid('item') : (originalItemId || uid('item'));
    if (moved) state.settings.tombstones.items[originalItemId] = now;
    const item = {
      ...(existing || {}),
      id: itemId,
      ...(moved ? { movedFromId: originalItemId } : {}),
      categoryId,
      name,
      isExam: kind === 'exam',
      examType: kind === 'exam' ? (existing?.examType || null) : undefined,
      score: validatedScore.score,
      outOf: validatedScore.outOf,
      submitted: $('rc-assessment-status').value,
      lateDeduction: clamp(cleanNumber($('rc-assessment-late').value, 20), 0, 100),
      dueDate: $('rc-assessment-due').value || '',
      memo: $('rc-assessment-memo').value.trim(),
      isSkipped: false,
      createdAt: moved ? now : (existing?.createdAt || now),
      updatedAt: now
    };
    if (!state.grades[subject.id]) state.grades[subject.id] = {};
    if (!Array.isArray(state.grades[subject.id][semester])) state.grades[subject.id][semester] = [];
    state.grades[subject.id][semester].push(item);

    const transaction = state.db.transaction(['subjects', 'grades'], 'readwrite');
    transaction.objectStore('subjects').put(subject);
    transaction.objectStore('grades').put({ subjectId: subject.id, terms: state.grades[subject.id] });
    if (originalSubjectId && originalSubjectId !== subject.id) {
      transaction.objectStore('grades').put({ subjectId: originalSubjectId, terms: state.grades[originalSubjectId] });
    }
    await transactionDone(transaction);
    await markDataChanged();
    closeDialog($('rc-assessment-modal'));
    renderApp();
    showToast(`${name}を保存しました。`);
  }

  async function deleteAssessment() {
    const form = $('rc-assessment-form');
    const itemId = $('rc-assessment-id').value;
    const subjectId = form.dataset.originalSubjectId;
    const semester = form.dataset.originalSemester;
    const item = getTermItems(subjectId, semester).find(entry => entry.id === itemId);
    if (!item || !await showConfirm('評価項目を削除', `「${item.name}」を削除します。`, '削除')) return;
    state.grades[subjectId][semester] = getTermItems(subjectId, semester).filter(entry => entry.id !== itemId);
    state.settings.tombstones.items[itemId] = Date.now();
    await saveGrades(subjectId);
    closeDialog($('rc-assessment-modal'));
    renderApp();
    showToast(`${item.name}を削除しました。`);
  }

  function encryptText(text, key) {
    if (!text || !key) return text;
    let result = '';
    for (let index = 0; index < text.length; index += 1) {
      result += String.fromCharCode(text.charCodeAt(index) ^ key.charCodeAt(index % key.length));
    }
    try {
      return btoa(unescape(encodeURIComponent(result)));
    } catch (error) {
      console.warn('Academic Report encryption failed.', error);
      return text;
    }
  }

  function decryptText(encoded, key) {
    if (!encoded || !key) return encoded;
    try {
      const text = decodeURIComponent(escape(atob(encoded)));
      let result = '';
      for (let index = 0; index < text.length; index += 1) {
        result += String.fromCharCode(text.charCodeAt(index) ^ key.charCodeAt(index % key.length));
      }
      return result;
    } catch (error) {
      throw new Error('同期データを復号できませんでした。');
    }
  }

  function publicSettings() {
    return {
      schemaVersion: DATA_VERSION,
      profileId: ACADEMIC_PROFILE.id,
      scheme: 'old',
      academicYear: ACADEMIC_PROFILE.academicYear,
      grade: ACADEMIC_PROFILE.grade,
      currentSemester: state.settings.currentSemester
    };
  }

  function packageData() {
    return {
      app: APP_NAME,
      version: DATA_VERSION,
      updatedAt: cleanNumber(state.settings.dataUpdatedAt, 0),
      exportedAt: new Date().toISOString(),
      settings: publicSettings(),
      subjects: structuredCloneSafe(state.subjects),
      grades: structuredCloneSafe(state.grades),
      tombstones: structuredCloneSafe(state.settings.tombstones)
    };
  }

  function validatePackage(input) {
    if (!input || typeof input !== 'object') throw new Error('JSONのルートがオブジェクトではありません。');
    if (input.app !== undefined && input.app !== APP_NAME) {
      throw new Error('Academic Report以外のバックアップは読み込めません。');
    }
    if (!Array.isArray(input.subjects)) throw new Error('subjects配列がありません。');
    if (input.subjects.length > 1000) throw new Error('科目数が上限を超えています。');
    if (!input.grades || typeof input.grades !== 'object' || Array.isArray(input.grades)) {
      throw new Error('gradesオブジェクトがありません。');
    }
    const ids = new Set();
    input.subjects.forEach((subject, index) => {
      if (!subject || typeof subject !== 'object' || !subject.id || typeof subject.name !== 'string') {
        throw new Error(`科目${index + 1}の形式が正しくありません。`);
      }
      if (ids.has(String(subject.id))) throw new Error(`重複した科目IDがあります: ${subject.id}`);
      ids.add(String(subject.id));
      if (subject.categories !== undefined && !Array.isArray(subject.categories)) {
        throw new Error(`${subject.name}の評価割合が配列ではありません。`);
      }
    });
    let itemCount = 0;
    Object.entries(input.grades).forEach(([subjectId, terms]) => {
      if (!terms || typeof terms !== 'object' || Array.isArray(terms)) throw new Error(`${subjectId}の成績形式が正しくありません。`);
      Object.entries(terms).forEach(([term, rows]) => {
        if (!Array.isArray(rows)) throw new Error(`${subjectId}/${term}の評価項目が配列ではありません。`);
        itemCount += rows.length;
        rows.forEach((item, index) => {
          if (!item || typeof item !== 'object') throw new Error(`${subjectId}/${term}/${index + 1}の形式が正しくありません。`);
        });
      });
    });
    if (itemCount > 100000) throw new Error('評価項目数が上限を超えています。');
    return input;
  }

  function normalizedPackage(input) {
    validatePackage(input);
    const normalized = {
      ...input,
      app: input.app || APP_NAME,
      version: cleanNumber(input.version, 1),
      updatedAt: cleanNumber(input.updatedAt, 0),
      settings: input.settings && typeof input.settings === 'object' ? { ...input.settings } : {},
      subjects: input.subjects.map(normalizeSubject),
      grades: structuredCloneSafe(input.grades),
      tombstones: {
        subjects: { ...(input.tombstones?.subjects || {}) },
        items: { ...(input.tombstones?.items || {}) }
      }
    };
    return normalized;
  }

  function mergeRows(localRows, remoteRows, localPackageTime, remotePackageTime, remoteWinsTie) {
    const rows = new Map();
    const add = (item, sourceTime, sourceIsRemote) => {
      if (!item || typeof item !== 'object') return;
      const id = String(item.id || uid('merged_item'));
      const existing = rows.get(id);
      const itemTime = cleanNumber(item.updatedAt || item.createdAt, sourceTime);
      const existingTime = existing ? cleanNumber(existing.item.updatedAt || existing.item.createdAt, existing.sourceTime) : -1;
      if (!existing || itemTime > existingTime || (itemTime === existingTime && sourceIsRemote === remoteWinsTie)) {
        rows.set(id, { item: { ...item, id }, sourceTime });
      }
    };
    (Array.isArray(localRows) ? localRows : []).forEach(item => add(item, localPackageTime, false));
    (Array.isArray(remoteRows) ? remoteRows : []).forEach(item => add(item, remotePackageTime, true));
    return [...rows.values()].map(entry => entry.item);
  }

  function mergePackages(localInput, remoteInput) {
    const local = normalizedPackage(localInput);
    const remote = normalizedPackage(remoteInput);
    const localTime = cleanNumber(local.updatedAt, 0);
    const remoteTime = cleanNumber(remote.updatedAt, 0);
    const remoteWins = remoteTime >= localTime;
    const subjectMap = new Map();
    const subjectSources = new Map();
    local.subjects.forEach(subject => {
      subjectMap.set(subject.id, subject);
      subjectSources.set(subject.id, { time: cleanNumber(subject.updatedAt, localTime), remote: false });
    });
    remote.subjects.forEach(subject => {
      const currentSource = subjectSources.get(subject.id);
      const candidateTime = cleanNumber(subject.updatedAt, remoteTime);
      if (!currentSource || candidateTime > currentSource.time || (candidateTime === currentSource.time && remoteWins)) {
        subjectMap.set(subject.id, subject);
        subjectSources.set(subject.id, { time: candidateTime, remote: true });
      }
    });

    const grades = {};
    const allSubjectIds = new Set([...Object.keys(local.grades), ...Object.keys(remote.grades), ...subjectMap.keys()]);
    allSubjectIds.forEach(subjectId => {
      const localTerms = local.grades[subjectId] || {};
      const remoteTerms = remote.grades[subjectId] || {};
      const terms = {};
      new Set([...Object.keys(localTerms), ...Object.keys(remoteTerms)]).forEach(term => {
        terms[term] = mergeRows(localTerms[term], remoteTerms[term], localTime, remoteTime, remoteWins);
      });
      grades[subjectId] = terms;
    });

    const tombstones = { subjects: {}, items: {} };
    for (const source of [local.tombstones, remote.tombstones]) {
      Object.entries(source.subjects || {}).forEach(([id, timestamp]) => {
        tombstones.subjects[id] = Math.max(cleanNumber(tombstones.subjects[id], 0), cleanNumber(timestamp, 0));
      });
      Object.entries(source.items || {}).forEach(([id, timestamp]) => {
        tombstones.items[id] = Math.max(cleanNumber(tombstones.items[id], 0), cleanNumber(timestamp, 0));
      });
    }

    Object.entries(tombstones.subjects).forEach(([subjectId, deletedAt]) => {
      const source = subjectSources.get(subjectId);
      if (!source || deletedAt >= source.time) {
        subjectMap.delete(subjectId);
        delete grades[subjectId];
      }
    });
    Object.values(grades).forEach(terms => {
      Object.keys(terms).forEach(term => {
        terms[term] = terms[term].filter(item => {
          const deletedAt = cleanNumber(tombstones.items[item.id], 0);
          return !deletedAt || cleanNumber(item.updatedAt || item.createdAt, 0) > deletedAt;
        });
      });
    });

    return {
      app: APP_NAME,
      version: DATA_VERSION,
      updatedAt: Math.max(localTime, remoteTime),
      settings: remoteWins ? { ...local.settings, ...remote.settings } : { ...remote.settings, ...local.settings },
      subjects: [...subjectMap.values()],
      grades,
      tombstones
    };
  }

  async function applyPackage(input, options = {}) {
    const data = normalizedPackage(input);
    state.subjects = data.subjects.map(normalizeSubject);
    state.grades = data.grades;
    state.settings = {
      ...state.settings,
      ...(data.settings || {}),
      schemaVersion: DATA_VERSION,
      profileId: ACADEMIC_PROFILE.id,
      academicYear: ACADEMIC_PROFILE.academicYear,
      grade: ACADEMIC_PROFILE.grade,
      scheme: 'old',
      dataUpdatedAt: data.updatedAt,
      initialized: true,
      tombstones: data.tombstones
    };
    state.semester = SEMESTERS.includes(state.settings.currentSemester) ? state.settings.currentSemester : 'first';
    state.subjects.forEach(subject => ensureCanonicalTerms(subject));

    const transaction = state.db.transaction(['settings', 'subjects', 'grades'], 'readwrite');
    const subjectStore = transaction.objectStore('subjects');
    const gradeStore = transaction.objectStore('grades');
    subjectStore.clear();
    gradeStore.clear();
    state.subjects.forEach(subject => subjectStore.put(subject));
    Object.entries(state.grades).forEach(([subjectId, terms]) => gradeStore.put({ subjectId, terms }));
    transaction.objectStore('settings').put(state.settings, 'app_settings');
    transaction.objectStore('settings').put(state.syncConfig, 'sync_config');
    await transactionDone(transaction);
    if (options.scheduleSync) scheduleBackgroundSync();
  }

  function getJsonBinKey() {
    return window.PWAConfigSync?.getApiKey?.() || '';
  }

  function authHeaders(includeContentType = false) {
    const key = getJsonBinKey();
    if (!key) throw new Error('JSONBin APIキーが設定されていません。');
    return {
      'X-Master-Key': key,
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {})
    };
  }

  async function fetchRemotePackage(binId) {
    const response = await fetch(`${BIN_URL}/${binId}/latest`, {
      headers: authHeaders(false),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`同期先の読み込みに失敗しました（${response.status}）。`);
    const body = await response.json();
    const record = body.record ?? body;
    if (!record || record.isInitial || !record.data) return null;
    if (typeof record.data === 'object') return normalizedPackage(record.data);
    const decrypted = decryptText(record.data, binId);
    return normalizedPackage(JSON.parse(decrypted));
  }

  async function pushPackage(binId, payload = packageData()) {
    const encrypted = encryptText(JSON.stringify(payload), binId);
    const response = await fetch(`${BIN_URL}/${binId}`, {
      method: 'PUT',
      headers: authHeaders(true),
      body: JSON.stringify({ data: encrypted })
    });
    if (!response.ok) throw new Error(`同期先への保存に失敗しました（${response.status}）。`);
    state.settings.lastSyncAt = Date.now();
    await saveSettingsOnly();
    return response.json();
  }

  async function setSyncKey(binId) {
    state.syncConfig = { key: binId, binId, syncEnabled: true, disconnected: false };
    localStorage.setItem('sd_academic_sync_key', binId);
    if (window.PWAConfigSync) {
      window.PWAConfigSync.setCachedBinId?.('report_card', binId);
      try {
        await window.PWAConfigSync.syncAppBinId?.('report_card', binId);
      } catch (error) {
        console.warn('Master sync config could not be updated.', error);
      }
    }
    await saveSettingsOnly();
  }

  async function createSyncBin() {
    const response = await fetch(BIN_URL, {
      method: 'POST',
      headers: {
        ...authHeaders(true),
        'X-Bin-Name': 'academic_report_sync',
        'X-Bin-Private': 'true'
      },
      body: JSON.stringify({ isInitial: true, app: APP_NAME })
    });
    if (!response.ok) throw new Error(`同期先を作成できませんでした（${response.status}）。`);
    const body = await response.json();
    const binId = body.metadata?.id;
    if (!isJsonBinId(binId)) throw new Error('同期先から有効なIDが返りませんでした。');
    await setSyncKey(binId);
    await pushPackage(binId);
    return binId;
  }

  function setSyncStatus(status, label) {
    const badge = $('rc-sync-badge-top');
    const statusLabel = label || ({
      local: 'この端末のみ',
      synced: '同期済み',
      busy: '同期中',
      error: '同期エラー'
    })[status] || status;
    badge.classList.remove('is-local', 'is-synced', 'is-busy', 'is-error');
    badge.classList.add(`is-${status}`);
    $('rc-sync-badge-label').textContent = statusLabel;
    badge.setAttribute('aria-label', `同期状態: ${statusLabel}。${status === 'local' ? '押すと同期設定を開きます' : '押すと今すぐ同期します'}`);
    badge.setAttribute('aria-busy', String(status === 'busy'));
    badge.disabled = status === 'busy';
    $('rc-sync-now-btn').disabled = status === 'busy';
    $('rc-sync-connect-btn').disabled = status === 'busy';
    $('rc-sync-copy-key-btn').disabled = status === 'busy';
    $('rc-sync-disconnect-btn').disabled = status === 'busy';
    $('rc-data-import-btn-trigger').disabled = status === 'busy';
    $('rc-data-clear-btn').disabled = status === 'busy';
  }

  function updateSyncUI() {
    const connected = state.syncConfig.syncEnabled && isJsonBinId(state.syncConfig.binId);
    if (!connected) setSyncStatus('local');
    else if (!$('rc-sync-badge-top').classList.contains('is-busy') && !$('rc-sync-badge-top').classList.contains('is-error')) setSyncStatus('synced');
    $('rc-sync-copy-key-btn').hidden = !connected;
    $('rc-sync-disconnect-btn').hidden = !connected;
    $('rc-sync-now-btn').textContent = connected ? '今すぐ同期' : '新しい同期キーを作成';
    const status = $('rc-sync-status-text');
    if (connected) {
      const suffix = state.syncConfig.binId.slice(-4);
      const lastSync = state.settings.lastSyncAt
        ? new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(state.settings.lastSyncAt))
        : '未同期';
      status.innerHTML = `<strong>同期に接続済み</strong><br>キー末尾 …${escapeHTML(suffix)} · 最終同期 ${escapeHTML(lastSync)}`;
    } else {
      status.textContent = 'この端末だけに保存されています。同期を設定するまでクラウド通信は行いません。';
    }
  }

  async function syncWithCloud(options = {}) {
    const binId = state.syncConfig.binId;
    if (!state.syncConfig.syncEnabled || !isJsonBinId(binId)) return false;
    if (hasBlockingDataDialog()) {
      state.pendingCloudSync = true;
      setSyncStatus('busy', '同期待ち');
      return false;
    }
    state.pendingCloudSync = false;
    setSyncStatus('busy');
    try {
      const remote = await fetchRemotePackage(binId);
      // A data sheet can open while the request is in flight. Applying remote
      // state at that point would replace live objects and uncommitted inputs.
      if (hasBlockingDataDialog()) {
        state.pendingCloudSync = true;
        setSyncStatus('busy', '同期待ち');
        return false;
      }
      if (remote) {
        const merged = mergePackages(packageData(), remote);
        await applyPackage(merged);
      }
      await pushPackage(binId);
      setSyncStatus('synced');
      renderAfterCloudSync();
      if (!options.silent) showToast('端末間データを同期しました。');
      return true;
    } catch (error) {
      console.error('Academic Report sync failed.', error);
      setSyncStatus('error');
      if (!options.silent) showToast(error.message || '同期に失敗しました。ローカルデータは保存済みです。', 'error');
      return false;
    } finally {
      updateSyncUI();
    }
  }

  function enqueueSync(task) {
    state.syncQueue = state.syncQueue
      .catch(() => undefined)
      .then(task);
    return state.syncQueue;
  }

  function scheduleBackgroundSync() {
    if (!state.syncConfig.syncEnabled || !isJsonBinId(state.syncConfig.binId)) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
      enqueueSync(() => syncWithCloud({ silent: true }));
    }, 1500);
  }

  async function manualSync() {
    clearTimeout(state.syncTimer);
    return enqueueSync(async () => {
      if (isJsonBinId(state.syncConfig.binId) && !state.syncConfig.syncEnabled && state.syncConfig.disconnected !== true) {
        state.syncConfig.syncEnabled = true;
        await saveSettingsOnly();
      }
      if (!state.syncConfig.syncEnabled || !isJsonBinId(state.syncConfig.binId)) {
        setSyncStatus('busy', '設定中');
        try {
          await createSyncBin();
          setSyncStatus('synced');
          updateSyncUI();
          showToast('同期キーを作成しました。設定画面からコピーできます。');
        } catch (error) {
          console.error('Sync bin creation failed.', error);
          setSyncStatus('error');
          showToast(error.message || '同期設定に失敗しました。', 'error');
        }
        return;
      }
      await syncWithCloud();
    });
  }

  async function connectSyncKey() {
    const binId = $('rc-sync-key-input').value.trim();
    if (!isJsonBinId(binId)) {
      showToast('24文字の有効な同期キーを入力してください。', 'error');
      return;
    }
    clearTimeout(state.syncTimer);
    return enqueueSync(async () => {
      setSyncStatus('busy', '接続中');
      try {
        const remote = await fetchRemotePackage(binId);
        const merged = remote ? mergePackages(packageData(), remote) : packageData();
        await setSyncKey(binId);
        await applyPackage(merged);
        await pushPackage(binId, packageData());
        $('rc-sync-key-input').value = '';
        setSyncStatus('synced');
        updateSyncUI();
        renderApp();
        showToast('別端末のデータと安全に統合しました。');
      } catch (error) {
        console.error('Sync key connection failed.', error);
        setSyncStatus('error');
        showToast(error.message || '同期キーへ接続できませんでした。', 'error');
      }
    });
  }

  async function disconnectSync() {
    if (!await showConfirm('同期を解除', 'この端末の成績データは残したまま、クラウドとの接続だけを解除します。', '解除')) return;
    clearTimeout(state.syncTimer);
    return enqueueSync(async () => {
      setSyncStatus('busy', '解除中');
      state.syncConfig = { key: '', binId: '', syncEnabled: false, disconnected: true };
      localStorage.removeItem('sd_academic_sync_key');
      window.PWAConfigSync?.setCachedBinId?.('report_card', '');
      const transaction = state.db.transaction(['settings'], 'readwrite');
      transaction.objectStore('settings').put(state.syncConfig, 'sync_config');
      transaction.objectStore('settings').delete('sd_academic_sync_key');
      await transactionDone(transaction);

      let masterUpdated = true;
      if (window.PWAConfigSync?.getMasterBinId?.()) {
        try {
          await window.PWAConfigSync.pushMasterConfig?.();
        } catch (error) {
          masterUpdated = false;
          console.warn('Master sync config could not remove the Academic Report Bin.', error);
        }
      }
      updateSyncUI();
      showToast(masterUpdated
        ? '同期を解除しました。ローカルデータは保持されています。'
        : 'この端末では解除しました。Sync Settingsへの反映は再試行してください。', masterUpdated ? 'success' : 'error');
    });
  }

  function downloadJSON(payload, fileName) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportData() {
    const date = japanDateStamp();
    downloadJSON(packageData(), `academic-report-${date}.json`);
    showToast('バックアップJSONを書き出しました。');
  }

  function packageItemLocations(data) {
    const locations = new Map();
    Object.entries(data?.grades || {}).forEach(([subjectId, terms]) => {
      Object.entries(terms || {}).forEach(([term, rows]) => {
        if (!Array.isArray(rows)) return;
        rows.forEach(item => {
          if (!item?.id) return;
          const id = String(item.id);
          if (!locations.has(id)) locations.set(id, new Set());
          locations.get(id).add(`${subjectId}/${term}`);
        });
      });
    });
    return locations;
  }

  function sameLocationSet(left, right) {
    if (!left || !right || left.size !== right.size) return false;
    return [...left].every(value => right.has(value));
  }

  function prepareImportedPackage(input, requestedAt = Date.now(), currentInput = packageData()) {
    const imported = normalizedPackage(input);
    const current = currentInput ? normalizedPackage(currentInput) : null;
    let revivedAt = Math.max(Date.now(), cleanNumber(requestedAt, 0), cleanNumber(imported.updatedAt, 0));
    [
      imported.tombstones.subjects,
      imported.tombstones.items,
      current?.tombstones?.subjects,
      current?.tombstones?.items
    ].forEach(group => {
      Object.values(group || {}).forEach(value => { revivedAt = Math.max(revivedAt, cleanNumber(value, 0)); });
    });
    revivedAt += 1;
    const deletionAt = revivedAt - 1;
    for (const kind of ['subjects', 'items']) {
      Object.entries(current?.tombstones?.[kind] || {}).forEach(([id, timestamp]) => {
        imported.tombstones[kind][id] = Math.max(
          cleanNumber(imported.tombstones[kind][id], 0),
          cleanNumber(timestamp, 0)
        );
      });
    }
    const importedSubjectIds = new Set(imported.subjects.map(subject => subject.id));
    const importedLocations = packageItemLocations(imported);
    const currentLocations = packageItemLocations(current);

    // 「置き換え」で消えた現行レコードをcloud mergeが復活させないよう削除markerを作る。
    current?.subjects.forEach(subject => {
      if (!importedSubjectIds.has(subject.id)) imported.tombstones.subjects[subject.id] = deletionAt;
    });
    currentLocations.forEach((locations, itemId) => {
      const nextLocations = importedLocations.get(itemId);
      if (!nextLocations || !sameLocationSet(locations, nextLocations)) {
        imported.tombstones.items[itemId] = deletionAt;
      }
    });

    imported.updatedAt = revivedAt;
    imported.subjects = imported.subjects.map(subject => {
      delete imported.tombstones.subjects[subject.id];
      return { ...subject, updatedAt: revivedAt };
    });
    Object.values(imported.grades).forEach(terms => {
      Object.values(terms || {}).forEach(rows => {
        if (!Array.isArray(rows)) return;
        rows.forEach(item => {
          if (!item || typeof item !== 'object') return;
          if (item.id) {
            const previousLocations = currentLocations.get(String(item.id));
            if (!previousLocations || sameLocationSet(previousLocations, importedLocations.get(String(item.id)))) {
              delete imported.tombstones.items[item.id];
            }
          }
          item.updatedAt = revivedAt;
        });
      });
    });
    return imported;
  }

  async function importDataFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let parsed;
    let preview;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('ファイルが20MBを超えています。');
      parsed = JSON.parse(await file.text());
      preview = normalizedPackage(parsed);
      const confirmed = await showConfirm(
        'バックアップを読み込む',
        `${preview.subjects.length}科目を読み込みます。現在のデータは自動バックアップしてから置き換えます。`,
        '読み込む'
      );
      if (!confirmed) return;
    } catch (error) {
      console.error('Academic Report import failed.', error);
      showToast(error.message || 'バックアップを読み込めませんでした。', 'error');
      return;
    }
    clearTimeout(state.syncTimer);
    return enqueueSync(async () => {
      setSyncStatus('busy', '読込中');
      try {
        const imported = prepareImportedPackage(parsed, Date.now(), packageData());
        downloadJSON(packageData(), `academic-report-before-import-${japanDateStamp()}.json`);
        await applyPackage(imported, { scheduleSync: true });
        if (!state.syncConfig.syncEnabled || !isJsonBinId(state.syncConfig.binId)) setSyncStatus('local');
        else setSyncStatus('busy', '同期待ち');
        renderApp();
        closeDialog($('rc-settings-modal'));
        showToast('バックアップを読み込みました。');
      } catch (error) {
        console.error('Academic Report import failed.', error);
        setSyncStatus('error');
        showToast(error.message || 'バックアップを読み込めませんでした。', 'error');
      }
    });
  }

  async function clearAllData() {
    const confirmed = await showConfirm(
      '成績データを消去',
      '科目・得点・提出物をすべて消去します。実行前にJSONバックアップを自動保存します。同期設定は残ります。',
      '消去'
    );
    if (!confirmed) return;
    clearTimeout(state.syncTimer);
    return enqueueSync(async () => {
      setSyncStatus('busy', '消去中');
      downloadJSON(packageData(), `academic-report-before-clear-${japanDateStamp()}.json`);
      const deletedAt = Date.now();
      state.subjects.forEach(subject => { state.settings.tombstones.subjects[subject.id] = deletedAt; });
      Object.keys(state.grades).forEach(subjectId => tombstoneSubjectItems(subjectId, deletedAt));
      const transaction = state.db.transaction(['subjects', 'grades'], 'readwrite');
      transaction.objectStore('subjects').clear();
      transaction.objectStore('grades').clear();
      await transactionDone(transaction);
      state.subjects = [];
      state.grades = {};
      await markDataChanged();
      if (!state.syncConfig.syncEnabled || !isJsonBinId(state.syncConfig.binId)) setSyncStatus('local');
      else setSyncStatus('busy', '同期待ち');
      closeDialog($('rc-settings-modal'));
      renderApp();
      showToast('成績データを消去しました。バックアップはダウンロード済みです。');
    });
  }

  function openSettings() {
    $('rc-setting-year').value = `${ACADEMIC_PROFILE.academicYear}年度`;
    $('rc-setting-grade').value = `情報工学科 ${ACADEMIC_PROFILE.grade}年`;
    $('rc-setting-scheme').value = '令和7年度以前入学生（優・良・可・不可）';
    updateSyncUI();
    openDialog($('rc-settings-modal'));
  }

  function showConfirm(title, message, actionLabel = '実行') {
    const dialog = $('rc-confirm-modal');
    if (dialog.open) dialog.close('cancel');
    $('rc-confirm-title').textContent = title;
    $('rc-confirm-message').textContent = message;
    $('rc-confirm-ok').textContent = actionLabel;
    return new Promise(resolve => {
      state.confirmAction = resolve;
      openDialog(dialog);
    });
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `rc5-toast${type === 'error' ? ' is-error' : ''}`;
    toast.textContent = message;
    $('rc-toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 3600);
  }

  function handleSyncBadgeClick() {
    const connected = state.syncConfig.syncEnabled && isJsonBinId(state.syncConfig.binId);
    if (connected) manualSync();
    else openSettings();
  }

  function setupEventListeners() {
    $('rc-close-btn').addEventListener('click', () => { window.location.href = '../'; });
    $('rc-settings-btn').addEventListener('click', openSettings);
    $('rc-sync-badge-top').addEventListener('click', handleSyncBadgeClick);

    $('rc-term-tabs').addEventListener('click', async event => {
      const button = event.target.closest('[data-term]');
      if (!button || !SEMESTERS.includes(button.dataset.term)) return;
      state.semester = button.dataset.term;
      state.settings.currentSemester = state.semester;
      await saveSettingsOnly();
      renderApp();
    });
    $('rc-term-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = SEMESTERS.indexOf(state.semester);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? SEMESTERS.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + SEMESTERS.length) % SEMESTERS.length;
      document.querySelector(`#rc-term-tabs [data-term="${SEMESTERS[nextIndex]}"]`)?.click();
    });

    $('rc-subject-search').addEventListener('input', event => {
      state.subjectSearch = event.target.value;
      renderSubjectList();
    });
    $('rc-subject-filters').addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      state.subjectFilter = button.dataset.filter;
      renderSubjectList();
    });
    $('rc-subject-list').addEventListener('click', event => {
      const card = event.target.closest('[data-subject-id]');
      if (card) openSubjectDrawer(card.dataset.subjectId);
    });

    ['rc-add-subject-btn', 'rc-empty-add-btn'].forEach(id => $(id).addEventListener('click', () => openSubjectModal(false)));
    $('rc-quick-assignment-btn').addEventListener('click', () => openAssessmentModal('assignment'));
    $('rc-quick-test-btn').addEventListener('click', () => openAssessmentModal('quiz'));

    $('rc-modal-sub-cancel').addEventListener('click', closeSubjectModal);
    $('rc-modal-sub-save').addEventListener('click', saveSubjectModal);
    document.querySelectorAll('[data-subject-tab]').forEach(button => {
      button.addEventListener('click', () => {
        state.subjectModalTab = button.dataset.subjectTab;
        renderSubjectModalTabs();
      });
    });
    document.querySelector('.rc5-sheet-tabs')?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('[data-subject-tab]')];
      if (!tabs.length) return;
      event.preventDefault();
      const current = Math.max(0, tabs.indexOf(document.activeElement));
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click();
      tabs[next].focus();
    });
    $('rc-preset-search').addEventListener('input', renderPresetList);
    $('rc-preset-list').addEventListener('change', event => {
      const checkbox = event.target.closest('[data-preset-code]');
      if (!checkbox) return;
      if (checkbox.checked) state.selectedPresets.add(checkbox.dataset.presetCode);
      else state.selectedPresets.delete(checkbox.dataset.presetCode);
      $('rc-preset-selection-count').textContent = `${state.selectedPresets.size}科目を選択`;
    });
    $('rc-preset-select-all').addEventListener('click', () => {
      const allCodes = SYLLABUS_PRESETS.map(item => item.code);
      const allSelected = allCodes.every(code => state.selectedPresets.has(code));
      allCodes.forEach(code => allSelected ? state.selectedPresets.delete(code) : state.selectedPresets.add(code));
      $('rc-preset-select-all').textContent = allSelected ? '全25科目を選択' : '全選択を解除';
      renderPresetList();
    });

    $('rc-drawer-close-btn').addEventListener('click', closeSubjectDrawer);
    $('rc-delete-subject-btn').addEventListener('click', deleteSelectedSubject);
    $('rc-edit-subject-btn').addEventListener('click', openSubjectEditModal);
    $('rc-apply-preset-btn').addEventListener('click', applyPresetFromDrawer);
    $('rc-gpa-eligible').addEventListener('change', updateGpaPolicy);
    $('rc-gpa-exclusion-reason').addEventListener('change', updateGpaPolicy);
    $('rc-midterm-policy').addEventListener('click', event => {
      const button = event.target.closest('[data-policy]');
      const subject = getSubject(state.selectedSubjectId);
      if (button && subject) setMidtermPolicy(subject, button.dataset.policy);
    });
    $('rc-add-exam-btn').addEventListener('click', () => openAssessmentModal('exam', { subjectId: state.selectedSubjectId, semester: state.semester }));
    $('rc-drawer-regular-exams').addEventListener('change', event => {
      const input = event.target.closest('[data-exam-field]');
      const row = event.target.closest('[data-item-id]');
      if (input && row) updateExamField(row, input.dataset.examField, input);
    });
    $('rc-drawer-regular-exams').addEventListener('click', event => {
      const button = event.target.closest('[data-exam-action]');
      const row = event.target.closest('[data-item-id]');
      if (button && row) handleExamAction(row, button.dataset.examAction);
    });

    $('rc-add-category-btn').addEventListener('click', addCategory);
    $('rc-drawer-categories').addEventListener('change', event => {
      const field = event.target.closest('[data-category-field]');
      const row = event.target.closest('[data-category-id]');
      if (field && row) updateCategory(row, field.dataset.categoryField, field.value);
    });
    $('rc-drawer-categories').addEventListener('click', event => {
      const button = event.target.closest('[data-category-action="delete"]');
      const row = event.target.closest('[data-category-id]');
      if (button && row) deleteCategory(row);
    });

    $('rc-add-item-btn').addEventListener('click', () => openAssessmentModal('assignment', { subjectId: state.selectedSubjectId, semester: state.semester }));
    $('rc-drawer-items').addEventListener('click', event => {
      const button = event.target.closest('[data-item-action="edit"]');
      const row = event.target.closest('[data-item-id]');
      const subject = getSubject(state.selectedSubjectId);
      const item = subject && row ? getTermItems(subject.id).find(entry => entry.id === row.dataset.itemId) : null;
      if (button && item) openAssessmentModal(inferCategoryKind(getCategory(subject, item.categoryId)), { subjectId: subject.id, semester: state.semester, item });
    });

    $('rc-subject-edit-cancel').addEventListener('click', () => closeDialog($('rc-subject-edit-modal')));
    $('rc-subject-edit-form').addEventListener('submit', saveSubjectEdit);

    $('rc-assessment-cancel').addEventListener('click', () => closeDialog($('rc-assessment-modal')));
    $('rc-assessment-form').addEventListener('submit', saveAssessment);
    $('rc-assessment-delete').addEventListener('click', deleteAssessment);
    $('rc-assessment-kind').addEventListener('change', () => updateAssessmentCategories());
    $('rc-assessment-status').addEventListener('change', updateLateField);
    $('rc-assessment-subject').addEventListener('change', () => updateAssessmentCategories());
    $('rc-assessment-term').addEventListener('change', () => {
      const currentSubject = $('rc-assessment-subject').value;
      populateAssessmentSubjects(currentSubject, $('rc-assessment-term').value);
      updateAssessmentCategories();
    });

    $('rc-settings-close').addEventListener('click', () => closeDialog($('rc-settings-modal')));
    $('rc-sync-now-btn').addEventListener('click', manualSync);
    $('rc-sync-connect-btn').addEventListener('click', connectSyncKey);
    $('rc-sync-disconnect-btn').addEventListener('click', disconnectSync);
    $('rc-sync-copy-key-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.syncConfig.binId);
        showToast('同期キーをコピーしました。');
      } catch (error) {
        showToast('同期キーをコピーできませんでした。', 'error');
      }
    });
    $('rc-data-export-btn').addEventListener('click', exportData);
    $('rc-data-import-btn-trigger').addEventListener('click', () => $('rc-data-import-file').click());
    $('rc-data-import-file').addEventListener('change', importDataFile);
    $('rc-data-clear-btn').addEventListener('click', clearAllData);

    $('rc-confirm-modal').addEventListener('close', () => {
      const resolve = state.confirmAction;
      state.confirmAction = null;
      if (resolve) resolve($('rc-confirm-modal').returnValue === 'confirm');
    });

    document.querySelectorAll('.rc5-dialog').forEach(dialog => {
      dialog.addEventListener('close', () => {
        restoreDialogFocus(dialog);
        flushDeferredInteractionWork();
      });
      dialog.addEventListener('click', event => {
        if (event.target !== dialog || dialog.id === 'rc-confirm-modal') return;
        if (dialog.id === 'rc-detail-drawer') closeSubjectDrawer();
        else closeDialog(dialog);
      });
    });
  }

  async function initialize() {
    document.body.classList.add('rc5-lock-scroll');
    isolateToolSurface();
    setupEventListeners();
    try {
      state.db = await openDatabase();
      await readLocalState();
      if (!state.syncConfig.binId && state.syncConfig.disconnected !== true) {
        const cached = window.PWAConfigSync?.getCachedBinId?.('report_card');
        if (isJsonBinId(cached)) await setSyncKey(cached);
      }
      renderApp();
      if (state.syncConfig.syncEnabled && isJsonBinId(state.syncConfig.binId)) {
        enqueueSync(() => syncWithCloud({ silent: true }));
      }
    } catch (error) {
      console.error('Academic Report initialization failed.', error);
      $('rc-subject-list').innerHTML = '';
      $('rc-subject-empty').hidden = false;
      $('rc-subject-empty').querySelector('h3').textContent = 'データを読み込めませんでした';
      $('rc-subject-empty').querySelector('p').textContent = 'ページを再読み込みしてください。既存データは削除されていません。';
      showToast('Academic Reportの初期化に失敗しました。', 'error');
    }
  }

  window.triggerManualSync = manualSync;
  window.__REPORT_CARD_TEST__ = {
    calculateSubjectGrade,
    formatScoreForDisplay,
    getGradeInfo,
    getGPAPoints,
    japanDateStamp,
    mergePackages,
    prepareImportedPackage,
    packageData,
    getState: () => ({
      settings: structuredCloneSafe(state.settings),
      subjects: structuredCloneSafe(state.subjects),
      grades: structuredCloneSafe(state.grades),
      semester: state.semester,
      syncConfig: { ...state.syncConfig }
    })
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();

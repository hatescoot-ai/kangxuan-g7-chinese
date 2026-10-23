(function () {
  const BANK = window.KANGXUAN_CURRICULUM_BANK || { units: [] };
  const STORAGE_KEY = "kangxuan_g7_hanmo_state_v1";
  const SELECTED_UNITS_KEY = "kangxuan_g7_selected_units_v1";
  // GitHub Pages 是純靜態網站，沒有 /api；只有本機 server.py（localhost / 區網 IP）才有後端
  const HAS_BACKEND = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);

  const RANKS = [
    { name: "白丁", minXp: 0 },
    { name: "童生", minXp: 100 },
    { name: "秀才", minXp: 300 },
    { name: "舉人", minXp: 600 },
    { name: "貢士", minXp: 1000 },
    { name: "狀元", minXp: 1600 }
  ];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn("[Hanmo] Failed to load state from localStorage:", err);
    }
    return {
      user: { className: "701班", studentId: "70101", studentName: "林語晴" },
      xp: 120,
      studyDays: 1,
      unitScores: {}, // { "L01_easy": { bestScore: 90, attempts: 1 } }
      leitner: {}, // { qid: { box: 1, question: {...}, wrongCount: 1, lastSeen: "" } }
      notes: {}, // { unitId: "reflection text" }
      skillStats: {
        "語境字音字形": [0, 0],
        "詞語成語運用": [0, 0],
        "擷取訊息": [0, 0],
        "統整解釋": [0, 0],
        "寫作手法分析": [0, 0],
        "跨文本與素養評鑑": [0, 0]
      }
    };
  }

  let state = loadState();

  // 錯題本存的是題目副本：題庫更新後，用最新版本覆蓋；已下架（隔離）的題目自動移除
  (function syncLeitnerWithBank() {
    if (!state.leitner || !BANK.units || !BANK.units.length) return;
    const byId = {};
    BANK.units.forEach(u => Object.values(u.questions || {}).forEach(l => (l || []).forEach(q => { byId[q.id] = q; })));
    let changed = false;
    Object.keys(state.leitner).forEach(qid => {
      if (byId[qid]) {
        if (JSON.stringify(state.leitner[qid].question) !== JSON.stringify(byId[qid])) {
          state.leitner[qid].question = byId[qid];
          changed = true;
        }
      } else {
        delete state.leitner[qid];
        changed = true;
      }
    });
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("[Hanmo] Failed to sync Leitner state:", err);
      }
    }
  })();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[Hanmo] Failed to save state:", err);
    }
    updateHeaderUI();
  }

  function getRank(xp) {
    let cur = RANKS[0];
    for (const r of RANKS) {
      if (xp >= r.minXp) cur = r;
    }
    return cur.name;
  }

  function updateHeaderUI() {
    const rankEl = document.getElementById("user-rank-text");
    const nameEl = document.getElementById("user-name-label");
    const wrongBadge = document.getElementById("nav-wrong-badge");
    if (rankEl) rankEl.textContent = `${getRank(state.xp)}・${state.xp} 分`;
    if (nameEl) nameEl.textContent = `${state.user.studentId} ${state.user.studentName}`;
    if (wrongBadge) {
      const count = Object.values(state.leitner).filter(x => x.box < 5).length;
      wrongBadge.textContent = count;
    }
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setSafeHTML(container, htmlString) {
    if (!container) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");
    doc.querySelectorAll("script, iframe, object, embed").forEach(el => el.remove());
    container.replaceChildren(...Array.from(doc.body.childNodes));
  }

  const app = {
    currentView: "home",
    examFilter: "exam1",
    searchQuery: "",
    currentUnitId: "L01",
    studioTab: "cards", // cards | workbook | core | text
    quizSession: null,
    leitnerBoxFilter: 0,
    teacherTab: "analytics", // analytics | paper | syllabus | mobile
    showWorkbookAnswers: sessionStorage.getItem("kangxuan_g7_show_wb_ans") === "1",
    teacherWorkbookGuides: {},
    classStats: { submissions: [] },
    remoteMessages: [],

    toggleWorkbookAnswers() {
      this.showWorkbookAnswers = !this.showWorkbookAnswers;
      sessionStorage.setItem("kangxuan_g7_show_wb_ans", this.showWorkbookAnswers ? "1" : "0");
      if (this.showWorkbookAnswers && HAS_BACKEND) {
        this.fetchTeacherWorkbookGuides();
      }
      this.render();
    },

    fetchTeacherWorkbookGuides() {
      if (!HAS_BACKEND) return;
      fetch("/api/teacher-workbook-guides")
        .then(r => r.json())
        .then(d => {
          if (d && d.guides) {
            this.teacherWorkbookGuides = d.guides;
            this.render();
          }
        })
        .catch(err => console.warn("[Hanmo] Local teacher workbook guides not available:", err));
    },

    speakUnitText(uid) {
      if (!("speechSynthesis" in window)) {
        alert("您的瀏覽器不支援內建語音朗讀功能。");
        return;
      }
      window.speechSynthesis.cancel();
      const u = this.getUnit(uid);
      const text = `${u.title}，作者${u.author}。${u.textbook_excerpt || ""}`;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-TW";
      utter.rate = this.ttsRate || 1.0;
      window.speechSynthesis.speak(utter);
    },

    stopSpeakUnitText() {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },

    init() {
      updateHeaderUI();
      if (this.showWorkbookAnswers && HAS_BACKEND) {
        this.fetchTeacherWorkbookGuides();
      }
      this.render();
      this.fetchClassStats();

      // Keyboard shortcuts for quiz mode (Pain Point 1 solution: manual next + 1-4 keys)
      window.addEventListener("keydown", (e) => {
        if (this.currentView !== "quiz" || !this.quizSession || this.quizSession.finished) return;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
        const qs = this.quizSession;
        if (qs.mode === "sheet") return;
        if (!qs.answered) {
          if (["1", "a", "A"].includes(e.key)) { e.preventDefault(); this.answerQuestion(0); }
          if (["2", "b", "B"].includes(e.key)) { e.preventDefault(); this.answerQuestion(1); }
          if (["3", "c", "C"].includes(e.key)) { e.preventDefault(); this.answerQuestion(2); }
          if (["4", "d", "D"].includes(e.key)) { e.preventDefault(); this.answerQuestion(3); }
          if (["h", "H"].includes(e.key)) { e.preventDefault(); this.toggleClue(); }
        } else {
          if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
            e.preventDefault();
            this.nextQuestion();
          }
        }
      });
    },

    navigate(view, opts = {}) {
      if (this.currentView === "quiz" && this.quizSession && !this.quizSession.finished && this.quizSession.index > 0 && view !== "quiz") {
        if (!confirm("目前測驗尚未結束，確定要離開測驗嗎？")) return;
      }
      this.currentView = view;
      if (opts.unitId) this.currentUnitId = opts.unitId;
      document.querySelectorAll(".nav-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === view);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      this.render();
    },

    getUnit(uid) {
      return BANK.units.find(u => u.id === uid) || BANK.units[0];
    },

    render() {
      const root = document.getElementById("app-root");
      if (!root) return;
      if (this.currentView === "home") setSafeHTML(root, this.renderHome());
      else if (this.currentView === "studio") setSafeHTML(root, this.renderStudio());
      else if (this.currentView === "quiz") setSafeHTML(root, this.renderQuiz());
      else if (this.currentView === "leitner") setSafeHTML(root, this.renderLeitner());
      else if (this.currentView === "teacher") setSafeHTML(root, this.renderTeacher());
    },

    /* ================= HOME VIEW (15-UNIT INK-WASH ACADEMY MAP) ================= */
    renderHome() {
      const picked = this.getSelectedUnits();
      const units = BANK.units.filter(u => {
        if (!picked.includes(u.id)) return false;
        if (this.searchQuery) {
          const q = this.searchQuery.toLowerCase();
          const match = (u.title + u.author + u.genre + u.key_concepts.join(" ")).toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      });

      const masteredCount = Object.values(state.unitScores).filter(s => s.bestScore >= 80).length;
      const totalTiers = BANK.units.length * 3;
      const shortTitle = t => String(t).replace(/^(第[一二三四五六七八九十]+課|自學[一二三]|語文天地[一二三])\s*/, "");
      const lessonNo = t => (String(t).match(/^(第[一二三四五六七八九十]+課|自學[一二三]|語文天地[一二三])/) || [""])[0];

      return `
        <section class="hero">
          <div class="hero-main">
            <p class="eyebrow eyebrow-line">115 學年度・康軒版國一上</p>
            <h1 class="hero-title">一學期十五課，<br />一課一課讀懂。</h1>
            <p class="hero-desc">
              每一課都有<strong>課文賞析、生字注釋、知識圖卡</strong>，
              以及「基礎、統整、素養」三個層次的練習題。答錯的題目會自動收進錯題本，可以反覆練到熟。
            </p>
            <div class="hero-actions">
              <button class="btn btn-primary" onclick="app.startSelectedMock()">用選取的課次做模擬測驗 <span class="arrow">↗</span></button>
              <button class="btn btn-secondary" onclick="app.openStudio('L01')">從第一課開始讀 <span class="arrow">→</span></button>
            </div>
          </div>

          <aside class="hero-panel">
            <p class="eyebrow">我的學習紀錄</p>
            <dl class="hero-stats">
              <div><dt>題庫</dt><dd>${BANK.total_questions || 537}<small>題</small></dd></div>
              <div><dt>知識圖卡</dt><dd>${BANK.total_cards || 60}<small>張</small></dd></div>
              <div><dt>達 80 分的練習</dt><dd>${masteredCount}<small>／${totalTiers}</small></dd></div>
              <div><dt>錯題待複習</dt><dd>${Object.values(state.leitner).filter(x => x.box < 5).length}<small>題</small></dd></div>
            </dl>
            <button class="link-arrow" onclick="app.navigate('leitner')">打開錯題本 <span>→</span></button>
          </aside>
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <p class="eyebrow">先選範圍</p>
              <h2 class="section-title">這次要準備哪幾課？</h2>
              <p class="section-note">各校段考範圍不同，直接勾選要考的課次；選擇會記在這台裝置上。</p>
            </div>
            <div class="picker-actions">
              <button class="link-arrow" onclick="app.selectAllUnits()">全選</button>
              <span class="picker-sep">／</span>
              <button class="link-arrow" onclick="app.clearSelectedUnits()">全部取消</button>
            </div>
          </div>
          <div class="lesson-picker" role="group" aria-label="選擇課次">
            ${BANK.units.map(u => `
              <button class="lesson-chip ${picked.includes(u.id) ? 'on' : ''}" aria-pressed="${picked.includes(u.id)}" onclick="app.toggleUnitSelect('${esc(u.id)}')">
                <span class="lesson-chip-no">${esc(lessonNo(u.title))}</span>
                <span class="lesson-chip-name">${esc(shortTitle(u.title))}</span>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <p class="eyebrow">已選 ${picked.length} 課${this.searchQuery ? `・符合搜尋 ${units.length} 課` : ""}</p>
              <h2 class="section-title">挑一課，開始練習。</h2>
            </div>
            <input type="search" class="search-input" placeholder="搜尋課名、作者或修辭" value="${esc(this.searchQuery)}" oninput="app.setSearch(this.value)" />
          </div>

          <div class="units-grid">
            ${units.length ? units.map(u => this.renderUnitCard(u)).join("") : `<p class="empty-note">${picked.length ? `找不到符合「${esc(this.searchQuery)}」的課文。` : "還沒有選任何課次，請在上方勾選。"}</p>`}
          </div>
        </section>
      `;
    },

    renderUnitCard(u) {
      const done = lv => {
        const s = state.unitScores[`${u.id}_${lv}`];
        return s && s.bestScore >= 80 ? "mastered" : "";
      };
      const hasLocalGuide = Boolean(this.teacherWorkbookGuides[u.id] || (u.basic_drills && u.basic_drills.workbook_guide));

      return `
        <article class="unit-card">
          <div class="unit-meta">
            <span>${esc(u.week)}</span>
            <span>${esc(u.genre)}</span>
          </div>
          <h3 class="unit-title">${esc(u.title)}</h3>
          <p class="unit-author">${esc(u.author)}</p>

          <p class="core-q" title="${esc(u.core_questions[0] || '')}">${esc(String(u.core_questions[0] || '').replace(/^★\s*/, ''))}</p>

          <p class="unit-concepts">${(u.key_concepts || []).slice(0, 3).map(c => esc(c)).join("<span>・</span>")}</p>

          <div class="unit-group">
            <p class="unit-group-title">題目練習</p>
            <div class="tile-grid">
              <button class="box-tile ${done('easy')}" onclick="app.startQuiz('${u.id}', 'easy')"><span class="tile-level">Ⅰ</span>基礎</button>
              <button class="box-tile ${done('medium')}" onclick="app.startQuiz('${u.id}', 'medium')"><span class="tile-level">Ⅱ</span>統整</button>
              <button class="box-tile ${done('hard')}" onclick="app.startQuiz('${u.id}', 'hard')"><span class="tile-level">Ⅲ</span>素養</button>
              <button class="box-tile" onclick="app.startQuiz('${u.id}', 'textbook')">課本題</button>
              <button class="box-tile" onclick="app.startQuiz('${u.id}', 'workbook')">習作題</button>
              <button class="box-tile" onclick="app.startQuiz('${u.id}', 'all')">全課綜合</button>
            </div>
          </div>

          <div class="unit-group">
            <p class="unit-group-title">重點內容</p>
            <div class="tile-grid">
              <button class="box-tile" onclick="app.openStudio('${u.id}', 'text')">課文賞析</button>
              <button class="box-tile" onclick="app.openStudio('${u.id}', 'workbook')">生字注釋</button>
              <button class="box-tile" onclick="app.openStudio('${u.id}', 'cards')">知識圖卡</button>
              <button class="box-tile" onclick="app.openStudio('${u.id}', 'core')">核心問題</button>
              ${this.showWorkbookAnswers && hasLocalGuide
                ? `<button class="box-tile" onclick="app.openStudio('${u.id}', 'workbook')">習作詳解</button>`
                : `<button class="box-tile" onclick="app.speakUnitText('${u.id}')">朗讀課文</button>`}
              <button class="box-tile" onclick="app.openStudio('${u.id}', 'cards')">記憶口訣</button>
            </div>
          </div>
        </article>
      `;
    },

    getSelectedUnits() {
      const all = BANK.units.map(u => u.id);
      if (!this._selectedUnits) {
        let saved = null;
        try {
          saved = JSON.parse(localStorage.getItem(SELECTED_UNITS_KEY) || "null");
        } catch (err) {
          console.warn("[Hanmo] Failed to load selected units:", err);
        }
        this._selectedUnits = Array.isArray(saved) ? saved.filter(id => all.includes(id)) : all.slice();
      }
      return this._selectedUnits;
    },

    saveSelectedUnits(list) {
      this._selectedUnits = BANK.units.map(u => u.id).filter(id => list.includes(id));
      try {
        localStorage.setItem(SELECTED_UNITS_KEY, JSON.stringify(this._selectedUnits));
      } catch (err) {
        console.warn("[Hanmo] Failed to save selected units:", err);
      }
      this.render();
    },

    toggleUnitSelect(id) {
      const cur = this.getSelectedUnits();
      this.saveSelectedUnits(cur.includes(id) ? cur.filter(x => x !== id) : cur.concat(id));
    },

    selectAllUnits() {
      this.saveSelectedUnits(BANK.units.map(u => u.id));
    },

    clearSelectedUnits() {
      this.saveSelectedUnits([]);
    },

    startSelectedMock() {
      const picked = this.getSelectedUnits();
      const units = BANK.units.filter(u => picked.includes(u.id));
      if (!units.length) {
        alert("請先在「這次要準備哪幾課？」勾選要考的課次。");
        return;
      }
      const pool = [];
      units.forEach(u => {
        pool.push(...(u.questions.easy || []).slice(0, 1));
        pool.push(...(u.questions.medium || []).slice(0, 1));
        pool.push(...(u.questions.hard || []).slice(0, 1));
      });
      this.startQuiz(units[0].id, "mock", pool, `自選範圍模擬測驗（${units.length} 課）`);
    },

    setExamFilter(f) {
      this.examFilter = f;
      this.render();
    },

    setSearch(q) {
      this.searchQuery = q;
      this.render();
    },

    /* ================= KNOWLEDGE CARDS & AUDIO STUDIO VIEW ================= */
    openStudio(unitId, tab = "cards") {
      this.currentUnitId = unitId;
      this.studioTab = tab === "gallery" ? "cards" : tab;
      this.navigate("studio");
    },

    setStudioTab(tab) {
      this.studioTab = tab;
      this.render();
    },

    renderStudio() {
      const u = this.getUnit(this.currentUnitId);
      const savedNote = state.notes[u.id] || "";
      const drills = u.basic_drills || { phonetics: [], definitions: [] };
      const localGuideText = this.teacherWorkbookGuides[u.id] || drills.workbook_guide || "";

      return `
        <div class="studio-header">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
            <div>
              <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.4rem;">
                <span class="q-badge hard">${esc(u.exam)}・${esc(u.week)}</span>
                <span class="q-badge skill">${esc(u.genre)}</span>
              </div>
              <h1 class="serif-title" style="font-size:1.75rem;">${esc(u.title)} <span style="font-size:1.05rem;color:var(--ink-500);font-weight:600;">／ 作者：${esc(u.author)}</span></h1>
            </div>

            <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
              <select class="search-input" style="min-width:210px;font-weight:700;" onchange="app.openStudio(this.value)">
                ${BANK.units.map(item => `<option value="${item.id}" ${item.id === u.id ? 'selected' : ''}>${esc(item.title)} (${esc(item.author)})</option>`).join("")}
              </select>
              <button class="btn btn-secondary" style="border-color:#2c654d;color:#2c654d;" onclick="app.startQuiz('${u.id}', 'textbook')">課本基礎題</button>
              <button class="btn btn-secondary" style="border-color:#2c654d;color:#2c654d;" onclick="app.startQuiz('${u.id}', 'workbook')">習作練習題</button>
              <button class="btn btn-jade" onclick="app.startQuiz('${u.id}', 'easy')">簡單</button>
              <button class="btn btn-primary" onclick="app.startQuiz('${u.id}', 'medium')">中等</button>
              <button class="btn btn-secondary" onclick="app.startQuiz('${u.id}', 'hard')">困難</button>
            </div>
          </div>

          <div class="audio-bar">
            <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
              <span style="font-weight:600;color:var(--ink-900);">課文朗讀</span>
              <button class="btn btn-jade" style="padding:0.35rem 0.85rem;font-size:0.85rem;" onclick="app.speakUnitText('${u.id}')">播放課文朗讀</button>
              <button class="btn btn-secondary" style="padding:0.35rem 0.85rem;font-size:0.85rem;" onclick="app.stopSpeakUnitText()">停止朗讀</button>
            </div>
            <div style="display:flex;gap:0.35rem;align-items:center;">
              <span style="font-size:0.8rem;color:var(--ink-700);">語速：</span>
              <button class="student-btn" onclick="app.setAudioSpeed(0.85)">0.85x</button>
              <button class="student-btn" onclick="app.setAudioSpeed(1.0)">1.0x</button>
              <button class="student-btn" onclick="app.setAudioSpeed(1.25)">1.25x</button>
            </div>
          </div>

          <div style="display:flex;gap:0.5rem;margin-top:1.15rem;flex-wrap:wrap;">
            <button class="filter-chip ${this.studioTab === 'cards' ? 'active' : ''}" onclick="app.setStudioTab('cards')">視覺化知識圖卡</button>
            <button class="filter-chip ${this.studioTab === 'workbook' ? 'active' : ''}" onclick="app.setStudioTab('workbook')">${this.showWorkbookAnswers && localGuideText ? '課本基礎字音注釋 & 習作全詳解（本機教師已開啟）' : '課本基礎字音與注釋'}</button>
            <button class="filter-chip ${this.studioTab === 'core' ? 'active' : ''}" onclick="app.setStudioTab('core')">教學大綱核心問題與思考筆記</button>
            <button class="filter-chip ${this.studioTab === 'text' ? 'active' : ''}" onclick="app.setStudioTab('text')">課文導讀、注釋與賞析</button>
          </div>
        </div>

        ${this.studioTab === 'cards' ? `
          <div class="kcards-grid">
            ${(u.knowledge_cards || []).map((c, idx) => `
              <div class="kcard">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span class="kcard-tag">${esc(c.tag || c.card_type || `知識圖卡 ${idx+1}`)}</span>
                  <span style="font-size:0.78rem;color:var(--ink-500);">Card #0${idx+1}</span>
                </div>
                <h3 class="serif-title" style="font-size:1.25rem;color:var(--ink-900);">${esc(c.title)}</h3>
                <p style="font-size:0.88rem;color:var(--ink-500);margin-top:-0.4rem;">${esc(c.subtitle || '')}</p>
                <ul class="kcard-points">
                  ${(c.key_points || []).map(pt => `<li>${esc(pt)}</li>`).join("")}
                </ul>
                ${c.memory_hook ? `
                  <div class="memory-hook-box">
                    <strong>秒記口訣：</strong>${esc(c.memory_hook)}
                  </div>
                ` : ''}
              </div>
            `).join("")}
          </div>
        ` : ''}

        ${this.studioTab === 'workbook' ? `
          <div class="question-card" style="margin-bottom:1.25rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
              <h3 class="serif-title" style="font-size:1.3rem;">〈${esc(u.short_title)}〉課本基礎篇：重點國字注音與課文注釋總表</h3>
              <div style="display:flex;gap:0.5rem;">
                <button class="btn btn-primary" onclick="app.startQuiz('${u.id}', 'textbook')">立即測驗課本基礎題</button>
                <button class="btn btn-jade" onclick="app.startQuiz('${u.id}', 'workbook')">立即測驗習作練習題</button>
              </div>
            </div>

            <h4 style="margin-bottom:0.6rem;color:var(--indigo);">一、重點國字與注音</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:0.55rem;margin-bottom:1.35rem;">
              ${(drills.phonetics || []).map(p => `
                <div style="background:#f8f8f1;border:1px solid #d8dbcc;border-radius:8px;padding:0.55rem 0.75rem;display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-weight:700;">${esc(p.prompt)}</span>
                  <span style="background:#e9efe6;color:#20382e;font-weight:900;padding:2px 8px;border-radius:6px;">${esc(p.answer)}</span>
                </div>
              `).join("") || '<p style="color:var(--ink-500);">請參考課文注釋。</p>'}
            </div>

            <h4 style="margin-bottom:0.6rem;color:var(--jade);">二、課本核心詞語注釋</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.65rem;margin-bottom:1.35rem;">
              ${(drills.definitions || []).map(d => `
                <div style="background:#eef3ea;border:1px solid #cfdcc8;border-radius:8px;padding:0.65rem 0.85rem;">
                  <div style="font-weight:900;color:#20382e;margin-bottom:0.2rem;">【${esc(d.term)}】</div>
                  <div style="font-size:0.9rem;color:var(--ink-700);">${esc(d.meaning)}</div>
                </div>
              `).join("") || '<p style="color:var(--ink-500);">本自學／語文單元無單獨注釋表。</p>'}
            </div>

            ${this.showWorkbookAnswers && localGuideText ? `
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;">
                <h4 style="margin:0;color:var(--vermilion);">三、康軒習作教師版全大題詳解講義（本機教師專用模式）</h4>
                <button class="student-btn" style="border-color:var(--vermilion);color:var(--vermilion);" onclick="app.toggleWorkbookAnswers()">點此隱藏習作解答</button>
              </div>
              <div style="background:#fbf9f4;padding:1.25rem;border-radius:10px;border:1px solid var(--border-subtle);white-space:pre-line;font-size:0.95rem;line-height:1.8;">${esc(localGuideText)}</div>
            ` : `
              <div style="background:#f8f8f1;border:1.5px dashed #d8dbcc;border-radius:10px;padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;">
                <div style="color:var(--ink-700);font-size:0.92rem;font-weight:600;">
                  <strong>習作解答保護中（資安方案 A）</strong>：公開網站已實體移除習作解答原始資料（防範學生以 F12 開發者工具偷看）。學生請點擊上方「立即測驗習作練習題」；授課老師如需投映詳解，請於教師電腦本機端 (<code>127.0.0.1</code>) 後台開啟。
                </div>
              </div>
            `}
          </div>
        ` : ''}

        ${this.studioTab === 'core' ? `
          <div class="question-card">
            <h3 class="serif-title" style="font-size:1.3rem;margin-bottom:0.85rem;">115-1 教學大綱核心問題與素養省思</h3>
            <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1.25rem;">
              ${(u.core_questions || []).map(q => `
                <div style="background:var(--bg-Warm);border-left:4px solid var(--vermilion);padding:0.9rem 1.1rem;border-radius:8px;font-weight:700;">
                  ${esc(q)}
                </div>
              `).join("")}
            </div>

            <h4 style="margin-bottom:0.5rem;">我的課堂小組討論與閱讀思考筆記（自動儲存於本機與存檔密語）</h4>
            <textarea id="unit-note-input" rows="5" style="width:100%;padding:0.85rem;border-radius:10px;border:1px solid var(--border-subtle);font-size:0.95rem;" placeholder="請寫下你對本課核心問題的想法，課堂小組討論（占學期成績 10%）時可直接分享...">${esc(savedNote)}</textarea>
            <div style="margin-top:0.75rem;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.82rem;color:var(--ink-500);">配合教學進度表：小組討論與課堂活動占平時成績 10%</span>
              <button class="btn btn-jade" onclick="app.saveUnitNote('${u.id}')">儲存思考筆記</button>
            </div>
          </div>
        ` : ''}

        ${this.studioTab === 'text' ? `
          <div class="question-card">
            <h3 class="serif-title" style="font-size:1.3rem;margin-bottom:1rem;">〈${esc(u.short_title)}〉課本導讀、正文、注釋與賞析全文</h3>
            <div style="background:#fbf9f4;padding:1.35rem;border-radius:10px;border:1px solid var(--border-subtle);white-space:pre-line;font-size:0.98rem;line-height:1.85;">${esc(u.textbook_excerpt || '載入中...')}</div>
          </div>
        ` : ''}
      `;
    },

    setAudioSpeed(rate) {
      this.ttsRate = rate;
      if ("speechSynthesis" in window && window.speechSynthesis.speaking) {
        this.speakUnitText(this.currentUnitId);
      }
    },

    saveUnitNote(uid) {
      const el = document.getElementById("unit-note-input");
      if (!el) return;
      state.notes[uid] = el.value;
      saveState();
      alert("已儲存本課核心問題思考筆記！");
    },

    openLightbox(src, caption) {
      const modal = document.getElementById("img-modal");
      const img = document.getElementById("lightbox-img");
      const cap = document.getElementById("lightbox-caption");
      if (modal && img && cap) {
        img.src = src;
        cap.textContent = caption;
        modal.classList.add("open");
      }
    },

    /* ================= THREE-TIERED ADAPTIVE CAP QUIZ ENGINE ================= */
    startQuiz(unitId, difficulty = "easy", customPool = null, customTitle = null) {
      this.currentUnitId = unitId;
      const u = this.getUnit(unitId);
      const allUnitQs = [
        ...(u.questions.easy || []),
        ...(u.questions.medium || []),
        ...(u.questions.hard || [])
      ];
      let pool = [];
      if (customPool) {
        pool = customPool;
      } else if (difficulty === "textbook") {
        pool = allUnitQs.filter(q => q.source_group === "textbook");
        if (pool.length === 0) pool = [...(u.questions.easy || [])];
      } else if (difficulty === "workbook") {
        pool = allUnitQs.filter(q => q.source_group === "workbook");
        if (pool.length === 0) pool = [...(u.questions.easy || [])];
      } else if (difficulty === "all") {
        pool = [
          ...(u.questions.easy || []).slice(0, 6),
          ...(u.questions.medium || []).slice(0, 5),
          ...(u.questions.hard || []).slice(0, 4)
        ];
      } else {
        pool = [...(u.questions[difficulty] || [])];
      }

      if (pool.length === 0) {
        alert("此分類題庫準備中！");
        return;
      }

      this.quizSession = {
        unitId,
        unitTitle: customTitle || u.title,
        difficulty,
        questions: pool,
        index: 0,
        answered: false,
        selectedOption: null,
        showClue: false,
        correctCount: 0,
        wrongQids: [],
        answersLog: [],
        skillBreakdown: {},
        startTime: Date.now(),
        finished: false,
        mode: "single" // single | sheet
      };

      this.currentView = "quiz";
      document.querySelectorAll(".nav-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === "quiz");
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      this.render();
    },

    startExamMock(examId) {
      const examNames = {
        exam1: "第一次段考（L01~L03 + 自學一 + 語文一）會考模擬試卷",
        exam2: "第二次段考（L04~L06 + 語文二 + 自學二）會考模擬試卷",
        exam3: "期末評量（L07~L10 + 自學三）會考模擬試卷"
      };
      const examUnits = BANK.units.filter(u => u.exam_id === examId);
      let pool = [];
      examUnits.forEach(u => {
        pool.push(...(u.questions.easy || []).slice(0, 1));
        pool.push(...(u.questions.medium || []).slice(0, 1));
        pool.push(...(u.questions.hard || []).slice(0, 1));
      });
      this.startQuiz(examUnits[0]?.id || "L01", "mock", pool, examNames[examId]);
    },

    toggleQuizViewMode() {
      if (!this.quizSession) return;
      this.quizSession.mode = this.quizSession.mode === "single" ? "sheet" : "single";
      this.render();
    },

    toggleClue() {
      if (!this.quizSession) return;
      this.quizSession.showClue = !this.quizSession.showClue;
      this.render();
    },

    answerQuestion(optIdx) {
      const qs = this.quizSession;
      if (!qs || qs.answered) return;
      const q = qs.questions[qs.index];
      qs.answered = true;
      qs.selectedOption = optIdx;
      const isCorrect = optIdx === q.answer;

      // Track skill breakdown
      const sk = q.cap_skill || "統整解釋";
      if (!qs.skillBreakdown[sk]) qs.skillBreakdown[sk] = [0, 0];
      qs.skillBreakdown[sk][1] += 1;
      if (!state.skillStats[sk]) state.skillStats[sk] = [0, 0];
      state.skillStats[sk][1] += 1;

      if (isCorrect) {
        qs.correctCount += 1;
        qs.skillBreakdown[sk][0] += 1;
        state.skillStats[sk][0] += 1;
        state.xp += (q.difficulty === "hard" ? 20 : q.difficulty === "medium" ? 15 : 10);
        // If in Leitner box, promote box!
        if (state.leitner[q.id]) {
          state.leitner[q.id].box = Math.min(5, state.leitner[q.id].box + 1);
          state.leitner[q.id].lastSeen = new Date().toLocaleDateString("zh-TW");
        }
      } else {
        qs.wrongQids.push(q.id);
        // Add or reset to Box 1 in Leitner Wrong-Question Book
        state.leitner[q.id] = {
          box: 1,
          question: q,
          unitTitle: qs.unitTitle,
          wrongCount: (state.leitner[q.id]?.wrongCount || 0) + 1,
          lastSeen: new Date().toLocaleDateString("zh-TW")
        };
      }

      qs.answersLog.push({ qid: q.id, selected: optIdx, answer: q.answer, isCorrect });
      saveState();
      this.render();
    },

    nextQuestion() {
      const qs = this.quizSession;
      if (!qs) return;
      if (qs.index + 1 < qs.questions.length) {
        qs.index += 1;
        qs.answered = false;
        qs.selectedOption = null;
        qs.showClue = false;
        this.render();
      } else {
        this.finishQuiz();
      }
    },

    finishQuiz() {
      const qs = this.quizSession;
      if (!qs || qs.finished) return;
      qs.finished = true;
      qs.timeSpentSec = Math.max(1, Math.round((Date.now() - qs.startTime) / 1000));
      qs.score = Math.round((qs.correctCount / qs.questions.length) * 100);

      const key = `${qs.unitId}_${qs.difficulty}`;
      const prev = state.unitScores[key] || { bestScore: 0, attempts: 0 };
      state.unitScores[key] = {
        bestScore: Math.max(prev.bestScore, qs.score),
        attempts: prev.attempts + 1
      };
      saveState();

      // Automatically submit to local Teacher Backend
      const payload = {
        student_id: state.user.studentId,
        student_name: state.user.studentName,
        class_name: state.user.className,
        unit_id: qs.unitId,
        difficulty: qs.difficulty,
        score: qs.score,
        correct: qs.correctCount,
        total: qs.questions.length,
        time_spent_sec: qs.timeSpentSec,
        wrong_qids: qs.wrongQids,
        skill_breakdown: qs.skillBreakdown
      };
      const localSubs = JSON.parse(localStorage.getItem("kangxuan_g7_local_subs") || "[]");
      localSubs.unshift({ ...payload, timestamp: new Date().toLocaleString("zh-TW") });
      localStorage.setItem("kangxuan_g7_local_subs", JSON.stringify(localSubs.slice(0, 100)));
      if (HAS_BACKEND) {
        fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(() => this.fetchClassStats()).catch(err => console.warn("[Hanmo] Submit sync warning:", err));
      } else {
        this.fetchClassStats();
      }

      this.render();
    },

    renderQuiz() {
      if (!this.quizSession) {
        this.startQuiz(this.currentUnitId || "L01", "easy");
      }
      const qs = this.quizSession;
      const diffNames = {
        easy: "簡單・基礎奠基",
        medium: "中等・會考統整",
        hard: "困難・素養評鑑",
        textbook: "課本基礎題專練（字音・注釋・應用練習・延伸小練兵）",
        workbook: "習作練習題專練（字音辨義・成語填空・悅讀挑戰）",
        all: "三級綜合練習",
        mock: "段考跨課會考模考",
        leitner: "錯題本專攻重練"
      };

      if (qs.finished) {
        return this.renderQuizReport(qs, diffNames[qs.difficulty] || qs.difficulty);
      }

      const q = qs.questions[qs.index];
      const pct = Math.round(((qs.index + (qs.answered ? 1 : 0)) / qs.questions.length) * 100);

      return `
        <div class="quiz-container">
          <div class="quiz-topbar">
            <div>
              <div style="font-size:0.82rem;color:var(--ink-500);font-weight:700;">
                ${esc(qs.unitTitle)} ｜ ${esc(diffNames[qs.difficulty] || qs.difficulty)}
              </div>
              <div style="font-size:1.1rem;font-weight:900;">
                第 ${qs.index + 1} / ${qs.questions.length} 題
                <span style="font-size:0.84rem;color:var(--jade);margin-left:0.6rem;">✓ 答對 ${qs.correctCount} 題</span>
              </div>
            </div>

            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
              <select class="search-input" style="min-width:145px;padding:0.35rem 0.65rem;" onchange="app.startQuiz(this.value, '${qs.difficulty === 'mock' ? 'medium' : qs.difficulty}')">
                ${BANK.units.map(u => `<option value="${u.id}" ${u.id === qs.unitId ? 'selected' : ''}>${esc(u.title)}</option>`).join("")}
              </select>
              <button class="student-btn ${qs.difficulty === 'textbook' ? 'active' : ''}" onclick="app.startQuiz('${qs.unitId}', 'textbook')">課本基礎</button>
              <button class="student-btn ${qs.difficulty === 'workbook' ? 'active' : ''}" onclick="app.startQuiz('${qs.unitId}', 'workbook')">習作練習</button>
              <button class="student-btn ${qs.difficulty === 'easy' ? 'active' : ''}" onclick="app.startQuiz('${qs.unitId}', 'easy')">簡單</button>
              <button class="student-btn ${qs.difficulty === 'medium' ? 'active' : ''}" onclick="app.startQuiz('${qs.unitId}', 'medium')">中等</button>
              <button class="student-btn ${qs.difficulty === 'hard' ? 'active' : ''}" onclick="app.startQuiz('${qs.unitId}', 'hard')">困難</button>
              <button class="student-btn" onclick="app.toggleQuizViewMode()">
                ${qs.mode === 'single' ? '切換整卷預覽' : '切換成單題作答'}
              </button>
            </div>

            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
          </div>

          ${qs.mode === "sheet" ? this.renderSheetPreview(qs) : `
            <div class="question-card">
              <div class="q-meta-row">
                <span class="q-badge ${q.difficulty}">${q.difficulty === 'easy' ? '簡單・基礎奠基' : q.difficulty === 'medium' ? '中等・會考統整' : '困難・素養評鑑'}</span>
                <span class="q-badge skill">會考能力：${esc(q.cap_skill)}</span>
                <span class="q-badge" style="background:#f1ebe0;color:var(--ink-700);">${esc(String(q.source_badge || '康軒題庫改編').replace(/^★\s*/, ''))}</span>
                <button class="student-btn" style="margin-left:auto;" onclick="app.toggleClue()">${qs.showClue ? '隱藏解題線索' : '查看解題線索 (快捷鍵 H)'}</button>
              </div>

              ${qs.showClue ? `
                <div style="background:var(--amber-light);border:1px dashed var(--amber);padding:0.7rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:0.9rem;color:#7a5a24;">
                  <strong>解題關鍵線索：</strong>${esc(q.clue)}
                </div>
              ` : ''}

              ${q.passage ? `<div class="q-passage-box">${esc(q.passage)}</div>` : ''}

              <div class="q-stem">${esc(q.stem)}</div>

              <div class="options-list">
                ${q.options.map((opt, idx) => {
                  let cls = "";
                  if (qs.answered) {
                    if (idx === q.answer) cls = "correct";
                    else if (idx === qs.selectedOption) cls = "wrong";
                  }
                  const letter = "ABCD"[idx];
                  return `
                    <button class="option-btn ${cls}" ${qs.answered ? 'disabled' : ''} onclick="app.answerQuestion(${idx})">
                      <span class="opt-letter">${letter}</span>
                      <span style="flex:1;">${esc(opt)}</span>
                    </button>
                  `;
                }).join("")}
              </div>

              ${qs.answered ? `
                <div class="feedback-panel">
                  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.85rem;">
                    <div style="font-size:1.1rem;font-weight:900;color:${qs.selectedOption === q.answer ? 'var(--jade)' : 'var(--vermilion)'};">
                      ${qs.selectedOption === q.answer ? '答對了！觀念非常精準！' : `答錯了！正確答案是 (${"ABCD"[q.answer]})，已自動收入「五盒錯題本」第 1 盒`}
                    </div>
                    <button class="btn btn-primary" onclick="app.nextQuestion()">
                      ${qs.index + 1 < qs.questions.length ? '下一題 → (或按空白鍵 Space)' : '查看會考素養診斷報告 →'}
                    </button>
                  </div>

                  <div style="background:#f8f5ee;padding:1rem 1.15rem;border-radius:8px;border-left:4px solid var(--jade);font-size:0.94rem;">
                    <strong>完整詳解與誘答診斷：</strong><br/>
                    ${esc(q.explanation)}
                  </div>

                  ${q.expert_strategy && q.expert_strategy.length ? `
                    <div class="strategy-steps">
                      <h4>閱讀專家三步拆解（108課綱會考解題思維）：</h4>
                      <ul>
                        ${q.expert_strategy.map(st => `<li>${esc(st)}</li>`).join("")}
                      </ul>
                    </div>
                  ` : ''}
                </div>
              ` : `
                <div style="margin-top:1rem;font-size:0.8rem;color:var(--ink-500);text-align:right;">
                  鍵盤快捷鍵：按 <strong>1~4</strong> 或 <strong>A~D</strong> 作答，作答後按 <strong>Space / Enter</strong> 進入下一題
                </div>
              `}
            </div>
          `}
        </div>
      `;
    },

    renderSheetPreview(qs) {
      return `
        <div class="question-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h3 class="serif-title">整卷瀏覽模式（共 ${qs.questions.length} 題，選項皆已重新編排）</h3>
            <button class="btn btn-primary" onclick="app.toggleQuizViewMode()">回到單題作答</button>
          </div>
          ${qs.questions.map((q, i) => `
            <div style="padding:1rem 0;border-bottom:1px solid var(--border-subtle);">
              <div style="font-size:0.8rem;color:var(--indigo);font-weight:700;margin-bottom:0.3rem;">
                第 ${i+1} 題 ｜ [${esc(q.cap_skill)}] (${q.difficulty})
              </div>
              ${q.passage ? `<div class="q-passage-box" style="padding:0.75rem;font-size:0.88rem;">${esc(q.passage)}</div>` : ''}
              <div style="font-weight:800;margin-bottom:0.5rem;">${esc(q.stem)}</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.4rem;font-size:0.92rem;">
                ${q.options.map((o, idx) => `<div>(${"ABCD"[idx]}) ${esc(o)}</div>`).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    },

    renderQuizReport(qs, diffTitle) {
      const reportCodeObj = {
        sid: state.user.studentId,
        name: state.user.studentName,
        cls: state.user.className,
        uid: qs.unitId,
        diff: qs.difficulty,
        score: qs.score,
        correct: qs.correctCount,
        total: qs.questions.length,
        sec: qs.timeSpentSec,
        wrong: qs.wrongQids
      };
      const reportCode = "KX115-" + btoa(unescape(encodeURIComponent(JSON.stringify(reportCodeObj))));

      let nextDiff = "medium";
      let nextMsg = "表現優異！建議挑戰下一階難度，深化會考素養推理能力！";
      if (qs.score < 70) {
        nextDiff = "easy";
        nextMsg = "建議先回顧本課「知識圖卡」，並到「五盒錯題本」把剛剛答錯的題目重練一次！";
      } else if (qs.difficulty === "medium" && qs.score >= 80) {
        nextDiff = "hard";
        nextMsg = "中等統整已過關！推薦挑戰「困難・素養評鑑題組」！";
      } else if (qs.difficulty === "hard" && qs.score >= 80) {
        nextDiff = "all";
        nextMsg = "本課最高難度也達標了，可以換下一課，或到錯題本複習。";
      }

      return `
        <div class="quiz-container">
          <div class="question-card" style="text-align:center;">
            <span class="q-badge hard">108課綱會考素養診斷報告</span>
            <h2 class="serif-title" style="font-size:1.8rem;margin:0.6rem 0 0.25rem;">${esc(qs.unitTitle)} — ${esc(diffTitle)}</h2>
            <p style="color:var(--ink-500);font-size:0.9rem;">學生：${esc(state.user.className)} ${esc(state.user.studentId)} ${esc(state.user.studentName)} ｜ 耗時：${qs.timeSpentSec} 秒</p>

            <div style="display:flex;justify-content:center;align-items:center;gap:2.5rem;margin:1.5rem 0;flex-wrap:wrap;">
              <div>
                <div style="font-size:3.4rem;font-weight:900;color:${qs.score >= 80 ? 'var(--jade)' : qs.score >= 60 ? 'var(--amber)' : 'var(--vermilion)'};">
                  ${qs.score} <span style="font-size:1.2rem;">分</span>
                </div>
                <div style="font-size:0.9rem;color:var(--ink-700);font-weight:700;">
                  答對 ${qs.correctCount} / ${qs.questions.length} 題
                </div>
              </div>

              <!-- 6-Axis CAP Skill Breakdown Bars -->
              <div style="text-align:left;min-width:300px;background:#faf8f3;padding:1rem 1.25rem;border-radius:12px;border:1px solid var(--border-subtle);">
                <div style="font-weight:800;font-size:0.9rem;margin-bottom:0.5rem;color:var(--indigo);">本次測驗會考素養向度分析：</div>
                ${Object.entries(qs.skillBreakdown).map(([sk, [c, t]]) => {
                  const p = Math.round((c / t) * 100);
                  return `
                    <div style="margin-bottom:0.45rem;">
                      <div style="display:flex;justify-content:space-between;font-size:0.82rem;font-weight:700;">
                        <span>${esc(sk)}</span>
                        <span>${c}/${t} (${p}%)</span>
                      </div>
                      <div style="height:6px;background:#e5dec9;border-radius:99px;overflow:hidden;">
                        <div style="height:100%;width:${p}%;background:${p >= 80 ? 'var(--jade)' : p >= 60 ? 'var(--amber)' : 'var(--vermilion)'};"></div>
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>

            <div style="background:var(--indigo-light);border-radius:10px;padding:0.9rem 1.2rem;margin-bottom:1.25rem;font-weight:700;color:var(--indigo);">
              <strong>適性學習引導建議：</strong>${esc(nextMsg)}
            </div>

            <!-- Homework Report Code for Teacher (Solves Pain Point 4) -->
            <div style="background:#fbf9f4;border:1px dashed var(--border-subtle);padding:0.9rem;border-radius:10px;margin-bottom:1.35rem;text-align:left;">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">
                <span style="font-size:0.85rem;font-weight:800;">班級平時成績回報碼（已自動同步至教師後台，亦可複製繳交至 Google Classroom）：</span>
                <button class="btn btn-secondary" style="padding:0.3rem 0.75rem;font-size:0.8rem;" onclick="navigator.clipboard.writeText('${reportCode}');alert('已複製班級回報碼！')">複製回報碼</button>
              </div>
              <input readonly value="${reportCode}" style="width:100%;margin-top:0.45rem;padding:0.4rem 0.6rem;font-family:monospace;font-size:0.78rem;border:1px solid var(--border-subtle);border-radius:6px;background:#fff;" />
            </div>

            <div style="display:flex;justify-content:center;gap:0.75rem;flex-wrap:wrap;">
              <button class="btn btn-primary" onclick="app.startQuiz('${qs.unitId}', '${nextDiff}')">建議的下一個練習 (${nextDiff === 'easy' ? '簡單' : nextDiff === 'medium' ? '中等' : nextDiff === 'hard' ? '困難' : '綜合'})</button>
              <button class="btn btn-jade" onclick="app.openStudio('${qs.unitId}')">複習本課知識圖卡</button>
              ${qs.wrongQids.length > 0 ? `<button class="btn btn-secondary" onclick="app.navigate('leitner')">前往五盒錯題本 (${qs.wrongQids.length}題待複習)</button>` : ''}
              <button class="btn btn-secondary" onclick="app.navigate('home')">回到課程首頁</button>
            </div>
          </div>
        </div>
      `;
    },

    /* ================= LEITNER 5-BOX SPACED REPETITION WRONG-QUESTION BOOK ================= */
    renderLeitner() {
      const allItems = Object.entries(state.leitner).map(([qid, item]) => ({ qid, ...item }));
      const boxCounts = [1, 2, 3, 4, 5].map(b => allItems.filter(x => x.box === b).length);
      const filtered = this.leitnerBoxFilter === 0 ? allItems : allItems.filter(x => x.box === this.leitnerBoxFilter);

      return `
        <div class="studio-header">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
            <div>
              <h1 class="serif-title" style="font-size:1.65rem;">錯題本：五盒間隔複習</h1>
              <p style="font-size:0.9rem;color:var(--ink-500);">
                答錯的題目會先放進第 1 盒；重練答對就往後移一盒，到第 5 盒代表已經熟練。
              </p>
            </div>
            <div style="display:flex;gap:0.6rem;">
              <button class="btn btn-primary" onclick="app.startLeitnerDrill()">開始錯題練習 (${allItems.filter(x => x.box < 5).length} 題)</button>
            </div>
          </div>
        </div>

        <div class="leitner-boxes">
          ${[
            { b: 1, name: "第 1 盒：剛答錯", desc: "剛答錯・需立即複習" },
            { b: 2, name: "第 2 盒：初醒悟", desc: "已答對 1 次" },
            { b: 3, name: "第 3 盒：漸熟練", desc: "已連對 2 次" },
            { b: 4, name: "第 4 盒：準精通", desc: "已連對 3 次" },
            { b: 5, name: "第 5 盒：已熟練", desc: "徹底掌握・免再考" }
          ].map(info => `
            <div class="leitner-box ${this.leitnerBoxFilter === info.b ? 'active' : ''}" role="button" tabindex="0" onclick="app.setLeitnerFilter(${info.b})">
              <div style="font-weight:800;font-size:0.95rem;">${info.name}</div>
              <div style="font-size:1.8rem;font-weight:900;color:var(--vermilion);margin:0.25rem 0;">${boxCounts[info.b - 1]} <span style="font-size:0.85rem;">題</span></div>
              <div style="font-size:0.75rem;color:var(--ink-500);">${info.desc}</div>
            </div>
          `).join("")}
        </div>

        ${filtered.length === 0 ? `
          <div class="question-card" style="text-align:center;padding:3rem 1.5rem;">
                        <h3 class="serif-title">目前此盒沒有錯題紀錄！</h3>
            <p style="color:var(--ink-500);margin:0.5rem 0 1.25rem;">前往 15 單元進行三級難度練習，答錯的題目會自動收錄於此並附上閱讀專家三步拆解。</p>
            <button class="btn btn-primary" onclick="app.navigate('home')">回到課程首頁</button>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:1rem;">
            ${filtered.map(item => {
              const q = item.question;
              return `
                <div class="question-card">
                  <div class="q-meta-row">
                    <span class="q-badge hard">目前位於：第 ${item.box} 盒</span>
                    <span class="q-badge skill">${esc(item.unitTitle)}｜${esc(q.cap_skill)}</span>
                    <span style="font-size:0.8rem;color:var(--ink-500);">累計答錯 ${item.wrongCount} 次</span>
                  </div>
                  ${q.passage ? `<div class="q-passage-box">${esc(q.passage)}</div>` : ''}
                  <div class="q-stem" style="font-size:1.05rem;">${esc(q.stem)}</div>
                  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0.5rem;margin-bottom:0.85rem;">
                    ${q.options.map((opt, idx) => `
                      <div style="padding:0.55rem 0.8rem;border-radius:6px;border:1px solid ${idx === q.answer ? 'var(--jade)' : 'var(--border-subtle)'};background:${idx === q.answer ? 'var(--jade-light)' : '#fff'};font-weight:${idx === q.answer ? '800' : '400'};">
                        (${"ABCD"[idx]}) ${esc(opt)} ${idx === q.answer ? '✓' : ''}
                      </div>
                    `).join("")}
                  </div>
                  <div style="background:#f8f5ee;padding:0.75rem 1rem;border-radius:8px;font-size:0.88rem;">
                    <strong>詳解診斷：</strong>${esc(q.explanation)}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        `}
      `;
    },

    setLeitnerFilter(b) {
      this.leitnerBoxFilter = this.leitnerBoxFilter === b ? 0 : b;
      this.render();
    },

    startLeitnerDrill() {
      const activeWrong = Object.values(state.leitner)
        .filter(x => x.box < 5)
        .map(x => x.question);
      if (activeWrong.length === 0) {
        alert("目前第 1～4 盒沒有待複習的錯題！請先到各課練習。");
        return;
      }
      this.startQuiz("L01", "leitner", activeWrong, "錯題練習");
    },

    /* ================= TEACHER BACKEND, GRADEBOOK & DUAL-COLUMN EXAM GENERATOR ================= */
    fetchClassStats() {
      const localSubs = JSON.parse(localStorage.getItem("kangxuan_g7_local_subs") || "[]");
      fetch("./data/submissions.json")
        .then(r => r.json())
        .then(seedSubs => {
          const merged = [...localSubs, ...(Array.isArray(seedSubs) ? seedSubs : [])];
          this.classStats = { submissions: merged };
          if (this.currentView === "teacher") this.render();
        })
        .catch(err => {
          console.warn("[Hanmo] Falling back to local submissions:", err);
          this.classStats = { submissions: localSubs };
        });
    },

    fetchRemoteMessages() {
      // [QA 2026-10-23] 推播頻道不再寫在公開網站；只透過本機 server.py 讀取 .secrets
      if (!HAS_BACKEND) {
        this.remoteMessages = [];
        return;
      }
      fetch("/api/remote-messages")
        .then(r => r.json())
        .then(data => {
          const msgs = Array.isArray(data && data.messages) ? data.messages : [];
          this.remoteMessages = msgs.slice(-15);
          if (this.currentView === "teacher") this.render();
        })
        .catch(err => console.warn("[Hanmo] Remote messages fetch warning:", err));
    },

    setTeacherTab(t) {
      this.teacherTab = t;
      if (t === "mobile") this.fetchRemoteMessages();
      this.render();
    },

    renderTeacher() {
      const subs = this.classStats.submissions || [];
      const avgScore = subs.length ? Math.round(subs.reduce((a, b) => a + (Number(b.score) || 0), 0) / subs.length) : 0;

      return `
        <div class="studio-header no-print">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
            <div>
              <span class="q-badge hard">115-1 國文科共備教師團隊：黃煌宜、吳家羽、程昱霖、鄞安妤</span>
              <h1 class="serif-title" style="font-size:1.7rem;margin-top:0.35rem;">教師共備、班級診斷與雙欄出卷後台</h1>
            </div>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
              <button class="btn ${this.showWorkbookAnswers ? 'btn-jade' : 'btn-primary'}" style="font-weight:800;box-shadow:var(--shadow-sm);" onclick="app.toggleWorkbookAnswers()">
                ${this.showWorkbookAnswers ? '習作解答：本機已開放（點此隱藏）' : '習作解答：預設隱藏中（本機點此開啟）'}
              </button>
              <button class="filter-chip ${this.teacherTab === 'analytics' ? 'active' : ''}" onclick="app.setTeacherTab('analytics')">班級作答診斷與學期配分</button>
              <button class="filter-chip ${this.teacherTab === 'paper' ? 'active' : ''}" onclick="app.setTeacherTab('paper')">會考雙欄出卷與列印中心</button>
              <button class="filter-chip ${this.teacherTab === 'syllabus' ? 'active' : ''}" onclick="app.setTeacherTab('syllabus')">115-1 教學進度與核心問題總表</button>
              <button class="filter-chip ${this.teacherTab === 'mobile' ? 'active' : ''}" onclick="app.setTeacherTab('mobile')">手機遠端通知中心 (ntfy)</button>
            </div>
          </div>
        </div>

        ${this.teacherTab === "analytics" ? this.renderTeacherAnalytics(subs, avgScore) : ""}
        ${this.teacherTab === "paper" ? this.renderTeacherPaperGenerator() : ""}
        ${this.teacherTab === "syllabus" ? this.renderTeacherSyllabus() : ""}
        ${this.teacherTab === "mobile" ? this.renderTeacherMobile() : ""}
      `;
    },

    renderTeacherAnalytics(subs, avgScore) {
      return `
        <div class="dashboard-grid">
          <div class="kpi-card">
            <div style="font-size:0.82rem;color:var(--ink-500);font-weight:700;">累計班級測驗繳交數</div>
            <div class="kpi-num">${subs.length} <span style="font-size:0.95rem;">筆</span></div>
            <div style="font-size:0.78rem;color:var(--jade);">支援線上即時同步 + 離線回報碼匯入</div>
          </div>
          <div class="kpi-card">
            <div style="font-size:0.82rem;color:var(--ink-500);font-weight:700;">全班平均正確率</div>
            <div class="kpi-num" style="color:var(--jade);">${avgScore}%</div>
            <div style="font-size:0.78rem;color:var(--ink-500);">對應課次卷／小考平時成績 (20%)</div>
          </div>
          <div class="kpi-card">
            <div style="font-size:0.82rem;color:var(--ink-500);font-weight:700;">115-1 學期成績配分比重</div>
            <div style="font-size:0.88rem;font-weight:800;margin-top:0.35rem;line-height:1.5;">
              • 三次定期評量：50%<br/>
              • 作業/習作/作文：20% ｜ 課次卷/小考：20%<br/>
              • 小組討論與課堂活動：10%
            </div>
          </div>
        </div>

        <div class="question-card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
            <h3 class="serif-title">貼上學生「班級回報碼 (KX115-...)」批次匯入平時成績</h3>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;flex:1 1 320px;max-width:520px;">
              <input id="inp-report-code" class="search-input" style="flex:1 1 260px;border-radius:8px;" placeholder="貼上學生的 KX115-... 回報碼" />
              <button class="btn btn-jade" onclick="app.importReportCode()">匯入成績</button>
              <button class="btn btn-secondary" onclick="app.exportSubmissionsCsv()">匯出成績單 CSV</button>
            </div>
          </div>

          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>繳交時間</th>
                  <th>班級</th>
                  <th>座號</th>
                  <th>姓名</th>
                  <th>單元</th>
                  <th>難度</th>
                  <th>成績</th>
                  <th>答對/題數</th>
                  <th>作答秒數</th>
                  <th>待加強錯題代號</th>
                </tr>
              </thead>
              <tbody>
                ${subs.map(s => {
                  const sc = Math.max(0, Math.min(100, Number(s.score) || 0));
                  const corr = Math.max(0, Number(s.correct) || 0);
                  const tot = Math.max(1, Number(s.total) || 0);
                  const sec = Math.max(0, Number(s.time_spent_sec) || 0);
                  const diffSafe = ["textbook", "workbook", "easy", "medium", "hard", "all", "mock", "leitner"].includes(s.difficulty) ? s.difficulty : "easy";
                  return `
                  <tr>
                    <td>${esc(s.timestamp)}</td>
                    <td>${esc(s.class_name)}</td>
                    <td>${esc(s.student_id)}</td>
                    <td><strong>${esc(s.student_name)}</strong></td>
                    <td>${esc(s.unit_id)}</td>
                    <td><span class="q-badge ${esc(diffSafe)}">${esc(diffSafe)}</span></td>
                    <td><strong style="color:${sc >= 80 ? 'var(--jade)' : sc >= 60 ? 'var(--amber)' : 'var(--vermilion)'};">${sc} 分</strong></td>
                    <td>${corr} / ${tot}</td>
                    <td>${sec}s</td>
                    <td style="font-size:0.78rem;color:var(--vermilion);">${esc((Array.isArray(s.wrong_qids) ? s.wrong_qids : []).join(", ") || "全對")}</td>
                  </tr>
                `;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    importReportCode() {
      const el = document.getElementById("inp-report-code");
      if (!el || !el.value.trim()) return;
      const raw = el.value.trim();
      if (!raw.startsWith("KX115-")) {
        alert("回報碼格式不正確（需以 KX115- 開頭）！");
        return;
      }
      try {
        const obj = JSON.parse(decodeURIComponent(escape(atob(raw.slice(6)))));
        const validDiffs = ["textbook", "workbook", "easy", "medium", "hard", "all", "mock", "leitner"];
        const scoreNum = Number(obj.score);
        const correctNum = Number(obj.correct);
        const totalNum = Number(obj.total);
        const secNum = Number(obj.sec);
        if (
          !obj ||
          typeof obj.sid !== "string" ||
          typeof obj.name !== "string" ||
          !Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 100 ||
          !Number.isFinite(correctNum) || correctNum < 0 ||
          !Number.isFinite(totalNum) || totalNum <= 0 || totalNum > 200 ||
          !Number.isFinite(secNum) || secNum < 0
        ) {
          alert("回報碼欄位結構異常或數值超出合理範圍，已攔截匯入！");
          return;
        }
        const rec = {
          student_id: String(obj.sid).slice(0, 20),
          student_name: String(obj.name).slice(0, 30),
          class_name: String(obj.cls || "701班").slice(0, 20),
          unit_id: String(obj.uid || "L01").slice(0, 12),
          difficulty: validDiffs.includes(obj.diff) ? obj.diff : "easy",
          score: Math.round(scoreNum),
          correct: Math.round(correctNum),
          total: Math.round(totalNum),
          time_spent_sec: Math.round(secNum),
          wrong_qids: Array.isArray(obj.wrong) ? obj.wrong.slice(0, 100).map(x => String(x).slice(0, 32)) : []
        };
        // 先存進本機（GitHub Pages 沒有後端，否則匯入的成績會消失）
        const localSubs = JSON.parse(localStorage.getItem("kangxuan_g7_local_subs") || "[]");
        const dup = localSubs.some(s => s.student_id === rec.student_id && s.unit_id === rec.unit_id &&
          s.difficulty === rec.difficulty && s.score === rec.score && s.time_spent_sec === rec.time_spent_sec);
        if (dup) {
          alert(`這筆回報碼（${rec.student_name} ${rec.unit_id} ${rec.score}分）已經匯入過了。`);
          el.value = "";
          return;
        }
        localSubs.unshift({ ...rec, timestamp: new Date().toLocaleString("zh-TW") });
        localStorage.setItem("kangxuan_g7_local_subs", JSON.stringify(localSubs.slice(0, 500)));
        if (HAS_BACKEND) {
          fetch("/api/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rec)
          }).catch(err => console.warn("[Hanmo] Report code backend sync warning:", err));
        }
        el.value = "";
        this.fetchClassStats();
        alert(`已成功匯入 ${rec.student_name} 同學的 ${rec.unit_id} (${rec.score}分) 成績！`);
      } catch (err) {
        console.warn("[Hanmo] Failed to parse report code:", err);
        alert("解析回報碼失敗，請確認字串完整。");
      }
    },

    exportSubmissionsCsv() {
      const subs = this.classStats.submissions || [];
      const rows = [["時間", "班級", "座號", "姓名", "單元", "難度", "分數", "答對題數", "總題數", "耗時秒數", "錯題ID"]];
      const safeCsvCell = (val) => {
        const s = String(val ?? "");
        const neutralized = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
        return `"${neutralized.replace(/"/g, '""')}"`;
      };
      subs.forEach(s => {
        rows.push([s.timestamp, s.class_name, s.student_id, s.student_name, s.unit_id, s.difficulty, s.score, s.correct, s.total, s.time_spent_sec, (s.wrong_qids || []).join(";")]);
      });
      const csv = "\uFEFF" + rows.map(r => r.map(safeCsvCell).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "康軒國一上國文_班級平時成績單.csv";
      a.click();
    },

    renderTeacherPaperGenerator() {
      const selectedUnit = this.paperUnit || "L01";
      const selectedDiff = this.paperDiff || "all";
      const showAns = this.paperShowAns || false;
      const u = this.getUnit(selectedUnit);

      let qs = [];
      if (selectedDiff === "all") {
        qs = [...u.questions.easy.slice(0, 5), ...u.questions.medium.slice(0, 5), ...u.questions.hard.slice(0, 5)];
      } else {
        qs = [...(u.questions[selectedDiff] || [])];
      }

      return `
        <div class="question-card no-print">
          <h3 class="serif-title" style="margin-bottom:0.75rem;">108課綱會考雙欄測驗卷產生器（支援 A4/B4 直接列印學生卷與教師用詳解卷）</h3>
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
            <select class="search-input" onchange="app.paperUnit=this.value;app.render()">
              ${BANK.units.map(item => `<option value="${item.id}" ${item.id === selectedUnit ? 'selected' : ''}>${esc(item.title)}</option>`).join("")}
            </select>
            <select class="search-input" style="min-width:180px;" onchange="app.paperDiff=this.value;app.render()">
              <option value="all" ${selectedDiff === 'all' ? 'selected' : ''}>三級難度混合卷 (15題)</option>
              <option value="easy" ${selectedDiff === 'easy' ? 'selected' : ''}>簡單基礎卷 (${u.question_counts.easy}題)</option>
              <option value="medium" ${selectedDiff === 'medium' ? 'selected' : ''}>中等統整卷 (${u.question_counts.medium}題)</option>
              <option value="hard" ${selectedDiff === 'hard' ? 'selected' : ''}>困難素養卷 (${u.question_counts.hard}題)</option>
            </select>
            <button class="btn ${showAns ? 'btn-primary' : 'btn-secondary'}" onclick="app.paperShowAns=!app.paperShowAns;app.render()">
              ${showAns ? '目前為：教師詳解卷（含答案解析）' : '目前為：學生測驗卷（空白作答括號）'}
            </button>
            <button class="btn btn-jade" onclick="window.print()">立即雙欄列印 / 另存 PDF</button>
          </div>
        </div>

        <div class="printable-paper">
          <div style="column-span:all;border-bottom:2px solid #000;padding-bottom:0.75rem;margin-bottom:1.25rem;text-align:center;">
            <h2 style="font-size:1.45rem;">115學年度第一學期 康軒版國一國文科 108課綱會考素養評量卷</h2>
            <div style="font-size:0.95rem;margin-top:0.35rem;">
              範圍：<strong>${esc(u.title)}（${esc(u.author)}）</strong> ｜ 版本：${showAns ? '【教師詳解用卷】' : '【學生測驗卷】'} ｜ 班級：____ 座號：____ 姓名：__________ 得分：______
            </div>
          </div>

          ${qs.map((q, idx) => `
            <div class="print-q-item">
              ${q.passage ? `<div style="border:1px solid #666;padding:0.5rem;margin-bottom:0.4rem;font-size:0.88rem;background:#fafafa;">${esc(q.passage)}</div>` : ''}
              <div style="font-weight:700;font-size:0.95rem;">
                （ ${showAns ? "ABCD"[q.answer] : "　"} ）${idx + 1}. ${esc(q.stem)}
              </div>
              <div style="margin-left:1.5rem;font-size:0.9rem;margin-top:0.25rem;">
                ${q.options.map((opt, oi) => `<div>(${"ABCD"[oi]}) ${esc(opt)}</div>`).join("")}
              </div>
              ${showAns ? `
                <div style="margin-left:1.5rem;margin-top:0.3rem;font-size:0.82rem;color:#8a3b2a;border-left:2px solid #8a3b2a;padding-left:0.5rem;">
                  【能力指標：${esc(q.cap_skill)}】${esc(q.explanation)}
                </div>
              ` : ''}
            </div>
          `).join("")}
        </div>
      `;
    },

    renderTeacherSyllabus() {
      return `
        <div class="question-card">
          <h3 class="serif-title" style="margin-bottom:0.85rem;">115-1 國一國文科教學大綱、進度與核心問題總覽</h3>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>考程區間</th>
                  <th>週次</th>
                  <th>單元名稱</th>
                  <th>作者/文體</th>
                  <th>大綱核心問題</th>
                  <th>題庫配置 (簡/中/難)</th>
                </tr>
              </thead>
              <tbody>
                ${BANK.units.map(u => `
                  <tr>
                    <td><span class="q-badge ${esc(u.exam_id)}">${esc(u.exam)}</span></td>
                    <td>${esc(u.week)}</td>
                    <td><strong>${esc(u.title)}</strong></td>
                    <td>${esc(u.author)}<br/><span style="font-size:0.76rem;color:var(--ink-500);">${esc(u.genre)}</span></td>
                    <td style="max-width:420px;font-size:0.85rem;">${esc(u.core_questions[0] || '')}</td>
                    <td>
                      ${u.question_counts.easy} / ${u.question_counts.medium} / ${u.question_counts.hard}
                      <button class="student-btn" style="margin-left:0.4rem;" onclick="app.openStudio('${u.id}')">檢視</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    renderTeacherMobile() {
      return `
        <div class="question-card">
          <h3 class="serif-title" style="margin-bottom:0.5rem;">雙向手機遠端遙控與進度推播中心</h3>
          <p style="font-size:0.9rem;color:var(--ink-500);margin-bottom:1rem;">
            ${HAS_BACKEND ? "老師出門在外時，可用手機的 ntfy App 或本站「手機版」頁面接收通知（頻道設定在老師電腦的 .secrets，不顯示在網頁上）。" : "推播功能只能在老師電腦的本機後台（server.py）使用。"}
          </p>

          <div style="display:flex;gap:0.6rem;margin-bottom:1.25rem;flex-wrap:wrap;">
            <input id="inp-mobile-push" class="search-input" style="flex:1;" placeholder="輸入要推播到老師手機的訊息..." value="【翰墨書院系統通知】15單元共537題會考素養題庫與60張知識圖卡已全數部署上線！" />
            <button class="btn btn-primary" onclick="app.sendMobilePush()">立即推播至手機</button>
            <button class="btn btn-secondary" onclick="app.fetchRemoteMessages()">重新讀取手機回覆</button>
          </div>

          <h4 style="margin-bottom:0.6rem;">最近收到的手機端互動紀錄：</h4>
          <div style="background:#faf8f3;border:1px solid var(--border-subtle);border-radius:8px;padding:1rem;">
            ${this.remoteMessages.length === 0 ? `<div style="color:var(--ink-500);">尚無新訊息，點擊上方「重新讀取手機回覆」即可同步。</div>` :
              this.remoteMessages.map(m => `
                <div style="padding:0.5rem 0;border-bottom:1px dashed var(--border-subtle);font-size:0.9rem;">
                  <strong style="color:var(--indigo);">[${new Date(m.time * 1000).toLocaleTimeString("zh-TW")}]</strong>
                  ${esc(m.title ? m.title + "：" : "")}${esc(m.message)}
                </div>
              `).join("")
            }
          </div>
        </div>
      `;
    },

    sendMobilePush() {
      const el = document.getElementById("inp-mobile-push");
      if (!el || !el.value.trim()) return;
      // [QA 2026-10-23] 改由本機 server.py 代發，公開網站不帶頻道代碼
      if (!HAS_BACKEND) {
        alert("推播只能在老師電腦的本機後台使用。");
        return;
      }
      fetch("/api/notify-mobile", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ message: el.value.trim() })
      })
        .then(r => r.json())
        .then(res => {
          if (res && res.ok) {
            alert("已推播到手機。");
            this.fetchRemoteMessages();
          } else {
            alert("推播失敗：" + String((res && res.detail) || "請確認 .secrets 的頻道設定"));
          }
        })
        .catch(() => alert("推播失敗，請確認本機 server.py 正在執行。"));
    },

    /* ================= USER / SEAT SWITCHER & SAVE CODE MODAL ================= */
    openUserModal() {
      document.getElementById("inp-class").value = state.user.className;
      document.getElementById("inp-sid").value = state.user.studentId;
      document.getElementById("inp-sname").value = state.user.studentName;
      document.getElementById("user-modal").classList.add("open");
    },

    closeUserModal() {
      document.getElementById("user-modal").classList.remove("open");
    },

    saveUserIdentity() {
      state.user.className = document.getElementById("inp-class").value.trim() || "701班";
      state.user.studentId = document.getElementById("inp-sid").value.trim() || "70101";
      state.user.studentName = document.getElementById("inp-sname").value.trim() || "匿名學子";
      saveState();
      this.closeUserModal();
      this.render();
    },

    resetCurrentSeat() {
      if (!confirm("確定要清空本機目前的作答紀錄，切換給下一位使用平板/電腦的同學嗎？")) return;
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      state.xp = 0;
      state.unitScores = {};
      state.leitner = {};
      state.notes = {};
      saveState();
      this.closeUserModal();
      this.render();
    },

    generateSaveCode() {
      const code = "HANMO-" + btoa(unescape(encodeURIComponent(JSON.stringify(state))));
      const box = document.getElementById("save-code-box");
      if (box) {
        box.value = code;
        navigator.clipboard.writeText(code).catch(err => console.warn("[Hanmo] Clipboard copy warning:", err));
        alert("已產生並複製「存檔密語」！可貼在個人記事本或 Google Keep 保存。");
      }
    },

    restoreSaveCode() {
      const box = document.getElementById("save-code-box");
      if (!box || !box.value.trim()) return;
      let raw = box.value.trim();
      if (raw.startsWith("HANMO-")) raw = raw.slice(6);
      try {
        const parsed = JSON.parse(decodeURIComponent(escape(atob(raw))));
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.user &&
          typeof parsed.user.studentName === "string" &&
          typeof parsed.user.studentId === "string"
        ) {
          state = {
            user: {
              className: String(parsed.user.className || "701班").slice(0, 20),
              studentId: String(parsed.user.studentId).slice(0, 20),
              studentName: String(parsed.user.studentName).slice(0, 30)
            },
            xp: Math.max(0, Number(parsed.xp) || 0),
            studyDays: Math.max(1, Number(parsed.studyDays) || 1),
            unitScores: parsed.unitScores && typeof parsed.unitScores === "object" ? parsed.unitScores : {},
            leitner: parsed.leitner && typeof parsed.leitner === "object" ? parsed.leitner : {},
            notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
            skillStats: parsed.skillStats && typeof parsed.skillStats === "object" ? parsed.skillStats : state.skillStats
          };
          saveState();
          this.closeUserModal();
          this.render();
          alert(`成功還原 ${state.user.studentName} 同學的學習進度與錯題本！`);
        } else {
          alert("存檔密語結構不完整，已攔截還原。");
        }
      } catch (err) {
        console.warn("[Hanmo] Failed to restore save code:", err);
        alert("存檔密語格式無效，請確認複製完整。");
      }
    },

    downloadProgressJson() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `翰墨書院學習存檔_${state.user.studentId}_${state.user.studentName}.json`;
      a.click();
    }
  };

  window.app = app;
  window.addEventListener("DOMContentLoaded", () => app.init());
})();

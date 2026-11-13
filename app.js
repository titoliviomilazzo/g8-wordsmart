(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const MIN = 60000, DAY = 86400000;
  const LV = { 1: 'Level 1 · Basic', 2: 'Level 2 · Intermediate', 3: 'Level 3 · Advanced' };
  const CHN = {
    2: '2. The Words',
    4: '4. SAT Key Terms',
    5: '5. GRE Key Terms',
    9: '9. The Arts',
    10: '10. Finance',
    11: '11. Foreign Words',
    12: '12. Science'
  };
  const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  let user = null, data = null, queue = [], cur = null, sessionStart = 0, shownAt = 0, sessStats = null;

  // ---------- Storage ----------
  const key = (u) => 'ws:user:' + u;
  const users = () => JSON.parse(localStorage.getItem('ws:users') || '[]');
  const save = () => localStorage.setItem(key(user), JSON.stringify(data));
  function load(u) {
    const raw = localStorage.getItem(key(u));
    return raw ? JSON.parse(raw) : { cards: {}, logs: [], settings: { newLimit: 10, ch: 'all', lv: 0, shuffle: false } };
  }

  // ---------- SM-2 Spaced Repetition Engine ----------
  function schedule(p, r, now) {
    if (!p) p = { st: 'new', iv: 0, ef: 2.5, due: now, lapses: 0, reps: 0 };
    p.reps++;
    if (p.st === 'new' || p.st === 'learn') {
      if (r === 1) { p.st = 'learn'; p.due = now + 1 * MIN; }
      else if (r === 2) { p.st = 'learn'; p.due = now + 10 * MIN; }
      else { p.st = 'review'; p.iv = 1; p.due = now + DAY; }
    } else {
      if (r === 1) { p.lapses++; p.st = 'learn'; p.iv = 1; p.ef = Math.max(1.3, p.ef - 0.2); p.due = now + 10 * MIN; }
      else if (r === 2) { p.iv = Math.max(p.iv + 1, Math.round(p.iv * 1.2)); p.ef = Math.max(1.3, p.ef - 0.15); p.due = now + p.iv * DAY; }
      else { p.iv = Math.max(p.iv + 1, Math.round(p.iv * p.ef)); p.ef = p.ef + 0.05; p.due = now + p.iv * DAY; }
    }
    return p;
  }

  // ---------- Filters & Queue ----------
  function pool() {
    const ch = data.settings.ch, lv = +data.settings.lv;
    return CARDS.filter((c) => (ch === 'all' || c.chapter === +ch) && (!lv || c.level === lv));
  }
  function buildQueue() {
    const now = Date.now(), pl = pool();
    const learn = [], rev = [];
    let nw = [];
    for (const c of pl) {
      const p = data.cards[c.id];
      if (!p) nw.push(c);
      else if (p.due <= now + 20 * MIN && p.st === 'learn') learn.push(c);
      else if (p.due <= now && p.st === 'review') rev.push(c);
    }
    rev.sort((a, b) => data.cards[a.id].due - data.cards[b.id].due);
    const room = Math.max(1, data.settings.newLimit || 10);
    if (data.settings.shuffle) {
      const selectedNew = shuffle(nw).slice(0, room);
      const q = [...learn, ...rev.slice(0, 40), ...selectedNew];
      return shuffle(q);
    } else {
      nw.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
      return [...learn, ...rev.slice(0, 40), ...nw.slice(0, room)];
    }
  }
  const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  // ---------- Views ----------
  function show(id) {
    ['login', 'home', 'study', 'quiz', 'done', 'teacher'].forEach((s) => $('#' + s).classList.toggle('hidden', s !== id));
  }
  function renderLogin() {
    $('#who').textContent = '';
    $('#userList').innerHTML = '';
    users().forEach((u) => {
      const b = document.createElement('button');
      b.className = 'userbtn'; b.textContent = u;
      b.onclick = () => enter(u);
      $('#userList').appendChild(b);
    });
    show('login');
  }
  function enter(u) {
    user = u; data = load(u);
    $('#who').textContent = u;
    $('#chSel').innerHTML = '<option value="all">All Chapters</option>' +
      Object.entries(CHN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('#chSel').value = data.settings.ch; $('#lvSel').value = data.settings.lv; $('#newLimit').value = data.settings.newLimit;
    $('#shuffleOpt').checked = !!data.settings.shuffle;
    renderHome();
  }
  function streak(tgtData) {
    const dObj = tgtData || data;
    const days = new Set(dObj.logs.map((l) => Math.floor((l.t - new Date(l.t).getTimezoneOffset() * MIN) / DAY)));
    let n = 0, d = Math.floor((Date.now() - new Date().getTimezoneOffset() * MIN) / DAY);
    if (!days.has(d)) d--;
    while (days.has(d)) { n++; d--; }
    return n;
  }
  // ---------- Google Sheets Sync ----------
  const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbx5gG3smxStLtrk7YMmNhpX0GPsuJkm6HOap73RIoNEWzNOho8qXInlqfPsXuSkHTcW_A/exec';
  function getGasUrl() {
    return localStorage.getItem('ws:gas_url') || DEFAULT_GAS_URL;
  }
  function setGasUrl(url) {
    localStorage.setItem('ws:gas_url', url.trim());
  }
  function syncToGoogleSheets(sessionSummary) {
    const url = getGasUrl();
    if (!url || !user) return;
    const payload = JSON.stringify({
      student: user,
      timestamp: new Date().toISOString(),
      chapter: $('#chSel') ? $('#chSel').options[$('#chSel').selectedIndex].text : 'All',
      level: $('#lvSel') ? $('#lvSel').options[$('#lvSel').selectedIndex].text : 'All',
      reviewedCount: sessionSummary.reviewedCount || 0,
      forgotCount: sessionSummary.forgotCount || 0,
      hardCount: sessionSummary.hardCount || 0,
      goodCount: sessionSummary.goodCount || 0,
      accuracy: sessionSummary.accuracy || 0,
      totalLearned: Object.keys(data.cards).length,
      matureCount: Object.values(data.cards).filter((p) => p.st === 'review' && p.iv >= 21).length,
      streak: streak()
    });
    try {
      // Google Apps Script는 text/plain으로 전송해야 브라우저 CORS 프리플라이트 없이 doPost에 온전히 도달함
      fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload
      }).catch((e) => console.log('Sync err:', e));
    } catch (e) {
      console.log('Sync err:', e);
    }
  }

  function renderTeacher() {
    const us = users();
    let rows = '';
    us.forEach((u) => {
      const ud = load(u);
      const seen = Object.keys(ud.cards).length;
      const mature = Object.values(ud.cards).filter((p) => p.st === 'review' && p.iv >= 21).length;
      const today = ud.logs.filter((l) => l.t >= startOfDay());
      const rec = ud.logs.slice(-200);
      const ret = rec.length ? Math.round(100 * rec.filter((l) => l.r === 3).length / rec.length) : 0;
      rows += `<tr>
        <td>${esc(u)}</td>
        <td>${streak(ud)} days</td>
        <td>${today.length}</td>
        <td>${seen} / ${CARDS.length} (${Math.round(100 * seen / CARDS.length)}%)</td>
        <td>${mature}</td>
        <td>${ret}%</td>
      </tr>`;
    });
    $('#gasUrlInput').value = getGasUrl();
    $('#teacherTableWrap').innerHTML = `<table class="tbl">
      <thead><tr><th>Student</th><th>Streak</th><th>Today's Reviews</th><th>Words Seen</th><th>Mature (21d+)</th><th>Recent Accuracy</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No registered students yet.</td></tr>'}</tbody>
    </table>`;
    show('teacher');
  }
  function renderHome() {
    data.settings.ch = $('#chSel').value; data.settings.lv = +$('#lvSel').value;
    data.settings.newLimit = Math.max(0, +$('#newLimit').value || 0);
    data.settings.shuffle = $('#shuffleOpt').checked;
    save();
    const today = data.logs.filter((l) => l.t >= startOfDay());
    const ok = today.filter((l) => l.r >= 2).length;
    const mature = Object.values(data.cards).filter((p) => p.st === 'review' && p.iv >= 21).length;
    const seen = Object.keys(data.cards).length;
    const rec = data.logs.slice(-200);
    const ret = rec.length ? Math.round(100 * rec.filter((l) => l.r === 3).length / rec.length) : 0;
    $('#stats').innerHTML = [
      [today.length, "Today's Reviews"], [today.length ? Math.round(100 * ok / today.length) + '%' : '-', "Today's Accuracy"],
      [streak() + ' days', 'Daily Streak'], [seen + '/' + CARDS.length, 'Words Learned'], [mature, 'Mature (21d+)'], [ret + '%', 'Recent "Good" Rate']
    ].map(([a, b]) => `<div class="stat"><b>${a}</b><span>${b}</span></div>`).join('');
    $('#dueCount').textContent = buildQueue().length;
    let h = '';
    for (const lv of [1, 2, 3]) {
      const all = CARDS.filter((c) => c.level === lv);
      const m = all.filter((c) => { const p = data.cards[c.id]; return p && p.st === 'review' && p.iv >= 21; }).length;
      const l = all.filter((c) => { const p = data.cards[c.id]; return p && !(p.st === 'review' && p.iv >= 21); }).length;
      h += `<div>${LV[lv]} · Mature ${m} / Learning ${l} / Total ${all.length}</div><div class="bar"><i style="width:${100 * m / all.length}%;background:var(--l${lv})"></i><i style="width:${100 * l / all.length}%;background:var(--l${lv});opacity:.4"></i></div>`;
    }
    $('#progress').innerHTML = h;
    show('home');
  }

  // ---------- Study Session ----------
  function startStudy() {
    queue = buildQueue();
    if (!queue.length) { finish('No Cards Due', 'Increase daily new limit or return tomorrow for scheduled reviews.'); return; }
    sessStats = { n: 0, r: [0, 0, 0, 0], ms: 0 };
    show('study'); next();
  }
  function next() {
    if (!queue.length) {
      const s = sessStats;
      const acc = s.n > 0 ? Math.round(((s.r[2] + s.r[3]) / s.n) * 100) : 0;
      syncToGoogleSheets({
        reviewedCount: s.n,
        forgotCount: s.r[1],
        hardCount: s.r[2],
        goodCount: s.r[3],
        accuracy: acc
      });
      finish('Session Complete', `Reviewed ${s.n} cards · Forgot ${s.r[1]} / Hard ${s.r[2]} / Good ${s.r[3]}. Next reviews scheduled automatically.`); return;
    }
    cur = queue.shift();
    $('#remain').textContent = `Remaining: ${queue.length + 1}`;
    $('#card').className = 'card';
    $('#front').innerHTML = `<div class="w">${esc(cur.word)}</div><div class="p">${esc(cur.pron ? '[' + cur.pron + ']' : '')}</div><div class="pos">${esc(cur.pos)}</div><button class="speak" id="spk">🔊 Audio</button>`;
    $('#spk').onclick = () => speak(cur.word);
    $('#front').classList.remove('hidden'); $('#back').classList.add('hidden');
    $('#showWrap').classList.remove('hidden'); $('#rateWrap').classList.add('hidden');
    shownAt = Date.now();
  }
  let isFlipping = false;
  function toggleCard() {
    if (!cur || isFlipping) return;
    isFlipping = true;
    const cardEl = $('#card');
    cardEl.classList.add('flipping');

    setTimeout(() => {
      const isFront = $('#back').classList.contains('hidden');
      if (isFront) {
        // 앞면 -> 뒷면
        cardEl.className = 'card flipping lv' + cur.level;
        $('#back').innerHTML =
          `<span class="badge">${LV[cur.level]}</span><div class="w">${esc(cur.word)}</div><div class="ko">${esc(cur.ko)}</div><div class="en">${esc(cur.def)}</div>` +
          (cur.ex ? `<div class="ex">• ${esc(cur.ex)}<div class="exko">${esc(cur.ko_ex || '')}</div></div>` : '') +
          (cur.notes ? `<div class="note">${esc(cur.notes)}</div>` : '');
        $('#back').classList.remove('hidden'); $('#front').classList.add('hidden');
        $('#showWrap').classList.add('hidden'); $('#rateWrap').classList.remove('hidden');
        if (!cur._ms) cur._ms = Date.now() - shownAt;
      } else {
        // 뒷면 -> 앞면
        cardEl.className = 'card flipping';
        $('#front').classList.remove('hidden'); $('#back').classList.add('hidden');
        $('#showWrap').classList.remove('hidden'); $('#rateWrap').classList.add('hidden');
      }

      // 90도 회전 상태에서 내용 교체 후 다시 0도로 펴기
      setTimeout(() => {
        cardEl.classList.remove('flipping');
        isFlipping = false;
      }, 40);
    }, 180);
  }
  function reveal() {
    if (!cur) return;
    if ($('#back').classList.contains('hidden')) toggleCard();
  }

  // ---------- Button Particle Effects ----------
  function fireEffect(r, targetBtn) {
    const btn = targetBtn || document.querySelector(`#rateWrap button[data-r="${r}"]`);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    if (r === 3) {
      // Good: 축하 콘페티 (화려한 멀티컬러 사각/원형 조각)
      const colors = ['#2e9e5b', '#00b894', '#f1c40f', '#3498db', '#e84393', '#fdcb6e', '#ff7675'];
      for (let i = 0; i < 36; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 8 + 6;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 110 + 40;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist - (Math.random() * 50 + 20); // 약간 위로 튀어오름
        const tr = (Math.random() - 0.5) * 720;
        const isRound = Math.random() > 0.5;

        p.style.width = size + 'px';
        p.style.height = (isRound ? size : size * 0.5) + 'px';
        p.style.backgroundColor = color;
        p.style.borderRadius = isRound ? '50%' : '2px';
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        p.style.setProperty('--tr', tr + 'deg');
        p.style.setProperty('--ts', Math.random() * 0.4 + 0.6);
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 750);
      }
    } else if (r === 2) {
      // Hard: 주황색 에너지 불꽃 / 집중 펄스 스파크
      const colors = ['#e08a00', '#f39c12', '#e67e22', '#d35400', '#f1c40f'];
      for (let i = 0; i < 22; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 7 + 4;
        const angle = (Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.4; // 위쪽 반원 방향
        const dist = Math.random() * 75 + 25;
        const tx = Math.cos(angle) * dist;
        const ty = -Math.sin(angle) * dist;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.backgroundColor = color;
        p.style.borderRadius = '50%';
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        p.style.setProperty('--tr', '0deg');
        p.style.setProperty('--ts', '0.2');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 600);
      }
    } else if (r === 1) {
      // Forgot: 붉은 먼지/깨진 조각이 흩날리며 가라앉는 이펙트
      const colors = ['#d23a3a', '#c0392b', '#7f8c8d', '#95a5a6', '#e74c3c'];
      for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 6 + 3;
        const tx = (Math.random() - 0.5) * 80;
        const ty = Math.random() * 55 + 15; // 아래로 떨어짐
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        p.style.backgroundColor = color;
        p.style.borderRadius = '2px';
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        p.style.setProperty('--tr', ((Math.random() - 0.5) * 360) + 'deg');
        p.style.setProperty('--ts', '0.3');
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 700);
      }
    }
  }

  function rate(r, btnElement) {
    if (!cur || $('#back').classList.contains('hidden')) return;
    fireEffect(r, btnElement);
    const now = Date.now(), isNew = !data.cards[cur.id];
    data.cards[cur.id] = schedule(data.cards[cur.id], r, now);
    data.logs.push({ t: now, id: cur.id, r, ms: cur._ms, n: isNew ? 1 : 0, m: 'f' });
    save();
    sessStats.n++; sessStats.r[r]++;
    if (r < 3) { const pos = Math.min(queue.length, r === 1 ? 3 : 7); queue.splice(pos, 0, cur); }
    setTimeout(next, 220); // 파티클이 터지는 손맛을 느낄 수 있도록 0.2초 후 다음 카드로 전환
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function speak(w) {
    try { const u = new SpeechSynthesisUtterance(w); u.lang = 'en-US'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
  }
  function finish(t, b) { $('#doneTitle').textContent = t; $('#doneBody').textContent = b; show('done'); }

  // ---------- 4-Choice Quiz ----------
  let qItems = [], qi = 0, qScore = 0;
  function startQuiz() {
    const seen = pool().filter((c) => data.cards[c.id]);
    if (seen.length < 4) { finish('Quiz Unavailable', 'Study at least 4 flashcards first before starting the quiz.'); return; }
    seen.sort((a, b) => data.cards[a.id].due - data.cards[b.id].due);
    qItems = seen.slice(0, 10); qi = 0; qScore = 0; show('quiz'); nextQ();
  }
  function nextQ() {
    if (qi >= qItems.length) { finish('Quiz Finished', `Score: ${qScore} / ${qItems.length}`); return; }
    const c = qItems[qi];
    const same = CARDS.filter((x) => x.id !== c.id && x.pos === c.pos && x.ko !== c.ko);
    const wrong = shuffle(same).slice(0, 3);
    const opts = shuffle([c, ...wrong]);
    $('#quizInfo').textContent = `${qi + 1} / ${qItems.length}`;
    $('#quizQ').className = 'card q';
    $('#quizQ').innerHTML = `<div class="w">${esc(c.word)}</div>`;
    $('#quizOpts').innerHTML = '';
    const t0 = Date.now();
    opts.forEach((o) => {
      const b = document.createElement('button'); b.textContent = o.ko;
      b.onclick = () => {
        const good = o.id === c.id;
        [...$('#quizOpts').children].forEach((x) => { x.disabled = true; if (x.textContent === c.ko) x.classList.add('ok'); });
        if (!good) b.classList.add('ng');
        if (good) qScore++;
        const now = Date.now();
        data.logs.push({ t: now, id: c.id, r: good ? 3 : 1, ms: now - t0, n: 0, m: 'q' });
        data.cards[c.id] = schedule(data.cards[c.id], good ? 3 : 1, now);
        save(); qi++; setTimeout(nextQ, good ? 600 : 1500);
      };
      $('#quizOpts').appendChild(b);
    });
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ---------- Event Listeners ----------
  $('#newUserForm').onsubmit = (e) => {
    e.preventDefault();
    const n = $('#newName').value.trim(); if (!n) return;
    const u = users(); if (!u.includes(n)) { u.push(n); localStorage.setItem('ws:users', JSON.stringify(u)); }
    $('#newName').value = ''; enter(n);
  };
  ['chSel', 'lvSel', 'newLimit', 'shuffleOpt'].forEach((id) => $('#' + id).addEventListener('change', renderHome));
  $('#startStudy').onclick = startStudy;
  $('#startQuiz').onclick = startQuiz;
  $('#showBtn').onclick = toggleCard;
  $('#card').onclick = (e) => {
    // 발음 듣기 버튼 클릭 시에는 뒤집히지 않도록 예외 처리
    if (e.target && e.target.id === 'spk') return;
    toggleCard();
  };
  document.querySelectorAll('#rateWrap button').forEach((b) => (b.onclick = () => rate(+b.dataset.r, b)));
  function quitStudy() {
    if (sessStats && sessStats.n > 0) {
      const s = sessStats;
      const acc = Math.round(((s.r[2] + s.r[3]) / s.n) * 100);
      syncToGoogleSheets({
        reviewedCount: s.n,
        forgotCount: s.r[1],
        hardCount: s.r[2],
        goodCount: s.r[3],
        accuracy: acc
      });
      sessStats = null;
    }
    renderHome();
  }
  $('#quit').onclick = quitStudy;
  $('#quizQuit').onclick = $('#backHome').onclick = $('#teacherBack').onclick = renderHome;
  $('#teacherBtn').onclick = renderTeacher;
  $('#saveGasBtn').onclick = () => {
    const val = $('#gasUrlInput').value.trim();
    setGasUrl(val);
    alert(val ? 'Google Sheets Sync URL saved successfully!' : 'Google Sheets Sync URL cleared.');
  };
  $('#switchUser').onclick = renderLogin;
  $('#exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ user, data })], { type: 'application/json' }));
    a.download = `wordsmart-${user}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  $('#importFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then((t) => {
      const o = JSON.parse(t);
      const u = users(); if (!u.includes(o.user)) { u.push(o.user); localStorage.setItem('ws:users', JSON.stringify(u)); }
      localStorage.setItem(key(o.user), JSON.stringify(o.data)); enter(o.user);
    });
  };
  document.addEventListener('keydown', (e) => {
    if ($('#study').classList.contains('hidden') || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggleCard(); }
    else if (['1', '2', '3'].includes(e.key)) rate(+e.key);
  });

  renderLogin();
})();

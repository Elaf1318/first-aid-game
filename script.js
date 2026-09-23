const SUPABASE_URL = "https://idizmnvkxenfjdodfyvm.supabase.co";
const SUPABASE_KEY = "sb_publishable_rebZV1dwORO6xvM-fHTVwA_9QsVpPTO";

// التحكم في إظهار / إخفاء خيار المسعف الصغير
const SHOW_CHILD_MODE = true;

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

let allQuestions = [];
let currentGameQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let timerInterval = null;
let timeLeft = 15; // 15 ثانية لكل سؤال
let gameInProgress = false;
let isOfflinePaused = false;
let offlineTimerInterval = null;
let offlineTimeLeft = 120;
let questionAnswered = false;

// بيانات المشارك الحالي
let currentParticipant = {
    name: "",
    email: ""
};

let gameStartTime = 0;

function escapeHtml(text) {
    if (!text) return "";
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function loadQuestions() {
    try {
        const { data, error } = await supabaseClient
            .from("questions")
            .select("id, question_number, question_text, options, correct_option, explanation, difficulty, topic")
            .eq("active", true);

        if (error) {
            console.error("فشل تحميل الأسئلة من Supabase:", error);
            allQuestions = [];
            return false;
        }

        if (!data || data.length < 10) {
            console.error("عدد الأسئلة الفعالة أقل من 10 (العدد الحالي: " + (data ? data.length : 0) + ")");
            allQuestions = [];
            return false;
        }

        allQuestions = data.map(q => ({
            id: q.id,
            question_number: q.question_number,
            q: q.question_text,
            a: q.options,
            c: q.correct_option,
            e: q.explanation,
            difficulty: q.difficulty || "medium",
            topic: q.topic || "General"
        }));

        return true;
    } catch (err) {
        console.error("خطأ أثناء جلب الأسئلة:", err);
        allQuestions = [];
        return false;
    }
}

function selectGameQuestions() {
    if (!allQuestions || allQuestions.length < 10) {
        console.error("التحقق قبل بدء اللعبة فشل: عدد الأسئلة المتاحة أقل من 10 (العدد الحالي: " + (allQuestions ? allQuestions.length : 0) + ")");
        return null;
    }

    // تقسيم الأسئلة حسب الصعوبة
    const easyPool = [];
    const mediumPool = [];
    const hardPool = [];
    const otherPool = [];

    allQuestions.forEach(q => {
        const diff = (q.difficulty || "").toLowerCase().trim();
        if (diff === "easy" || diff === "سهل") {
            easyPool.push(q);
        } else if (diff === "medium" || diff === "متوسط") {
            mediumPool.push(q);
        } else if (diff === "hard" || diff === "صعب") {
            hardPool.push(q);
        } else {
            otherPool.push(q);
        }
    });

    const shuffle = (arr) => [...arr].sort(() => 0.5 - Math.random());

    const shuffledEasy = shuffle(easyPool);
    const shuffledMedium = shuffle(mediumPool);
    const shuffledHard = shuffle(hardPool);
    const shuffledOther = shuffle(otherPool);

    // التوزيع المستهدف: 3 easy, 5 medium, 2 hard
    const selected = [];

    const takeFromBucket = (bucket, count) => {
        const taken = bucket.splice(0, count);
        selected.push(...taken);
        return count - taken.length;
    };

    let easyNeeded = takeFromBucket(shuffledEasy, 3);
    let mediumNeeded = takeFromBucket(shuffledMedium, 5);
    let hardNeeded = takeFromBucket(shuffledHard, 2);

    let totalNeeded = easyNeeded + mediumNeeded + hardNeeded;

    if (totalNeeded > 0) {
        const remainingPool = shuffle([
            ...shuffledEasy,
            ...shuffledMedium,
            ...shuffledHard,
            ...shuffledOther
        ]);
        const extra = remainingPool.splice(0, totalNeeded);
        selected.push(...extra);
    }

    // التحقق قبل بدء اللعبة
    if (selected.length !== 10) {
        console.error("التحقق قبل بدء اللعبة فشل: عدد الأسئلة المختارة ليس 10 (العدد: " + selected.length + ")");
        return null;
    }

    const idsSet = new Set();
    for (let i = 0; i < selected.length; i++) {
        const q = selected[i];
        if (!q.id) {
            console.error("التحقق قبل بدء اللعبة فشل: يوجد سؤال بدون id", q);
            return null;
        }
        if (idsSet.has(q.id)) {
            console.error("التحقق قبل بدء اللعبة فشل: يوجد id مكرر (" + q.id + ")");
            return null;
        }
        idsSet.add(q.id);

        if (!Array.isArray(q.a) || q.a.length === 0) {
            console.error("التحقق قبل بدء اللعبة فشل: السؤال لا يحتوي على options صالحة", q);
            return null;
        }
        if (q.c === undefined || q.c === null || typeof q.c !== "number") {
            console.error("التحقق قبل بدء اللعبة فشل: السؤال لا يحتوي على correct_option صالح", q);
            return null;
        }
    }

    // ترتيب الأسئلة ومنع تكرار الـ topic المتتالي
    const pool = [...selected];
    const sequence = [];

    while (pool.length > 0) {
        const lastTopic = sequence.length > 0 ? sequence[sequence.length - 1].topic : null;
        let validCandidates = pool.filter(item => item.topic !== lastTopic);

        if (validCandidates.length === 0) {
            validCandidates = pool;
        }

        const randomIndex = Math.floor(Math.random() * validCandidates.length);
        const chosen = validCandidates[randomIndex];

        sequence.push(chosen);
        const idxInPool = pool.findIndex(item => item.id === chosen.id);
        pool.splice(idxInPool, 1);
    }

    // Console logging للاختبار
    console.log("Selected questions: 10");
    sequence.forEach((q, idx) => {
        console.log(`${idx + 1} ${q.topic} ${q.difficulty}`);
    });

    return sequence;
}

function renderHomeScreen(message = "") {
    gameInProgress = false;
    clearInterval(timerInterval);
    clearInterval(offlineTimerInterval);
    hideOfflineOverlay();

    const app = document.getElementById("app");
    let html = `
        <div class="brand-header">
            <div class="brand-logo">
                <svg class="kit-icon" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>
            </div>
            <h1>أنت المسعف</h1>
            <p class="subtitle">موقف واحد، قرار واحد. هل أنت مستعد للتحدي؟</p>
        </div>
    `;

    if (message) {
        html += `
            <div class="result wrong banner-alert">
                <svg class="status-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>${message}</span>
            </div>
        `;
    }

    html += `
        <div class="mode-selection horizontal">
            <button class="mode-card primary" onclick="showRegistrationForm()">
                <div class="card-icon-wrap">
                    <svg class="mode-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
                </div>
                <span class="mode-title">المسعف</span>
                <span class="mode-desc">تحدي الإسعافات الأولية</span>
            </button>
    `;

    if (SHOW_CHILD_MODE) {
        html += `
            <button class="mode-card secondary" onclick="startChildChallenge()">
                <div class="card-icon-wrap">
                    <svg class="mode-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
                </div>
                <span class="mode-title">المسعف الصغير</span>
                <span class="mode-desc">تحدٍ تعليمي للأطفال</span>
            </button>
        `;
    }

    html += `</div>`;
    app.innerHTML = html;
}

function showRegistrationForm(errorMessage = "") {
    gameInProgress = false;
    const app = document.getElementById("app");
    app.innerHTML = `
        <div class="brand-header compact">
            <div class="brand-logo small">
                <svg class="kit-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>
            </div>
            <h1>أنت المسعف</h1>
        </div>
        <div class="registration-box">
            <h2>تسجيل المشارك</h2>
            <p class="reg-subtitle">أدخل بياناتك للبدء في التحدي (محاولة واحدة فقط لكل بريد):</p>
            ${errorMessage ? `
                <div class="result wrong banner-alert">
                    <svg class="status-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <span>${errorMessage}</span>
                </div>
            ` : ''}
            <form onsubmit="handleRegistrationSubmit(event)">
                <div class="input-group">
                    <label for="player-name">الاسم الكامل</label>
                    <input type="text" id="player-name" class="custom-input" required placeholder="أدخل اسمك الكامل" value="${escapeHtml(currentParticipant.name)}">
                </div>
                <div class="input-group">
                    <label for="player-email">البريد الإلكتروني</label>
                    <input type="email" id="player-email" class="custom-input" required placeholder="name@example.com" value="${escapeHtml(currentParticipant.email)}">
                </div>
                <button type="submit" class="start main-action-btn">
                    <span>بدء التحدي</span>
                    <svg class="btn-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                </button>
            </form>
        </div>
    `;
}

async function handleRegistrationSubmit(event) {
    event.preventDefault();
    const nameInput = document.getElementById("player-name").value.trim();
    const emailInput = document.getElementById("player-email").value.trim().toLowerCase();

    if (!nameInput || !emailInput) {
        showRegistrationForm("يرجى ملء جميع الحقول المطلوبة.");
        return;
    }

    currentParticipant.name = nameInput;
    currentParticipant.email = emailInput;

    const hasCompleted = await checkEmailCompleted(emailInput);
    if (hasCompleted) {
        showRegistrationForm("عذراً، هذا البريد الإلكتروني قد أكمل محاولة سابقة بالفعل. لا يمكن إكمال محاولة ثانية.");
        return;
    }

    startAdultChallenge();
}

async function checkEmailCompleted(email) {
    try {
        const { data, error } = await supabaseClient
            .from("attempts")
            .select("id")
            .eq("email", email)
            .eq("completed", true);

        if (!error && data && data.length > 0) {
            return true;
        }

        // التحقق التلقائي من التخزين المحلي الاحتياطي
        const localAttempts = JSON.parse(localStorage.getItem("local_attempts") || "[]");
        return localAttempts.some(a => a.email.toLowerCase() === email && a.completed);
    } catch (e) {
        console.error("خطأ أثناء فحص البريد الإلكتروني:", e);
        const localAttempts = JSON.parse(localStorage.getItem("local_attempts") || "[]");
        return localAttempts.some(a => a.email.toLowerCase() === email && a.completed);
    }
}

async function startAdultChallenge() {
    if (!allQuestions || allQuestions.length < 10) {
        const success = await loadQuestions();
        if (!success || allQuestions.length < 10) {
            alert("تعذر تحميل الأسئلة الفعالة من قاعدة البيانات. يرجى التأكد من الاتصال بالإنترنت والمحاولة مجدداً.");
            return;
        }
    }

    const selected = selectGameQuestions();
    if (!selected || selected.length !== 10) {
        alert("تعذر اختيار الأسئلة الفعالة للعبة. تحقق من وحدة التحكم (Console).");
        return;
    }

    currentGameQuestions = selected;
    currentQuestionIndex = 0;
    score = 0;
    gameInProgress = true;
    gameStartTime = Date.now();

    renderQuestion();
}

function startChildChallenge() {
    alert("قريباً... تحدي المسعف الصغير!");
}

function renderQuestion() {
    questionAnswered = false;
    const currentQ = currentGameQuestions[currentQuestionIndex];
    timeLeft = 15;

    const optionBadges = ["أ", "ب", "ج", "د"];

    const app = document.getElementById("app");
    let html = `
        <div class="quiz-header">
            <span class="progress-badge">السؤال ${currentQuestionIndex + 1} من 10</span>
            <div class="timer-badge">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span id="timer-text">${Math.ceil(timeLeft)}s</span>
            </div>
        </div>
        <div class="timeline-container">
            <div id="timeline-bar" class="timeline-bar" style="width: 100%;"></div>
        </div>
        <div class="question-container">
            <div class="question-card">
                <h2>${currentQ.q}</h2>
            </div>
            <p class="instruction-text">اختر التصرف الأنسب:</p>
            <div class="options-list">
    `;

    currentQ.a.forEach((answer, index) => {
        html += `
            <button class="answer" id="opt-${index}" onclick="handleAnswerSelect(${index})">
                <span class="option-badge">${optionBadges[index] || index + 1}</span>
                <span class="option-text">${answer}</span>
            </button>
        `;
    });

    html += `
            </div>
            <div id="feedback-area"></div>
        </div>
    `;

    app.innerHTML = html;
    startTimer();
}

function startTimer() {
    clearInterval(timerInterval);
    const barElem = document.getElementById("timeline-bar");
    const timerTextElem = document.getElementById("timer-text");
    const totalDuration = 15;

    timerInterval = setInterval(() => {
        if (isOfflinePaused) return;

        timeLeft -= 0.1;
        const percent = Math.max(0, (timeLeft / totalDuration) * 100);

        if (barElem) {
            barElem.style.width = `${percent}%`;

            if (timeLeft <= 5.0) {
                barElem.classList.add("warning");
            } else {
                barElem.classList.remove("warning");
            }
        }

        if (timerTextElem) {
            timerTextElem.innerText = `${Math.max(0, Math.ceil(timeLeft))}s`;
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (!questionAnswered) {
                handleTimeOut();
            }
        }
    }, 100);
}

function handleAnswerSelect(selectedIndex) {
    if (questionAnswered) return;
    questionAnswered = true;
    clearInterval(timerInterval);

    const currentQ = currentGameQuestions[currentQuestionIndex];
    const isCorrect = selectedIndex === currentQ.c;
    if (isCorrect) score++;

    currentQ.a.forEach((_, idx) => {
        const btn = document.getElementById(`opt-${idx}`);
        if (btn) {
            btn.disabled = true;
            if (idx === currentQ.c) {
                btn.classList.add("correct-option");
            } else if (idx === selectedIndex) {
                btn.classList.add("wrong-option");
            }
        }
    });

    const feedbackElem = document.getElementById("feedback-area");
    if (feedbackElem) {
        feedbackElem.innerHTML = isCorrect
            ? `<div class="result success-feedback inline-feedback">
                <div class="feedback-header">
                    <svg class="status-icon success" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    <h3>إجابة صحيحة</h3>
                </div>
                <p>${currentQ.e}</p>
               </div>`
            : `<div class="result wrong-feedback inline-feedback">
                <div class="feedback-header">
                    <svg class="status-icon error" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    <h3>إجابة غير صحيحة</h3>
                </div>
                <p class="correct-answer-text">الإجابة الصحيحة: <strong>${currentQ.a[currentQ.c]}</strong></p>
                <p>${currentQ.e}</p>
               </div>`;
    }

    setTimeout(() => {
        nextQuestion();
    }, 2000);
}

function handleTimeOut() {
    questionAnswered = true;
    const currentQ = currentGameQuestions[currentQuestionIndex];

    currentQ.a.forEach((_, idx) => {
        const btn = document.getElementById(`opt-${idx}`);
        if (btn) {
            btn.disabled = true;
            if (idx === currentQ.c) {
                btn.classList.add("correct-option");
            }
        }
    });

    const feedbackElem = document.getElementById("feedback-area");
    if (feedbackElem) {
        feedbackElem.innerHTML = `
            <div class="result timeout-feedback inline-feedback">
                <div class="feedback-header">
                    <svg class="status-icon timeout" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <h3>انتهى الوقت</h3>
                </div>
                <p class="correct-answer-text">الإجابة الصحيحة: <strong>${currentQ.a[currentQ.c]}</strong></p>
                <p>${currentQ.e}</p>
            </div>`;
    }

    setTimeout(() => {
        nextQuestion();
    }, 2000);
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < 10 && currentQuestionIndex < currentGameQuestions.length) {
        renderQuestion();
    } else {
        finishGame();
    }
}

async function finishGame() {
    gameInProgress = false;
    clearInterval(timerInterval);

    const totalTimeSeconds = Math.round((Date.now() - gameStartTime) / 1000);
    await saveAttempt(currentParticipant.name, currentParticipant.email, score, totalTimeSeconds);
    await renderLeaderboardScreen(score, totalTimeSeconds);
}

async function saveAttempt(name, email, finalScore, totalTime) {
    const attemptRecord = {
        name: name,
        email: email,
        score: finalScore,
        total_time: totalTime,
        completed: true,
        created_at: new Date().toISOString()
    };

    try {
        const { error } = await supabaseClient
            .from("attempts")
            .insert([attemptRecord]);

        if (error) {
            console.warn("فشل حفظ المحاولة في Supabase:", error);
            saveLocalAttempt(attemptRecord);
        }
    } catch (e) {
        console.error("خطأ حفظ المحاولة:", e);
        saveLocalAttempt(attemptRecord);
    }
}

function saveLocalAttempt(record) {
    const localAttempts = JSON.parse(localStorage.getItem("local_attempts") || "[]");
    localAttempts.push(record);
    localStorage.setItem("local_attempts", JSON.stringify(localAttempts));
}

async function fetchLeaderboard() {
    let list = [];
    try {
        const { data, error } = await supabaseClient
            .from("attempts")
            .select("name, email, score, total_time")
            .eq("completed", true)
            .order("score", { ascending: false })
            .order("total_time", { ascending: true });

        if (!error && data && data.length > 0) {
            list = data;
        } else {
            const localAttempts = JSON.parse(localStorage.getItem("local_attempts") || "[]");
            list = localAttempts.filter(a => a.completed);
            list.sort((a, b) => b.score - a.score || a.total_time - b.total_time);
        }
    } catch (e) {
        const localAttempts = JSON.parse(localStorage.getItem("local_attempts") || "[]");
        list = localAttempts.filter(a => a.completed);
        list.sort((a, b) => b.score - a.score || a.total_time - b.total_time);
    }
    return list;
}

async function renderLeaderboardScreen(userScore, userTotalTime) {
    gameInProgress = false;
    clearInterval(timerInterval);
    clearInterval(offlineTimerInterval);
    hideOfflineOverlay();

    const leaderboard = await fetchLeaderboard();
    
    let userRank = "-";
    if (currentParticipant.email) {
        const index = leaderboard.findIndex(item => item.email && item.email.toLowerCase() === currentParticipant.email.toLowerCase());
        if (index !== -1) {
            userRank = `#${index + 1}`;
        }
    }

    let rowsHtml = "";
    leaderboard.forEach((item, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'rank-gold' : rank === 2 ? 'rank-silver' : rank === 3 ? 'rank-bronze' : 'rank-normal';
        const isCurrentUser = currentParticipant.email && item.email && item.email.toLowerCase() === currentParticipant.email.toLowerCase();

        rowsHtml += `
            <tr class="${isCurrentUser ? 'current-player-row' : ''}">
                <td><span class="rank-badge-cell ${rankClass}">${rank}</span></td>
                <td class="player-name-cell">${escapeHtml(item.name)}</td>
                <td><span class="score-badge">${item.score} / 10</span></td>
                <td><span class="time-text">${item.total_time}ث</span></td>
            </tr>
        `;
    });

    const app = document.getElementById("app");
    app.innerHTML = `
        <div class="result final-result">
            <div class="result-header">
                <h2>اكتمل التحدي</h2>
                <p class="result-sub">تم تسجيل محاولتك بنجاح في لوحة الصدارة</p>
            </div>

            <div class="score-summary-grid">
                <div class="summary-card main-score">
                    <span class="summary-label">النتيجة</span>
                    <strong class="score-text">${userScore} <span class="total-count">/ 10</span></strong>
                </div>
                <div class="summary-card time-score">
                    <span class="summary-label">الوقت الإجمالي</span>
                    <strong class="time-val">${userTotalTime} <span class="unit">ثانية</span></strong>
                </div>
                ${userRank !== '-' ? `
                <div class="summary-card rank-score">
                    <span class="summary-label">الترتيب في الصدارة</span>
                    <strong class="rank-val">${userRank}</strong>
                </div>
                ` : ''}
            </div>

            <div class="leaderboard-section">
                <h3 class="leaderboard-title">لوحة الصدارة</h3>
                <div class="table-responsive">
                    <table class="leaderboard-table">
                        <thead>
                            <tr>
                                <th>الترتيب</th>
                                <th>الاسم</th>
                                <th>النتيجة</th>
                                <th>الوقت</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml || '<tr><td colspan="4">لا توجد نتائج مسجلة بعد</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
            <p class="final-note">
                شكراً لمشاركتك! تم تسجيل محاولتك بنجاح ولا يمكن إعادتها.
            </p>
        </div>
    `;
}

function cancelAttempt(reason) {
    if (!gameInProgress) return;
    gameInProgress = false;
    clearInterval(timerInterval);
    clearInterval(offlineTimerInterval);
    hideOfflineOverlay();
    renderHomeScreen(reason || "تم إلغاء المحاولة للتمكن من البدء من جديد.");
}

// التعامل مع الخروج من التبويب أو التطبيق
document.addEventListener("visibilitychange", () => {
    if (document.hidden && gameInProgress) {
        cancelAttempt("تم إلغاء المحاولة بسبب الخروج من اللعبة");
    }
});

window.addEventListener("blur", () => {
    if (gameInProgress) {
        cancelAttempt("تم إلغاء المحاولة بسبب الخروج من اللعبة");
    }
});

// التعامل مع انقطاع الإنترنت
function handleOffline() {
    if (!gameInProgress || isOfflinePaused) return;
    isOfflinePaused = true;
    showOfflineOverlay();

    offlineTimeLeft = 120;
    clearInterval(offlineTimerInterval);
    offlineTimerInterval = setInterval(() => {
        offlineTimeLeft--;
        const offlineCountElem = document.getElementById("offline-countdown");
        if (offlineCountElem) {
            offlineCountElem.innerText = `المتبقي للمحاولة: ${offlineTimeLeft} ثانية`;
        }

        if (navigator.onLine) {
            handleOnline();
        }

        if (offlineTimeLeft <= 0) {
            clearInterval(offlineTimerInterval);
            isOfflinePaused = false;
            cancelAttempt("تم إلغاء المحاولة بسبب انقطاع الاتصال لأكثر من دقيقتين");
        }
    }, 1000);
}

function handleOnline() {
    if (!isOfflinePaused) return;
    isOfflinePaused = false;
    clearInterval(offlineTimerInterval);
    hideOfflineOverlay();
}

window.addEventListener("offline", handleOffline);
window.addEventListener("online", handleOnline);

function showOfflineOverlay() {
    let overlay = document.getElementById("offline-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "offline-overlay";
        overlay.className = "offline-overlay";
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div class="offline-content">
            <div class="offline-icon-wrap">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
            </div>
            <h2>انقطع الاتصال</h2>
            <p>جاري محاولة إعادة الاتصال بالشبكة...</p>
            <div id="offline-countdown" class="offline-timer-badge">المتبقي للمحاولة: 120 ثانية</div>
        </div>
    `;
    overlay.style.display = "flex";
}

function hideOfflineOverlay() {
    const overlay = document.getElementById("offline-overlay");
    if (overlay) {
        overlay.style.display = "none";
    }
}

// البدء بتحميل الأسئلة وعرض الصفحة الرئيسية
loadQuestions().then(() => {
    renderHomeScreen();
});
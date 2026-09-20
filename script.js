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
let timeLeft = 10;
let gameInProgress = false;
let isOfflinePaused = false;
let offlineTimerInterval = null;
let offlineTimeLeft = 120;
let questionAnswered = false;

// صوت تنبيه لمؤقت الثواني الأخيرة (3، 2، 1)
function playWarningBeep() {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        // يتجاهل إذا لم يتفاعل المستخدم بعد مع الصفحة
    }
}

async function loadQuestions() {
    const { data, error } = await supabaseClient
        .from("questions")
        .select("*")
        .order("question_number");

    if (error) {
        console.error("فشل تحميل الأسئلة:", error);
        return false;
    }

    allQuestions = data.map(q => ({
        q: q.question_text,
        a: q.options,
        c: q.correct_option,
        e: q.explanation
    }));

    console.log("تم تحميل الأسئلة:", allQuestions);
    return true;
}

function renderHomeScreen(message = "") {
    gameInProgress = false;
    clearInterval(timerInterval);
    clearInterval(offlineTimerInterval);
    hideOfflineOverlay();

    const app = document.getElementById("app");
    let html = `
        <h1><span class="kit">✚</span> أنت المسعف</h1>
        <p>موقف واحد، قرار واحد. هل أنت مستعد؟</p>
    `;

    if (message) {
        html += `<div class="result wrong" style="margin-bottom: 15px;"><p>${message}</p></div>`;
    }

    html += `
        <div class="mode-selection">
            <button class="mode-card primary" onclick="startAdultChallenge()">
                <span class="mode-title">🚑 المسعف</span>
                <span class="mode-desc">تحدي الإسعافات الأولية</span>
            </button>
    `;

    if (SHOW_CHILD_MODE) {
        html += `
            <button class="mode-card secondary" onclick="startChildChallenge()">
                <span class="mode-title">🧒 المسعف الصغير</span>
                <span class="mode-desc">تحدٍ تعليمي للأطفال</span>
            </button>
        `;
    }

    html += `</div>`;
    app.innerHTML = html;
}

async function startAdultChallenge() {
    if (allQuestions.length === 0) {
        const success = await loadQuestions();
        if (!success || allQuestions.length === 0) {
            alert("تعذر تحميل الأسئلة. يرجى التثبت من الاتصال بالإنترنت والمحاولة مجدداً.");
            return;
        }
    }

    // اختيار 10 أسئلة عشوائية بدون تكرار
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    currentGameQuestions = shuffled.slice(0, 10);
    currentQuestionIndex = 0;
    score = 0;
    gameInProgress = true;

    renderQuestion();
}

function startChildChallenge() {
    alert("قريباً... تحدي المسعف الصغير!");
}

function renderQuestion() {
    questionAnswered = false;
    const currentQ = currentGameQuestions[currentQuestionIndex];
    timeLeft = 10;

    const app = document.getElementById("app");
    let html = `
        <div class="quiz-header">
            <span class="progress-text">السؤال ${currentQuestionIndex + 1} من 10</span>
            <span id="timer" class="timer-box">⏱️ 10</span>
        </div>
        <div class="question-container">
            <h2>${currentQ.q}</h2>
            <p>اختر التصرف الأنسب:</p>
            <div class="options-list">
    `;

    currentQ.a.forEach((answer, index) => {
        html += `<button class="answer" id="opt-${index}" onclick="handleAnswerSelect(${index})">${answer}</button>`;
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
    const timerElem = document.getElementById("timer");

    timerInterval = setInterval(() => {
        if (isOfflinePaused) return;

        timeLeft--;
        if (timerElem) {
            timerElem.innerText = `⏱️ ${timeLeft}`;
            if (timeLeft <= 3 && timeLeft > 0) {
                timerElem.classList.add("timer-warning");
                playWarningBeep();
            } else if (timeLeft > 3) {
                timerElem.classList.remove("timer-warning");
            }
        }

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (!questionAnswered) {
                handleTimeOut();
            }
        }
    }, 1000);
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
            ? `<div class="result inline-feedback"><h2>✅ إجابة صحيحة!</h2><p>${currentQ.e}</p></div>`
            : `<div class="result wrong inline-feedback"><h2>❌ إجابة غير صحيحة</h2><p>الإجابة الصحيحة: <strong>${currentQ.a[currentQ.c]}</strong></p><p>${currentQ.e}</p></div>`;
    }

    setTimeout(() => {
        nextQuestion();
    }, 2200);
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
        feedbackElem.innerHTML = `<div class="result wrong inline-feedback"><h2>⏰ انتهى الوقت!</h2><p>الإجابة الصحيحة: <strong>${currentQ.a[currentQ.c]}</strong></p><p>${currentQ.e}</p></div>`;
    }

    setTimeout(() => {
        nextQuestion();
    }, 2200);
}

function nextQuestion() {
    currentQuestionIndex++;
    if (currentQuestionIndex < 10 && currentQuestionIndex < currentGameQuestions.length) {
        renderQuestion();
    } else {
        finishGame();
    }
}

function finishGame() {
    gameInProgress = false;
    clearInterval(timerInterval);
    const app = document.getElementById("app");
    app.innerHTML = `
        <div class="result final-result">
            <h2>🏆 اكتمل التحدي!</h2>
            <h1 class="score-display">نتيجتك: ${score} / 10</h1>
            <p>${score >= 7 ? 'أنت مسعف قدير! تملك المعرفة والسرعة لحفظ الأرواح.' : 'محاولة جيدة! واصل التعلم وتجربة التحدي مرة أخرى.'}</p>
            <button class="start" style="margin-top: 20px;" onclick="renderHomeScreen()">العودة للرئيسية</button>
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
            <h2>⚠️ انقطع الاتصال</h2>
            <p>جاري محاولة إعادة الاتصال...</p>
            <span id="offline-countdown" style="font-size: 14px; opacity: 0.85;">المتبقي للمحاولة: 120 ثانية</span>
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
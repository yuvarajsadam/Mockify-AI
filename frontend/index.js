// ==================== GLOBAL STATE ====================
let mediaRecorder = null;
let recordingChunks = [];
let recordedBlob = null;
let isSpeaking = false;
let currentAudio = null;
let resumeFile = null;
let questionCount = 1;
let isInterviewComplete = false;

// Quota state
let quotaCountdownInterval = null;
let quotaRetryFn = null;  // function to call when user retries after quota error

// ==================== DOM REFS ====================
const setupScreen = document.getElementById("setupScreen");
const interviewScreen = document.getElementById("interviewScreen");

// Setup elements
const resumeInput = document.getElementById("resumeInput");
const dropZone = document.getElementById("dropZone");
const fileBanner = document.getElementById("fileBanner");
const fileIcon = document.getElementById("fileIcon");
const fileName = document.getElementById("fileName");
const removeFileBtn = document.getElementById("removeFileBtn");
const jdInput = document.getElementById("jdInput");
const setupStatus = document.getElementById("setupStatus");
const startBtn = document.getElementById("startBtn");

// Interview elements
const chatTranscript = document.getElementById("chatTranscript");
const chatEmpty = document.getElementById("chatEmpty");
const recordBtn = document.getElementById("recordBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const submitBtn = document.getElementById("submitBtn");
const endBtn = document.getElementById("endBtn");
const recordingStatusEl = document.getElementById("recordingStatusEl");
const recordingStatusText = document.getElementById("recordingStatusText");

// AI panel
const speakingRing = document.getElementById("speakingRing");
const aiStatusBadge = document.getElementById("aiStatusBadge");
const currentQuestionText = document.getElementById("currentQuestionText");
const questionNumDisplay = document.getElementById("questionNumDisplay");
const progressFill = document.getElementById("progressFill");

// Top bar
const topbarTitle = document.getElementById("topbarTitle");
const interviewBadge = document.getElementById("interviewBadge");
const badgeText = document.getElementById("badgeText");

// Feedback
const feedbackSection = document.getElementById("feedbackSection");
const getFeedbackArea = document.getElementById("getFeedbackArea");
const getFeedbackBtn = document.getElementById("getFeedbackBtn");
const feedbackContent = document.getElementById("feedbackContent");
const feedbackRoleLabel = document.getElementById("feedbackRoleLabel");
const scoreCircle = document.getElementById("scoreCircle");
const scoreValue = document.getElementById("scoreValue");
const feedbackText = document.getElementById("feedbackText");
const improvementText = document.getElementById("improvementText");
const newInterviewBtn = document.getElementById("newInterviewBtn");

// Quota overlay elements
const quotaOverlay   = document.getElementById("quotaOverlay");
const quotaTimer     = document.getElementById("quotaTimer");
const quotaProgressFill = document.getElementById("quotaProgressFill");
const quotaRetryBtn  = document.getElementById("quotaRetryBtn");
const quotaDismissBtn = document.getElementById("quotaDismissBtn");


// ==================== UI HELPERS ====================

function setRecordingStatus(text, type = "") {
    recordingStatusText.textContent = text;
    recordingStatusEl.className = "recording-status";
    const dot = recordingStatusEl.querySelector(".recording-indicator");
    dot.className = "recording-indicator";
    if (type === "recording") {
        recordingStatusEl.classList.add("recording-active-text");
        dot.classList.add("blink");
    } else if (type === "listening") {
        recordingStatusEl.classList.add("listening-text");
    } else if (type === "ready") {
        recordingStatusEl.classList.add("ready-text");
    }
}

function setAIStatus(status) {
    // status: 'idle' | 'speaking' | 'listening' | 'thinking'
    aiStatusBadge.className = "ai-status-badge " + status;
    speakingRing.className = "speaking-ring";

    if (status === "speaking") {
        aiStatusBadge.textContent = "Speaking...";
        speakingRing.classList.add("active");
        setRecordingStatus("Natalie is speaking...", "listening");
    } else if (status === "listening") {
        aiStatusBadge.textContent = "Listening";
        setRecordingStatus("Click mic to record your answer", "ready");
    } else if (status === "thinking") {
        aiStatusBadge.textContent = "Thinking...";
        setRecordingStatus("Processing...");
    } else {
        aiStatusBadge.textContent = "Idle";
        setRecordingStatus("Waiting...");
    }
}

function updateProgress(qNum) {
    questionNumDisplay.textContent = qNum;
    const pct = Math.min((qNum / 10) * 100, 100);
    progressFill.style.width = pct + "%";
}

function setCurrentQuestion(text) {
    currentQuestionText.textContent = text;
}

// ==================== CHAT TRANSCRIPT ====================

function appendChatMessage(role, text, label) {
    // Remove empty state
    if (chatEmpty && chatEmpty.parentNode === chatTranscript) {
        chatTranscript.removeChild(chatEmpty);
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-message " + (role === "user" ? "user-msg" : "");

    const avatarDiv = document.createElement("div");
    if (role === "ai") {
        avatarDiv.className = "chat-avatar ai-avatar";
        const img = document.createElement("img");
        img.src = "https://www.whiteroomstudio.com.sg/wordpress/wp-content/uploads/2021/10/professional-headshot-photography-linkedin-singapore-5.jpeg";
        img.alt = "Natalie";
        avatarDiv.appendChild(img);
    } else {
        avatarDiv.className = "chat-avatar user-avatar";
        avatarDiv.textContent = "You";
    }

    const contentDiv = document.createElement("div");
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + (role === "ai" ? "ai-bubble" : "user-bubble");
    bubble.textContent = text;

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = label || (role === "ai" ? "Natalie" : "You");

    contentDiv.appendChild(bubble);
    contentDiv.appendChild(meta);

    msgDiv.appendChild(avatarDiv);
    msgDiv.appendChild(contentDiv);
    chatTranscript.appendChild(msgDiv);

    // Scroll to bottom
    chatTranscript.scrollTop = chatTranscript.scrollHeight;
}

function showTypingIndicator() {
    const typingDiv = document.createElement("div");
    typingDiv.id = "typingIndicator";
    typingDiv.className = "chat-message";

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "chat-avatar ai-avatar";
    const img = document.createElement("img");
    img.src = "https://www.whiteroomstudio.com.sg/wordpress/wp-content/uploads/2021/10/professional-headshot-photography-linkedin-singapore-5.jpeg";
    avatarDiv.appendChild(img);

    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;

    typingDiv.appendChild(avatarDiv);
    typingDiv.appendChild(indicator);
    chatTranscript.appendChild(typingDiv);
    chatTranscript.scrollTop = chatTranscript.scrollHeight;
}

function removeTypingIndicator() {
    const existing = document.getElementById("typingIndicator");
    if (existing) existing.remove();
}

// ==================== ERROR TOAST ====================

function showErrorToast(message, retryFn = null) {
    // Remove any existing toast
    const existing = document.getElementById("errorToast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "errorToast";
    toast.className = "error-toast";
    toast.innerHTML = `
        <div class="error-toast-header"><i class="fas fa-exclamation-triangle"></i> Error</div>
        <div class="error-toast-body">${message}</div>
        ${retryFn ? `<button class="error-toast-retry" id="toastRetryBtn"><i class="fas fa-redo"></i> Retry</button>` : ""}
    `;

    document.body.appendChild(toast);

    if (retryFn) {
        document.getElementById("toastRetryBtn").addEventListener("click", () => {
            toast.remove();
            retryFn();
        });
    }

    // Auto-dismiss after 8 seconds
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
}

// ==================== QUOTA OVERLAY ====================

/**
 * Show the quota-exhausted full-screen overlay.
 * @param {number} retryAfterSeconds  - seconds to wait before retry (from backend)
 * @param {Function} retryFn          - function to call when user clicks Retry / auto-retry fires
 */
function showQuotaOverlay(retryAfterSeconds, retryFn) {
    // Store retry function for button click
    quotaRetryFn = retryFn;

    // Show an inline warning bar in the chat too
    appendQuotaInlineBanner(retryAfterSeconds);

    // Show overlay
    quotaOverlay.classList.remove("hidden");

    // Disable retry button until countdown ends
    quotaRetryBtn.disabled = true;

    // Clear any existing countdown
    if (quotaCountdownInterval) clearInterval(quotaCountdownInterval);

    let remaining = retryAfterSeconds > 0 ? retryAfterSeconds : 60;
    const total = remaining;

    function formatTime(s) {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }

    // Set initial display
    quotaTimer.textContent = formatTime(remaining);
    quotaProgressFill.style.width = "100%";

    quotaCountdownInterval = setInterval(() => {
        remaining--;
        quotaTimer.textContent = formatTime(Math.max(remaining, 0));
        quotaProgressFill.style.width = ((remaining / total) * 100).toFixed(1) + "%";

        if (remaining <= 0) {
            clearInterval(quotaCountdownInterval);
            quotaCountdownInterval = null;
            quotaTimer.textContent = "Ready!";
            quotaProgressFill.style.width = "0%";
            quotaRetryBtn.disabled = false;
            // Auto-retry
            hideQuotaOverlay();
            if (quotaRetryFn) quotaRetryFn();
        }
    }, 1000);
}

function hideQuotaOverlay() {
    quotaOverlay.classList.add("hidden");
    if (quotaCountdownInterval) {
        clearInterval(quotaCountdownInterval);
        quotaCountdownInterval = null;
    }
}

function appendQuotaInlineBanner(seconds) {
    // Remove any existing inline banner
    const existing = document.getElementById("quotaInlineBanner");
    if (existing) existing.remove();

    if (chatEmpty && chatEmpty.parentNode === chatTranscript) {
        chatTranscript.removeChild(chatEmpty);
    }

    const bar = document.createElement("div");
    bar.id = "quotaInlineBanner";
    bar.className = "quota-inline-bar";
    bar.innerHTML = `
        <i class="fas fa-bolt"></i>
        <span>
            <strong>API quota exhausted</strong> — Gemini free tier limit (20 req/day) reached.
            Retrying in <strong id="quotaInlineTimer">${seconds}s</strong>. Your answers are saved.
        </span>
    `;
    chatTranscript.appendChild(bar);
    chatTranscript.scrollTop = chatTranscript.scrollHeight;

    // Also tick the inline timer
    let rem = seconds;
    const inlineInterval = setInterval(() => {
        rem--;
        const el = document.getElementById("quotaInlineTimer");
        if (el) el.textContent = Math.max(rem, 0) + "s";
        if (rem <= 0) clearInterval(inlineInterval);
    }, 1000);
}

// Wire overlay buttons
quotaRetryBtn.addEventListener("click", () => {
    hideQuotaOverlay();
    if (quotaRetryFn) quotaRetryFn();
});

quotaDismissBtn.addEventListener("click", () => {
    hideQuotaOverlay();
    // Remove inline banner and restore status
    const bar = document.getElementById("quotaInlineBanner");
    if (bar) bar.remove();
    setAIStatus("idle");
    setRecordingStatus("Quota paused — dismissed. Click End to get feedback.");
    endBtn.disabled = false;
});

// ==================== AUDIO STREAMING ====================

function handleAudioStream(response, questionText, onComplete) {
    // Show question in UI immediately
    if (questionText) {
        setCurrentQuestion(questionText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let mediaSource = new MediaSource();
    let audioUrl = URL.createObjectURL(mediaSource);
    let sourceBuffer;
    let queue = [];
    let isSourceBufferReady = false;
    let streamDone = false;

    setAIStatus("speaking");
    isSpeaking = true;
    recordBtn.disabled = true;
    endBtn.disabled = true;

    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    currentAudio = new Audio(audioUrl);
    currentAudio.play().catch(() => {});

    mediaSource.addEventListener("sourceopen", () => {
        try {
            sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        } catch (e) {
            console.error("SourceBuffer error:", e);
            if (onComplete) onComplete();
            return;
        }
        isSourceBufferReady = true;

        function flushQueue() {
            if (queue.length > 0 && !sourceBuffer.updating) {
                sourceBuffer.appendBuffer(queue.shift());
            } else if (queue.length === 0 && streamDone && mediaSource.readyState === "open") {
                try { mediaSource.endOfStream(); } catch (e) {}
            }
        }

        sourceBuffer.addEventListener("updateend", flushQueue);

        // Flush any pre-queued data
        flushQueue();
    });

    function processChunk({ done, value }) {
        if (done) {
            streamDone = true;
            if (isSourceBufferReady && !sourceBuffer.updating && queue.length === 0) {
                if (mediaSource.readyState === "open") {
                    try { mediaSource.endOfStream(); } catch (e) {}
                }
            }
            if (onComplete) onComplete();
            return;
        }

        const textChunk = decoder.decode(value, { stream: true });
        textChunk.split("\n").forEach((line) => {
            if (line.trim()) {
                try {
                    const binaryString = atob(line.trim());
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    if (isSourceBufferReady && !sourceBuffer.updating) {
                        sourceBuffer.appendBuffer(bytes);
                    } else {
                        queue.push(bytes);
                    }
                } catch (e) {
                    console.warn("Base64 decode error:", e);
                }
            }
        });
        reader.read().then(processChunk).catch(err => console.error("Read error:", err));
    }

    reader.read().then(processChunk);

    currentAudio.onended = () => {
        isSpeaking = false;
        setAIStatus("listening");
        recordBtn.disabled = false;
        endBtn.disabled = false;
        URL.revokeObjectURL(audioUrl);
    };

    currentAudio.onerror = () => {
        isSpeaking = false;
        setAIStatus("listening");
        recordBtn.disabled = false;
        endBtn.disabled = false;
        URL.revokeObjectURL(audioUrl);
    };
}


// ==================== RECORDING ====================

function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? { mimeType: "audio/webm;codecs=opus" }
            : { mimeType: "audio/webm" };

        mediaRecorder = new MediaRecorder(stream, options);
        recordingChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordingChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(recordingChunks, { type: "audio/webm" });
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();

        recordBtn.classList.add("recording");
        micIcon.classList.add("hidden");
        stopIcon.classList.remove("hidden");
        submitBtn.classList.add("hidden");
        endBtn.disabled = true;
        setRecordingStatus("Recording... click to stop", "recording");

    }).catch(err => {
        console.error("Microphone error:", err);
        showErrorToast("Microphone access denied. Please allow microphone access in your browser.");
    });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        recordBtn.classList.remove("recording");
        micIcon.classList.remove("hidden");
        stopIcon.classList.add("hidden");
        submitBtn.classList.remove("hidden");
        submitBtn.disabled = false;
        setRecordingStatus("Recording done — click Submit to send", "ready");
    }
}


// ==================== API CALLS ====================

const API_BASE = "http://127.0.0.1:5000";

async function startInterview() {
    if (!resumeFile) {
        showErrorToast("Please upload a resume first.");
        return;
    }

    const jdText = jdInput.value.trim();

    // Transition to interview screen
    setupScreen.classList.add("hidden");
    interviewScreen.classList.remove("hidden");
    interviewScreen.style.display = "flex";
    interviewBadge.classList.remove("hidden");

    const derivedRole = jdText ? jdText.split("\n")[0].trim().substring(0, 45) : "Practice Interview";
    badgeText.textContent = derivedRole;
    topbarTitle.textContent = derivedRole;
    feedbackRoleLabel.textContent = derivedRole;

    showTypingIndicator();
    setAIStatus("thinking");
    setRecordingStatus("Preparing interview...");

    const formData = new FormData();
    formData.append("resume", resumeFile);
    formData.append("job_description", jdText);

    try {
        const response = await fetch(`${API_BASE}/start-interview`, {
            method: "POST",
            body: formData
        });

        removeTypingIndicator();

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 429) {
                const retryAfter = parseInt(errData.retry_after || 60);
                setAIStatus("idle");
                setRecordingStatus("Quota exhausted — waiting...");
                showQuotaOverlay(retryAfter, startInterview);
            } else {
                const msg = errData.error || `Server error (${response.status})`;
                showErrorToast(msg, startInterview);
                setAIStatus("idle");
            }
            return;
        }

        const questionText = decodeQuestionHeader(response);
        if (questionText) {
            appendChatMessage("ai", questionText, "Natalie — Q1");
        }

        handleAudioStream(response, questionText, () => {
            endBtn.disabled = false;
        });

    } catch (error) {
        removeTypingIndicator();
        console.error("Start interview error:", error);
        showErrorToast("Could not connect to backend. Make sure the server is running at localhost:5000.", startInterview);
        setAIStatus("idle");
        // Go back to setup
        setupScreen.classList.remove("hidden");
        interviewScreen.classList.add("hidden");
    }
}

async function submitAnswer() {
    if (!recordedBlob) return;

    const answerBlob = recordedBlob;
    recordedBlob = null;
    recordingChunks = [];
    submitBtn.classList.add("hidden");
    endBtn.disabled = true;
    setAIStatus("thinking");

    // Show user's transcribing indicator
    const transcribingEl = document.createElement("div");
    transcribingEl.id = "transcribingEl";
    transcribingEl.className = "chat-message user-msg";
    transcribingEl.innerHTML = `
        <div class="chat-avatar user-avatar">You</div>
        <div>
            <div class="chat-bubble user-bubble" style="color: var(--text-dim); font-style: italic;">Transcribing your answer...</div>
        </div>
    `;
    if (chatEmpty.parentNode === chatTranscript) chatTranscript.removeChild(chatEmpty);
    chatTranscript.appendChild(transcribingEl);
    chatTranscript.scrollTop = chatTranscript.scrollHeight;

    const formData = new FormData();
    formData.append("audio", answerBlob, "answer.webm");

    try {
        const response = await fetch(`${API_BASE}/submit-answer`, {
            method: "POST",
            body: formData
        });

        // Remove transcribing placeholder
        const te = document.getElementById("transcribingEl");
        if (te) te.remove();

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 429) {
                const retryAfter = parseInt(errData.retry_after || 60);
                setAIStatus("idle");
                setRecordingStatus("Quota exhausted — waiting...");
                recordBtn.disabled = false;
                endBtn.disabled = false;
                showQuotaOverlay(retryAfter, submitAnswer);
            } else {
                const msg = errData.error || `Server error (${response.status})`;
                showErrorToast(msg, submitAnswer);
                setAIStatus("listening");
                recordBtn.disabled = false;
                endBtn.disabled = false;
            }
            return;
        }

        const isComplete = response.headers.get("X-Interview-Complete") === "true";
        const qNumHeader = response.headers.get("X-Question-Number");
        const questionText = decodeQuestionHeader(response);

        // Fetch transcript to get the last user answer text
        fetchAndShowLastAnswer(questionText, qNumHeader, isComplete);

        handleAudioStream(response, questionText, () => {
            recordedBlob = null;
            recordingChunks = [];
            if (isComplete) {
                // Wait for audio to end, then show feedback
                if (currentAudio) {
                    currentAudio.onended = () => {
                        isSpeaking = false;
                        setAIStatus("idle");
                        showFeedbackSection();
                    };
                } else {
                    showFeedbackSection();
                }
            } else {
                endBtn.disabled = false;
            }
        });

    } catch (error) {
        const te = document.getElementById("transcribingEl");
        if (te) te.remove();
        console.error("Submit error:", error);
        showErrorToast("Failed to submit answer. Please try again.", submitAnswer);
        setAIStatus("listening");
        recordBtn.disabled = false;
        endBtn.disabled = false;
    }
}

async function fetchAndShowLastAnswer(nextQuestionText, qNumHeader, isComplete) {
    // Get transcript from backend to show the user's transcribed answer
    try {
        const r = await fetch(`${API_BASE}/get-transcript`);
        const data = await r.json();
        const transcript = data.transcript || [];

        // Find the last user message
        const userEntries = transcript.filter(e => e.role === "user");
        if (userEntries.length > 0) {
            const lastAnswer = userEntries[userEntries.length - 1].text;
            appendChatMessage("user", lastAnswer, "You");
        }

        // Show typing indicator then AI question
        if (nextQuestionText) {
            const qNum = qNumHeader ? parseInt(qNumHeader) : questionCount + 1;
            questionCount = qNum;
            updateProgress(qNum);
            showTypingIndicator();
            setTimeout(() => {
                removeTypingIndicator();
                appendChatMessage("ai", nextQuestionText, `Natalie — Q${qNum}`);
            }, 800);
        }
    } catch (e) {
        console.warn("Could not fetch transcript:", e);
        // Fallback: just add the AI message
        if (nextQuestionText) {
            const qNum = qNumHeader ? parseInt(qNumHeader) : questionCount + 1;
            questionCount = qNum;
            updateProgress(qNum);
            appendChatMessage("ai", nextQuestionText, `Natalie — Q${qNum}`);
        }
    }
}

function decodeQuestionHeader(response) {
    try {
        const encoded = response.headers.get("X-Question-Text");
        if (encoded) return decodeURIComponent(encoded);
    } catch (e) {
        console.warn("Could not decode question header:", e);
    }
    return null;
}

async function getFeedback() {
    getFeedbackBtn.disabled = true;
    getFeedbackBtn.innerHTML = `<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i> Generating Feedback...`;

    try {
        const response = await fetch(`${API_BASE}/get-feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (data.success && data.feedback) {
            displayFeedback(data.feedback);
        } else if (response.status === 429 || !response.ok) {
            const retryAfter = data.retry_after || 60;
            showQuotaOverlay(retryAfter, getFeedback);
            getFeedbackBtn.disabled = false;
            getFeedbackBtn.innerHTML = `<i class="fas fa-chart-bar" style="margin-right:8px;"></i> Retry Feedback`;
        } else {
            const msg = data.error || "Could not generate feedback.";
            showErrorToast(msg, getFeedback);
            getFeedbackBtn.disabled = false;
            getFeedbackBtn.innerHTML = `<i class="fas fa-chart-bar" style="margin-right:8px;"></i> Retry Feedback`;
        }

    } catch (error) {
        console.error("Feedback error:", error);
        showErrorToast("Failed to get feedback. Please retry.", getFeedback);
        getFeedbackBtn.disabled = false;
        getFeedbackBtn.innerHTML = `<i class="fas fa-chart-bar" style="margin-right:8px;"></i> Retry Feedback`;
    }
}

function displayFeedback(data) {
    const score = data.candidate_score || 0;
    scoreValue.textContent = score;

    // Animate score circle: circumference = 2 * pi * 32 ≈ 201
    const circumference = 201;
    const offset = circumference - (score / 5) * circumference;
    scoreCircle.style.strokeDashoffset = offset;

    feedbackText.textContent = data.feedback || "No feedback available.";
    improvementText.textContent = data.areas_of_improvement || "No suggestions available.";
    feedbackRoleLabel.textContent = data.subject || "Practice Interview";

    getFeedbackArea.classList.add("hidden");
    feedbackContent.classList.remove("hidden");
}

function showFeedbackSection() {
    isInterviewComplete = true;
    recordBtn.disabled = true;
    submitBtn.classList.add("hidden");
    endBtn.disabled = true;
    feedbackSection.classList.remove("hidden");
    feedbackSection.scrollIntoView({ behavior: "smooth" });
}


// ==================== FILE HANDLING ====================

function handleFileSelect(file) {
    if (!file) return;
    resumeFile = file;
    fileName.textContent = file.name;

    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) {
        fileIcon.className = "fas fa-file-pdf";
        fileIcon.style.color = "#f87171";
    } else if (name.endsWith(".docx")) {
        fileIcon.className = "fas fa-file-word";
        fileIcon.style.color = "#60a5fa";
    } else {
        fileIcon.className = "fas fa-file-alt";
        fileIcon.style.color = "#9ca3af";
    }

    dropZone.classList.add("hidden");
    fileBanner.classList.remove("hidden");
    validateSetup();
}

function validateSetup() {
    if (resumeFile) {
        startBtn.disabled = false;
        setupStatus.textContent = "✓ Ready to start";
        setupStatus.className = "setup-status ready";
    } else {
        startBtn.disabled = true;
        setupStatus.textContent = "Upload a resume to unlock the interview";
        setupStatus.className = "setup-status";
    }
}

function resetToSetup() {
    // Reset state
    mediaRecorder = null;
    recordingChunks = [];
    recordedBlob = null;
    isSpeaking = false;
    resumeFile = null;
    questionCount = 1;
    isInterviewComplete = false;

    if (currentAudio) { currentAudio.pause(); currentAudio = null; }

    // Reset form
    resumeInput.value = "";
    jdInput.value = "";
    fileBanner.classList.add("hidden");
    dropZone.classList.remove("hidden");

    // Reset transcript
    chatTranscript.innerHTML = "";
    chatTranscript.appendChild(chatEmpty);
    chatEmpty.classList.remove("hidden");

    // Reset controls
    recordBtn.disabled = true;
    recordBtn.classList.remove("recording");
    micIcon.classList.remove("hidden");
    stopIcon.classList.add("hidden");
    submitBtn.classList.add("hidden");
    endBtn.disabled = true;

    // Reset feedback
    feedbackSection.classList.add("hidden");
    feedbackContent.classList.add("hidden");
    getFeedbackArea.classList.remove("hidden");
    getFeedbackBtn.disabled = false;
    getFeedbackBtn.innerHTML = `<i class="fas fa-chart-bar" style="margin-right:8px;"></i> Generate Feedback`;
    scoreCircle.style.strokeDashoffset = 201;
    scoreValue.textContent = "–";

    // Reset AI panel
    setCurrentQuestion("Waiting to begin...");
    updateProgress(1);
    setAIStatus("idle");

    // Reset top bar
    topbarTitle.textContent = "Practice Interview";
    interviewBadge.classList.add("hidden");

    // Switch screen
    setupScreen.classList.remove("hidden");
    interviewScreen.classList.add("hidden");

    validateSetup();
}


// ==================== EVENT LISTENERS ====================

// File upload
dropZone.addEventListener("click", () => resumeInput.click());

resumeInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
});

removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resumeFile = null;
    resumeInput.value = "";
    fileBanner.classList.add("hidden");
    dropZone.classList.remove("hidden");
    validateSetup();
});

// Start interview
startBtn.addEventListener("click", startInterview);

// Record button
recordBtn.addEventListener("click", () => {
    if (isSpeaking || recordBtn.disabled) return;
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
        startRecording();
    } else {
        stopRecording();
    }
});

// Submit answer
submitBtn.addEventListener("click", submitAnswer);

// End interview
endBtn.addEventListener("click", async () => {
    if (!confirm("End the interview and get feedback?")) return;
    endBtn.disabled = true;
    recordBtn.disabled = true;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    showFeedbackSection();
});

// Feedback
getFeedbackBtn.addEventListener("click", getFeedback);
newInterviewBtn.addEventListener("click", resetToSetup);

// Init
validateSetup();
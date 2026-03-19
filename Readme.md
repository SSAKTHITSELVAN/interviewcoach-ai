<div align="center">

# 🎯 InterviewCouch AI

### Fully Offline AI Interview Coach for Windows

[![Download](https://img.shields.io/badge/⬇️%20Download%20Installer-v1.0.0-white?style=for-the-badge)](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-blue?style=for-the-badge&logo=windows)](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/releases/latest)
[![Offline](https://img.shields.io/badge/Network-Fully%20Offline-green?style=for-the-badge)](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

**Practice job interviews with a real AI interviewer — no internet, no API keys, no subscriptions.**

[**⬇️ Download Now**](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/releases/latest) · [Report Bug](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/issues) · [Request Feature](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/issues)

</div>

---

## ✨ What It Does

InterviewCouch puts a senior technical interviewer on your desktop — fully offline, completely private. Alex (your AI interviewer) asks real questions, follows up on your answers, adapts to your experience level, and gives you detailed feedback with scores.

- 🎙️ **Voice-first** — speak your answers naturally, see them transcribed in real time
- 🤖 **Adaptive AI** — follow-up questions based on what you actually said
- 📄 **Resume-aware** — upload your CV, get questions tailored to your background
- 📊 **Detailed feedback** — scores for Technical, Communication, and Confidence
- 🔒 **100% offline** — everything runs on your machine, nothing leaves it

---

## ⬇️ Download & Install

> **No technical knowledge required. Just download and double-click.**

### Minimum Requirements
| | |
|---|---|
| **OS** | Windows 10 or Windows 11 (64-bit) |
| **RAM** | 4 GB minimum, 8 GB recommended |
| **Storage** | 2 GB free space |
| **CPU** | Any modern x64 processor |

### Steps

1. Go to the [**Releases page**](https://github.com/SSAKTHITSELVAN/interviewcoach-ai/releases/latest)
2. Download **`InterviewCouch-Setup-1.0.0.exe`**
3. Double-click the installer
4. If Windows SmartScreen appears → click **"More info" → "Run anyway"** *(app is unsigned, this is normal)*
5. Follow the install wizard → click **Finish**
6. Launch **InterviewCouch** from your Desktop or Start Menu
7. Wait for the **green "AI Ready"** dot → you're good to go

---

## 🎮 How to Use

```
1. Click "Start Interview"
2. Select your role and experience level
3. Optionally upload your resume (PDF or TXT)
4. Click "Begin Interview"
5. Alex greets you and asks the first question
6. Press SPACE (hold) or click 🎙️ to record your answer
7. Release to transcribe → Alex responds
8. After ~10 questions → automatic feedback with scores
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` (hold) | Record answer |
| `Space` (release) | Stop recording |
| `Enter` | Send typed answer |

---

## 🤖 AI Stack

Everything runs locally on your machine:

| Component | Technology | Size |
|-----------|-----------|------|
| **Interviewer AI** | Llama 3.2-1B via llama.cpp | ~808 MB |
| **Speech-to-Text** | Whisper tiny.en | ~75 MB |
| **Text-to-Speech** | Windows SAPI (built-in) | 0 MB |
| **Resume Parsing** | pdf-parse | — |

---

## 🎯 Supported Roles

Engineering · Frontend · Backend · Full Stack · Mobile · DevOps · Data Engineer · ML/AI Engineer · Software Architect · QA · Engineering Manager · Product Manager · Technical Lead · Data Analyst · UX Designer · Business Analyst · and more

---

## ❓ FAQ

**Windows says "Windows protected your PC" — is it safe?**
Yes. The app is unsigned (no paid code-signing certificate). Click "More info" → "Run anyway". The full source code is in this repo for review.

**The AI sounds robotic / answers are slow**
The app uses a small 1B parameter model optimised for speed on CPU. Responses take 5–15 seconds depending on your CPU. For better quality, swap `models/llm/model.gguf` with a larger GGUF model from HuggingFace.

**Microphone not working**
Go to Windows Settings → Privacy → Microphone → allow desktop apps. You can always type your answers instead.

**Can I use a better AI model?**
Yes. Download any GGUF model from HuggingFace and replace `models/llm/model.gguf`. Recommended upgrades: Qwen2.5-3B Q4 (2GB) or Phi-3.5-mini Q4 (2.2GB).

---

## 🛠️ For Developers

Want to run from source or contribute?

```bash
# Prerequisites: Node.js v18+, Windows 10/11

git clone https://github.com/SSAKTHITSELVAN/interviewcoach-ai.git
cd interviewcoach-ai
npm install
npm run setup        # Downloads AI models (~900MB, one-time)
npm start            # Launch the app
```

To build the installer yourself:
```bash
npm run build        # Creates dist/InterviewCouch-Setup-1.0.0.exe
```

### Project Structure
```
interviewcoach-ai/
├── main.js                  ← Electron main process
├── preload.js               ← Secure IPC bridge
├── src/
│   ├── main/
│   │   ├── llm-service.js   ← Llama inference
│   │   ├── stt-service.js   ← Whisper transcription
│   │   ├── tts-service.js   ← Windows SAPI speech
│   │   └── ipc-handlers.js  ← IPC routing
│   └── renderer/
│       ├── pages/           ← HTML pages
│       ├── css/             ← Styles
│       └── js/              ← Session logic
├── scripts/
│   ├── setup.js             ← Downloads models & binaries
│   └── build.js             ← Builds installer
└── models/                  ← AI models (gitignored)
```

---

## 📝 License

MIT © 2025 [SSAKTHITSELVAN](https://github.com/SSAKTHITSELVAN/interviewcoach-ai)

---

<div align="center">
  <sub>Built with ❤️ using Electron · llama.cpp · Whisper.cpp · Node.js</sub>
</div>
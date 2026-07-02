# Mockify AI

Mockify AI is a voice-based mock interview platform that personalizes every interview to *you* — not a generic topic. Upload your resume and a job description, and Natalie, the AI interviewer, conducts a live voice interview built around your actual experience and the role's actual requirements.

## Why Mockify AI

Most mock interview tools ask the same canned questions regardless of who you are or what job you're targeting. Mockify AI instead:

- Reads your resume and grounds questions in real things you've done — specific projects, tools, roles.
- Reads the job description and probes the gaps between what's on your resume and what the role actually needs.
- Runs the whole thing as a live voice conversation, not a text quiz.
- Ends with a detailed, personalized feedback report — strengths, gaps, and concrete next steps tied to the role.

## How It Works

1. **Upload your resume** (PDF, DOCX, or TXT).
2. **Paste the job description** — or just a target role title if that's all you have.
3. **Natalie starts the interview** with a self-introduction question, then asks 8–10 questions built from your resume and mapped to the JD's requirements.
4. **Get AI feedback** — a score, your strengths, and specific areas to improve, all referencing what you actually said and what the role actually needs.

## Tech Stack

| Layer | Technology |
|---|---|
| LLM / interview reasoning | Google Gemini (via LangChain `create_agent` + LangGraph checkpointer) |
| Speech-to-text | AssemblyAI |
| Text-to-speech | Murf AI (streaming voice, `en-US-natalie`) |
| Backend | Python, Flask, Flask-CORS |
| Frontend | HTML, CSS, vanilla JavaScript (MediaSource-based audio streaming/recording) |

## Project Structure

```
.
├── backend/
│   └── app.py          # Flask API — interview orchestration, resume/JD parsing,
│                        # speech-to-text, TTS streaming, feedback generation
└── frontend/
    ├── index.html       # UI: resume upload, JD input, live interview screen, feedback screen
    └── index.js          # Recording, audio playback, API calls
```

## Getting Started

### Prerequisites

- Python 3.10+
- API keys for:
  - [Google AI Studio](https://aistudio.google.com/) (`GOOGLE_API_KEY`) — powers Gemini
  - [AssemblyAI](https://www.assemblyai.com/) (`ASSEMBLYAI_API_KEY`) — speech-to-text
  - [Murf AI](https://murf.ai/) (`MURF_API_KEY`) — text-to-speech

### Setup

1. Clone the repo:
   ```bash
   git clone <your-repo-url>
   cd mockify-ai
   ```

2. Install backend dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. Create a `.env` file inside `backend/`:
   ```env
   GOOGLE_API_KEY=your_google_api_key
   MURF_API_KEY=your_murf_api_key
   ASSEMBLYAI_API_KEY=your_assemblyai_api_key
   ```

4. Run the backend:
   ```bash
   python app.py
   ```

5. Open `frontend/index.html` in your browser (or serve it with a simple static server) and point it at the running backend.

## Usage

1. Open the app and upload your resume.
2. Paste in the job description (or a target role title).
3. Click **Start Interview** and allow microphone access.
4. Answer Natalie's questions out loud — she listens, responds, and adapts based on what you actually say.
5. Once the interview wraps up, review your personalized feedback report.

## Roadmap

- [ ] Deploy live demo
- [ ] Support multiple resume formats more robustly
- [ ] Session history / multiple past interviews
- [ ] Export feedback report as PDF

## Disclaimer

This is a personal/portfolio project built for practicing interview skills. It is not affiliated with any employer or job platform.

## License

MIT (or update to whatever license you prefer)

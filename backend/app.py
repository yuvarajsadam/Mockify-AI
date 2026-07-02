from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver
from langchain.agents import create_agent
import assemblyai as aai
import os
import base64
import requests
import tempfile
import json
import pypdf
import docx
import io
import urllib.parse

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")
aai.settings.api_key = ASSEMBLYAI_API_KEY
checkpointer = InMemorySaver()

model = init_chat_model(
    "google_genai:gemini-2.5-flash",
    api_key=GOOGLE_API_KEY
)

agent = create_agent(
    model=model,
    tools=[],
    checkpointer=checkpointer
)

question_count = 0
thread_id = "interview_session"
resume_text = ""
job_description = ""
derived_role = ""

# Local transcript store for feedback fallback
interview_transcript = []  # list of {"role": "ai"|"user", "text": "..."}
last_question_text = ""


def extract_text_from_file(file_storage):
    filename = file_storage.filename.lower()
    try:
        file_bytes = file_storage.read()
        if not file_bytes:
            return ""
        if filename.endswith(".pdf"):
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in reader.pages:
                text += page.extract_text() or ""
            return text.strip()
        elif filename.endswith(".docx"):
            doc = docx.Document(io.BytesIO(file_bytes))
            text = "\n".join([p.text for p in doc.paragraphs])
            return text.strip()
        else:
            return file_bytes.decode("utf-8", errors="ignore").strip()
    except Exception as e:
        print(f"Error extracting text from {filename}: {e}")
        return ""


INTERVIEW_PROMPT = """You are Natalie, a friendly, professional interviewer conducting a real job interview.

Here is the candidate's Resume (for context only — do NOT quiz every detail):
{resume_text}

Here is the Job Description / Job Title the candidate is applying for:
{job_description}

YOUR MISSION:
Conduct a focused, natural interview of 8 to 10 questions total. The interview must feel like a real job interview, not a resume quiz.

STRICT GUIDELINES:
1. START by asking the candidate to give a brief self-introduction (this is Question 1 always).
2. After their intro, ask 7-9 more questions. 
3. 60-70% of questions should be based on the JOB DESCRIPTION requirements — skills, responsibilities, domain knowledge the role needs.
4. 20-30% of questions can reference specific resume items (projects, internships, tools) only if they are highly relevant to the JD.
5. Ask at most ONE follow-up question per topic — do NOT keep drilling the same project or experience repeatedly.
6. Cover: technical skills from JD, behavioral/situational (at least 1), and any clear gap between resume and JD.
7. Keep each question SHORT and CRISP (1-2 sentences max). No lengthy explanations.
8. Be warm, conversational, and genuinely interested.
9. After 8-10 questions AND covering technical + behavioral areas, conclude the interview warmly and append the exact token "[INTERVIEW_COMPLETE]" at the very end of your closing message.
10. DO NOT repeat questions or topics already covered in the conversation.
11. ALWAYS acknowledge what the candidate ACTUALLY said — never make up or assume their answers.

CRITICAL: Focus on the JOB ROLE, not just the resume. The goal is to test if they can do THIS job."""


FEEDBACK_PROMPT = """Based on the interview conversation below, the candidate's resume, and the job description, provide detailed, honest feedback.

Candidate's Resume:
{resume_text}

Job Description:
{job_description}

Interview Transcript:
{transcript}

IMPORTANT: You MUST respond with ONLY a valid JSON object. No other text before or after.
Address the candidate directly using "you" and "your".
Respond with ONLY this JSON structure (no markdown, no code blocks, no extra text):
{{
    "subject": "{role}",
    "candidate_score": <integer 1-5>,
    "feedback": "<detailed strengths — reference specific things they actually said, how well they addressed the JD requirements>",
    "areas_of_improvement": "<specific gaps — what JD requirements they couldn't speak to, where answers were vague, what they should improve>"
}}
Be specific and constructive. Reference their ACTUAL answers and the JD requirements."""


app = Flask(__name__)
CORS(app, expose_headers=['X-Question-Number', 'X-Interview-Complete', 'X-Question-Text', 'X-Error'])


def stream_audio(text):
    BASE_URL = "https://global.api.murf.ai/v1/speech/stream"
    payload = {
        "text": text,
        "voiceId": "en-US-natalie",
        "model": "FALCON",
        "multiNativeLocale": "en-US",
        "sampleRate": 24000,
        "format": "MP3",
    }
    headers = {
        "Content-Type": "application/json",
        "api-key": MURF_API_KEY
    }
    response = requests.post(
        BASE_URL,
        headers=headers,
        data=json.dumps(payload),
        stream=True
    )
    for chunk in response.iter_content(chunk_size=4096):
        if chunk:
            yield base64.b64encode(chunk).decode("utf-8") + "\n"


def safe_agent_invoke(messages, config):
    """Invoke the agent and handle rate limit errors gracefully."""
    try:
        return agent.invoke({"messages": messages}, config=config), None
    except Exception as e:
        error_str = str(e)
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            # Extract retry delay if available
            import re
            match = re.search(r'retry in (\d+)', error_str)
            delay = match.group(1) if match else "60"
            return None, {"type": "rate_limit", "message": f"API quota exceeded. Please wait {delay} seconds and try again.", "retry_after": int(delay)}
        return None, {"type": "error", "message": f"An error occurred: {error_str[:200]}"}


def build_transcript_string():
    """Build a readable transcript from stored interview_transcript."""
    lines = []
    for i, entry in enumerate(interview_transcript):
        if entry["role"] == "ai":
            lines.append(f"Interviewer (Q{i//2 + 1}): {entry['text']}")
        else:
            lines.append(f"Candidate: {entry['text']}")
    return "\n\n".join(lines)


@app.route("/start-interview", methods=["POST"])
def start_interview():
    global question_count, checkpointer, agent, resume_text, job_description, derived_role, interview_transcript, last_question_text

    resume_file = request.files.get("resume")
    job_description = request.form.get("job_description", "")

    if resume_file:
        resume_text = extract_text_from_file(resume_file)
    else:
        resume_text = ""

    if not resume_text:
        resume_text = "No resume content uploaded or text could not be extracted."

    jd_clean = job_description.strip()
    if jd_clean:
        first_line = jd_clean.split("\n")[0].strip()
        derived_role = first_line[:42] + "..." if len(first_line) > 45 else first_line
    else:
        derived_role = "Custom Role"

    question_count = 1
    interview_transcript = []  # reset transcript
    checkpointer = InMemorySaver()
    agent = create_agent(
        model=model,
        tools=[],
        checkpointer=checkpointer
    )
    config = {"configurable": {"thread_id": thread_id}}
    formatted_prompt = INTERVIEW_PROMPT.format(
        resume_text=resume_text,
        job_description=job_description if job_description else "Not specified"
    )

    response, error = safe_agent_invoke(
        [
            {"role": "system", "content": formatted_prompt},
            {"role": "user", "content": "Start the interview. Greet the candidate warmly (use their name if you know it from the resume) and ask them for a brief self-introduction. Keep it to 2-3 sentences max."}
        ],
        config
    )

    if error:
        status_code = 429 if error["type"] == "rate_limit" else 500
        error_body = {"error": error["message"]}
        if error["type"] == "rate_limit":
            error_body["retry_after"] = error.get("retry_after", 60)
        return jsonify(error_body), status_code

    question = response["messages"][-1].content
    last_question_text = question
    interview_transcript.append({"role": "ai", "text": question})
    print(f"\n[Question {question_count}] {question}")

    encoded_question = urllib.parse.quote(question, safe='')
    headers = {
        "Content-Type": "text/plain",
        "X-Question-Text": encoded_question
    }
    return stream_audio(question), headers


def speech_to_text(audio_path):
    """Convert audio file to text using AssemblyAI"""
    try:
        transcriber = aai.Transcriber()
        config = aai.TranscriptionConfig(
            speech_models=["universal-3-pro", "universal-2"],
            language_detection=True,
            speaker_labels=True,
        )
        transcript = transcriber.transcribe(audio_path, config=config)
        return transcript.text if transcript.text else ""
    except Exception as e:
        print(f"Speech-to-text error: {e}")
        return ""


@app.route("/submit-answer", methods=["POST"])
def submit_answer():
    global question_count, last_question_text

    audio_file = request.files["audio"]
    temp_path = tempfile.NamedTemporaryFile(delete=False, suffix=".webm").name
    audio_file.save(temp_path)
    answer = speech_to_text(temp_path)
    os.unlink(temp_path)

    if not answer or answer.strip() == "":
        answer = "I'm not sure about this one."

    print(f"[Answer {question_count}] {answer}")

    # Store answer in local transcript
    interview_transcript.append({"role": "user", "text": answer})

    config = {"configurable": {"thread_id": thread_id}}

    # Store the answer in agent memory
    agent_answer_resp, error = safe_agent_invoke(
        [{"role": "user", "content": answer}],
        config
    )

    if error:
        return jsonify({"error": error["message"]}), 429 if error["type"] == "rate_limit" else 500

    question_count += 1
    prompt = f"""The candidate just answered. Question number so far: {question_count}.

Guidance based on where we are in the interview:
- If question_count < 8: Continue. Ask the next question based on JD requirements or a relevant topic NOT yet covered. Do NOT revisit the same topic twice.
- If question_count >= 8: If you have covered: (a) JD technical requirements, (b) at least one behavioral question, then conclude the interview now. Say a warm thank-you in 1-2 sentences and append "[INTERVIEW_COMPLETE]" at the very end. Otherwise ask one more targeted question.
- If question_count >= 10: MUST conclude. Say thank-you and append "[INTERVIEW_COMPLETE]".

Instructions for your reply:
1. Briefly acknowledge what they ACTUALLY said (1 sentence). Reference their real words.
2. Ask your next focused question (1-2 sentences) OR wrap up warmly.
3. If they said "I don't know" or gave a vague answer, acknowledge that briefly and move on to the next topic.
4. Total response: under 3 sentences.
5. Do NOT ask about topics already covered in this conversation.
"""

    response, error = safe_agent_invoke(
        [{"role": "user", "content": prompt}],
        config
    )

    if error:
        return jsonify({"error": error["message"]}), 429 if error["type"] == "rate_limit" else 500

    question = response["messages"][-1].content

    is_complete = False
    if "[INTERVIEW_COMPLETE]" in question:
        is_complete = True
        question = question.replace("[INTERVIEW_COMPLETE]", "").strip()

    last_question_text = question
    interview_transcript.append({"role": "ai", "text": question})
    print(f"\n[Question {question_count}] {question} (Complete: {is_complete})")

    encoded_question = urllib.parse.quote(question, safe='')
    headers = {
        'Content-Type': 'text/plain',
        'X-Question-Number': str(question_count),
        'X-Question-Text': encoded_question,
        'Access-Control-Expose-Headers': 'X-Question-Number, X-Interview-Complete, X-Question-Text'
    }
    if is_complete:
        headers['X-Interview-Complete'] = 'true'

    return stream_audio(question), headers


@app.route("/get-feedback", methods=["POST"])
def get_feedback():
    """Generate detailed interview feedback using stored transcript as fallback."""
    global resume_text, job_description, derived_role

    config = {"configurable": {"thread_id": thread_id}}
    transcript_str = build_transcript_string()

    formatted_feedback_prompt = FEEDBACK_PROMPT.format(
        resume_text=resume_text,
        job_description=job_description if job_description else "Not specified",
        role=derived_role,
        transcript=transcript_str if transcript_str else "No transcript available."
    )

    full_prompt = f"{formatted_feedback_prompt}\n\nReview the interview transcript above and provide detailed JSON feedback."

    response, error = safe_agent_invoke(
        [{"role": "user", "content": full_prompt}],
        config
    )

    if error:
        # If API fails, generate basic feedback from stored transcript
        if interview_transcript:
            fallback_feedback = {
                "subject": derived_role,
                "candidate_score": 3,
                "feedback": f"Interview completed with {len([e for e in interview_transcript if e['role'] == 'user'])} answers recorded. The candidate participated in the interview covering topics related to {derived_role}. Detailed AI feedback is temporarily unavailable due to API quota limits — please try again shortly.",
                "areas_of_improvement": "Please retry feedback generation in a few minutes when the API quota resets. Your interview has been recorded and no answers were lost."
            }
            return jsonify({"success": True, "feedback": fallback_feedback})
        return jsonify({"error": error["message"]}), 429 if error["type"] == "rate_limit" else 500

    text = response["messages"][-1].content
    print(f"\n[Feedback Generated]\n{text}\n")

    try:
        cleaned = text.strip()
        if "```" in cleaned:
            # Extract JSON from markdown code block
            parts = cleaned.split("```")
            for part in parts:
                part = part.strip()
                if part.startswith("json"):
                    part = part[4:].strip()
                if part.startswith("{"):
                    cleaned = part
                    break
        feedback = json.loads(cleaned)
        return jsonify({"success": True, "feedback": feedback})
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}\nRaw text: {text}")
        # Fallback: return a structured error feedback
        fallback_feedback = {
            "subject": derived_role,
            "candidate_score": 3,
            "feedback": "Feedback was generated but could not be parsed. The interview covered technical and behavioral questions related to the role.",
            "areas_of_improvement": "Please try regenerating feedback."
        }
        return jsonify({"success": True, "feedback": fallback_feedback})


@app.route("/get-transcript", methods=["GET"])
def get_transcript():
    """Return the stored interview transcript."""
    return jsonify({"transcript": interview_transcript})


app.run(debug=True, port=5000)
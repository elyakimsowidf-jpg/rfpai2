import os
import json

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

_client = genai.Client()
_MODEL = "gemini-3-flash-preview"

_SYSTEM_TEMPLATE = """You are an expert document editor assistant for RFP (Request for Proposal) documents.
You are helping a user refine a specific section. You may ONLY suggest changes to the "Improved Text" field.
The original text must never be altered.
IMPORTANT: Always respond in Hebrew unless the user explicitly writes in English.

--- CURRENT SECTION ---
Section Title: {section_title}

Original Text:
{original_text}

Current Improved Text:
{improved_text}

Explanation of prior improvements:
{explanation}
--- END SECTION ---

Instructions:
- When the user asks a question, explain or discuss the section helpfully.
- When the user requests a change or improvement, propose an updated "Improved Text" in full.
- NEVER change the original text.
- Respond ONLY with valid JSON in exactly this structure, with no extra text before or after:
{{
  "message": "Your conversational reply to the user",
  "is_proposal": true,
  "proposed_improved_text": "Full revised improved text here"
}}
If no change is being proposed, use:
{{
  "message": "Your reply",
  "is_proposal": false,
  "proposed_improved_text": null
}}
"""


def chat_with_section(user_message: str, selected_row: dict, chat_history: list) -> dict:
    """
    Generate a chat response in the context of a selected document section.

    Args:
        user_message:  The user's latest message.
        selected_row:  Dict with section_title, original_text, improved_text, explanation.
        chat_history:  Prior turns as list of {role: 'user'|'model', content: str}.

    Returns:
        Dict with keys: message (str), is_proposal (bool), proposed_improved_text (str|None).
    """
    system_instruction = _SYSTEM_TEMPLATE.format(
        section_title=selected_row.get("section_title", ""),
        original_text=selected_row.get("original_text", ""),
        improved_text=selected_row.get("improved_text", ""),
        explanation=selected_row.get("explanation", ""),
    )

    contents = []
    for turn in chat_history:
        role = turn.get("role", "user")
        if role == "assistant":
            role = "model"
        contents.append(
            types.Content(role=role, parts=[types.Part(text=turn["content"])])
        )
    contents.append(
        types.Content(role="user", parts=[types.Part(text=user_message)])
    )

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        response_mime_type="application/json",
    )

    response = _client.models.generate_content(
        model=_MODEL,
        contents=contents,
        config=config,
    )

    raw = (response.text or "").strip()
    try:
        parsed = json.loads(raw)
        return {
            "message": parsed.get("message", raw),
            "is_proposal": bool(parsed.get("is_proposal", False)),
            "proposed_improved_text": parsed.get("proposed_improved_text") or None,
        }
    except (json.JSONDecodeError, AttributeError):
        return {
            "message": raw,
            "is_proposal": False,
            "proposed_improved_text": None,
        }

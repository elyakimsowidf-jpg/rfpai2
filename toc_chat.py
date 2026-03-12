import json

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

_client = genai.Client()
_MODEL = "gemini-3-flash-preview"

_SYSTEM_TEMPLATE = """You are an expert in government RFP/SOW document architecture.
You are helping a user refine the table of contents for their document.

IMPORTANT: Always respond in Hebrew unless the user explicitly writes in English.

--- CURRENT TABLE OF CONTENTS ---
{current_toc_text}
--- END CURRENT TOC ---

--- ORIGINAL TABLE OF CONTENTS (baseline) ---
{original_toc_text}
--- END ORIGINAL TOC ---

Document summary (abbreviated):
{document_summary}

Market research findings (abbreviated):
{market_research}

Instructions:
- You may add, remove, rename, or reorder sections in the TOC when the user requests it.
- The original TOC sections should generally be preserved unless the user explicitly asks to change them.
- New sections should follow the existing numbering style (e.g. פרק, נספח).
- Each TOC item has three fields: kind (e.g. "פרק", "נספח"), number, title.

When the user asks a question, discuss the TOC helpfully.
When the user requests a change, propose an updated full TOC.

Respond ONLY with valid JSON in this exact structure:
{{
  "message": "Your conversational reply in Hebrew",
  "is_proposal": true,
  "proposed_toc": [{{"kind": "...", "number": "...", "title": "..."}}],
  "changes_explanation": "Brief Hebrew explanation of what changed"
}}

If no change is being proposed, use:
{{
  "message": "Your reply",
  "is_proposal": false,
  "proposed_toc": null,
  "changes_explanation": null
}}
"""


_RECS_SYSTEM_TEMPLATE = """You are an expert in government RFP/SOW document architecture.
You are helping a user refine the recommendations for their table of contents BEFORE generating it.

IMPORTANT: Always respond in Hebrew unless the user explicitly writes in English.

--- CURRENT RECOMMENDATIONS ---
{current_recommendations}
--- END CURRENT RECOMMENDATIONS ---

--- ORIGINAL TABLE OF CONTENTS ---
{original_toc_text}
--- END ORIGINAL TOC ---

Document summary (abbreviated):
{document_summary}

Market research findings (abbreviated):
{market_research}

Instructions:
- The recommendations are bullet points suggesting what topics or sections to add/strengthen in the TOC.
- When the user asks to change, add, remove, or adjust recommendations, produce updated recommendations.
- Keep recommendations as 3-5 concise bullet points in Hebrew.
- Focus on actionable insights from the market research.

Respond ONLY with valid JSON in this exact structure:
{{
  "message": "Your conversational reply in Hebrew",
  "updated_recommendations": "Updated bullet-point recommendations text (or null if no change)"
}}

If no change is being proposed:
{{
  "message": "Your reply",
  "updated_recommendations": null
}}
"""


def _format_toc_items(items):
    lines = []
    for item in items:
        parts = [
            (item.get("kind") or "").strip(),
            (item.get("number") or "").strip(),
            (item.get("title") or "").strip(),
        ]
        lines.append(" ".join(p for p in parts if p))
    return "\n".join(lines)


def chat_with_toc(
    user_message: str,
    current_toc: list,
    original_toc: list,
    document_summary: str,
    market_research: str,
    chat_history: list,
) -> dict:
    system_instruction = _SYSTEM_TEMPLATE.format(
        current_toc_text=_format_toc_items(current_toc),
        original_toc_text=_format_toc_items(original_toc),
        document_summary=(document_summary or "")[:3000],
        market_research=(market_research or "")[:3000],
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
        proposed_toc = parsed.get("proposed_toc")
        if proposed_toc and isinstance(proposed_toc, list):
            proposed_toc = [
                {
                    "kind": str(item.get("kind", "")).strip(),
                    "number": str(item.get("number", "")).strip(),
                    "title": str(item.get("title", "")).strip(),
                }
                for item in proposed_toc
                if isinstance(item, dict)
            ]
        else:
            proposed_toc = None

        return {
            "message": parsed.get("message", raw),
            "is_proposal": bool(parsed.get("is_proposal", False)),
            "proposed_toc": proposed_toc,
            "changes_explanation": parsed.get("changes_explanation") or None,
        }
    except (json.JSONDecodeError, AttributeError):
        return {
            "message": raw,
            "is_proposal": False,
            "proposed_toc": None,
            "changes_explanation": None,
        }


def chat_with_recommendations(
    user_message: str,
    current_recommendations: str,
    original_toc: list,
    document_summary: str,
    market_research: str,
    chat_history: list,
) -> dict:
    system_instruction = _RECS_SYSTEM_TEMPLATE.format(
        current_recommendations=(current_recommendations or "").strip(),
        original_toc_text=_format_toc_items(original_toc),
        document_summary=(document_summary or "")[:3000],
        market_research=(market_research or "")[:3000],
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
            "updated_recommendations": parsed.get("updated_recommendations") or None,
        }
    except (json.JSONDecodeError, AttributeError):
        return {
            "message": raw,
            "updated_recommendations": None,
        }

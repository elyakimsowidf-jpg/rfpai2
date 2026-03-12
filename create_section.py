import json
import re
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client()


def _extract_chapter_number(title: str) -> Optional[str]:
    """Return the leading numeric token from a title, e.g. 'Chapter 6: Fuel' -> '6'."""
    match = re.search(r'\b(\d+(?:\.\d+)*)\b', title)
    return match.group(1) if match else None


def _extract_json(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()
    for prefix in ("```json", "```"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1:
            return json.loads(cleaned[start:end + 1])
        raise


def create_section(
    chapter_title: str,
    original_text: str,
    market_research: str,
    document_summary: str,
) -> Dict[str, Any]:
    """Generate an improved version of a single document section.

    Returns a dict with keys:
      - improved_text: full Markdown content of the improved section
      - explanation: brief description of the changes made
    """
    chapter_number = _extract_chapter_number(chapter_title)
    if chapter_number:
        numbering_instruction = (
            f"- Use structured subsection numbering that matches this chapter's number. "
            f"For example, for \"{chapter_title}\", label subsections "
            f"{chapter_number}.1, {chapter_number}.1.1, {chapter_number}.1.2, "
            f"{chapter_number}.2, etc.\n"
            f"- Every subsection heading must follow this numbering scheme exactly.\n"
        )
    else:
        numbering_instruction = (
            "- Use logical subsection numbering where this section contains subsections.\n"
        )

    original_block = (
        original_text.strip()
        if original_text and original_text.strip()
        else "(No original text — this is a new section)"
    )

    prompt = f"""You are an expert technical writer specialising in government RFP and SOW procurement documents.

You are improving/creating one chapter of a document. Here is the full context:

1. Chapter title: {chapter_title}

2. Original section text:
{original_block}

3. Market research insights:
{market_research}

4. Document summary (for broader context):
{document_summary}

Instructions:
- CRITICAL: Keep the original text as your base. Preserve the existing writing style, structure, and formatting.
- Only make targeted improvements — add missing details, fix inaccuracies, or incorporate relevant market research insights.
- Do NOT rewrite from scratch. The output should be recognizable as a revision of the original, not a replacement.
- If the original section has existing content, keep as much of it as possible and only add/modify what is necessary.
- Start directly with the content — do NOT repeat the chapter title as a heading (it will be prepended automatically).
{numbering_instruction}- Write in the same language as the original text (preserve Hebrew, English, or mixed usage as-is).
- IMPORTANT: Output ONLY in the language of the original text. Do not introduce any other languages (no Chinese, Japanese, etc.).
- If the original section is empty (new section), write thorough professional content based on the market research and document context.
- Explain changes clearly and justify them.

Return a JSON object with exactly these two keys:
{{
  "improved_text": "<the revised chapter content in Markdown — keep original text as base, only modify what's needed>",
  "explanation": "<brief explanation of the key changes made and why, written in Hebrew>"
}}
IMPORTANT: Write the "explanation" field in Hebrew."""

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=prompt,
    )

    parsed = _extract_json(response.text or "")
    return {
        "improved_text": (parsed.get("improved_text") or "").strip(),
        "explanation": (parsed.get("explanation") or "").strip(),
    }

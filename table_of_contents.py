import json
from typing import Any, Dict, List

from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client()


def _extract_json(text: str) -> Dict[str, Any]:
    cleaned = (text or "").strip()

    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]

    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1:
            return json.loads(cleaned[start : end + 1])
        raise


def _load_original_toc(toc_path: str) -> List[Dict[str, str]]:
    with open(toc_path, "r", encoding="utf-8") as f:
        toc = json.load(f)

    if not isinstance(toc, list):
        raise ValueError("Original TOC must be a JSON array")

    normalized: List[Dict[str, str]] = []
    for item in toc:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "kind": str(item.get("kind", "")).strip(),
                "number": str(item.get("number", "")).strip(),
                "title": str(item.get("title", "")).strip(),
            }
        )
    return normalized


def _format_toc(toc: List[Dict[str, str]]) -> str:
    # Keep display human-readable and consistent with the document's TOC line style.
    lines: List[str] = []
    for item in toc:
        kind = (item.get("kind") or "").strip()
        number = (item.get("number") or "").strip()
        title = (item.get("title") or "").strip()
        lines.append(" ".join([x for x in [kind, number, title] if x]))
    return "\n".join(lines)


def _build_prompt(
    original_toc: List[Dict[str, str]],
    original_toc_page_text: str,
    document_summary: str,
    market_research: str,
) -> str:
    return f"""
You are an expert in government RFP/SOW document architecture.

You are given:
1) Original table of contents (authoritative baseline)
2) Document summary
3) Market research results

Original table of contents (JSON):
{json.dumps(original_toc, ensure_ascii=False, indent=2)}

Original TOC page text (includes cover/title context when available):
{original_toc_page_text}

Document summary:
{document_summary}

Market research:
{market_research}

Task:
- Produce an updated table of contents that preserves ALL existing sections from the original.
- You are not allowed to remove, rename, or reorder existing sections.
- You may add only a small number of new sections (0 to 3) if truly needed.
- New sections should be appended in a way that remains consistent with the existing numbering style.
- Keep exactly the same item format as the original TOC: each item must have only these keys: kind, number, title.

Return JSON only in this exact schema:
{{
  "new_toc": [
    {{"kind": "...", "number": "...", "title": "..."}}
  ],
    "rendered_new_toc_text": "...",
  "additions_explanation": "..."
}}

Rules for additions_explanation:
- If no sections were added, return an empty string: ""
- If sections were added, explain briefly what was added and why.
- IMPORTANT: Write the additions_explanation field in Hebrew.

Rules for rendered_new_toc_text:
- Must be plain text (not JSON).
- Must look similar to the original TOC block style.
- Keep title/header lines from the original text when present.
- Keep line-based TOC presentation (e.g., פרק ..., נספח ...).
- Do not remove existing sections.
"""


def generate_toc_recommendations(
    document_summary: str,
    market_research: str,
    original_toc: List[Dict[str, str]] | None = None,
) -> str:
    """Generate a short recommendation based on market research for what to address in the new TOC."""
    original_toc_text = _format_toc(original_toc or [])

    prompt = f"""You are an expert in government RFP/SOW document architecture.

Based on the market research findings below, provide a SHORT recommendation (3-5 bullet points)
about what topics or sections could be valuable to add or strengthen in the updated table of contents.

Original table of contents:
{original_toc_text}

Document summary:
{(document_summary or '').strip()}

Market research findings:
{(market_research or '').strip()}

Instructions:
- Write your response in Hebrew.
- Keep it concise: 3-5 short bullet points maximum.
- Focus on actionable insights from the market research that could improve the document structure.
- Each bullet should mention a specific topic/area and briefly why it matters.
- Do NOT return JSON. Return plain text with bullet points (use - or * for bullets).
- Do NOT repeat what already exists in the TOC. Focus on gaps and opportunities.
"""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
    )

    return (response.text or "").strip()


def generate_new_table_of_contents(
    document_summary: str,
    market_research: str,
    toc_path: str = "toc.json",
    original_toc_page_text: str = "",
    original_toc: List[Dict[str, str]] | None = None,
) -> Dict[str, Any]:
    original_toc = original_toc or _load_original_toc(toc_path)
    original_toc_text = _format_toc(original_toc)

    prompt = _build_prompt(
        original_toc=original_toc,
        original_toc_page_text=(original_toc_page_text or "").strip(),
        document_summary=(document_summary or "").strip(),
        market_research=(market_research or "").strip(),
    )

    response = client.models.generate_content(
        model="gemini-3-flash-preview",
        contents=prompt,
    )

    parsed = _extract_json(response.text or "")
    new_toc = parsed.get("new_toc") or []
    rendered_new_toc_text = (parsed.get("rendered_new_toc_text") or "").strip()
    additions_explanation = (parsed.get("additions_explanation") or "").strip()

    if not isinstance(new_toc, list):
        raise ValueError("Invalid model output: new_toc must be a list")

    normalized_new_toc: List[Dict[str, str]] = []
    for item in new_toc:
        if not isinstance(item, dict):
            continue
        normalized_new_toc.append(
            {
                "kind": str(item.get("kind", "")).strip(),
                "number": str(item.get("number", "")).strip(),
                "title": str(item.get("title", "")).strip(),
            }
        )

    # Enforce: no original section may be removed.
    original_tuples = {(x["kind"], x["number"], x["title"]) for x in original_toc}
    new_tuples = {(x["kind"], x["number"], x["title"]) for x in normalized_new_toc}

    if not original_tuples.issubset(new_tuples):
        normalized_new_toc = list(original_toc)
        additions_explanation = ""

    additions_count = max(0, len(normalized_new_toc) - len(original_toc))
    if additions_count == 0:
        additions_explanation = ""

    if not rendered_new_toc_text:
        rendered_new_toc_text = _format_toc(normalized_new_toc)

    return {
        "original_toc": original_toc,
        "new_toc": normalized_new_toc,
        "original_toc_page_text": (original_toc_page_text or "").strip(),
        "original_toc_text": original_toc_text,
        "new_toc_text": rendered_new_toc_text,
        "additions_explanation": additions_explanation,
    }
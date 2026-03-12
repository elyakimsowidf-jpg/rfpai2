from __future__ import annotations

from datetime import datetime
import json
import re
import struct
import unicodedata
from typing import Dict, List

from dotenv import load_dotenv
from google import genai
from google.genai import types
from langchain_text_splitters import RecursiveCharacterTextSplitter
from markitdown import MarkItDown

load_dotenv()

client = genai.Client()

DOC_PATH = "/Users/leon/git/rfpai2/uploads/a.docx"
MODEL_NAME = "gemini-3-flash-preview"

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1500,
    chunk_overlap=0,
    length_function=len,
)


def _persist_artifact(artifact_writer, filename: str, content: str) -> None:
    if artifact_writer:
        artifact_writer(filename, content)


def _extract_text_from_doc(doc_path: str) -> str:
    """Extract text from an old-format .doc (OLE) file using olefile."""
    import olefile

    ole = olefile.OleFileIO(doc_path)
    try:
        data = ole.openstream("WordDocument").read()
    finally:
        ole.close()

    chars: list[str] = []
    for i in range(0, len(data) - 1, 2):
        code = struct.unpack_from("<H", data, i)[0]
        # Skip surrogates (0xD800-0xDFFF) and private use / invalid codepoints
        if 0xD800 <= code <= 0xDFFF:
            continue
        if 0x20 <= code < 0xFFFE or code in (0x0A, 0x0D, 0x09):
            chars.append(chr(code))
        else:
            if chars and chars[-1] != "\n":
                chars.append("\n")

    raw = "".join(chars)

    # Filter out garbage lines (very short, non-Hebrew/ASCII)
    hebrew_range = range(0x0590, 0x05FF + 1)
    cleaned_lines: list[str] = []
    for line in raw.split("\n"):
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append("")
            continue
        # Keep line only if it contains Hebrew or enough ASCII letters
        has_hebrew = any(ord(c) in hebrew_range for c in stripped)
        has_latin = sum(c.isascii() and c.isalpha() for c in stripped) > 2
        if has_hebrew or has_latin or len(stripped) > 10:
            cleaned_lines.append(stripped)

    return "\n".join(cleaned_lines).strip()


def split_doc_to_chunks(doc_path: str, artifact_writer=None) -> List[Dict]:
    try:
        md = MarkItDown(enable_plugins=False)
        result = md.convert(doc_path)
        text = strip_image_data(result.text_content)
    except Exception:
        # Fallback: try reading old .doc binary format
        if doc_path.lower().endswith(".doc"):
            text = _extract_text_from_doc(doc_path)
        else:
            raise

    _persist_artifact(artifact_writer, "output.md", text)

    chunks = text_splitter.split_text(text)
    return [{"section_title": f"Section {i}", "text": chunk} for i, chunk in enumerate(chunks)]


def extract_json_array(text: str) -> List[Dict]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()

    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except Exception:
        pass

    match = re.search(r"\[\s*{.*}\s*\]", text, re.DOTALL)
    if match:
        data = json.loads(match.group(0))
        if isinstance(data, list):
            return data

    raise ValueError(f"Could not parse JSON array from model response:\n{text}")


def strip_image_data(text: str) -> str:
    """Remove base64 image data and other unreadable binary strings from text."""
    # Remove data:image/... base64 strings (inline images)
    text = re.sub(r'data:image/[^;]+;base64,[A-Za-z0-9+/=\s]{20,}', '[תמונה]', text)
    # Remove standalone long base64-like blocks (40+ chars of base64 alphabet)
    text = re.sub(r'(?<!\w)[A-Za-z0-9+/=]{40,}(?!\w)', '[תמונה]', text)
    # Remove markdown image references with long unreadable alt text or data URIs
    text = re.sub(r'!\[[^\]]{0,200}\]\(data:[^)]+\)', '[תמונה]', text)
    return text


def normalize_text(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("״", '"').replace("׳", "'")
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_for_match(s: str) -> str:
    s = normalize_text(s)
    s = s.lower()
    s = re.sub(r"[\.\,\-\*\:\;\'\"\(\)\[\]\{\}\/\\\|\!\?\#\_`]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def build_section_title(item: Dict) -> str:
    if item["kind"] == "פרק":
        return f'פרק {item["number"]} - {item["title"]}'
    return f'נספח {item["number"]} - {item["title"]}'


def extract_toc_with_llm(toc_text: str) -> List[Dict]:
    prompt = f"""
Extract the table of contents entries from this Hebrew document.

Return JSON only.
No markdown.
No explanation.

Include:
- main chapters beginning with "פרק"
- appendices beginning with "נספח"

Output format:
[
  {{"kind": "פרק", "number": "1", "title": "כללי"}},
  {{"kind": "פרק", "number": "2", "title": "פרופיל השימוש"}},
  {{"kind": "נספח", "number": "א", "title": "דוחות"}}
]

Rules:
- Preserve the original Hebrew titles
- Ignore page numbers
- Keep the order from the table of contents
- "number" must be a string
- For chapters use kind "פרק"
- For appendices use kind "נספח"

Text:
{toc_text}
""".strip()

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            tools=[],
        ),
    )

    items = extract_json_array(response.text or "")

    cleaned: List[Dict] = []
    seen = set()

    for item in items:
        kind = str(item.get("kind", "")).strip()
        number = str(item.get("number", "")).strip()
        title = str(item.get("title", "")).strip()

        if kind not in {"פרק", "נספח"}:
            continue
        if not number or not title:
            continue

        key = (kind, number)
        if key in seen:
            continue

        seen.add(key)
        cleaned.append({
            "kind": kind,
            "number": number,
            "title": title,
        })

    return cleaned


def build_review_lines(left_text: str, toc: List[Dict], artifact_writer=None) -> List[Dict]:
    cleaned_titles = [clean_for_match(item["title"]) for item in toc]
    max_line_len = (max(len(title) for title in cleaned_titles) + 15) if cleaned_titles else 100

    raw_lines = left_text.split("\n")
    cleaned_lines = []

    for i, line in enumerate(raw_lines):
        cleaned = clean_for_match(line)

        if not cleaned:
            continue

        if len(cleaned) > max_line_len:
            continue

        cleaned_lines.append({
            "line_index": i,
            "cleaned_line": cleaned,
        })

    review_lines_text = "".join(
        f"{item['line_index']}: {item['cleaned_line']}\n" for item in cleaned_lines
    )
    _persist_artifact(artifact_writer, "review_lines.txt", review_lines_text)

    return cleaned_lines


def find_title_lines_with_llm(toc: List[Dict], review_lines_text: str) -> List[Dict]:
    prompt = f"""
You are given:

1. A Hebrew table of contents.
2. A filtered line index from the document body.
Each body line is formatted as:
<number>: <cleaned line text>

Your job:
For each TOC item, choose the single best matching line_index from the body lines.

Important rules:
- Return JSON only
- No markdown
- No explanation
- Preserve the original TOC items
- Add a field called "line_index"
- line_index must be an integer
- Match semantically, not only exact text
- Small wording differences are allowed
- Prefer the main section heading, not a sub-heading
- The returned line_index values should be in ascending order
- Every TOC item must appear exactly once in the output

Output format:
[
  {{"kind": "פרק", "number": "1", "title": "כללי", "line_index": 0}},
  {{"kind": "פרק", "number": "2", "title": "פרופיל השימוש", "line_index": 76}}
]

TOC:
{json.dumps(toc, ensure_ascii=False, indent=2)}

Body lines:
{review_lines_text}
""".strip()

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            tools=[],
        ),
    )

    items = extract_json_array(response.text or "")

    cleaned: List[Dict] = []
    seen = set()

    for item in items:
        kind = str(item.get("kind", "")).strip()
        number = str(item.get("number", "")).strip()
        title = str(item.get("title", "")).strip()
        line_index = item.get("line_index")

        if kind not in {"פרק", "נספח"}:
            continue
        if not number or not title:
            continue
        if not isinstance(line_index, int):
            try:
                line_index = int(line_index)
            except Exception:
                continue

        key = (kind, number)
        if key in seen:
            continue

        seen.add(key)
        cleaned.append({
            "kind": kind,
            "number": number,
            "title": title,
            "line_index": line_index,
        })

    cleaned.sort(key=lambda x: x["line_index"])
    return cleaned


def split_by_line_indexes(left_text: str, title_lines: List[Dict]) -> List[Dict]:
    raw_lines = left_text.split("\n")
    sections: List[Dict] = []

    title_lines = sorted(title_lines, key=lambda x: x["line_index"])

    for i, item in enumerate(title_lines):
        start_idx = item["line_index"]
        end_idx = title_lines[i + 1]["line_index"] if i + 1 < len(title_lines) else len(raw_lines)

        section_text = "\n".join(raw_lines[start_idx:end_idx]).strip()

        sections.append({
            "section_title": build_section_title(item),
            "kind": item["kind"],
            "number": item["number"],
            "title": item["title"],
            "line_index": start_idx,
            "text": section_text,
        })

    return sections


def save_sections_markdown(sections: List[Dict], filename: str = "merged_sections.md") -> None:
    with open(filename, "w", encoding="utf-8") as f:
        for section in sections:
            f.write(f"# {section['section_title']}\n\n")
            f.write(f"{section['text']}\n\n")


def save_json(obj: object, filename: str) -> None:
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _sections_to_markdown(sections: List[Dict]) -> str:
    parts = []
    for section in sections:
        parts.append(f"# {section['section_title']}\n\n{section['text']}")
    return "\n\n".join(parts)


def split_doc_to_sections(doc_path, artifact_writer=None):
    chunks = split_doc_to_chunks(doc_path, artifact_writer=artifact_writer)
    toc_text = chunks[0]["text"]
    toc = extract_toc_with_llm(toc_text)
    left_text = "\n\n".join(section["text"] for section in chunks[1:])

    if not toc:
        # No TOC items found – treat the whole document as a single section
        merged_sections = [{"section_title": "תוכן עניינים", "text": toc_text}]
        if left_text.strip():
            merged_sections.append({"section_title": "מסמך", "text": left_text})
        _persist_artifact(artifact_writer, "toc.json", json.dumps(toc, ensure_ascii=False, indent=2))
        _persist_artifact(artifact_writer, "toc_and_all_sections.md", _sections_to_markdown(merged_sections))
        return merged_sections

    review_lines = build_review_lines(left_text, toc, artifact_writer=artifact_writer)
    review_lines_text = "\n".join(f"{item['line_index']}: {item['cleaned_line']}" for item in review_lines)
    title_lines = find_title_lines_with_llm(toc, review_lines_text)
    merged_sections = [{"section_title": "תוכן עניינים", "text": toc_text}]
    merged_sections += split_by_line_indexes(left_text, title_lines)

    _persist_artifact(artifact_writer, "toc.json", json.dumps(toc, ensure_ascii=False, indent=2))
    _persist_artifact(
        artifact_writer,
        "title_lines.json",
        json.dumps(title_lines, ensure_ascii=False, indent=2),
    )
    _persist_artifact(artifact_writer, "toc_and_all_sections.md", _sections_to_markdown(merged_sections))
    return merged_sections

if __name__ == "__main__":
    print(f"{datetime.now()}: start")

    chunks = split_doc_to_chunks(DOC_PATH)
    print(f"{datetime.now()}: chunks={len(chunks)}")

    toc_text = chunks[0]["text"]
    toc = extract_toc_with_llm(toc_text)
    print(f"{datetime.now()}: toc_items={len(toc)}")
    for item in toc:
        print("  ", build_section_title(item))

    left_text = "\n\n".join(section["text"] for section in chunks[1:])

    review_lines = build_review_lines(left_text, toc)
    print(f"{datetime.now()}: review_lines={len(review_lines)}")

    with open("review_lines.txt", "r", encoding="utf-8") as f:
        review_lines_text = f.read()

    title_lines = find_title_lines_with_llm(toc, review_lines_text)
    print(f"{datetime.now()}: title_lines={len(title_lines)}")
    for item in title_lines:
        print(f"  {item['line_index']}: {build_section_title(item)}")

    merged_sections = split_by_line_indexes(left_text, title_lines)
    print(f"{datetime.now()}: merged_sections={len(merged_sections)}")
    for section in merged_sections:
        print("  ", section["section_title"])

    save_json(toc, "toc.json")
    save_json(title_lines, "title_lines.json")
    save_sections_markdown(merged_sections, "merged_sections.md")

    print(f"{datetime.now()}: done")
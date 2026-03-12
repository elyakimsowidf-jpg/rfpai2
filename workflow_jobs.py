from __future__ import annotations

from datetime import datetime, timezone
import mimetypes
import os
from pathlib import Path
import uuid
from typing import Any

from create_section import create_section
from market_research import generate_market_research, translate_market_research_to_hebrew
from split_doc import split_doc_to_sections, strip_image_data
from summary_workflow import summarize_section
from workflow_store import BaseWorkflowStore


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_event(manifest: dict[str, Any], message: str) -> None:
    manifest.setdefault("progress", []).append(
        {
            "timestamp": _now_iso(),
            "message": message,
        }
    )
    manifest["updated_at"] = _now_iso()


def _source_artifact_name(filename: str) -> str:
    return f"source/{Path(filename).name}"


def _guess_content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def create_workflow(
    store: BaseWorkflowStore,
    workflow_type: str,
    input_payload: dict[str, Any],
) -> dict[str, Any]:
    workflow_id = uuid.uuid4().hex
    created_at = _now_iso()
    manifest: dict[str, Any] = {
        "workflow_id": workflow_id,
        "workflow_type": workflow_type,
        "status": "pending",
        "phase": "pending",
        "created_at": created_at,
        "updated_at": created_at,
        "progress": [],
        "input": {},
        "artifacts": {},
        "result_artifact": None,
        "storage": store.storage_descriptor(),
        "total_sections": 0,
        "current_section_index": 0,
    }

    if workflow_type == "improve":
        source_local_path = input_payload["source_local_path"]
        filename = input_payload["filename"]
        artifact_name = _source_artifact_name(filename)
        with open(source_local_path, "rb") as source_file:
            store.write_bytes(
                workflow_id,
                artifact_name,
                source_file.read(),
                content_type=_guess_content_type(filename),
            )
        manifest["input"] = {
            "filename": filename,
            "source_artifact": artifact_name,
        }
        manifest["phase"] = "split_document"
        _append_event(manifest, f"Workflow created for {filename}")
    elif workflow_type == "market_research":
        manifest["input"] = {
            "summary": input_payload["summary"],
            "user_goal": input_payload["user_goal"],
        }
        manifest["phase"] = "research"
        _append_event(manifest, "תהליך מחקר שוק נוצר")
    elif workflow_type == "section_generation":
        sections = input_payload["sections"]
        manifest["input"] = {
            "sections": sections,
            "document_summary": input_payload["document_summary"],
            "market_research": input_payload["market_research"],
        }
        manifest["phase"] = "generate_sections"
        manifest["total_sections"] = len(sections)
        store.write_json(workflow_id, "artifacts/sections/section_rows.json", sections)
        _append_event(manifest, f"תהליך יצירת סעיפים נוצר עבור {len(sections)} סעיפים")
    elif workflow_type == "single_section":
        section = {
            "sectionTitle": input_payload["chapter_title"],
            "originalText": input_payload["original_text"],
            "improvedText": "",
            "explanation": "",
        }
        manifest["input"] = {
            "sections": [section],
            "document_summary": input_payload["document_summary"],
            "market_research": input_payload["market_research"],
        }
        manifest["phase"] = "generate_sections"
        manifest["total_sections"] = 1
        store.write_json(workflow_id, "artifacts/sections/section_rows.json", [section])
        _append_event(manifest, f"תהליך יצירת סעיף נוצר עבור {section['sectionTitle']}")
    else:
        raise ValueError(f"Unsupported workflow type: {workflow_type}")

    store.save_manifest(manifest)
    return hydrate_workflow(store, manifest)


def load_workflow(store: BaseWorkflowStore, workflow_id: str) -> dict[str, Any]:
    return hydrate_workflow(store, store.load_manifest(workflow_id))


def advance_workflow(store: BaseWorkflowStore, workflow_id: str) -> dict[str, Any]:
    manifest = store.load_manifest(workflow_id)
    if manifest["status"] in {"completed", "failed"}:
        return hydrate_workflow(store, manifest)

    manifest["status"] = "running"

    try:
        if manifest["workflow_type"] == "improve":
            _advance_improve(store, manifest)
        elif manifest["workflow_type"] == "market_research":
            _advance_market_research(store, manifest)
        elif manifest["workflow_type"] in {"section_generation", "single_section"}:
            _advance_section_generation(store, manifest)
        else:
            raise ValueError(f"Unsupported workflow type: {manifest['workflow_type']}")
    except Exception as exc:
        manifest["status"] = "failed"
        manifest["phase"] = "failed"
        manifest["last_error"] = str(exc)
        _append_event(manifest, f"Failed: {exc}")

    store.save_manifest(manifest)
    return hydrate_workflow(store, manifest)


def hydrate_workflow(store: BaseWorkflowStore, manifest: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "workflow_id": manifest["workflow_id"],
        "workflow_type": manifest["workflow_type"],
        "status": manifest["status"],
        "phase": manifest["phase"],
        "created_at": manifest["created_at"],
        "updated_at": manifest["updated_at"],
        "storage": manifest.get("storage"),
        "total_sections": manifest.get("total_sections", 0),
        "current_section_index": manifest.get("current_section_index", 0),
        "progress_messages": [entry["message"] for entry in manifest.get("progress", [])],
        "last_error": manifest.get("last_error"),
        "result": None,
    }

    result_artifact = manifest.get("result_artifact")
    if result_artifact and store.exists(manifest["workflow_id"], result_artifact):
        payload["result"] = store.read_json(manifest["workflow_id"], result_artifact)
    elif manifest["workflow_type"] == "improve" and store.exists(manifest["workflow_id"], "artifacts/improve/table.json"):
        payload["result"] = {
            "table": store.read_json(manifest["workflow_id"], "artifacts/improve/table.json"),
            "toc_items": store.read_json(manifest["workflow_id"], "artifacts/improve/toc.json")
            if store.exists(manifest["workflow_id"], "artifacts/improve/toc.json")
            else [],
        }
    elif manifest["workflow_type"] in {"section_generation", "single_section"} and store.exists(
        manifest["workflow_id"], "artifacts/sections/section_rows.json"
    ):
        payload["result"] = {
            "section_rows": store.read_json(manifest["workflow_id"], "artifacts/sections/section_rows.json")
        }

    return payload


def _artifact_writer(store: BaseWorkflowStore, workflow_id: str, root: str):
    def write(relative_path: str, content: str) -> None:
        store.write_text(workflow_id, f"artifacts/{root}/{relative_path}", content)

    return write


def _advance_improve(store: BaseWorkflowStore, manifest: dict[str, Any]) -> None:
    workflow_id = manifest["workflow_id"]
    if manifest["phase"] == "split_document":
        _append_event(manifest, "שלב 1: פיצול המסמך לסעיפים...")
        source_artifact = manifest["input"]["source_artifact"]
        with store.materialize_file(workflow_id, source_artifact) as local_path:
            sections = split_doc_to_sections(
                local_path,
                artifact_writer=_artifact_writer(store, workflow_id, "improve"),
            )
        store.write_json(workflow_id, "artifacts/improve/sections.json", sections)
        manifest["total_sections"] = len(sections)
        manifest["current_section_index"] = 0
        store.write_json(workflow_id, "artifacts/improve/table.json", [])
        _append_event(manifest, f"נמצאו {len(sections)} סעיפים במסמך")
        manifest["phase"] = "summarize_sections"
        return

    if manifest["phase"] == "summarize_sections":
        sections = store.read_json(workflow_id, "artifacts/improve/sections.json")
        table = store.read_json(workflow_id, "artifacts/improve/table.json")
        index = manifest["current_section_index"]

        if index >= len(sections):
            manifest["phase"] = "finalize"
            return

        section = sections[index]
        total = len(sections)
        section_title = section.get("section_title", f"Section {index + 1}")

        _append_event(manifest, f"מעבד סעיף {index + 1}/{total}: {section_title}")
        result = summarize_section(section)
        table.append(
            {
                "section_title": section_title,
                "original_text": strip_image_data(section.get("text", "")),
                "summary": strip_image_data(result.get("summary", "")),
            }
        )
        store.write_json(workflow_id, "artifacts/improve/table.json", table)
        manifest["current_section_index"] = index + 1
        _append_event(manifest, f"הושלם סעיף {index + 1}/{total}: {section_title}")

        if manifest["current_section_index"] >= total:
            manifest["phase"] = "finalize"
        return

    if manifest["phase"] == "finalize":
        table = store.read_json(workflow_id, "artifacts/improve/table.json")
        result = {
            "source_file": manifest["input"]["filename"],
            "table": table,
            "toc_items": store.read_json(workflow_id, "artifacts/improve/toc.json")
            if store.exists(workflow_id, "artifacts/improve/toc.json")
            else [],
        }
        store.write_json(workflow_id, "artifacts/improve/result.json", result)
        manifest["result_artifact"] = "artifacts/improve/result.json"
        manifest["phase"] = "completed"
        manifest["status"] = "completed"
        _append_event(manifest, "תהליך הסתיים")


def _advance_market_research(store: BaseWorkflowStore, manifest: dict[str, Any]) -> None:
    workflow_id = manifest["workflow_id"]
    summary = manifest["input"]["summary"]
    user_goal = manifest["input"]["user_goal"]

    if manifest["phase"] == "research":
        _append_event(manifest, "מבצע מחקר שוק...")
        english_markdown = generate_market_research(summary, user_goal)
        store.write_text(workflow_id, "artifacts/market_research/source.md", english_markdown)
        manifest["phase"] = "translate"
        _append_event(manifest, "מחקר שוק הושלם, מתרגם לעברית...")
        return

    if manifest["phase"] == "translate":
        english_markdown = store.read_text(workflow_id, "artifacts/market_research/source.md")
        _append_event(manifest, "מתרגם מחקר שוק לעברית...")
        hebrew_markdown = translate_market_research_to_hebrew(english_markdown)
        result = {"markdown": strip_image_data(hebrew_markdown)}
        store.write_json(workflow_id, "artifacts/market_research/result.json", result)
        store.write_text(workflow_id, "artifacts/market_research/result.md", hebrew_markdown)
        manifest["result_artifact"] = "artifacts/market_research/result.json"
        manifest["phase"] = "completed"
        manifest["status"] = "completed"
        _append_event(manifest, "מחקר שוק הושלם")


def _advance_section_generation(store: BaseWorkflowStore, manifest: dict[str, Any]) -> None:
    workflow_id = manifest["workflow_id"]
    section_rows = store.read_json(workflow_id, "artifacts/sections/section_rows.json")
    index = manifest["current_section_index"]
    total = len(section_rows)

    if index >= total:
        result = {"section_rows": section_rows}
        store.write_json(workflow_id, "artifacts/sections/result.json", result)
        manifest["result_artifact"] = "artifacts/sections/result.json"
        manifest["phase"] = "completed"
        manifest["status"] = "completed"
        _append_event(manifest, "כל הסעיפים נוצרו")
        return

    current_row = section_rows[index]
    section_title = current_row.get("sectionTitle", f"סעיף {index + 1}")
    _append_event(manifest, f"יוצר סעיף {index + 1}/{total}: {section_title}")
    result = create_section(
        chapter_title=section_title,
        original_text=current_row.get("originalText", ""),
        market_research=manifest["input"]["market_research"],
        document_summary=manifest["input"]["document_summary"],
    )

    section_rows[index] = {
        **current_row,
        "improvedText": strip_image_data(result.get("improved_text", "")),
        "explanation": result.get("explanation", ""),
    }
    store.write_json(workflow_id, "artifacts/sections/section_rows.json", section_rows)
    manifest["current_section_index"] = index + 1
    _append_event(manifest, f"הושלם סעיף {index + 1}/{total}: {section_title}")

    if manifest["current_section_index"] >= total:
        result = {"section_rows": section_rows}
        store.write_json(workflow_id, "artifacts/sections/result.json", result)
        manifest["result_artifact"] = "artifacts/sections/result.json"
        manifest["phase"] = "completed"
        manifest["status"] = "completed"
        _append_event(manifest, "כל הסעיפים נוצרו")

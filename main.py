import os
from dotenv import load_dotenv

# Load .env BEFORE any imports that create genai.Client() at module level
load_dotenv()

# google-genai SDK reads GOOGLE_API_KEY; always prefer GEMINI_API_KEY from .env
if os.environ.get("GEMINI_API_KEY"):
    os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import io
import tempfile
from markitdown import MarkItDown
from markdown_pdf import MarkdownPdf, Section
from md2docx_python.src.md2docx_python import markdown_to_word
from market_research import run_market_research
from table_of_contents import generate_new_table_of_contents, generate_toc_recommendations
from workflow_jobs import advance_workflow, create_workflow, load_workflow
from workflow_store import get_workflow_store
from file_store import get_file_store

app = Flask(__name__, static_folder='static', static_url_path='')
# Enable CORS for the React frontend
CORS(app)

# Legacy local storage paths (kept for backward compatibility if needed)
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
CREATED_FOLDER = os.path.join(os.path.dirname(__file__), 'created_files')

# File storage namespace constants
UPLOADS_NAMESPACE = 'uploads'
CREATED_FILES_NAMESPACE = 'created_files'


def load_original_toc_page_text():
    toc_doc_path = os.path.join(os.path.dirname(__file__), 'toc_and_all_sections.md')
    if not os.path.exists(toc_doc_path):
        return ""

    try:
        with open(toc_doc_path, 'r', encoding='utf-8') as f:
            content = f.read()

        marker = "# Section 1"
        idx = content.find(marker)
        if idx == -1:
            first_page = content.strip()
        else:
            first_page = content[:idx].strip()

        # Keep the exact TOC page body while removing artificial section markers.
        lines = first_page.splitlines()
        if lines and lines[0].strip().lower() == "# section 0":
            lines = lines[1:]
            while lines and not lines[0].strip():
                lines = lines[1:]

        return "\n".join(lines).strip()
    except Exception:
        return ""

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

@app.route('/api/status', methods=['GET'])
def status():
    return jsonify({"status": "healthy", "service": "RFP API"})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file parameter"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Empty filename"}), 400
    
    try:
        store = get_file_store()
        content = file.read()
        store.write_bytes(UPLOADS_NAMESPACE, file.filename, content)
        return jsonify({"message": f"File {file.filename} uploaded successfully"}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to upload file: {str(e)}"}), 500

@app.route('/api/uploads', methods=['GET'])
def list_uploaded_files():
    try:
        store = get_file_store()
        files = store.list_files(UPLOADS_NAMESPACE)
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": f"Failed to list files: {str(e)}"}), 500

@app.route('/api/uploads/<filename>', methods=['DELETE'])
def delete_uploaded_file(filename):
    try:
        store = get_file_store()
        if store.delete(UPLOADS_NAMESPACE, filename):
            return jsonify({"message": "File deleted"}), 200
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        return jsonify({"error": f"Failed to delete file: {str(e)}"}), 500

@app.route('/api/convert', methods=['POST'])
def convert_doc():
    data = request.json
    filename = data.get('filename')
    new_filename = data.get('new_filename')
    
    if not filename or not new_filename:
        return jsonify({"error": "Missing filename or new_filename"}), 400
        
    if not new_filename.endswith('.md'):
        new_filename += '.md'
    
    try:
        store = get_file_store()
        if not store.exists(UPLOADS_NAMESPACE, filename):
            return jsonify({"error": "Original file not found"}), 404
        
        # Materialize the file temporarily to process it
        with store.materialize_file(UPLOADS_NAMESPACE, filename) as file_path:
            try:
                if filename.endswith('.docx') or filename.endswith('.doc'):
                    md = MarkItDown(enable_plugins=False)
                    text = md.convert(file_path)
                    md_content = f"# {new_filename.replace('.md', '')}\n\n{text}"
                else:
                    md_content = store.read_text(UPLOADS_NAMESPACE, filename)
            except Exception as e:
                return jsonify({"error": f"Failed to process file: {str(e)}"}), 500
        
        # Save the converted file to created_files
        store.write_text(CREATED_FILES_NAMESPACE, new_filename, md_content)
        
        return jsonify({
            "message": "Converted successfully", 
            "content": md_content,
            "new_filename": new_filename
        }), 200
    except Exception as e:
        return jsonify({"error": f"Conversion failed: {str(e)}"}), 500

@app.route('/api/uploads/<filename>', methods=['GET'])
def get_uploaded_file(filename):
    try:
        store = get_file_store()
        if not store.exists(UPLOADS_NAMESPACE, filename):
            return jsonify({"error": "File not found"}), 404
        content = store.read_text(UPLOADS_NAMESPACE, filename)
        return jsonify({"content": content})
    except Exception as e:
        return jsonify({"error": str(e)}), 404

@app.route('/api/files', methods=['POST'])
def save_created_file():
    data = request.json
    filename = data.get('filename')
    content = data.get('content')
    output_format = (data.get('output_format') or 'md').lower()

    if not filename or not content:
        return jsonify({"error": "Missing filename or content"}), 400

    if output_format not in {'md', 'pdf', 'docx'}:
        return jsonify({"error": "Invalid output_format"}), 400

    if output_format == 'md' and not filename.endswith('.md'):
        filename += '.md'
    elif output_format == 'pdf' and not filename.endswith('.pdf'):
        filename += '.pdf'
    elif output_format == 'docx' and not filename.endswith('.docx'):
        filename += '.docx'

    try:
        store = get_file_store()
        
        if output_format == 'pdf':
            # Generate PDF to temporary file, then save to storage
            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
                temp_pdf_path = temp_pdf.name
            try:
                pdf = MarkdownPdf(toc_level=2, optimize=True)
                pdf.meta['title'] = os.path.splitext(filename)[0]
                pdf.add_section(Section(content, root=os.path.dirname(__file__)))
                pdf.save(temp_pdf_path)
                with open(temp_pdf_path, 'rb') as f:
                    store.write_bytes(CREATED_FILES_NAMESPACE, filename, f.read(), content_type='application/pdf')
            finally:
                if os.path.exists(temp_pdf_path):
                    os.remove(temp_pdf_path)
                    
        elif output_format == 'docx':
            # Generate DOCX via temp markdown file
            with tempfile.NamedTemporaryFile('w', suffix='.md', encoding='utf-8', delete=False) as temp_md:
                temp_md.write(content)
                temp_md_path = temp_md.name
            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as temp_docx:
                temp_docx_path = temp_docx.name
            try:
                markdown_to_word(temp_md_path, temp_docx_path)
                with open(temp_docx_path, 'rb') as f:
                    store.write_bytes(CREATED_FILES_NAMESPACE, filename, f.read(), 
                                    content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            finally:
                if os.path.exists(temp_md_path):
                    os.remove(temp_md_path)
                if os.path.exists(temp_docx_path):
                    os.remove(temp_docx_path)
        else:  # markdown
            store.write_text(CREATED_FILES_NAMESPACE, filename, content, content_type='text/markdown; charset=utf-8')
            
        return jsonify({"message": "File saved successfully", "filename": filename}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to save file: {str(e)}"}), 500

@app.route('/api/files', methods=['GET'])
def list_created_files():
    try:
        store = get_file_store()
        files = store.list_files(CREATED_FILES_NAMESPACE)
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": f"Failed to list files: {str(e)}"}), 500

@app.route('/api/files/<filename>', methods=['GET'])
def download_created_file(filename):
    try:
        store = get_file_store()
        if not store.exists(CREATED_FILES_NAMESPACE, filename):
            return jsonify({"error": "File not found"}), 404
        
        # For binary files (pdf, docx), we need to stream them
        if filename.endswith('.pdf'):
            content = store.read_bytes(CREATED_FILES_NAMESPACE, filename)
            return send_file(io.BytesIO(content), mimetype='application/pdf', as_attachment=True, download_name=filename)
        elif filename.endswith('.docx'):
            content = store.read_bytes(CREATED_FILES_NAMESPACE, filename)
            return send_file(io.BytesIO(content), 
                            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                            as_attachment=True, download_name=filename)
        else:  # markdown
            content = store.read_text(CREATED_FILES_NAMESPACE, filename)
            return send_file(io.BytesIO(content.encode('utf-8')), mimetype='text/markdown', 
                            as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({"error": f"Failed to download file: {str(e)}"}), 500

@app.route('/api/improve', methods=['POST'])
def improve_document():
    data = request.json
    filename = data.get('filename')
    
    try:
        store = get_file_store()
        
        if filename:
            # Try to find the file in uploads
            actual_filename = filename
            if filename.endswith('.md'):
                base_name = filename[:-3]
                if base_name.startswith('new-'):
                    base_name = base_name[4:]
                
                # Try .docx, then .doc, then original filename
                for variant in [f"{base_name}.docx", f"{base_name}.doc", filename]:
                    if store.exists(UPLOADS_NAMESPACE, variant):
                        actual_filename = variant
                        break
            
            if not store.exists(UPLOADS_NAMESPACE, actual_filename):
                return jsonify({"error": "File not found in uploads folder"}), 404
        else:
            return jsonify({"error": "Missing filename parameter. Process_document requires a valid .docx file from uploads."}), 400

        # Materialize the file to get a local path for the workflow
        with store.materialize_file(UPLOADS_NAMESPACE, actual_filename) as file_path:
            workflow = create_workflow(
                get_workflow_store(),
                'improve',
                {
                    'filename': filename or actual_filename,
                    'source_local_path': file_path,
                },
            )
        return jsonify(workflow), 202
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/workflows/<workflow_id>', methods=['GET'])
def get_workflow_status(workflow_id):
    try:
        workflow = load_workflow(get_workflow_store(), workflow_id)
        return jsonify(workflow), 200
    except FileNotFoundError:
        return jsonify({"error": "Workflow not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/workflows/<workflow_id>/advance', methods=['POST'])
def advance_workflow_endpoint(workflow_id):
    try:
        workflow = advance_workflow(get_workflow_store(), workflow_id)
        status_code = 200 if workflow.get('status') != 'failed' else 500
        return jsonify(workflow), status_code
    except FileNotFoundError:
        return jsonify({"error": "Workflow not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def section_chat_endpoint():
    data = request.json or {}
    user_message = (data.get('message') or '').strip()
    selected_row = data.get('selected_row')
    chat_history = data.get('chat_history') or []

    if not user_message:
        return jsonify({"error": "Missing message"}), 400
    if not selected_row or not isinstance(selected_row, dict):
        return jsonify({"error": "Missing or invalid selected_row"}), 400

    from section_chat import chat_with_section
    result = chat_with_section(user_message, selected_row, chat_history)
    return jsonify(result)


@app.route('/api/toc-chat', methods=['POST'])
def toc_chat_endpoint():
    data = request.json or {}
    user_message = (data.get('message') or '').strip()
    current_toc = data.get('current_toc') or []
    original_toc = data.get('original_toc') or []
    document_summary = (data.get('document_summary') or '').strip()
    market_research = (data.get('market_research') or '').strip()
    chat_history = data.get('chat_history') or []

    if not user_message:
        return jsonify({"error": "Missing message"}), 400

    from toc_chat import chat_with_toc
    result = chat_with_toc(
        user_message, current_toc, original_toc,
        document_summary, market_research, chat_history,
    )
    return jsonify(result)

@app.route('/api/market-research', methods=['POST'])
def market_research_endpoint():
    data = request.json or {}
    summary = (data.get('summary') or '').strip()
    user_goal = (data.get('user_goal') or '').strip()

    if not summary:
        return jsonify({"error": "Missing summary"}), 400
    if not user_goal:
        return jsonify({"error": "Missing user_goal"}), 400

    try:
        workflow = create_workflow(
            get_workflow_store(),
            'market_research',
            {
                'summary': summary,
                'user_goal': user_goal,
            },
        )
        return jsonify(workflow), 202
    except Exception as e:
        return jsonify({"error": f"Failed to run market research: {str(e)}"}), 500


@app.route('/api/toc-recommendations', methods=['POST'])
def toc_recommendations_endpoint():
    data = request.json or {}
    summary = (data.get('summary') or '').strip()
    market_research = (data.get('market_research') or '').strip()
    original_toc = data.get('original_toc') or []

    if not summary:
        return jsonify({"error": "Missing summary"}), 400
    if not market_research:
        return jsonify({"error": "Missing market_research"}), 400

    try:
        recommendations = generate_toc_recommendations(
            document_summary=summary,
            market_research=market_research,
            original_toc=original_toc,
        )
        return jsonify({"recommendations": recommendations}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to generate recommendations: {str(e)}"}), 500


@app.route('/api/toc-recommendations-chat', methods=['POST'])
def toc_recommendations_chat_endpoint():
    data = request.json or {}
    user_message = (data.get('message') or '').strip()
    current_recommendations = (data.get('current_recommendations') or '').strip()
    original_toc = data.get('original_toc') or []
    document_summary = (data.get('document_summary') or '').strip()
    market_research = (data.get('market_research') or '').strip()
    chat_history = data.get('chat_history') or []

    if not user_message:
        return jsonify({"error": "Missing message"}), 400

    try:
        from toc_chat import chat_with_recommendations
        result = chat_with_recommendations(
            user_message, current_recommendations, original_toc,
            document_summary, market_research, chat_history,
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"Failed to chat about recommendations: {str(e)}"}), 500


@app.route('/api/table-of-contents', methods=['POST'])
def table_of_contents_endpoint():
    data = request.json or {}
    summary = (data.get('summary') or '').strip()
    market_research = (data.get('market_research') or '').strip()
    original_toc_text = (data.get('original_toc_text') or '').strip()
    original_toc = data.get('original_toc') or []

    if not summary:
        return jsonify({"error": "Missing summary"}), 400
    if not market_research:
        return jsonify({"error": "Missing market_research"}), 400

    try:
        original_toc_page_text = original_toc_text or load_original_toc_page_text()
        result = generate_new_table_of_contents(
            document_summary=summary,
            market_research=market_research,
            toc_path=os.path.join(os.path.dirname(__file__), 'toc.json'),
            original_toc_page_text=original_toc_page_text,
            original_toc=original_toc,
        )
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": f"Failed to generate table of contents: {str(e)}"}), 500


@app.route('/api/section-generation', methods=['POST'])
def create_section_generation_workflow():
    data = request.json or {}
    sections = data.get('sections') or []
    market_research = (data.get('market_research') or '').strip()
    document_summary = (data.get('document_summary') or '').strip()

    if not sections or not isinstance(sections, list):
        return jsonify({"error": "Missing or invalid sections"}), 400
    if not market_research:
        return jsonify({"error": "Missing market_research"}), 400

    try:
        workflow = create_workflow(
            get_workflow_store(),
            'section_generation',
            {
                'sections': sections,
                'market_research': market_research,
                'document_summary': document_summary,
            },
        )
        return jsonify(workflow), 202
    except Exception as e:
        return jsonify({"error": f"Failed to create section workflow: {str(e)}"}), 500


@app.route('/api/create-section', methods=['POST'])
def create_single_section_workflow():
    data = request.json or {}
    chapter_title = (data.get('chapter_title') or '').strip()
    original_text = (data.get('original_text') or '').strip()
    market_research = (data.get('market_research') or '').strip()
    document_summary = (data.get('document_summary') or '').strip()

    if not chapter_title:
        return jsonify({"error": "Missing chapter_title"}), 400
    if not market_research:
        return jsonify({"error": "Missing market_research"}), 400

    try:
        workflow = create_workflow(
            get_workflow_store(),
            'single_section',
            {
                'chapter_title': chapter_title,
                'original_text': original_text,
                'market_research': market_research,
                'document_summary': document_summary,
            },
        )
        return jsonify(workflow), 202
    except Exception as e:
        return jsonify({"error": f"Failed to create section workflow: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
